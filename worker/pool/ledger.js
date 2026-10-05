/* Community reward pool — accounting ledger (no transfers, no keys).

   VERIFIED maker reward (adapter) ──► maker_reward_events (UNIQUE source+external_id = idempotent)
        gross ─┬─ community = floor(gross × communityBps / 10000)  ──► prize_pool_transactions (MAKER_REWARD, VERIFIED)
               │                                                       of the open season → Season Top-10 prizes
               └─ remaining = gross − community (stays OUTSIDE the pool; recorded only)

   Everything is integer base units (lamports, BigInt math). One event can fund the pool exactly once:
   the event row, the pool row and the scan row are written in ONE atomic batch, guarded by UNIQUE keys.
   Admin corrections are separate, labelled ADJUSTMENT rows with a mandatory reason + audit entry. */
import { CONFIG } from '../config.js';
import { ApiError, now, isUniqueViolation } from '../lib/util.js';
import { auditStmt } from '../lib/platform.js';
import { lamportsToSolString, toLamports } from '../lib/prizes.js';
import * as SOL from './solana-adapter.js';

const C = CONFIG.communityPool;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const FINAL = ['PROCESSED', 'NOT_A_REWARD', 'FAILED_TX', 'DUPLICATE'];

export function split(gross, bps = C.communityBps) {
  const g = BigInt(gross);
  if (g <= 0n) throw new Error('gross must be positive');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('bad bps');
  const community = (g * BigInt(bps)) / 10000n;           // floor: never over-credit the pool
  return { gross: g, community, remaining: g - community };
}

/* The season whose prize pool receives new community money: running now, else the next upcoming one. Never a frozen/ended season. */
export async function openSeason(env, t = now()) {
  return (await env.DB.prepare("SELECT * FROM seasons WHERE status IN ('ACTIVE','UPCOMING') AND frozen_pool_lamports IS NULL AND starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1").bind(t, t).first())
    || env.DB.prepare("SELECT * FROM seasons WHERE status = 'UPCOMING' AND frozen_pool_lamports IS NULL AND starts_at > ? ORDER BY starts_at ASC LIMIT 1").bind(t).first();
}

function scanStmt(env, externalId, result, detail, t) {
  return env.DB.prepare(`INSERT INTO maker_reward_scan (external_id, result, detail, checked_at, attempts) VALUES (?,?,?,?,1)
    ON CONFLICT(external_id) DO UPDATE SET result = excluded.result, detail = excluded.detail, checked_at = excluded.checked_at, attempts = attempts + 1`)
    .bind(externalId, result, detail ? String(detail).slice(0, 200) : null, t);
}

/* Record ONE verified reward event (adapter output). Returns { created, duplicate, event }. */
export async function recordEvent(env, ev, actor) {
  const { gross, community, remaining } = split(ev.gross);
  if (gross > MAX) throw new ApiError(400, 'AMOUNT_TOO_LARGE', 'Amount out of range.');
  const t = now();
  const season = await openSeason(env, t);
  const sourceKey = [ev.source, ev.externalId];
  const evidence = JSON.stringify({ slot: ev.slot ?? null, blockTime: ev.blockTime ?? null, payerHint: ev.payerHint || null, receiver: ev.receiver, adapter: ev.source });
  const stmts = [
    env.DB.prepare(`INSERT INTO maker_reward_events (source, external_id, asset, decimals, gross_base_units, community_bps, community_base_units, remaining_base_units,
        receiver, payer_hint, block_time, slot, confirmation, status, season_id, evidence_json, created_at, processed_at, actor)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PROCESSED',?,?,?,?,?)`)
      .bind(ev.source, ev.externalId, C.asset, C.decimals, Number(gross), C.communityBps, Number(community), Number(remaining),
        ev.receiver, ev.payerHint || null, ev.blockTime ?? null, ev.slot ?? null, C.commitment, season && community > 0n ? season.id : null, evidence, t, t, actor),
  ];
  if (season && community > 0n) {
    stmts.push(env.DB.prepare(`INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, tx_signature, status, verification_method, notes, created_at, verified_at, actor, maker_event_id)
      VALUES (?, ?, 'MAKER_REWARD', ?, 'VERIFIED', ?, ?, ?, ?, ?, (SELECT id FROM maker_reward_events WHERE source = ? AND external_id = ?))`)
      .bind(season.id, Number(community), ev.externalId, `auto:${ev.source}`, `${C.communityBps / 100}% of ${lamportsToSolString(gross)} SOL verified maker reward`, t, t, actor, ...sourceKey));
  }
  stmts.push(scanStmt(env, ev.externalId, 'PROCESSED', season ? `season ${season.id}` : 'no open season yet (held, unassigned)', t));
  stmts.push(auditStmt(env, actor, 'pool.maker_reward', ev.externalId, { gross: gross.toString(), community: community.toString(), remaining: remaining.toString(), season: season?.id || null }));
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (isUniqueViolation(e)) {
      await scanStmt(env, ev.externalId, 'DUPLICATE', 'already processed', t).run().catch(() => {});
      return { created: false, duplicate: true };
    }
    throw e;
  }
  const event = await env.DB.prepare('SELECT * FROM maker_reward_events WHERE source = ? AND external_id = ?').bind(...sourceKey).first();
  return { created: true, duplicate: false, event };
}

