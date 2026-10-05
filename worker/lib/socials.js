/* X + Telegram eligibility verification.
   Nothing here is ever marked verified without server-side evidence:
   - Telegram: Telegram Login Widget data (HMAC-SHA256 signed with the bot token) + Bot API getChatMember
     proving the user is a member of the official HALLOWINU group.
   - X: OAuth 2.0 (PKCE) proves account ownership; the player's "following" list must contain the official account.
   Stable platform user ids are stored; usernames are display-only. */
import { CONFIG } from '../config.js';
import { ApiError, now, randomToken, isUniqueViolation } from './util.js';
import { auditStmt, rateLimit, RL } from './platform.js';

const SC = CONFIG.socials;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function socialsConfig(env) {
  const tg = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_CHAT_ID);
  const x = !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET && (env.X_OFFICIAL_USER_ID || SC.xHandle));
  return {
    telegram: { available: tg, botUsername: tg ? String(env.TELEGRAM_BOT_USERNAME).replace(/^@/, '') : null },
    x: { available: x, handle: SC.xHandle },
  };
}

export async function identitiesOf(env, playerId) {
  const { results } = await env.DB.prepare('SELECT provider, provider_user_id, username, verified_at, method FROM player_identities WHERE player_id = ?').bind(playerId).all();
  return Object.fromEntries(results.map(r => [r.provider, r]));
}

/* Prize eligibility = verified wallet + verified X + verified Telegram (or explicit audited admin verification). */
export async function refreshEligibility(env, playerId) {
  const ids = await identitiesOf(env, playerId);
  const ok = !!(ids.solana_wallet && ids.x && ids.telegram);
  if (ok) await env.DB.prepare('UPDATE players SET payout_verified = 1 WHERE id = ? AND payout_verified = 0').bind(playerId).run();
  return ok;
}

async function linkIdentity(env, player, provider, userId, username, method, evidence) {
  const t = now();
  const existing = await env.DB.prepare('SELECT player_id FROM player_identities WHERE provider = ? AND provider_user_id = ?').bind(provider, userId).first();
  if (existing && existing.player_id !== player.id) throw new ApiError(409, 'IDENTITY_IN_USE', `This ${provider === 'x' ? 'X' : 'Telegram'} account is already linked to another player.`);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO player_identities (player_id, provider, provider_user_id, username, verified_at, method, evidence_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(player_id, provider) DO UPDATE SET provider_user_id = excluded.provider_user_id, username = excluded.username,
           verified_at = excluded.verified_at, method = excluded.method, evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`)
        .bind(player.id, provider, userId, username || null, t, method, JSON.stringify(evidence || {}), t, t),
      auditStmt(env, `player:${player.id}`, `identity.${provider}`, player.id, { userId, username, method }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'IDENTITY_IN_USE', `This ${provider === 'x' ? 'X' : 'Telegram'} account is already linked to another player.`);
    throw e;
  }
  await refreshEligibility(env, player.id);
}

/* ===================== TELEGRAM ===================== */
/* https://core.telegram.org/widgets/login#checking-authorization */
export async function checkTelegramAuth(botToken, data, maxAgeSec, nowSec = Math.floor(now() / 1000)) {
  if (!data || typeof data !== 'object') return false;
  const hash = typeof data.hash === 'string' ? data.hash : '';
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  const fields = Object.keys(data).filter(k => k !== 'hash' && data[k] != null && ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'].includes(k)).sort();
  const checkString = fields.map(k => `${k}=${data[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(checkString)));
  if (sig.length !== hash.length) return false;
  let diff = 0; for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return false;
  const age = nowSec - Number(data.auth_date);
  return Number.isFinite(age) && age >= -60 && age <= maxAgeSec;
}

export async function telegramIsMember(env, userId, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(env.TELEGRAM_CHAT_ID)}&user_id=${encodeURIComponent(userId)}`);
  let data = null; try { data = await res.json(); } catch {}
  if (!data || !data.ok) {
    console.error('telegram_getChatMember', res.status, data && data.description);
    throw new ApiError(502, 'TELEGRAM_UNAVAILABLE', 'Telegram could not confirm your membership right now. Make sure you joined the group and try again.');
  }
  const m = data.result || {};
  return ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member === true);
}

export async function verifyTelegram(env, player, body) {
  const cfg = socialsConfig(env);
  if (!cfg.telegram.available) throw new ApiError(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram verification is not switched on yet.');
  await rateLimit(env, `social:${player.id}`, RL.socialChecks);
  const data = body && body.auth;
  if (!(await checkTelegramAuth(env.TELEGRAM_BOT_TOKEN, data, SC.telegramMaxAuthAgeSec))) throw new ApiError(401, 'TELEGRAM_AUTH_INVALID', 'Telegram login could not be verified. Please try again.');
  const userId = String(data.id);
  if (!/^\d{1,20}$/.test(userId)) throw new ApiError(400, 'TELEGRAM_AUTH_INVALID', 'Telegram login could not be verified.');
  if (!(await telegramIsMember(env, userId))) throw new ApiError(403, 'TELEGRAM_NOT_MEMBER', 'Join the official HALLOWINU Telegram group first, then verify again.');
  await linkIdentity(env, player, 'telegram', userId, data.username ? String(data.username).slice(0, 64) : null, 'telegram_login+member', { chat: String(env.TELEGRAM_CHAT_ID) });
  return { telegram: { verified: true, username: data.username || null } };
}

/* ===================== X (OAuth 2.0 + PKCE) ===================== */
function xRedirectUri(env, url) { return env.X_REDIRECT_URI || `${url.origin}/api/socials/x/callback`; }

export async function startX(env, url, player) {
  const cfg = socialsConfig(env);
  if (!cfg.x.available) throw new ApiError(503, 'X_NOT_CONFIGURED', 'X verification is not switched on yet.');
  await rateLimit(env, `social:${player.id}`, RL.socialChecks);
  const t = now();
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO oauth_states (state, player_id, provider, verifier, created_at, expires_at) VALUES (?,?, 'x', ?,?,?)")
      .bind(state, player.id, verifier, t, t + SC.oauthStateTtlMs),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(t - 3600_000),
  ]);
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.X_CLIENT_ID, redirect_uri: xRedirectUri(env, url),
    scope: 'users.read tweet.read follows.read', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `https://x.com/i/oauth2/authorize?${q}`;
}

