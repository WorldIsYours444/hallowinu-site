/* Shared reward engine: limits/cooldowns, attempts, point ledger, XP, counters, achievements.
   Every game uses these primitives; adding a game never touches this file. */
import { CONFIG, levelForXp } from '../config.js';
import { ApiError, now, dayKey, nextDayStart, randomId, isUniqueViolation } from './util.js';
import { getActiveSeason } from './seasons.js';

/* ---------- limits ---------- */
export async function consumeLimit(env, player, gameId, gameCfg) {
  const lim = gameCfg.limit, t = now();
  if (lim.type === 'daily') {
    const period = dayKey(t);
    const row = await env.DB.prepare(
      `INSERT INTO usage_limits (player_id, game, period_key, used) SELECT ?, ?, ?, 1 WHERE ? > 0
       ON CONFLICT(player_id, game, period_key) DO UPDATE SET used = used + 1 WHERE used < ?
       RETURNING used`).bind(player.id, gameId, period, lim.count, lim.count).first();
    if (!row) throw new ApiError(429, 'DAILY_LIMIT', 'No plays left today.', { resetsAt: nextDayStart(t) });
    return { period, used: row.used, refund: () => refundDaily(env, player.id, gameId, period) };
  }
  if (lim.type === 'cooldown') {
    const next = t + lim.ms;
    const row = await env.DB.prepare(
      `INSERT INTO cooldowns (player_id, game, next_at) VALUES (?, ?, ?)
       ON CONFLICT(player_id, game) DO UPDATE SET next_at = excluded.next_at WHERE cooldowns.next_at <= ?
       RETURNING next_at`).bind(player.id, gameId, next, t).first();
    if (!row) {
      const cur = await env.DB.prepare('SELECT next_at FROM cooldowns WHERE player_id = ? AND game = ?').bind(player.id, gameId).first();
      throw new ApiError(429, 'COOLDOWN', 'Not ready yet.', { nextAt: cur?.next_at });
    }
    return { period: `cd:${t}`, nextAt: next, refund: () => env.DB.prepare('UPDATE cooldowns SET next_at = ? WHERE player_id = ? AND game = ? AND next_at = ?').bind(t, player.id, gameId, next).run() };
  }
  throw new Error('unknown limit type');
}
function refundDaily(env, playerId, gameId, period) {
  return env.DB.prepare('UPDATE usage_limits SET used = used - 1 WHERE player_id = ? AND game = ? AND period_key = ? AND used > 0').bind(playerId, gameId, period).run();
}

export async function limitStatus(env, player, gameId, gameCfg) {
  const lim = gameCfg.limit, t = now();
  if (lim.type === 'daily') {
    const row = player && await env.DB.prepare('SELECT used FROM usage_limits WHERE player_id=? AND game=? AND period_key=?').bind(player.id, gameId, dayKey(t)).first();
    const used = row?.used || 0;
    return { type: 'daily', limit: lim.count, used, remaining: Math.max(0, lim.count - used), resetsAt: nextDayStart(t) };
  }
  const row = player && await env.DB.prepare('SELECT next_at FROM cooldowns WHERE player_id=? AND game=?').bind(player.id, gameId).first();
  const nextAt = row && row.next_at > t ? row.next_at : null;
  return { type: 'cooldown', ready: !nextAt, nextAt, cooldownMs: lim.ms };
}

/* ---------- idempotent attempt ---------- */
/* Returns { attempt, replay } — replay=true when this idem key was already used by this player. */
export async function beginAttempt(env, player, gameId, idemKey, periodKey) {
  const id = randomId('a_', 16), t = now();
  try {
    await env.DB.prepare(
      "INSERT INTO game_attempts (id, player_id, game, idem_key, period_key, status, created_at) VALUES (?,?,?,?,?,'pending',?)")
      .bind(id, player.id, gameId, idemKey, periodKey, t).run();
    return { attempt: { id, created_at: t }, replay: false };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const prev = await env.DB.prepare('SELECT * FROM game_attempts WHERE player_id=? AND game=? AND idem_key=?').bind(player.id, gameId, idemKey).first();
    return { attempt: prev, replay: true };
  }
}
export async function findAttempt(env, player, gameId, idemKey) {
  return env.DB.prepare('SELECT * FROM game_attempts WHERE player_id=? AND game=? AND idem_key=?').bind(player.id, gameId, idemKey).first();
}

/* ---------- the reward transaction ----------
   One atomic D1 batch: ledger row (UNIQUE reference) + player cache + season stats + counters + attempt result.
   A duplicate reference makes the whole batch fail -> nothing is applied twice. */