/* Community money received while no season was open is attached to the next open season (idempotent). */
export async function assignUnassigned(env, actor = 'cron') {
  const season = await openSeason(env);
  if (!season) return { assigned: 0 };
  const { results } = await env.DB.prepare("SELECT * FROM maker_reward_events WHERE status = 'PROCESSED' AND season_id IS NULL AND community_base_units > 0 ORDER BY id LIMIT 50").all();
  let assigned = 0; const t = now();
  for (const e of results) {
    try {
      const out = await env.DB.batch([
        env.DB.prepare('UPDATE maker_reward_events SET season_id = ? WHERE id = ? AND season_id IS NULL').bind(season.id, e.id),
        env.DB.prepare(`INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, tx_signature, status, verification_method, notes, created_at, verified_at, actor, maker_event_id)
          SELECT ?, community_base_units, 'MAKER_REWARD', external_id, 'VERIFIED', 'auto:' || source, 'held until a season opened', ?, ?, ?, id FROM maker_reward_events WHERE id = ? AND season_id = ?
            AND NOT EXISTS (SELECT 1 FROM prize_pool_transactions WHERE maker_event_id = ?)`).bind(season.id, t, t, actor, e.id, season.id, e.id),
        auditStmt(env, actor, 'pool.assign', String(e.id), { season: season.id }),
      ]);
      if (out[0].meta.changes) assigned++;
    } catch (err) { if (!isUniqueViolation(err)) throw err; }
  }
  return { assigned };
}

/* ---------- source adapters ---------- */
function errCode(c) { return { REWARD: null, PENDING_CONFIRMATION: 'NOT_FINALIZED', FAILED_TX: 'TX_FAILED', NOT_A_REWARD: 'NOT_A_MAKER_REWARD', ERROR: 'TX_UNREADABLE' }[c]; }

/* Admin: verify one transaction signature now. Throws ApiError with a clear reason when it is not a reward. */
export async function processSignature(env, signature, actor, fetchImpl) {
  const cfg = SOL.sourceConfig(env);
  if (!cfg.ready) throw new ApiError(503, 'AWAITING_REWARD_SOURCE', `Reward source not configured: ${cfg.problems.join(', ')}.`);
  const sig = String(signature || '').trim();
  const dup = await env.DB.prepare('SELECT id FROM maker_reward_events WHERE source = ? AND external_id = ?').bind(SOL.SOURCE_ID, sig).first();
  if (dup) throw new ApiError(409, 'ALREADY_PROCESSED', 'This reward transaction was already processed.');
  let tx;
  try { tx = await SOL.getTransaction(env, sig, fetchImpl); }
  catch (e) {
    if (e.code === 'BAD_SIGNATURE') throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid transaction signature.');
    throw new ApiError(502, 'RPC_UNAVAILABLE', 'Solana RPC unavailable, try again later.');
  }
  const c = SOL.classify(tx, cfg);
  if (c.result !== 'REWARD') {
    await scanStmt(env, sig, c.result, c.detail, now()).run();
    throw new ApiError(409, errCode(c.result), `Not credited: ${c.detail}.`);
  }
  const r = await recordEvent(env, { source: SOL.SOURCE_ID, externalId: sig, gross: c.gross, receiver: cfg.wallet, payerHint: c.payerHint, blockTime: c.blockTime, slot: c.slot }, actor);
  if (r.duplicate) throw new ApiError(409, 'ALREADY_PROCESSED', 'This reward transaction was already processed.');
  return eventView(r.event);
}