async function xJson(res, what) {
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) {
    console.error('x_api', what, res.status, JSON.stringify(data).slice(0, 300));
    if (res.status === 402 || res.status === 403) throw new ApiError(502, 'X_API_ACCESS', 'The X API refused this check (API access/credits). The team has been notified.');
    throw new ApiError(502, 'X_UNAVAILABLE', 'X could not be reached. Please try again.');
  }
  return data;
}

/* Returns a redirect target for the browser. Never throws to the user: errors become ?social=x&status=<code>. */
export async function finishX(env, url, player, fetchImpl = fetch) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (url.searchParams.get('error')) return 'denied';
  if (!/^[a-f0-9]{48}$/.test(state) || !code || code.length > 1000) return 'invalid';
  const t = now();
  const row = await env.DB.prepare("UPDATE oauth_states SET used_at = ? WHERE state = ? AND provider = 'x' AND used_at IS NULL RETURNING player_id, verifier, expires_at").bind(t, state).first();
  if (!row || row.expires_at <= t) return 'expired';
  if (!player || row.player_id !== player.id) return 'session';
  const basic = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
  const tokenRes = await fetchImpl('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: xRedirectUri(env, url), code_verifier: row.verifier, client_id: env.X_CLIENT_ID }),
  });
  const tok = await xJson(tokenRes, 'token');
  const access = tok && tok.access_token;
  if (!access) return 'invalid';
  const auth = { authorization: `Bearer ${access}` };
  const me = await xJson(await fetchImpl('https://api.x.com/2/users/me', { headers: auth }), 'me');
  const xId = me?.data?.id, xUser = me?.data?.username;
  if (!xId || !/^\d{1,25}$/.test(xId)) return 'invalid';
  // Official account id: configured, or resolved once from the handle.
  let officialId = env.X_OFFICIAL_USER_ID;
  if (!officialId) {
    const o = await xJson(await fetchImpl(`https://api.x.com/2/users/by/username/${encodeURIComponent(SC.xHandle)}`, { headers: auth }), 'official');
    officialId = o?.data?.id;
    if (!officialId) return 'unavailable';
  }
  let follows = xId === officialId;
  let token = null;
  for (let page = 0; !follows && page < SC.xFollowPages; page++) {
    const q = new URLSearchParams({ max_results: '1000' }); if (token) q.set('pagination_token', token);
    const f = await xJson(await fetchImpl(`https://api.x.com/2/users/${xId}/following?${q}`, { headers: auth }), 'following');
    follows = (f?.data || []).some(u => u.id === officialId);
    token = f?.meta?.next_token; if (!token) break;
  }
  // Best effort: revoke the user token, we do not keep it.
  try { await fetchImpl('https://api.x.com/2/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` }, body: new URLSearchParams({ token: access, token_type_hint: 'access_token' }) }); } catch {}
  if (!follows) return 'not_following';
  await linkIdentity(env, player, 'x', xId, xUser ? String(xUser).slice(0, 64) : null, 'oauth2+follow', { officialId });
  return 'verified';
}
