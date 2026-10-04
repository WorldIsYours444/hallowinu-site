/* Shared helpers: responses, errors, crypto randomness, time. */

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra || {};
  }
}

const SECURITY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

export function errorResponse(err) {
  if (err instanceof ApiError) return json({ ok: false, error: err.code, message: err.message, ...err.extra }, err.status);
  // Never leak internals.
  console.error('internal_error', err && (err.stack || err.message || err));
  return json({ ok: false, error: 'INTERNAL', message: 'Something went wrong.' }, 500);
}

export const now = () => Date.now();
export function dayKey(ts = Date.now()) { return new Date(ts).toISOString().slice(0, 10); } // UTC day
export function nextDayStart(ts = Date.now()) {
  const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/* ---------- randomness (Web Crypto only) ---------- */
export function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
const B32 = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
export function randomId(prefix = '', len = 16) {
  const b = randomBytes(len); let s = '';
  for (const x of b) s += B32[x & 31];
  return prefix + s;
}
export function randomToken(bytes = 32) {
  return [...randomBytes(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
/* Uniform integer in [0, max) without modulo bias. */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error('bad max');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % max; }
}
/* Weighted pick. Weights may be decimals; scaled to integers for exactness. */
export function weightedPick(items, weightOf = x => x.weight) {
  const scaled = items.map(x => Math.round(weightOf(x) * 1000));
  const total = scaled.reduce((a, b) => a + b, 0);
  let r = randomInt(total);
  for (let i = 0; i < items.length; i++) { if (r < scaled[i]) return { item: items[i], index: i }; r -= scaled[i]; }
  return { item: items[items.length - 1], index: items.length - 1 };
}
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function timingSafeEqualStr(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0; for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0 && String(a).length === String(b).length;
}

export function isUniqueViolation(err) {
  const m = String(err && (err.message || err));
  return /UNIQUE constraint failed|PRIMARY KEY/i.test(m);
}

export async function readJson(request, maxBytes = 8192) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) throw new ApiError(415, 'BAD_CONTENT_TYPE', 'Expected JSON.');
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError(413, 'TOO_LARGE', 'Request too large.');
  if (!text) return {};
  try { const v = JSON.parse(text); if (v === null || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw new ApiError(400, 'BAD_JSON', 'Malformed request.'); }
}

export function str(v, { max = 200, min = 0, pattern } = {}) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length < min || s.length > max) return null;
  if (pattern && !pattern.test(s)) return null;
  return s;
}
export const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;
