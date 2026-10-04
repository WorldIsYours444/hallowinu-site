/* HALLOWINU ARCADE — Cloudflare Worker entry.
   Static site is served from ./dist (assets binding); /api/* is handled here. */
import { CONFIG, levelInfo, validateConfig, OVERRIDABLE_SETTINGS as OVERRIDABLE } from './config.js';
import { ApiError, json, errorResponse, now, readJson, sha256Hex, str, timingSafeEqualStr } from './lib/util.js';
import { loadSettings, gameConfig, rateLimit, RL, auditStmt, cleanupRateLimits } from './lib/platform.js';
import { getSessionPlayer, requirePlayer, createPlayer, sessionCookie } from './lib/session.js';
import { limitStatus } from './lib/rewards.js';
import {
  syncSeasonStates, getActiveSeason, getDisplaySeason, seasonPhase, poolSummary, effectivePool, distributionOf,
  seasonRanking, finalizeSeason, recomputeEntitlements, disqualify, approveSeason, publicSeason,
} from './lib/seasons.js';
import { allocatePool, lamportsToSolString, solStringToLamports, toLamports, validateDistribution } from './lib/prizes.js';
import { verifyTransferToPool, isValidSignature, isValidAddress } from './lib/solana.js';
import * as TOT from './games/trick-or-treat.js';
import * as HUNT from './games/pumpkin-hunt.js';
import * as SPIN from './games/daily-spin.js';
import * as QUIZ from './games/quiz.js';

validateConfig();

/* Game registry: adding game #5 = add a module + a CONFIG.games entry + routes below. */
const GAMES = {
  'trick-or-treat': { routes: { play: TOT.play } },
  'pumpkin-hunt': { routes: { start: HUNT.start, claim: HUNT.claim, finish: HUNT.finish } },
  'daily-spin': { routes: { spin: SPIN.spin } },
  quiz: { routes: { next: QUIZ.next, answer: QUIZ.answer } },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      if (!env.DB) throw new ApiError(503, 'ARCADE_OFFLINE', 'The Arcade database is not connected yet.');
      return await route(request, env, url);
    } catch (err) {
      return errorResponse(err);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env));
  },
};

export async function cron(env) {
  await syncSeasonStates(env);
  const t = now();
  const { results } = await env.DB.prepare("SELECT id FROM seasons WHERE status IN ('ACTIVE','UPCOMING') AND ends_at <= ?").bind(t).all();
  for (const s of results) { try { await finalizeSeason(env, s.id, 'cron'); } catch (e) { console.error('auto-finalize', s.id, e.message); } }
  await cleanupRateLimits(env);
}

/* ---------- request guards ---------- */
function checkMutation(request, env, url) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  // Custom header forces a CORS preflight for cross-site callers (which we never approve).
  if (request.headers.get('x-hw-client') !== '1') throw new ApiError(403, 'BAD_CLIENT', 'Request blocked.');
  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = new Set([url.origin, ...String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
    if (!allowed.has(origin)) throw new ApiError(403, 'BAD_ORIGIN', 'Request blocked.');
  }
}
async function ipKey(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  return (await sha256Hex(`${env.IP_SALT || 'hallowinu-arcade'}:${ip}`)).slice(0, 32);
}