/* Cron: look at the creator wallet's latest finalized transactions; every signature is classified once. */
export async function scan(env, fetchImpl) {
  const cfg = SOL.sourceConfig(env);
  if (!cfg.ready) return { state: 'AWAITING_REWARD_SOURCE', problems: cfg.problems };
  const sigs = await SOL.recentSignatures(env, cfg.wallet, fetchImpl);
  const out = { state: 'SCANNED', seen: sigs.length, processed: 0, skipped: 0, errors: 0 };
  for (const s of sigs) {
    const sig = s.signature;
    const known = await env.DB.prepare('SELECT result, attempts, checked_at FROM maker_reward_scan WHERE external_id = ?').bind(sig).first();
    if (known && (FINAL.includes(known.result) || known.attempts >= C.scan.maxAttempts || now() - known.checked_at < C.scan.retryPendingMs)) { out.skipped++; continue; }
    if (s.err) { await scanStmt(env, sig, 'FAILED_TX', 'failed on-chain', now()).run(); continue; }
    let tx;
    try { tx = await SOL.getTransaction(env, sig, fetchImpl); }
    catch (e) { await scanStmt(env, sig, 'ERROR', e.message, now()).run(); out.errors++; continue; }
    const c = SOL.classify(tx, cfg);
    if (c.result !== 'REWARD') { await scanStmt(env, sig, c.result, c.detail, now()).run(); continue; }
    const r = await recordEvent(env, { source: SOL.SOURCE_ID, externalId: sig, gross: c.gross, receiver: cfg.wallet, payerHint: c.payerHint, blockTime: c.blockTime, slot: c.slot }, 'cron');
    if (r.created) out.processed++;
  }
  out.assigned = (await assignUnassigned(env)).assigned;
  return out;
}

/* ---------- admin corrections (labelled, reasoned, audited; never shown as maker revenue) ---------- */
async function seasonPool(env, seasonId) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS t FROM prize_pool_transactions WHERE season_id = ? AND status = 'VERIFIED'").bind(seasonId).first();
  return toLamports(r.t);
}
function openOrThrow(season) {
  if (!season) throw new ApiError(404, 'NOT_FOUND', 'Season not found.');
  if (season.frozen_pool_lamports != null || ['FINALIZING', 'FINALIZED'].includes(season.status)) throw new ApiError(409, 'POOL_FROZEN', 'The prize pool of this season is frozen.');
}

export async function adjust(env, actor, body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'Explain the adjustment (at least 10 characters).');
  if (body.confirm !== 'I CONFIRM THIS ADJUSTMENT') throw new ApiError(400, 'CONFIRM_REQUIRED', 'Type confirm: "I CONFIRM THIS ADJUSTMENT".');
  let amount;
  try { amount = toLamports(String(body.amountLamports)); } catch { throw new ApiError(400, 'BAD_AMOUNT', 'amountLamports must be an integer (lamports).'); }
  if (amount === 0n || amount > MAX || -amount > MAX) throw new ApiError(400, 'BAD_AMOUNT', 'Amount must be a non-zero integer in range.');
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(String(body.seasonId || '')).first();
  openOrThrow(season);
  if ((await seasonPool(env, season.id)) + amount < 0n) throw new ApiError(409, 'NEGATIVE_POOL', 'Adjustment would make the pool negative.');
  const t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO community_pool_adjustments (season_id, kind, asset, base_units, reason, actor, created_at) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, ?)").bind(season.id, C.asset, Number(amount), reason.slice(0, 500), actor, t),
    env.DB.prepare("INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, status, verification_method, notes, created_at, verified_at, actor) VALUES (?, ?, 'ADJUSTMENT', 'VERIFIED', 'admin_adjustment', ?, ?, ?, ?)")
      .bind(season.id, Number(amount), `ADMIN ADJUSTMENT: ${reason}`.slice(0, 500), t, t, actor),
    auditStmt(env, actor, 'pool.adjust', season.id, { lamports: amount.toString(), reason }),
  ]);
  return { ok: true };
}

