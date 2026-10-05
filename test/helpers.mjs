import { D1Shim } from './d1-shim.mjs';
import worker, { cron } from '../worker/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base58Encode } from '../worker/lib/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN = 'test-admin-token-0123456789abcdef';
export const ORIGIN = 'https://hallowinu.xyz';

/* Controllable clock (all server code reads Date.now()). */
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;
export const clock = {
  set(ts) { offset = ts - realNow(); },
  advance(ms) { offset += ms; },
  reset() { offset = 0; },
};

export function makeEnv(extra = {}) {
  const DB = new D1Shim();
  DB.migrate(path.join(root, 'migrations'));
  return { DB, ADMIN_TOKEN: ADMIN, IP_SALT: 'test', ...extra };
}

let ipCounter = 0;
export function client(env, { ip } = {}) {
  let cookie = null;
  const myIp = ip || `10.0.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  async function call(method, p, body, headers = {}) {
    const h = { 'cf-connecting-ip': myIp };
    if (cookie) h.cookie = cookie;
    if (method !== 'GET') { h['content-type'] = 'application/json'; h['x-hw-client'] = '1'; h.origin = ORIGIN; }
    Object.assign(h, headers);
    const res = await worker.fetch(new Request(ORIGIN + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }), env, { waitUntil() {} });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? null : sc.split(';')[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, location: res.headers.get('location'), setCookie: sc, ...data };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    patch: (p, b, h) => call('PATCH', p, b, h),
    put: (p, b, h) => call('PUT', p, b, h),
    raw: call,
    get cookie() { return cookie; }, set cookie(v) { cookie = v; },
  };
}

export function adminClient(env) {
  const c = client(env);
  const auth = { authorization: `Bearer ${ADMIN}` };
  return {
    get: p => c.get('/api/admin/' + p, auth),
    post: (p, b) => c.post('/api/admin/' + p, b, auth),
    patch: (p, b) => c.patch('/api/admin/' + p, b, auth),
    put: (p, b) => c.put('/api/admin/' + p, b, auth),
  };
}

export const idem = () => 'k' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
export { cron };

/* Season 01 window in the seed: 2026-10-04 .. 2026-11-01 UTC */
export const S01_START = Date.UTC(2026, 9, 4);
export const S01_END = Date.UTC(2026, 10, 1);

/* ---------- Solana wallet test doubles (real ed25519 keys, real signatures) ---------- */
export async function newWallet() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {
    address: base58Encode(raw),
    sign: async msg => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg))),
  };
}
export const b64 = u8 => Buffer.from(u8).toString('base64');
export async function signIn(c, wallet) {
  const n = await c.post('/api/auth/nonce', { wallet: wallet.address });
  if (!n.ok) return n;
  return c.post('/api/auth/verify', { wallet: wallet.address, nonce: n.nonce, signature: b64(await wallet.sign(n.message)) });
}
let nameSeq = 0;
export function uniqueName(prefix = 'Ghost') {
  let n = nameSeq++, s = '';
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0);
  return `${prefix} ${s}`;
}
/* Signed-in player with a chosen name (ready to play). */
export async function walletPlayer(env, { name, ip } = {}) {
  const c = client(env, { ip });
  const wallet = await newWallet();
  const r = await signIn(c, wallet);
  if (!r.ok) throw new Error('sign-in failed: ' + JSON.stringify(r));
  const named = await c.patch('/api/me', { displayName: name || uniqueName() });
  if (!named.ok) throw new Error('naming failed: ' + JSON.stringify(named));
  return { c, wallet, player: named.player };
}
/* Mark X + Telegram as verified directly in the DB (for prize-flow tests). */
export async function grantSocials(env, playerId) {
  const t = Date.now();
  for (const [prov, id] of [['x', 'x' + playerId], ['telegram', 't' + playerId]]) {
    await env.DB.prepare("INSERT INTO player_identities (player_id, provider, provider_user_id, verified_at, method, created_at, updated_at) VALUES (?,?,?,?, 'test', ?, ?)")
      .bind(playerId, prov, id, t, t, t).run();
  }
  const { refreshEligibility } = await import('../worker/lib/socials.js');
  return refreshEligibility(env, playerId);
}
