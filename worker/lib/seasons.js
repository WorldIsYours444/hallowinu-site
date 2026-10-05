/* Seasons, prize pool, standings, finalization, disqualification. */
import { CONFIG } from '../config.js';
import { ApiError, now } from './util.js';
import { allocatePool, toLamports, lamportsToSolString, validateDistribution } from './prizes.js';
import { auditStmt } from './platform.js';

/* Lazy state machine: UPCOMING -> ACTIVE by time. ACTIVE past ends_at is treated as ended
   (no rewards) until finalize() snapshots it (cron or admin). */
export async function syncSeasonStates(env) {
  const t = now();
  await env.DB.prepare("UPDATE seasons SET status='ACTIVE' WHERE status='UPCOMING' AND starts_at <= ? AND ends_at > ?").bind(t, t).run();
}

export async function getActiveSeason(env) {
  const t = now();
  return env.DB.prepare("SELECT * FROM seasons WHERE status IN ('ACTIVE','UPCOMING') AND starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1").bind(t, t).first();
}

/* The season shown on the site: active, else next upcoming, else most recent. */
export async function getDisplaySeason(env) {
  const t = now();
  return (await getActiveSeason(env))
    || await env.DB.prepare("SELECT * FROM seasons WHERE status='UPCOMING' AND starts_at > ? ORDER BY starts_at ASC LIMIT 1").bind(t).first()
    || await env.DB.prepare('SELECT * FROM seasons ORDER BY ends_at DESC LIMIT 1').first();
}

export function seasonPhase(season, t = now()) {
  if (!season) return 'NONE';
  if (season.status === 'FINALIZED' || season.status === 'FINALIZING') return season.status;
  if (t < season.starts_at) return 'UPCOMING';
  if (t >= season.ends_at) return 'ENDED';
  return 'ACTIVE';
}

export async function poolSummary(env, seasonId) {
  const { results } = await env.DB.prepare(
    "SELECT source, SUM(amount_lamports) AS total FROM prize_pool_transactions WHERE season_id = ? AND status='VERIFIED' GROUP BY source").bind(seasonId).all();
  const by = {}; let total = 0n;
  for (const r of results) { const v = toLamports(r.total ?? 0); by[r.source] = v; total += v; }
  if (total < 0n) total = 0n;
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_lamports),0) AS amt FROM prize_pool_transactions WHERE season_id = ? AND status='PENDING'").bind(seasonId).first();
  const latestMaker = await env.DB.prepare("SELECT id, amount_lamports, verified_at, tx_signature FROM prize_pool_transactions WHERE season_id = ? AND status='VERIFIED' AND source='MAKER_REWARD' ORDER BY verified_at DESC LIMIT 1").bind(seasonId).first();
  return {
    totalLamports: total,
    initialLamports: by.INITIAL_FUNDING || 0n,
    makerLamports: by.MAKER_REWARD || 0n,
    manualLamports: by.MANUAL_CONTRIBUTION || 0n,
    adjustmentLamports: by.ADJUSTMENT || 0n,
    pendingCount: pending?.n || 0,
    latestMaker,
  };
}

/* Pool used for prize math: frozen value after finalization, otherwise live verified total. */
export async function effectivePool(env, season) {
  if (season.frozen_pool_lamports != null) return toLamports(season.frozen_pool_lamports);
  return (await poolSummary(env, season.id)).totalLamports;
}

export function distributionOf(season) {
  const bps = JSON.parse(season.distribution_json);
  validateDistribution(bps);
  return bps;
}

/* Ranked players = wallet-verified accounts with a chosen name (legacy anonymous test players never rank). */
export const RANKED = "p.status = 'active' AND p.kind = 'wallet' AND p.name_set_at IS NOT NULL";

/* Live ranking for a season (excludes banned + disqualified + legacy). */
export async function seasonRanking(env, seasonId, limit) {
  const { results } = await env.DB.prepare(
    `SELECT s.player_id, p.display_name, s.points, s.updated_at, p.payout_verified
     FROM season_player_stats s JOIN players p ON p.id = s.player_id
     WHERE s.season_id = ? AND s.points > 0 AND ${RANKED}
       AND NOT EXISTS (SELECT 1 FROM season_disqualifications d WHERE d.season_id = s.season_id AND d.player_id = s.player_id)
     ORDER BY s.points DESC, s.updated_at ASC, s.player_id ASC
     LIMIT ?`).bind(seasonId, limit).all();
  return results.map((r, i) => ({ rank: i + 1, ...r }));
}

