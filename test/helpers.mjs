import { D1Shim } from './d1-shim.mjs';
import worker, { cron } from '../worker/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json();
    return { status: res.status, ...data };
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