/* Void a processed event (e.g. the reward was clawed back). Reverses its community share via a labelled adjustment. */
export async function voidEvent(env, actor, id, body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 10) throw new ApiError(400, 'REASON_REQUIRED', 'Explain why (at least 10 characters).');
  const e = await env.DB.prepare('SELECT * FROM maker_reward_events WHERE id = ?').bind(Number(id)).first();
  if (!e) throw new ApiError(404, 'NOT_FOUND', 'Event not found.');
  if (e.status !== 'PROCESSED') throw new ApiError(409, 'ALREADY_VOIDED', 'Already voided.');
  const t = now();
  const stmts = [
    env.DB.prepare("UPDATE maker_reward_events SET status = 'VOIDED', void_reason = ?, voided_at = ? WHERE id = ? AND status = 'PROCESSED'").bind(reason.slice(0, 300), t, e.id),
    auditStmt(env, actor, 'pool.void', String(e.id), { reason, community: String(e.community_base_units), season: e.season_id }),
  ];
  if (e.season_id && e.community_base_units > 0) {
    const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(e.season_id).first();
    openOrThrow(season);
    if ((await seasonPool(env, season.id)) - BigInt(e.community_base_units) < 0n) throw new ApiError(409, 'NEGATIVE_POOL', 'Voiding would make the pool negative.');
    stmts.push(
      env.DB.prepare("INSERT INTO community_pool_adjustments (season_id, kind, maker_event_id, asset, base_units, reason, actor, created_at) VALUES (?, 'EVENT_VOID', ?, ?, ?, ?, ?, ?)").bind(season.id, e.id, e.asset, -e.community_base_units, reason.slice(0, 500), actor, t),
      env.DB.prepare("INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, status, verification_method, notes, created_at, verified_at, actor) VALUES (?, ?, 'ADJUSTMENT', 'VERIFIED', 'admin_void', ?, ?, ?, ?)")
        .bind(season.id, -e.community_base_units, `VOID maker event #${e.id}: ${reason}`.slice(0, 500), t, t, actor));
  }
  const out = await env.DB.batch(stmts);
  if (!out[0].meta.changes) throw new ApiError(409, 'ALREADY_VOIDED', 'Already voided.');
  return { ok: true };
}

/* ---------- read models ---------- */
const sol = v => lamportsToSolString(v ?? 0);
function eventView(e) {
  return { id: e.id, source: e.source, signature: e.external_id, asset: e.asset, grossLamports: String(e.gross_base_units), communityLamports: String(e.community_base_units),
    remainingLamports: String(e.remaining_base_units), grossSol: sol(e.gross_base_units), communitySol: sol(e.community_base_units), remainingSol: sol(e.remaining_base_units),
    seasonId: e.season_id, status: e.status, blockTime: e.block_time, processedAt: e.processed_at };
}

async function totals(env) {
  const ev = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(gross_base_units),0) AS g, COALESCE(SUM(community_base_units),0) AS c, COALESCE(SUM(remaining_base_units),0) AS r, MAX(processed_at) AS last FROM maker_reward_events WHERE status = 'PROCESSED'").first();
  const adj = await env.DB.prepare("SELECT COALESCE(SUM(base_units),0) AS a FROM community_pool_adjustments WHERE kind = 'ADJUSTMENT'").first();
  const paid = await env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS p FROM prize_entitlements WHERE status = 'PAID'").first();
  const owed = await env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS o FROM prize_entitlements WHERE status IN ('FINALIZING','APPROVED')").first();
  const unassigned = await env.DB.prepare("SELECT COALESCE(SUM(community_base_units),0) AS u FROM maker_reward_events WHERE status = 'PROCESSED' AND season_id IS NULL").first();
  return { events: ev.n, gross: toLamports(ev.g), community: toLamports(ev.c), remaining: toLamports(ev.r), lastEventAt: ev.last, adjustments: toLamports(adj.a), distributed: toLamports(paid.p), owed: toLamports(owed.o), unassigned: toLamports(unassigned.u) };
}