/* ---------- finalization ---------- */
export async function finalizeSeason(env, seasonId, actor) {
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(seasonId).first();
  if (!season) throw new ApiError(404, 'NOT_FOUND', 'Season not found.');
  if (season.status === 'FINALIZING' || season.status === 'FINALIZED') throw new ApiError(409, 'ALREADY_FINALIZED', 'Season is already finalized.');
  if (now() < season.ends_at) throw new ApiError(409, 'SEASON_NOT_OVER', 'Season has not ended yet.');
  const pool = (await poolSummary(env, seasonId)).totalLamports;
  const t = now();
  // 1) freeze pool + status atomically (guards against concurrent finalize)
  const res = await env.DB.prepare(
    "UPDATE seasons SET status='FINALIZING', frozen_pool_lamports = ?, finalized_at = ? WHERE id = ? AND status IN ('ACTIVE','UPCOMING') RETURNING id")
    .bind(Number(pool), t, seasonId).first();
  if (!res) throw new ApiError(409, 'ALREADY_FINALIZED', 'Season is already finalized.');
  // 2) permanent snapshot of standings (full ranking incl. flags at this moment)
  const ranking = await seasonRanking(env, seasonId, 100000);
  const stmts = ranking.map(r => env.DB.prepare(
    'INSERT INTO season_final_standings (season_id, rank, player_id, display_name, points, reached_at, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(seasonId, r.rank, r.player_id, r.display_name, r.points, r.updated_at, t));
  stmts.push(auditStmt(env, actor, 'season.finalize', seasonId, { poolLamports: pool.toString(), players: ranking.length }));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await recomputeEntitlements(env, seasonId, actor, 'finalize');
  return { seasonId, poolLamports: pool.toString(), players: ranking.length };
}

/* Entitlements = the top-N PRIZE-ELIGIBLE players (wallet + X + Telegram verified, not disqualified/banned)
   from the frozen snapshot, in snapshot order. Ineligible players keep their rank but receive no prize. */
export async function recomputeEntitlements(env, seasonId, actor, why) {
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(seasonId).first();
  if (season.status !== 'FINALIZING') throw new ApiError(409, 'NOT_FINALIZING', 'Entitlements can only change while the season is FINALIZING.');
  const bps = distributionOf(season);
  const { results: eligible } = await env.DB.prepare(
    `SELECT f.player_id, f.points FROM season_final_standings f JOIN players p ON p.id = f.player_id
     WHERE f.season_id = ? AND p.status = 'active' AND p.payout_verified = 1
       AND NOT EXISTS (SELECT 1 FROM season_disqualifications d WHERE d.season_id = f.season_id AND d.player_id = f.player_id)
     ORDER BY f.rank ASC LIMIT ?`).bind(seasonId, bps.length).all();
  const pool = toLamports(season.frozen_pool_lamports ?? 0);
  const alloc = allocatePool(pool, bps, eligible.length);
  const { results: before } = await env.DB.prepare('SELECT rank, player_id, amount_lamports, status FROM prize_entitlements WHERE season_id = ? ORDER BY rank').bind(seasonId).all();
  if (before.some(e => e.status === 'APPROVED' || e.status === 'PAID')) throw new ApiError(409, 'ALREADY_APPROVED', 'Payouts were already approved; cannot recompute.');
  const t = now();
  const stmts = [
    // keep disqualified rows as history, replace the active set
    env.DB.prepare("DELETE FROM prize_entitlements WHERE season_id = ? AND status = 'FINALIZING'").bind(seasonId),
    ...eligible.map((e, i) => env.DB.prepare(
      `INSERT INTO prize_entitlements (season_id, rank, player_id, bps, amount_lamports, status, created_at, updated_at)
       VALUES (?,?,?,?,?,'FINALIZING',?,?)
       ON CONFLICT(season_id, player_id) DO UPDATE SET rank=excluded.rank, bps=excluded.bps, amount_lamports=excluded.amount_lamports, status='FINALIZING', updated_at=excluded.updated_at`)
      .bind(seasonId, i + 1, e.player_id, bps[i], Number(alloc.amounts[i]), t, t)),
    auditStmt(env, actor, 'entitlements.recompute', seasonId, {
      why, poolLamports: pool.toString(), unallocatedLamports: alloc.unallocated.toString(),
      previous: before, next: eligible.map((e, i) => ({ rank: i + 1, player_id: e.player_id, amount_lamports: alloc.amounts[i].toString() })),
    }),
  ];
  await env.DB.batch(stmts);
  return { winners: eligible.length, unallocatedLamports: alloc.unallocated.toString() };
}

export async function disqualify(env, seasonId, playerId, reason, evidence, actor) {
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(seasonId).first();
  if (!season) throw new ApiError(404, 'NOT_FOUND', 'Season not found.');
  if (season.status === 'FINALIZED') throw new ApiError(409, 'ALREADY_APPROVED', 'Season payouts are already approved.');
  const t = now();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO season_disqualifications (season_id, player_id, reason, evidence, actor, created_at) VALUES (?,?,?,?,?,?)')
        .bind(seasonId, playerId, reason, evidence ?? null, actor, t),
      env.DB.prepare("UPDATE prize_entitlements SET status='DISQUALIFIED', updated_at=? WHERE season_id=? AND player_id=? AND status='FINALIZING'").bind(t, seasonId, playerId),
      auditStmt(env, actor, 'season.disqualify', `${seasonId}:${playerId}`, { reason, evidence }),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|FOREIGN KEY/i.test(String(e.message))) throw new ApiError(409, 'ALREADY_DISQUALIFIED', 'Player already disqualified or unknown.');
    throw e;
  }
  if (season.status === 'FINALIZING') return recomputeEntitlements(env, seasonId, actor, `disqualify:${playerId}`);
  return { ok: true };
}

