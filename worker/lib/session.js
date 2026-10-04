/* Phase-1 identity: server-generated player_id + HttpOnly session cookie.
   The cookie holds a random token; only its SHA-256 hash is stored. */
import { CONFIG } from '../config.js';
import { ApiError, now, randomId, randomToken, sha256Hex, randomInt } from './util.js';
import { rateLimit } from './platform.js';

const S = CONFIG.session;
const ADJ = ['Spooky', 'Ghostly', 'Midnight', 'Pumpkin', 'Haunted', 'Moonlit', 'Creepy', 'Lantern', 'Phantom', 'Grave', 'Candy', 'Shadow'];
const NOUN = ['Pup', 'Inu', 'Howler', 'Shiba', 'Specter', 'Wraith', 'Bones', 'Bat', 'Ghost', 'Hound'];

export function generateName() {
  return `${ADJ[randomInt(ADJ.length)]} ${NOUN[randomInt(NOUN.length)]} ${1000 + randomInt(9000)}`;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${S.cookieName}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${S.ttlDays * 86400}${secure ? '; Secure' : ''}`;
}

/* Returns the player for a valid session, or null. Never trusts client-supplied ids. */
export async function getSessionPlayer(env, request) {
  const token = readCookie(request, S.cookieName);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const t = now();
  const row = await env.DB.prepare(
    `SELECT p.* FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = ? AND s.expires_at > ?`).bind(hash, t).first();
  if (!row) return null;
  // Light touch: update last-seen at most once per 5 minutes.
  if (t - row.last_seen_at > 5 * 60_000) {
    await env.DB.batch([
      env.DB.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').bind(t, row.id),
      env.DB.prepare('UPDATE player_sessions SET last_used_at = ? WHERE token_hash = ?').bind(t, hash),
    ]);
  }
  return row;
}

export async function requirePlayer(env, request) {
  const p = await getSessionPlayer(env, request);
  if (!p) throw new ApiError(401, 'NO_SESSION', 'Your arcade session expired. Tap to re-enter.');
  if (p.status !== 'active') throw new ApiError(403, 'BANNED', 'This player is not allowed in the Arcade.');
  return p;
}

/* Create a new anonymous player + session. */
export async function createPlayer(env, request, ipKey) {
  await rateLimit(env, `newplayer:${ipKey}`, { limit: S.newPlayersPerIpPerHour, windowMs: 3600_000 });
  const t = now();
  const id = randomId('p_', 16);
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO players (id, display_name, created_at, last_seen_at) VALUES (?,?,?,?)').bind(id, generateName(), t, t),
    env.DB.prepare('INSERT INTO player_sessions (token_hash, player_id, created_at, expires_at, last_used_at) VALUES (?,?,?,?,?)')
      .bind(hash, id, t, t + S.ttlDays * 86400_000, t),
  ]);
  const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
  return { player, token };
}
