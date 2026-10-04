/* Settings overrides, rate limiting, audit log. */
import { CONFIG, OVERRIDABLE_SETTINGS } from '../config.js';
import { ApiError, now } from './util.js';

/* ---------- settings (admin overrides) ---------- */
export async function loadSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value_json FROM settings').all();
  const out = {};
  for (const r of results) if (r.key in OVERRIDABLE_SETTINGS) { try { out[r.key] = JSON.parse(r.value_json); } catch {} }
  return out;
}
export function gameConfig(gameId, settings = {}) {
  const base = CONFIG.games[gameId];
  if (!base) return null;
  const enabledKey = `games.${gameId}.enabled`, limitKey = `games.${gameId}.dailyLimit`;
  const g = { ...base, limit: { ...base.limit } };
  if (typeof settings[enabledKey] === 'boolean') g.enabled = settings[enabledKey];
  if (g.limit.type === 'daily' && Number.isInteger(settings[limitKey]) && settings[limitKey] >= 0) g.limit.count = settings[limitKey];
  return g;
}

/* ---------- rate limiting (fixed window, D1-backed, atomic upsert) ---------- */
export async function rateLimit(env, key, { limit, windowMs }) {
  const t = now(); const windowStart = t - (t % windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`).bind(key, windowStart).first();
  if (row && row.count > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. The ghosts need a breather.', { retryAfterMs: windowStart + windowMs - t });
  }
}
export async function cleanupRateLimits(env) {
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now() - 6 * 60 * 60 * 1000).run();
}
export const RL = CONFIG.rateLimits;

/* ---------- audit ---------- */
export function auditStmt(env, actor, action, target, details) {
  return env.DB.prepare('INSERT INTO audit_log (actor, action, target, details_json, created_at) VALUES (?,?,?,?,?)')
    .bind(actor, action, target ?? null, JSON.stringify(details ?? {}), now());
}