/* ---------- router ---------- */
async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  checkMutation(request, env, url);
  await syncSeasonStates(env);

  if (path.startsWith('/api/admin/')) return admin(request, env, url, path.slice('/api/admin/'.length));

  if (path === '/api/session' && m === 'POST') {
    const existing = await getSessionPlayer(env, request);
    if (existing) return json({ ok: true, player: await profile(env, existing) });
    const { player, token } = await createPlayer(env, request, await ipKey(request, env));
    return json({ ok: true, created: true, player: await profile(env, player) }, 201, { 'set-cookie': sessionCookie(token, request) });
  }
  if (path === '/api/arcade' && m === 'GET') {
    const player = await getSessionPlayer(env, request);
    if (player) await rateLimit(env, `read:${player.id}`, RL.reads);
    return json({ ok: true, ...(await arcadeState(env, player)) });
  }
  if (path === '/api/leaderboard' && m === 'GET') {
    const player = await getSessionPlayer(env, request);
    return json({ ok: true, ...(await leaderboard(env, player, url.searchParams.get('scope') === 'all' ? 'all' : 'season')) });
  }
  if (path === '/api/season' && m === 'GET') return json({ ok: true, ...(await seasonDetails(env)) });

  // ---- authenticated player routes ----
  if (path === '/api/me' && m === 'GET') { const p = await requirePlayer(env, request); return json({ ok: true, player: await profile(env, p, true) }); }
  if (path === '/api/me' && m === 'PATCH') {
    const p = await requirePlayer(env, request);
    await rateLimit(env, `act:${p.id}`, RL.gameActions);
    const body = await readJson(request);
    const N = CONFIG.names;
    const name = str(body.displayName, { min: N.minLength, max: N.maxLength, pattern: N.pattern });
    if (!name) throw new ApiError(400, 'BAD_NAME', `Name must be ${N.minLength}–${N.maxLength} letters, numbers, spaces, - _ or .`);
    if (N.blocked.some(b => name.toLowerCase().includes(b))) throw new ApiError(400, 'BAD_NAME', 'That name is reserved.');
    const t = now();
    const r = await env.DB.prepare('UPDATE players SET display_name=?, name_changed_at=? WHERE id=? AND (name_changed_at IS NULL OR name_changed_at < ?) RETURNING id')
      .bind(name.replace(/\s+/g, ' '), t, p.id, t - N.changeCooldownMs).first();
    if (!r) throw new ApiError(429, 'NAME_COOLDOWN', 'You can rename once per hour.');
    return json({ ok: true, player: await profile(env, { ...p, display_name: name }) });
  }

  const gm = path.match(/^\/api\/games\/([a-z-]+)\/([a-z]+)$/);
  if (gm && m === 'POST') {
    const [, gameId, action] = gm;
    const game = GAMES[gameId];
    if (!game || !game.routes[action]) throw new ApiError(404, 'NOT_FOUND', 'Unknown game.');
    const p = await requirePlayer(env, request);
    if (action !== 'claim') await rateLimit(env, `act:${p.id}`, RL.gameActions);
    const cfg = gameConfig(gameId, await loadSettings(env));
    if (!cfg.enabled) throw new ApiError(503, 'GAME_DISABLED', 'This cabinet is closed for maintenance.');
    const body = await readJson(request);
    const result = await game.routes[action](env, p, cfg, body);
    return json({ ok: true, ...stringifyBig(result) });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint.');
}

function stringifyBig(o) { return JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v))); }

