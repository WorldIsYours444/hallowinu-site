/* Phantom / Solana wallet sign-in.
   Flow: nonce (server) -> human-readable message -> wallet signs (no transaction) -> ed25519 verify -> session.
   Nonces are single use, expire after CONFIG.auth.nonceTtlMs and are bound to wallet + origin. */
import { CONFIG } from '../config.js';
import { ApiError, now, randomId, randomToken, isUniqueViolation } from './util.js';
import { rateLimit, auditStmt } from './platform.js';
import { createSession } from './session.js';

const A = CONFIG.auth;

/* ---------- base58 (Bitcoin alphabet, used by Solana) ---------- */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));
export function base58Decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 128) return null;
  const bytes = [];
  for (const ch of s) {
    const v = MAP[ch]; if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== '1') break; bytes.push(0); }
  return new Uint8Array(bytes.reverse());
}
export function base58Encode(buf) {
  const digits = [];
  for (const b of buf) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of buf) { if (b !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/* A Solana wallet address = base58 of a 32-byte ed25519 public key (canonical encoding only). */
export function parseWallet(addr) {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return null;
  const bytes = base58Decode(addr);
  if (!bytes || bytes.length !== 32) return null;
  if (base58Encode(bytes) !== addr) return null;
  return bytes;
}
export function shortWallet(w) { return w ? `${w.slice(0, 4)}…${w.slice(-4)}` : null; }

function decodeSignature(sig) {
  if (typeof sig !== 'string' || sig.length > 200) return null;
  let bytes = null;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(sig) && sig.length === 88) {
    try { bytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0)); } catch { bytes = null; }
  }
  if (!bytes) bytes = base58Decode(sig);
  return bytes && bytes.length === 64 ? bytes : null;
}

export async function verifyEd25519(publicKey, message, signature) {
  try {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new TextEncoder().encode(message));
  } catch { return false; }
}

/* Plain-text message (deliberately NOT the strict Sign-In-With-Solana format: Phantom parses SIWS
   messages strictly and rejects/flags non-conforming ones). Everything security-relevant is in it. */
export function buildMessage({ host, uri, wallet, nonce, issuedAt, expiresAt }) {
  return [
    'HALLOWINU ARCADE - SIGN IN',
    '',
    A.statement,
    'This only proves you own this wallet.',
    'It is NOT a transaction and costs no fees.',
    'HALLOWINU will never ask for your seed phrase or private key.',
    '',
    `Website: ${host}`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
  ].join('\n');
}

/* POST /api/auth/nonce */
export async function createNonce(env, request, url, body, ipKey) {
  await rateLimit(env, `nonce:${ipKey}`, { limit: A.noncesPerIpPerHour, windowMs: 3600_000 });
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  if (!parseWallet(wallet)) throw new ApiError(400, 'BAD_WALLET', 'That is not a valid Solana wallet address.');
  const t = now();
  const nonce = randomToken(16);
  const expiresAt = t + A.nonceTtlMs;
  const message = buildMessage({ host: url.host, uri: url.origin, wallet, nonce, issuedAt: t, expiresAt });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_nonces (nonce, wallet, message, origin, ip_key, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(nonce, wallet, message, url.origin, ipKey, t, expiresAt),
    env.DB.prepare('DELETE FROM auth_nonces WHERE expires_at < ?').bind(t - 3600_000),
  ]);
  return { nonce, message, expiresAt };
}

