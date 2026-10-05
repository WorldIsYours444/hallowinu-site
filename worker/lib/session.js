/* Wallet-backed sessions. The cookie holds a random token; only its SHA-256 hash is stored.
   A session only exists after a verified Solana wallet signature (see lib/auth.js). */
import { CONFIG } from '../config.js';
import { ApiError, now, randomToken, sha256Hex } from './util.js';

const S = CONFIG.session;

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function secureFlag(request) { return new URL(request.url).protocol === 'https:' ? '; Secure' : ''; }
export function sessionCookie(token, request) {
  return `${S.cookieName}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${S.ttlDays * 86400}${secureFlag(request)}`;
}
export function clearSessionCookie(request) {
  return `${S.cookieName}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(request)}`;
}

/* Returns { player, wallet, tokenHash } for a valid wallet session, or null. Never trusts client-supplied ids. */
export async function getSession(env, request) {
  const token = readCookie(request, S.cookieName);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const t = now();
  const row = await env.DB.prepare(
    `SELECT p.*, s.wallet AS session_wallet, s.last_used_at AS session_used_at FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND p.kind = 'wallet' AND s.wallet IS NOT NULL`).bind(hash, t).first();
  if (!row) return null;
  if (t - row.session_used_at > 5 * 60_000) {
    await env.DB.batch([
      env.DB.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').bind(t, row.id),
      env.DB.prepare('UPDATE player_sessions SET last_used_at = ? WHERE token_hash = ?').bind(t, hash),
    ]);
  }
  const { session_wallet: wallet, session_used_at, ...player } = row;
  return { player, wallet, tokenHash: hash };
}

export async function getSessionPlayer(env, request) {
  const s = await getSession(env, request);
  return s ? s.player : null;
}

/* Signed in (any state). */
export async function requireSession(env, request) {
  const s = await getSession(env, request);
  if (!s) throw new ApiError(401, 'NO_SESSION', 'Connect your Phantom wallet and sign in to continue.');
  if (s.player.status !== 'active') throw new ApiError(403, 'SUSPENDED', 'This player is suspended from the Arcade.');
  return s;
}

/* Signed in AND profile complete: required for every game action. */
export async function requirePlayer(env, request) {
  const { player } = await requireSession(env, request);
  if (!player.name_set_at) throw new ApiError(403, 'PROFILE_REQUIRED', 'Choose your player name first.');
  return player;
}

/* New session for a verified wallet (rotates: every sign-in gets a fresh token). */
export async function createSession(env, playerId, wallet) {
  const t = now();
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO player_sessions (token_hash, player_id, created_at, expires_at, last_used_at, wallet) VALUES (?,?,?,?,?,?)')
      .bind(hash, playerId, t, t + S.ttlDays * 86400_000, t, wallet),
    // housekeeping: drop this player's expired sessions
    env.DB.prepare('DELETE FROM player_sessions WHERE player_id = ? AND expires_at <= ?').bind(playerId, t),
  ]);
  return token;
}

export async function destroySession(env, tokenHash) {
  await env.DB.prepare('DELETE FROM player_sessions WHERE token_hash = ?').bind(tokenHash).run();
}