/* ---------- views ---------- */
async function profile(env, p, full = false) {
  const season = await getActiveSeason(env) || await getDisplaySeason(env);
  const sp = season && await env.DB.prepare('SELECT points, updated_at FROM season_player_stats WHERE season_id=? AND player_id=?').bind(season.id, p.id).first();
  const fresh = await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(p.id).first();
  const allRank = fresh.total_points > 0 ? (await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM players WHERE status='active' AND total_points > 0 AND
      (total_points > ?1 OR (total_points = ?1 AND (last_point_at < ?2 OR (last_point_at = ?2 AND id < ?3))))`)
    .bind(fresh.total_points, fresh.last_point_at ?? 0, fresh.id).first()).r : null;
  let seasonRank = null;
  if (sp && sp.points > 0) {
    const dq = await env.DB.prepare('SELECT 1 FROM season_disqualifications WHERE season_id=? AND player_id=?').bind(season.id, p.id).first();
    if (!dq) seasonRank = (await env.DB.prepare(
      `SELECT COUNT(*) + 1 AS r FROM season_player_stats s JOIN players p ON p.id=s.player_id
       WHERE s.season_id=?1 AND s.points > 0 AND p.status='active'
         AND NOT EXISTS (SELECT 1 FROM season_disqualifications d WHERE d.season_id=s.season_id AND d.player_id=s.player_id)
         AND (s.points > ?2 OR (s.points = ?2 AND (s.updated_at < ?3 OR (s.updated_at = ?3 AND s.player_id < ?4))))`)
      .bind(season.id, sp.points, sp.updated_at, p.id).first()).r;
  }
  const out = {
    id: fresh.id, shortId: fresh.id.slice(2, 8).toUpperCase(), displayName: fresh.display_name,
    ...levelInfo(fresh.xp),
    totalPoints: fresh.total_points, seasonPoints: sp?.points || 0, seasonId: season?.id || null,
    allTimeRank: allRank, seasonRank,
    gamesPlayed: fresh.games_played, wins: fresh.wins, losses: fresh.losses,
    currentStreak: fresh.current_streak, bestStreak: fresh.best_streak,
    payoutEligibility: fresh.payout_verified ? 'VERIFIED' : 'NOT_VERIFIED',
    createdAt: fresh.created_at,
  };
  if (full) {
    const { results: ach } = await env.DB.prepare('SELECT achievement_id, unlocked_at FROM player_achievements WHERE player_id=?').bind(p.id).all();
    const got = Object.fromEntries(ach.map(a => [a.achievement_id, a.unlocked_at]));
    out.achievements = CONFIG.achievements.map(a => ({ id: a.id, name: a.name, description: a.description, icon: a.icon, unlockedAt: got[a.id] || null }));
    const { results: hist } = await env.DB.prepare('SELECT game, amount, reason, created_at FROM point_transactions WHERE player_id=? ORDER BY id DESC LIMIT 15').bind(p.id).all();
    out.history = hist.map(h => ({ game: h.game, points: h.amount, reason: h.reason, at: h.created_at }));
  }
  return out;
}

function estPrizes(poolLamports, bps) {
  const { amounts } = allocatePool(poolLamports, bps, bps.length);
  return amounts.map((a, i) => ({ rank: i + 1, bps: bps[i], lamports: a.toString(), sol: lamportsToSolString(a) }));
}

async function arcadeState(env, player) {
  const settings = await loadSettings(env);
  const season = await getDisplaySeason(env);
  let seasonOut = null;
  if (season) {
    const pool = await poolSummary(env, season.id);
    const eff = await effectivePool(env, season);
    seasonOut = { ...publicSeason(season, pool, seasonPhase(season)), estPrizes: estPrizes(eff, distributionOf(season)) };
  }
  const games = [];
  for (const id of Object.keys(GAMES)) {
    const cfg = gameConfig(id, settings);
    const g = { id, name: cfg.name, enabled: cfg.enabled, limit: await limitStatus(env, player, id, cfg) };
    if (id === 'daily-spin') g.wheel = SPIN.publicWheel(cfg);
    if (id === 'trick-or-treat') g.odds = Object.fromEntries(Object.entries(cfg.tables).map(([k, t]) => [k, t.map(r => ({ weight: r.weight, points: r.points }))]));
    if (id === 'pumpkin-hunt') g.rules = { durationMs: cfg.durationMs, points: Object.fromEntries(Object.entries(cfg.targets).map(([k, v]) => [k, v.points])) };
    if (id === 'quiz') g.rules = { rewards: cfg.rewards, streakBonuses: cfg.streakBonuses, answerTimeMs: cfg.answerTimeMs };
    games.push(g);
  }
  return { serverNow: now(), dayBoundary: CONFIG.dayBoundary, season: seasonOut, games, player: player ? await profile(env, player, true) : null };
}

async function leaderboard(env, player, scope) {
  const size = CONFIG.seasons.leaderboardSize;
  if (scope === 'all') {
    const { results } = await env.DB.prepare(
      `SELECT id, display_name, total_points FROM players WHERE status='active' AND total_points > 0
       ORDER BY total_points DESC, last_point_at ASC, id ASC LIMIT ?`).bind(size).all();
    const rows = results.map((r, i) => ({ rank: i + 1, name: r.display_name, points: r.total_points, me: !!player && r.id === player.id }));
    let me = null;
    if (player && !rows.some(r => r.me)) { const pr = await profile(env, player); if (pr.allTimeRank) me = { rank: pr.allTimeRank, points: pr.totalPoints, name: pr.displayName }; }
    return { scope, rows, me };
  }
  const season = await getDisplaySeason(env);
  if (!season) return { scope, rows: [], me: null, season: null };
  const finalized = season.status === 'FINALIZING' || season.status === 'FINALIZED';
  const bps = distributionOf(season);
  const pool = await effectivePool(env, season);
  const prizes = estPrizes(pool, bps);
  let rows;
  if (finalized) {
    const { results } = await env.DB.prepare(
      `SELECT f.rank, f.player_id, f.display_name, f.points, e.amount_lamports, e.status AS pstatus, e.rank AS prank
       FROM season_final_standings f LEFT JOIN prize_entitlements e ON e.season_id=f.season_id AND e.player_id=f.player_id
       WHERE f.season_id=? ORDER BY f.rank LIMIT ?`).bind(season.id, size).all();
    rows = results.map(r => ({ rank: r.rank, name: r.display_name, points: r.points, me: !!player && r.player_id === player.id,
      prize: r.amount_lamports != null ? { lamports: String(r.amount_lamports), sol: lamportsToSolString(r.amount_lamports), status: r.pstatus } : null }));
  } else {
    const ranking = await seasonRanking(env, season.id, size);
    rows = ranking.map(r => ({ rank: r.rank, name: r.display_name, points: r.points, me: !!player && r.player_id === player.id,
      prize: r.rank <= bps.length ? { lamports: prizes[r.rank - 1].lamports, sol: prizes[r.rank - 1].sol, status: 'ESTIMATED', eligibility: r.payout_verified ? 'VERIFIED' : 'NOT_VERIFIED' } : null }));
  }
  let me = null;
  if (player && !rows.some(r => r.me)) { const pr = await profile(env, player); if (pr.seasonRank) me = { rank: pr.seasonRank, points: pr.seasonPoints, name: pr.displayName }; }
  return { scope, season: { id: season.id, name: season.name, status: season.status, phase: seasonPhase(season) }, rows, me };
}

async function seasonDetails(env) {
  const season = await getDisplaySeason(env);
  let current = null;
  if (season) {
    const pool = await poolSummary(env, season.id);
    current = { ...publicSeason(season, pool, seasonPhase(season)), estPrizes: estPrizes(await effectivePool(env, season), distributionOf(season)) };
    const { results: funding } = await env.DB.prepare(
      "SELECT id, amount_lamports, source, tx_signature, verified_at, verification_method FROM prize_pool_transactions WHERE season_id=? AND status='VERIFIED' ORDER BY verified_at DESC LIMIT 25").bind(season.id).all();
    current.funding = funding.map(f => ({ id: f.id, lamports: String(f.amount_lamports), sol: lamportsToSolString(f.amount_lamports), source: f.source, txSignature: f.tx_signature, verifiedAt: f.verified_at, method: f.verification_method }));
  }
  const { results: past } = await env.DB.prepare("SELECT * FROM seasons WHERE status IN ('FINALIZING','FINALIZED') ORDER BY ends_at DESC LIMIT 5").all();
  const previous = [];
  for (const s of past) {
    const { results } = await env.DB.prepare(
      `SELECT e.rank, f.display_name, f.points, e.amount_lamports, e.status FROM prize_entitlements e
       JOIN season_final_standings f ON f.season_id=e.season_id AND f.player_id=e.player_id
       WHERE e.season_id=? AND e.status != 'DISQUALIFIED' ORDER BY e.rank LIMIT 10`).bind(s.id).all();
    previous.push({ id: s.id, name: s.name, status: s.status, endsAt: s.ends_at, poolLamports: String(s.frozen_pool_lamports ?? 0), poolSol: lamportsToSolString(s.frozen_pool_lamports ?? 0),
      winners: results.map(r => ({ rank: r.rank, name: r.display_name, points: r.points, sol: lamportsToSolString(r.amount_lamports), status: r.status })) });
  }
  return { serverNow: now(), current, previous };
}

/* ---------- admin (Bearer ADMIN_TOKEN; every write is audited) ---------- */
async function admin(request, env, url, sub) {
  const ip = await ipKey(request, env);
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 24) throw new ApiError(503, 'ADMIN_DISABLED', 'Admin is not configured.');
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !(await timingSafeEqualStr(token, env.ADMIN_TOKEN))) {
    await rateLimit(env, `adminfail:${ip}`, RL.adminFailures);
    throw new ApiError(401, 'UNAUTHORIZED', 'Not authorized.');
  }
  const actor = `admin:${ip.slice(0, 8)}`;
  const m = request.method;
  const body = m === 'GET' ? {} : await readJson(request, 32768);
  const seg = sub.split('/');

  if (sub === 'overview' && m === 'GET') {
    const { results: seasons } = await env.DB.prepare('SELECT * FROM seasons ORDER BY starts_at DESC').all();
    const { results: funding } = await env.DB.prepare('SELECT * FROM prize_pool_transactions ORDER BY id DESC LIMIT 50').all();
    const { results: audit } = await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 40').all();
    const { results: settings } = await env.DB.prepare('SELECT * FROM settings').all();
    const counts = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM game_attempts WHERE status=\'complete\') AS plays, (SELECT COALESCE(SUM(amount),0) FROM point_transactions) AS points').first();
    const ents = [];
    for (const s of seasons) {
      const { results } = await env.DB.prepare(`SELECT e.*, p.display_name, p.payout_verified FROM prize_entitlements e JOIN players p ON p.id=e.player_id WHERE e.season_id=? ORDER BY e.status='DISQUALIFIED', e.rank`).bind(s.id).all();
      if (results.length) ents.push({ seasonId: s.id, entitlements: results });
    }
    return json({ ok: true, counts, seasons, funding, audit, settings, entitlements: ents, overridable: OVERRIDABLE, poolWallet: env.POOL_WALLET || null });
  }

  // Funding: add (PENDING) -> verify (onchain|manual) / reject
  if (sub === 'funding' && m === 'POST') {
    const seasonId = str(body.seasonId, { max: 20 });
    const season = seasonId && await env.DB.prepare('SELECT * FROM seasons WHERE id=?').bind(seasonId).first();
    if (!season) throw new ApiError(404, 'NOT_FOUND', 'Season not found.');
    if (season.status === 'FINALIZING' || season.status === 'FINALIZED') throw new ApiError(409, 'POOL_FROZEN', 'The prize pool of this season is frozen.');
    const source = body.source;
    if (!['INITIAL_FUNDING', 'MAKER_REWARD', 'MANUAL_CONTRIBUTION', 'ADJUSTMENT'].includes(source)) throw new ApiError(400, 'BAD_SOURCE', 'Invalid source.');
    let lamports;
    try { lamports = body.amountLamports != null ? toLamports(String(body.amountLamports)) : solStringToLamports(String(body.amountSol)); }
    catch { throw new ApiError(400, 'BAD_AMOUNT', 'Invalid amount.'); }
    if (source !== 'ADJUSTMENT' && lamports <= 0n) throw new ApiError(400, 'BAD_AMOUNT', 'Amount must be positive.');
    if (lamports > BigInt(Number.MAX_SAFE_INTEGER) || -lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiError(400, 'BAD_AMOUNT', 'Amount too large.');
    const sig = body.txSignature ? String(body.txSignature).trim() : null;
    if (sig && !isValidSignature(sig)) throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid transaction signature.');
    try {
      const row = await env.DB.prepare(
        "INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, tx_signature, status, notes, created_at, actor) VALUES (?,?,?,?,'PENDING',?,?,?) RETURNING id")
        .bind(seasonId, Number(lamports), source, sig, str(body.notes, { max: 500 }) || null, now(), actor).first();
      await auditStmt(env, actor, 'funding.add', String(row.id), { seasonId, lamports: lamports.toString(), source, sig }).run();
      return json({ ok: true, id: row.id });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) throw new ApiError(409, 'DUPLICATE_SIGNATURE', 'This transaction signature was already recorded.');
      throw e;
    }
  }
  if (seg[0] === 'funding' && seg[2] && m === 'POST') {
    const id = Number(seg[1]);
    const tx = await env.DB.prepare('SELECT f.*, s.status AS season_status FROM prize_pool_transactions f JOIN seasons s ON s.id=f.season_id WHERE f.id=?').bind(id).first();
    if (!tx) throw new ApiError(404, 'NOT_FOUND', 'Funding record not found.');
    if (tx.status !== 'PENDING') throw new ApiError(409, 'NOT_PENDING', `Already ${tx.status}.`);
    if (tx.season_status === 'FINALIZING' || tx.season_status === 'FINALIZED') throw new ApiError(409, 'POOL_FROZEN', 'The prize pool of this season is frozen.');
    if (seg[2] === 'reject') {
      await env.DB.batch([
        env.DB.prepare("UPDATE prize_pool_transactions SET status='REJECTED', verified_at=? WHERE id=? AND status='PENDING'").bind(now(), id),
        auditStmt(env, actor, 'funding.reject', String(id), { reason: str(body.reason, { max: 300 }) }),
      ]);
      return json({ ok: true });
    }
    if (seg[2] === 'verify') {
      let amount = BigInt(tx.amount_lamports), method = 'admin_manual', extra = {};
      if (body.method === 'onchain') {
        if (!tx.tx_signature) throw new ApiError(400, 'NO_SIGNATURE', 'This record has no transaction signature.');
        const v = await verifyTransferToPool(env, tx.tx_signature);
        if (v.lamports < amount) throw new ApiError(409, 'AMOUNT_MISMATCH', `On-chain deposit (${lamportsToSolString(v.lamports)} SOL) is lower than recorded.`);
        method = 'onchain'; extra = { slot: v.slot, onchainLamports: v.lamports.toString() };
      } else if (body.method !== 'manual' || body.confirm !== 'I VERIFIED THIS FUNDING') {
        throw new ApiError(400, 'CONFIRM_REQUIRED', 'Manual verification requires confirm: "I VERIFIED THIS FUNDING".');
      }
      if (tx.source === 'ADJUSTMENT' && amount < 0n) {
        const pool = (await poolSummary(env, tx.season_id)).totalLamports;
        if (pool + amount < 0n) throw new ApiError(409, 'NEGATIVE_POOL', 'Adjustment would make the pool negative.');
      }
      const r = await env.DB.prepare("UPDATE prize_pool_transactions SET status='VERIFIED', verified_at=?, verification_method=? WHERE id=? AND status='PENDING' RETURNING id").bind(now(), method, id).first();
      if (!r) throw new ApiError(409, 'NOT_PENDING', 'Already processed.');
      await auditStmt(env, actor, 'funding.verify', String(id), { method, ...extra }).run();
      return json({ ok: true, method });
    }
  }

  // Seasons
  if (sub === 'seasons' && m === 'POST') {
    const id = str(body.id, { max: 12, pattern: /^s\d{2,4}$/ });
    const name = str(body.name, { min: 3, max: 80 });
    const startsAt = Number(body.startsAt), endsAt = Number(body.endsAt);
    const bps = body.distributionBps || CONFIG.seasons.defaultDistributionBps;
    if (!id || !name || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) throw new ApiError(400, 'BAD_SEASON', 'Invalid season fields.');
    try { validateDistribution(bps); } catch (e) { throw new ApiError(400, 'BAD_DISTRIBUTION', e.message); }
    const overlap = await env.DB.prepare("SELECT id FROM seasons WHERE status IN ('UPCOMING','ACTIVE') AND starts_at < ? AND ends_at > ?").bind(endsAt, startsAt).first();
    if (overlap) throw new ApiError(409, 'OVERLAP', `Overlaps season ${overlap.id}.`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO seasons (id,name,starts_at,ends_at,status,distribution_json,rules_json,created_at) VALUES (?,?,?,?,'UPCOMING',?,?,?)")
        .bind(id, name, startsAt, endsAt, JSON.stringify(bps), JSON.stringify(body.rules || {}), now()),
      auditStmt(env, actor, 'season.create', id, { name, startsAt, endsAt, bps }),
    ]);
    return json({ ok: true, id });
  }
  if (seg[0] === 'seasons' && seg[1] && !seg[2] && m === 'PATCH') {
    const s = await env.DB.prepare('SELECT * FROM seasons WHERE id=?').bind(seg[1]).first();
    if (!s) throw new ApiError(404, 'NOT_FOUND', 'Season not found.');
    const started = now() >= s.starts_at;
    const name = body.name != null ? str(body.name, { min: 3, max: 80 }) : s.name;
    const startsAt = body.startsAt != null ? Number(body.startsAt) : s.starts_at;
    const endsAt = body.endsAt != null ? Number(body.endsAt) : s.ends_at;
    if (!name || !(endsAt > startsAt)) throw new ApiError(400, 'BAD_SEASON', 'Invalid season fields.');
    if (s.status === 'FINALIZING' || s.status === 'FINALIZED') throw new ApiError(409, 'SEASON_LOCKED', 'Finalized seasons cannot change.');
    if (started && (body.startsAt != null || body.distributionBps != null)) throw new ApiError(409, 'SEASON_STARTED', 'Start time and prize distribution are locked once a season starts.');
    if (started && endsAt < now()) throw new ApiError(400, 'BAD_SEASON', 'End time cannot be in the past.');
    let dist = s.distribution_json;
    if (body.distributionBps != null) { try { validateDistribution(body.distributionBps); } catch (e) { throw new ApiError(400, 'BAD_DISTRIBUTION', e.message); } dist = JSON.stringify(body.distributionBps); }
    await env.DB.batch([
      env.DB.prepare('UPDATE seasons SET name=?, starts_at=?, ends_at=?, distribution_json=? WHERE id=?').bind(name, startsAt, endsAt, dist, s.id),
      auditStmt(env, actor, 'season.update', s.id, { before: { name: s.name, startsAt: s.starts_at, endsAt: s.ends_at, dist: s.distribution_json }, after: { name, startsAt, endsAt, dist } }),
    ]);
    return json({ ok: true });
  }
  if (seg[0] === 'seasons' && seg[2] === 'finalize' && m === 'POST') return json({ ok: true, ...(await finalizeSeason(env, seg[1], actor)) });
  if (seg[0] === 'seasons' && seg[2] === 'recompute' && m === 'POST') return json({ ok: true, ...(await recomputeEntitlements(env, seg[1], actor, 'manual')) });
  if (seg[0] === 'seasons' && seg[2] === 'disqualify' && m === 'POST') {
    const reason = str(body.reason, { min: 3, max: 300 });
    if (!reason || typeof body.playerId !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'playerId and reason are required.');
    return json({ ok: true, ...(await disqualify(env, seg[1], body.playerId, reason, str(body.evidence, { max: 1000 }), actor)) });
  }
  if (seg[0] === 'seasons' && seg[2] === 'approve' && m === 'POST') return json({ ok: true, ...(await approveSeason(env, seg[1], actor)) });

  if (seg[0] === 'entitlements' && seg[2] === 'paid' && m === 'POST') {
    const sig = String(body.txSignature || '').trim();
    if (!isValidSignature(sig)) throw new ApiError(400, 'BAD_SIGNATURE', 'A valid payout transaction signature is required.');
    const r = await env.DB.prepare("UPDATE prize_entitlements SET status='PAID', payout_tx=?, updated_at=? WHERE id=? AND status='APPROVED' RETURNING id").bind(sig, now(), Number(seg[1])).first();
    if (!r) throw new ApiError(409, 'NOT_APPROVED', 'Only APPROVED entitlements can be marked paid.');
    await auditStmt(env, actor, 'entitlement.paid', seg[1], { sig }).run();
    return json({ ok: true });
  }

  // Players
  if (sub === 'players' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
    const { results } = await env.DB.prepare("SELECT id, display_name, total_points, xp, level, status, payout_verified, created_at FROM players WHERE id = ? OR display_name LIKE ? ORDER BY total_points DESC LIMIT 25").bind(q, `%${q}%`).all();
    return json({ ok: true, players: results });
  }
  if (seg[0] === 'players' && seg[2] === 'ban' && m === 'POST') {
    const status = body.banned ? 'banned' : 'active';
    await env.DB.batch([
      env.DB.prepare('UPDATE players SET status=? WHERE id=?').bind(status, seg[1]),
      auditStmt(env, actor, 'player.ban', seg[1], { status, reason: str(body.reason, { max: 300 }) }),
    ]);
    return json({ ok: true });
  }
  // Phase-1 manual payout verification (identity confirmed out-of-band + public wallet). Audited.
  if (seg[0] === 'players' && seg[2] === 'verify-payout' && m === 'POST') {
    const wallet = String(body.wallet || '').trim();
    if (!isValidAddress(wallet)) throw new ApiError(400, 'BAD_WALLET', 'Provide a valid public Solana address.');
    if (body.confirm !== 'I VERIFIED THIS PLAYER') throw new ApiError(400, 'CONFIRM_REQUIRED', 'Requires confirm: "I VERIFIED THIS PLAYER".');
    const t = now();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO identity_links (player_id, provider, external_id, verified_at, verification, created_at) VALUES (?, 'solana_wallet', ?, ?, 'admin_manual', ?)").bind(seg[1], wallet, t, t),
        env.DB.prepare('UPDATE players SET payout_verified=1 WHERE id=?').bind(seg[1]),
        auditStmt(env, actor, 'player.verify_payout', seg[1], { wallet, evidence: str(body.evidence, { max: 1000 }) }),
      ]);
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw new ApiError(409, 'WALLET_IN_USE', 'Wallet already linked to a player.'); throw e; }
    return json({ ok: true });
  }

  // Runtime settings (allow-listed keys only)
  if (sub === 'settings' && m === 'PUT') {
    const key = body.key; const type = OVERRIDABLE[key];
    if (!type) throw new ApiError(400, 'BAD_KEY', 'Setting not adjustable.');
    const v = body.value;
    if ((type === 'boolean' && typeof v !== 'boolean') || (type === 'int' && (!Number.isInteger(v) || v < 0 || v > 1000))) throw new ApiError(400, 'BAD_VALUE', 'Invalid value.');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at').bind(key, JSON.stringify(v), now()),
      auditStmt(env, actor, 'settings.set', key, { value: v }),
    ]);
    return json({ ok: true });
  }

  // Quiz bank
  if (sub === 'quiz' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM quiz_questions ORDER BY id').all();
    return json({ ok: true, questions: results });
  }
  if (sub === 'quiz' && m === 'POST') {
    const q = str(body.question, { min: 8, max: 300 });
    const answers = Array.isArray(body.answers) && body.answers.length === 4 ? body.answers.map(a => str(a, { min: 1, max: 120 })) : null;
    const ci = body.correctIndex;
    if (!q || !answers || answers.includes(null) || new Set(answers).size !== 4 || !Number.isInteger(ci) || ci < 0 || ci > 3
      || !['easy', 'medium', 'hard'].includes(body.difficulty) || !str(body.category, { min: 2, max: 40 })) throw new ApiError(400, 'BAD_QUESTION', 'Invalid question.');
    const r = await env.DB.prepare('INSERT INTO quiz_questions (category, difficulty, question, answers_json, correct_index, active, created_at) VALUES (?,?,?,?,?,1,?) RETURNING id')
      .bind(body.category.trim().toUpperCase(), body.difficulty, q, JSON.stringify(answers), ci, now()).first();
    await auditStmt(env, actor, 'quiz.add', String(r.id), { q }).run();
    return json({ ok: true, id: r.id });
  }
  if (seg[0] === 'quiz' && seg[1] && m === 'PATCH') {
    await env.DB.batch([
      env.DB.prepare('UPDATE quiz_questions SET active=? WHERE id=?').bind(body.active ? 1 : 0, Number(seg[1])),
      auditStmt(env, actor, 'quiz.toggle', seg[1], { active: !!body.active }),
    ]);
    return json({ ok: true });
  }
  if (sub === 'cron' && m === 'POST') { await cron(env); return json({ ok: true }); }

  throw new ApiError(404, 'NOT_FOUND', 'Unknown admin endpoint.');
}