/* Public pool view. Never shows a number that is not backed by a processed on-chain event. */
export async function publicPool(env) {
  const cfg = SOL.sourceConfig(env);
  const T = await totals(env);
  const state = T.events === 0 ? (cfg.ready ? 'WAITING_FOR_FIRST_REWARD' : 'AWAITING_REWARD_SOURCE') : 'LIVE';
  const scanRow = await env.DB.prepare('SELECT MAX(checked_at) AS t FROM maker_reward_scan').first();
  const { results } = await env.DB.prepare("SELECT * FROM maker_reward_events WHERE status = 'PROCESSED' ORDER BY processed_at DESC LIMIT 10").all();
  const season = await openSeason(env);
  const seasonLamports = season ? await seasonPool(env, season.id) : null;
  return {
    state, asset: C.asset, communityPercent: C.communityBps / 100, source: SOL.SOURCE_ID,
    creatorWallet: cfg.wallet,                        // public address (only when configured)
    totals: state === 'LIVE' ? {
      receivedSol: sol(T.gross), communitySol: sol(T.community), outsideSol: sol(T.remaining),
      receivedLamports: T.gross.toString(), communityLamports: T.community.toString(), outsideLamports: T.remaining.toString(),
      distributedSol: sol(T.distributed), distributedLamports: T.distributed.toString(), events: T.events, lastEventAt: T.lastEventAt,
    } : null,
    season: season ? { id: season.id, name: season.name, poolLamports: seasonLamports.toString(), poolSol: sol(seasonLamports) } : null,
    recent: state === 'LIVE' ? results.map(e => ({ signature: e.external_id, communitySol: sol(e.community_base_units), grossSol: sol(e.gross_base_units), at: e.block_time ? e.block_time * 1000 : e.processed_at })) : [],
    lastScanAt: scanRow?.t || null,
  };
}

/* Admin reconciliation: every number + every discrepancy check. */
export async function reconciliation(env) {
  const cfg = SOL.sourceConfig(env);
  const T = await totals(env);
  const { results: events } = await env.DB.prepare(`SELECT e.*, (SELECT amount_lamports FROM prize_pool_transactions p WHERE p.maker_event_id = e.id) AS pool_amount FROM maker_reward_events e ORDER BY e.id DESC LIMIT 100`).all();
  const { results: adjustments } = await env.DB.prepare('SELECT * FROM community_pool_adjustments ORDER BY id DESC LIMIT 100').all();
  const { results: scanCounts } = await env.DB.prepare('SELECT result, COUNT(*) AS n FROM maker_reward_scan GROUP BY result').all();
  const { results: scanRecent } = await env.DB.prepare('SELECT * FROM maker_reward_scan ORDER BY checked_at DESC LIMIT 30').all();
  const { results: bySeason } = await env.DB.prepare(`SELECT season_id, source, COALESCE(SUM(amount_lamports),0) AS total, COUNT(*) AS n FROM prize_pool_transactions WHERE status = 'VERIFIED' GROUP BY season_id, source ORDER BY season_id, source`).all();
  const issues = [];
  for (const e of events) {
    if (BigInt(e.community_base_units) + BigInt(e.remaining_base_units) !== BigInt(e.gross_base_units)) issues.push({ event: e.id, issue: 'SPLIT_MISMATCH' });
    if (split(e.gross_base_units, e.community_bps).community !== BigInt(e.community_base_units)) issues.push({ event: e.id, issue: 'BPS_MISMATCH' });
    if (e.status === 'PROCESSED' && e.season_id && e.community_base_units > 0 && e.pool_amount !== e.community_base_units) issues.push({ event: e.id, issue: 'POOL_ROW_MISSING_OR_DIFFERENT' });
  }
  const linked = await env.DB.prepare("SELECT COALESCE(SUM(p.amount_lamports),0) AS s FROM prize_pool_transactions p JOIN maker_reward_events e ON e.id = p.maker_event_id WHERE p.status = 'VERIFIED'").first();
  const credited = await env.DB.prepare("SELECT COALESCE(SUM(community_base_units),0) AS s FROM maker_reward_events WHERE season_id IS NOT NULL").first();
  if (BigInt(linked.s) !== BigInt(credited.s)) issues.push({ issue: 'POOL_TOTAL_MISMATCH', poolRows: String(linked.s), events: String(credited.s) });
  return {
    config: { ready: cfg.ready, problems: cfg.problems, creatorWallet: cfg.wallet, sources: cfg.sources, since: cfg.since || null, communityBps: C.communityBps, asset: C.asset, commitment: C.commitment },
    totals: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])),
    events: events.map(e => ({ ...eventView(e), payerHint: e.payer_hint, slot: e.slot, actor: e.actor, voidReason: e.void_reason, poolAmount: e.pool_amount != null ? String(e.pool_amount) : null })),
    adjustments, scanCounts, scanRecent, bySeason, issues, ok: issues.length === 0,
  };
}
