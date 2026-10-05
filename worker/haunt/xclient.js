/* Server-side X API client for THE HAUNT (app-only Bearer token; never exposed to the browser).
   - Meters every request (requests, resources, cache hits, errors, estimated cost) per UTC day + endpoint.
   - Caches non-security-critical lookups (target metadata). Reply verification is always fetched fresh.
   - Classifies failures: NOT_FOUND (definitive) vs TRANSIENT (retry later, never punish the user). */
import { CONFIG } from '../config.js';
import { dayKey, now } from '../lib/util.js';

const H = CONFIG.haunt;
export class XUnavailable extends Error { constructor(code, status) { super(code); this.code = code; this.httpStatus = status; } }
export class XNotFound extends Error { constructor() { super('NOT_FOUND'); this.code = 'NOT_FOUND'; } }

export const TWEET_FIELDS = 'author_id,conversation_id,created_at,referenced_tweets,in_reply_to_user_id,text,public_metrics';

export function xConfigured(env) { return !!env.X_BEARER_TOKEN; }

async function meter(env, endpoint, { requests = 0, resources = 0, cacheHits = 0, errors = 0, costMicros = 0 }) {
  try {
    await env.DB.prepare(
      `INSERT INTO x_api_usage (day, endpoint, requests, resources, cache_hits, errors, cost_micros) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(day, endpoint) DO UPDATE SET requests = requests + excluded.requests, resources = resources + excluded.resources,
         cache_hits = cache_hits + excluded.cache_hits, errors = errors + excluded.errors, cost_micros = cost_micros + excluded.cost_micros`)
      .bind(dayKey(now()), endpoint, requests, resources, cacheHits, errors, costMicros).run();
  } catch (e) { console.error('x_usage_meter', e.message); }
}

export async function todayCostMicros(env) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(cost_micros),0) AS c FROM x_api_usage WHERE day = ?').bind(dayKey(now())).first();
  return r ? r.c : 0;
}

async function cacheGet(env, key) {
  const r = await env.DB.prepare('SELECT json, expires_at FROM x_api_cache WHERE cache_key = ?').bind(key).first();
  if (!r || r.expires_at <= now()) return null;
  try { return JSON.parse(r.json); } catch { return null; }
}
async function cachePut(env, key, value, ttlMs) {
  const t = now();
  await env.DB.prepare('INSERT INTO x_api_cache (cache_key, json, fetched_at, expires_at) VALUES (?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at')
    .bind(key, JSON.stringify(value), t, t + ttlMs).run();
}

/* GET /2/tweets/:id — returns { data, includes } or throws XNotFound / XUnavailable. */
export async function fetchTweet(env, id, { expandAuthor = false, cacheTtlMs = 0, fetchImpl = fetch } = {}) {
  if (!xConfigured(env)) throw new XUnavailable('X_NOT_CONFIGURED', 503);
  const endpoint = expandAuthor ? 'tweets.lookup+author' : 'tweets.lookup';
  const key = `tweet:${id}:${expandAuthor ? 1 : 0}`;
  if (cacheTtlMs) {
    const hit = await cacheGet(env, key);
    if (hit) { await meter(env, endpoint, { cacheHits: 1 }); return hit; }
  }
  const q = new URLSearchParams({ 'tweet.fields': TWEET_FIELDS });
  if (expandAuthor) { q.set('expansions', 'author_id'); q.set('user.fields', 'username,name,public_metrics,description,verified'); }
  let res;
  try {
    res = await fetchImpl(`https://api.x.com/2/tweets/${encodeURIComponent(id)}?${q}`, { headers: { authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
  } catch {
    await meter(env, endpoint, { requests: 1, errors: 1 });
    throw new XUnavailable('X_NETWORK', 0);
  }
  let body = null; try { body = await res.json(); } catch {}
  if (res.status === 429 || res.status >= 500) { await meter(env, endpoint, { requests: 1, errors: 1 }); throw new XUnavailable(res.status === 429 ? 'X_RATE_LIMITED' : 'X_SERVER_ERROR', res.status); }
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    await meter(env, endpoint, { requests: 1, errors: 1 });
    console.error('x_api_access', res.status, JSON.stringify(body).slice(0, 200));
    throw new XUnavailable(res.status === 402 ? 'X_CREDITS' : 'X_ACCESS', res.status);
  }
  const notFound = res.status === 404 || (!body?.data && Array.isArray(body?.errors) && body.errors.some(e => /not found|resource-not-found|Authorization Error|suspended/i.test(`${e.title} ${e.type} ${e.detail}`)));
  if (notFound) { await meter(env, endpoint, { requests: 1 }); throw new XNotFound(); }
  if (!res.ok || !body?.data) { await meter(env, endpoint, { requests: 1, errors: 1 }); throw new XUnavailable('X_BAD_RESPONSE', res.status); }
  const users = (body.includes?.users || []).length;
  await meter(env, endpoint, { requests: 1, resources: 1 + users, costMicros: H.costMicros.postRead + users * H.costMicros.userRead });
  const out = { data: body.data, includes: body.includes || {} };
  if (cacheTtlMs) await cachePut(env, key, out, cacheTtlMs);
  return out;
}

export async function usageSummary(env, days = 7) {
  const { results } = await env.DB.prepare('SELECT * FROM x_api_usage ORDER BY day DESC, endpoint LIMIT ?').bind(days * 6).all();
  return results;
}