export async function settle(env, player, {
  gameId, attemptId, reference, points = 0, reason, xp = 0, win, counters = {}, result, extraStatements = [],
}) {
  if (!Number.isInteger(points) || points < 0 || points > 100000) throw new Error('invalid points');
  const t = now();
  const season = await getActiveSeason(env);
  const seasonId = season ? season.id : null;
  const counterEntries = Object.entries({ games_played: 1, [`played_${gameId}`]: 1, ...counters }).filter(([, v]) => v);
  const stmts = [
    env.DB.prepare('INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(player.id, seasonId, gameId, points, reason, reference, t),
    env.DB.prepare(
      `UPDATE players SET
         total_points = total_points + ?1,
         xp = xp + ?2,
         games_played = games_played + 1,
         wins = wins + ?3, losses = losses + ?4,
         current_streak = CASE WHEN ?3 = 1 THEN current_streak + 1 ELSE 0 END,
         best_streak = MAX(best_streak, CASE WHEN ?3 = 1 THEN current_streak + 1 ELSE 0 END),
         last_point_at = CASE WHEN ?1 > 0 THEN ?5 ELSE last_point_at END,
         last_seen_at = ?5
       WHERE id = ?6`).bind(points, xp, win ? 1 : 0, win ? 0 : 1, t, player.id),
    ...counterEntries.map(([k, v]) => env.DB.prepare(
      `INSERT INTO player_counters (player_id, key, value) VALUES (?,?,?)
       ON CONFLICT(player_id, key) DO UPDATE SET value = value + excluded.value`).bind(player.id, k, v)),
    env.DB.prepare("UPDATE game_attempts SET status='complete', points=?, result_json=?, completed_at=? WHERE id=?")
      .bind(points, JSON.stringify(result ?? {}), t, attemptId),
    ...extraStatements,
  ];
  if (seasonId) {
    stmts.push(env.DB.prepare(
      `INSERT INTO season_player_stats (season_id, player_id, points, games_played, updated_at) VALUES (?,?,?,1,?)
       ON CONFLICT(season_id, player_id) DO UPDATE SET
         points = points + excluded.points,
         games_played = games_played + 1,
         updated_at = CASE WHEN excluded.points > 0 THEN excluded.updated_at ELSE updated_at END`)
      .bind(seasonId, player.id, points, t));
  }
  try { await env.DB.batch(stmts); }
  catch (e) { if (isUniqueViolation(e)) throw new ApiError(409, 'ALREADY_SETTLED', 'This play was already rewarded.'); throw e; }
  const after = await postSettle(env, player.id);
  return { seasonId, ...after };
}

/* Level + achievements, evaluated server-side after every settlement. */
export async function postSettle(env, playerId) {
  const p = await env.DB.prepare('SELECT xp, level FROM players WHERE id=?').bind(playerId).first();
  const level = levelForXp(p.xp);
  let levelUp = null;
  if (level !== p.level) {
    const r = await env.DB.prepare('UPDATE players SET level=? WHERE id=? AND level=? RETURNING level').bind(level, playerId, p.level).first();
    if (r && level > p.level) levelUp = level;
  }
  const unlocked = await evaluateAchievements(env, playerId);
  return { level, levelUp, achievementsUnlocked: unlocked };
}

export async function getCounters(env, playerId) {
  const { results } = await env.DB.prepare('SELECT key, value FROM player_counters WHERE player_id=?').bind(playerId).all();
  const c = {}; for (const r of results) c[r.key] = r.value; return c;
}

export async function evaluateAchievements(env, playerId) {
  const counters = await getCounters(env, playerId);
  const { results } = await env.DB.prepare('SELECT achievement_id FROM player_achievements WHERE player_id=?').bind(playerId).all();
  const have = new Set(results.map(r => r.achievement_id));
  const out = [];
  for (const a of CONFIG.achievements) {
    if (have.has(a.id) || !a.test(counters)) continue;
    const r = await env.DB.prepare('INSERT INTO player_achievements (player_id, achievement_id, unlocked_at) VALUES (?,?,?) ON CONFLICT DO NOTHING RETURNING achievement_id')
      .bind(playerId, a.id, now()).first();
    if (r) out.push({ id: a.id, name: a.name, description: a.description, icon: a.icon });
  }
  return out;
}

export function setCounterMax(env, playerId, key, value) {
  return env.DB.prepare(`INSERT INTO player_counters (player_id, key, value) VALUES (?,?,?)
    ON CONFLICT(player_id, key) DO UPDATE SET value = MAX(value, excluded.value)`).bind(playerId, key, value);
}