/* Approval: every winner must be payout-verified (Phase 1 anonymous players are not). */
export async function approveSeason(env, seasonId, actor) {
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(seasonId).first();
  if (!season || season.status !== 'FINALIZING') throw new ApiError(409, 'NOT_FINALIZING', 'Season must be FINALIZING to approve.');
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.rank, e.player_id, p.payout_verified,
       (SELECT provider_user_id FROM player_identities l WHERE l.player_id = e.player_id AND l.provider='solana_wallet') AS wallet
     FROM prize_entitlements e JOIN players p ON p.id = e.player_id
     WHERE e.season_id = ? AND e.status = 'FINALIZING' ORDER BY e.rank`).bind(seasonId).all();
  const blockers = results.filter(r => !r.payout_verified || !r.wallet).map(r => ({ rank: r.rank, playerId: r.player_id, issue: 'NOT_VERIFIED' }));
  if (blockers.length) throw new ApiError(409, 'UNVERIFIED_WINNERS', 'Some winners are not payout-verified. Verify or disqualify them first.', { blockers });
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE prize_entitlements SET status='APPROVED', updated_at=? WHERE season_id=? AND status='FINALIZING'").bind(t, seasonId),
    env.DB.prepare("UPDATE seasons SET status='FINALIZED', approved_at=? WHERE id=? AND status='FINALIZING'").bind(t, seasonId),
    auditStmt(env, actor, 'season.approve', seasonId, { winners: results.length }),
  ]);
  return { approved: results.length };
}

export function publicSeason(season, pool, phase) {
  return {
    id: season.id, name: season.name, startsAt: season.starts_at, endsAt: season.ends_at,
    status: season.status, phase,
    displayStatus: ({ UPCOMING: 'UPCOMING', ACTIVE: 'ACTIVE', ENDED: 'LOCKED', FINALIZING: 'UNDER_REVIEW', FINALIZED: 'FINALIZED' })[phase] || phase,
    distributionBps: distributionOf(season),
    rules: JSON.parse(season.rules_json || '{}'),
    pool: pool && {
      totalLamports: pool.totalLamports.toString(), totalSol: lamportsToSolString(pool.totalLamports),
      initialLamports: pool.initialLamports.toString(), makerLamports: pool.makerLamports.toString(),
      manualLamports: pool.manualLamports.toString(), adjustmentLamports: pool.adjustmentLamports.toString(),
      // verified money on top of the verified base funding
      verifiedAdditionsLamports: (pool.totalLamports - pool.initialLamports > 0n ? pool.totalLamports - pool.initialLamports : 0n).toString(),
      pendingCount: pool.pendingCount,
      frozen: season.frozen_pool_lamports != null,
      latestMaker: pool.latestMaker ? { id: pool.latestMaker.id, amountLamports: String(pool.latestMaker.amount_lamports), verifiedAt: pool.latestMaker.verified_at } : null,
    },
  };
}

export { CONFIG };