/* POST /api/auth/verify -> { player, token, created } */
export async function verifySignIn(env, request, url, body, ipKey) {
  await rateLimit(env, `verify:${ipKey}`, { limit: A.verifyPerIpPerHour, windowMs: 3600_000 });
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
  const pub = parseWallet(wallet);
  const nonce = typeof body.nonce === 'string' && /^[a-f0-9]{32}$/.test(body.nonce) ? body.nonce : null;
  const sig = decodeSignature(body.signature);
  if (!pub || !nonce || !sig) throw new ApiError(400, 'BAD_REQUEST', 'Invalid sign-in request.');
  const t = now();
  // Burn the nonce FIRST (atomic single use) — a failed attempt cannot be retried with the same nonce.
  const row = await env.DB.prepare(
    'UPDATE auth_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL RETURNING wallet, message, origin, expires_at').bind(t, nonce).first();
  if (!row) throw new ApiError(401, 'NONCE_INVALID', 'This sign-in request was already used or does not exist. Please try again.');
  if (row.expires_at <= t) throw new ApiError(401, 'NONCE_EXPIRED', 'This sign-in request expired. Please try again.');
  if (row.wallet !== wallet) throw new ApiError(401, 'WALLET_MISMATCH', 'The wallet does not match this sign-in request.');
  if (row.origin !== url.origin) throw new ApiError(401, 'ORIGIN_MISMATCH', 'Sign-in request was created for a different site.');
  if (!(await verifyEd25519(pub, row.message, sig))) throw new ApiError(401, 'BAD_SIGNATURE', 'The wallet signature could not be verified.');

  // Wallet proven. Find or create the player bound to this wallet.
  let player = await findPlayerByWallet(env, wallet);
  let created = false;
  if (!player) {
    await rateLimit(env, `newplayer:${ipKey}`, { limit: A.newPlayersPerIpPerHour, windowMs: 3600_000 });
    const id = randomId('p_', 16);
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO players (id, display_name, created_at, last_seen_at, kind) VALUES (?,?,?,?, 'wallet')").bind(id, `Player ${wallet.slice(0, 4)}`, t, t),
        env.DB.prepare("INSERT INTO player_identities (player_id, provider, provider_user_id, verified_at, method, created_at, updated_at) VALUES (?, 'solana_wallet', ?, ?, 'signature', ?, ?)")
          .bind(id, wallet, t, t, t),
        auditStmt(env, `player:${id}`, 'player.create', id, { wallet }),
      ]);
      created = true;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;   // concurrent first sign-in with the same wallet: use the winner
    }
    player = await findPlayerByWallet(env, wallet);
    if (!player) throw new ApiError(500, 'INTERNAL', 'Could not create player.');
  }
  if (player.status !== 'active') throw new ApiError(403, 'SUSPENDED', 'This player is suspended from the Arcade.');
  const token = await createSession(env, player.id, wallet);
  return { player, token, created };
}

export async function findPlayerByWallet(env, wallet) {
  return env.DB.prepare(
    "SELECT p.* FROM player_identities i JOIN players p ON p.id = i.player_id WHERE i.provider = 'solana_wallet' AND i.provider_user_id = ?").bind(wallet).first();
}

/* ---------- player names ---------- */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
export function nameKey(name) {
  return name.toLowerCase().replace(/[0-9@$!|]/g, c => LEET[c] ?? c).replace(/[^a-z0-9]/g, '');
}
/* Returns the clean display name or throws ApiError(400). Server-side only source of truth. */
export function validateName(raw) {
  const N = CONFIG.names;
  if (typeof raw !== 'string') throw new ApiError(400, 'BAD_NAME', 'Choose a player name.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(raw)) throw new ApiError(400, 'BAD_NAME', 'Names cannot contain control or invisible characters.');
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'BAD_NAME', 'Choose a player name.');
  if (name.length < N.minLength || name.length > N.maxLength) throw new ApiError(400, 'BAD_NAME', `Names are ${N.minLength}–${N.maxLength} characters.`);
  if (!N.pattern.test(name)) throw new ApiError(400, 'BAD_NAME', 'Use letters, numbers, spaces, - _ or . only.');
  if (!/[A-Za-z0-9]/.test(name)) throw new ApiError(400, 'BAD_NAME', 'Names need at least one letter or number.');
  const key = nameKey(name);
  if (key.length < 2) throw new ApiError(400, 'BAD_NAME', 'Choose a longer name.');
  if (N.reservedExact.includes(key) || N.reserved.some(r => key.includes(r))) throw new ApiError(400, 'NAME_RESERVED', 'That name is reserved.');
  if (N.profanity.some(w => key.includes(w))) throw new ApiError(400, 'NAME_NOT_ALLOWED', 'Please choose a different name.');
  return { name, key };
}

export async function setPlayerName(env, player, raw) {
  const { name, key } = validateName(raw);
  const N = CONFIG.names;
  const t = now();
  const first = !player.name_set_at;
  try {
    const r = await env.DB.prepare(
      `UPDATE players SET display_name = ?, name_key = ?, name_set_at = COALESCE(name_set_at, ?), name_changed_at = ?
       WHERE id = ? AND (name_set_at IS NULL OR name_changed_at IS NULL OR name_changed_at < ?) RETURNING id`)
      .bind(name, key, t, first ? null : t, player.id, t - N.changeCooldownMs).first();
    if (!r) throw new ApiError(429, 'NAME_COOLDOWN', 'You can change your name once every 24 hours.');
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'NAME_TAKEN', 'That name is already taken.');
    throw e;
  }
  return name;
}
