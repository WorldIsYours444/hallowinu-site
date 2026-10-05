import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, adminClient, clock, cron, S01_START, walletPlayer } from './helpers.mjs';
import { CONFIG } from '../worker/config.js';
import { parseStatusUrl, parseTikTokUrl, mentionsProject, cryptoRelevance, fingerprint, checkReplyContent } from '../worker/haunt/content.js';
import * as ENGINE from '../worker/haunt/engine.js';

const MID = S01_START + 3 * 86400_000 + 10 * 3600_000;
const H = CONFIG.haunt;
const XENV = { X_BEARER_TOKEN: 'test-bearer', X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'cs' };
const TARGET_ID = '1800000000000000001', TARGET_AUTHOR = '777';
let seq = 5000;
const sid = () => String(1900000000000000000n + BigInt(seq++));

/* ---------- fake X API ---------- */
const tweets = new Map();       // id -> data | { _status }
const tiktoks = new Map();      // video id -> { creator, caption } | { _status }
let calls = [];
let realFetch;
function installX() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    calls.push(url);
    if (url.startsWith('https://www.tiktok.com/oembed')) {
      const vid = decodeURIComponent(url).match(/\/video\/(\d+)/)[1];
      const v = tiktoks.get(vid);
      if (!v) return new Response(JSON.stringify({ code: 400, message: 'Something went wrong' }), { status: 400 });
      if (v._status) return new Response('{}', { status: v._status });
      return new Response(JSON.stringify({ version: '1.0', type: 'video', author_unique_id: v.creator, author_name: v.creator, title: v.caption, embed_product_id: vid }), { status: 200 });
    }
    const m = url.match(/\/2\/tweets\/(\d+)\?/);
    if (!m) throw new Error('unexpected ' + url);
    const t = tweets.get(m[1]);
    if (!t) return new Response(JSON.stringify({ errors: [{ title: 'Not Found Error', type: 'https://api.twitter.com/2/problems/resource-not-found' }] }), { status: 200 });
    if (t._status) return new Response(JSON.stringify({ title: 'err' }), { status: t._status });
    const includes = url.includes('expansions=author_id') ? { users: [{ id: t.author_id, username: t._username || 'cryptoKOL', public_metrics: { followers_count: 5000 } }] } : undefined;
    let inc = includes;
    if (url.includes('attachments.media_keys') && t._media) inc = { ...(inc || {}), media: t._media.map((type, i) => ({ media_key: `3_${t.id}_${i}`, type })) };
    const data = { ...t }; delete data._media;
    if (t._media) data.attachments = { media_keys: t._media.map((_, i) => `3_${t.id}_${i}`) };
    return new Response(JSON.stringify({ data, includes: inc }), { status: 200 });
  };
}
function reply({ id = sid(), author, parent = TARGET_ID, conv = TARGET_ID, text = 'Solana memecoin season is here, the ghost dog is early ' + id, created = Date.now() - 60_000 } = {}) {
  tweets.set(id, { id, author_id: author, conversation_id: conv, created_at: new Date(created).toISOString(), text: `@cryptoKOL ${text}`, referenced_tweets: parent ? [{ type: 'replied_to', id: parent }] : undefined });
  return { id, url: `https://x.com/someone/status/${id}?s=20` };
}
async function setup(extraEnv = {}) {
  const env = makeEnv({ ...XENV, ...extraEnv });
  tweets.set(TARGET_ID, { id: TARGET_ID, author_id: TARGET_AUTHOR, conversation_id: TARGET_ID, created_at: new Date(MID - 3600_000).toISOString(), text: 'Solana memecoins are pumping today, which $SOL meme are you holding? #solana' });
  const a = adminClient(env);
  const tgt = await a.post('haunt/targets', { url: `https://x.com/cryptoKOL/status/${TARGET_ID}`, category: 'SOLANA / MEMECOINS', reward: 5, expiresInMinutes: 600 });
  assert.equal(tgt.ok, true, JSON.stringify(tgt));
  return { env, a, targetId: tgt.id };
}
let xuid = 100;
async function raider(env) {
  const p = await walletPlayer(env);
  const x = String(xuid++);
  const t = Date.now();
  await env.DB.prepare("INSERT INTO player_identities (player_id, provider, provider_user_id, username, verified_at, method, created_at, updated_at) VALUES (?, 'x', ?, ?, ?, 'oauth2', ?, ?)").bind(p.player.id, x, 'raider' + x, t, t, t).run();
  return { ...p, x };
}
async function newTarget(env, a, opts = {}) {
  const id = sid();
  tweets.set(id, { id, author_id: TARGET_AUTHOR, conversation_id: id, created_at: new Date(Date.now() - 3600_000).toISOString(), text: 'Solana memecoin chat' });
  const r = await a.post('haunt/targets', { url: `https://x.com/k/status/${id}`, category: 'SOLANA', reward: opts.reward ?? 5, expiresInMinutes: opts.mins ?? 600, maxSubmissions: opts.max });
  return { targetId: r.id, statusId: id };
}

describe('THE HAUNT', () => {
  beforeEach(() => { clock.set(MID); calls = []; tweets.clear(); tiktoks.clear(); installX(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('valid reply: auto-approved, +5 Haunt XP via ledger, Arcade points + season untouched', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env);
    const before = await env.DB.prepare('SELECT total_points, xp FROM players WHERE id=?').bind(r.player.id).first();
    const rep = reply({ author: r.x });
    calls = [];
    const s = await r.c.post('/api/haunt/submit', { url: rep.url, targetId, points: 9999 });
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(s.submission.status, 'AUTO_APPROVED');
    assert.equal(s.submission.points, 5);
    assert.ok(s.submission.checks.every(c => c.ok));
    assert.deepEqual(s.submission.checks.map(c => c.key), ['TYPE_SELECT', 'URL', 'ACCOUNT', 'DUPLICATE', 'TARGET', 'LIMITS', 'POST', 'AUTHOR', 'REPLY', 'CONTEXT', 'TIMING', 'CONTENT', 'ORIGINALITY', 'CRYPTO']);
    assert.equal(calls.length, 1, 'exactly one paid X read per submission (target is pre-verified)');
    const p = await env.DB.prepare('SELECT total_points, xp, haunt_xp, haunt_count FROM players WHERE id=?').bind(r.player.id).first();
    assert.equal(p.haunt_xp, 5); assert.equal(p.haunt_count, 1); assert.equal(p.xp, before.xp + 5);
    assert.equal(p.total_points, before.total_points, 'Arcade points unchanged');
    const led = await env.DB.prepare("SELECT * FROM point_transactions WHERE source_type='HAUNT_X_REPLY'").first();
    assert.equal(led.amount, 5); assert.equal(led.currency, 'HAUNT_XP'); assert.equal(led.source_id, s.submission.id); assert.equal(led.season_id, null);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM season_player_stats').first()).n, 0, 'never counts toward Season SOL prizes');
    const st = await r.c.get('/api/haunt');
    assert.equal(st.me.xp, 5); assert.equal(st.me.rank, 1); assert.equal(st.targets[0].mine, 'AUTO_APPROVED');
  });

  test('cheap local rejections never call the X API', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env);
    calls = [];
    for (const url of ['nope', 'https://evil.com/x/status/123456', 'https://x.com/home', 'javascript:alert(1)', 'https://x.com/a/status/abc']) {
      assert.equal((await r.c.post('/api/haunt/submit', { url, targetId })).error, 'INVALID_URL', url);
    }
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url })).error, 'TARGET_REQUIRED');
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId: 99999 })).error, 'TARGET_NOT_FOUND');
    const noX = await walletPlayer(env);
    assert.equal((await noX.c.post('/api/haunt/submit', { url: reply({ author: '1' }).url, targetId })).error, 'X_NOT_CONNECTED');
    assert.equal((await client(env).post('/api/haunt/submit', { url: reply({ author: '1' }).url, targetId })).status, 401);
    assert.equal(calls.length, 0);
  });

  test('author mismatch, not a reply, wrong target, deleted post, too old, before the haunt', async () => {
    const { env, a, targetId } = await setup();
    const cases = [
      [{ author: '424242' }, 'AUTHOR_MISMATCH'],
      [{ parent: null }, 'NOT_A_REPLY'],
      [{ parent: '1111111111111111111', conv: '1111111111111111111' }, 'WRONG_TARGET'],
      [{ created: MID - 3 * 86400_000 }, 'REPLY_BEFORE_HAUNT'],
    ];
    for (const [o, reason] of cases) {
      const r = await raider(env);
      const s = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, ...o }).url, targetId });
      assert.equal(s.submission.status, 'AUTO_REJECTED', reason); assert.equal(s.submission.reason, reason);
      assert.ok(s.submission.message.length > 10);
    }
    const r = await raider(env);
    const ghost = await r.c.post('/api/haunt/submit', { url: 'https://x.com/x/status/1234567890123', targetId });
    assert.equal(ghost.submission.reason, 'STATUS_NOT_FOUND');
    const p = await env.DB.prepare('SELECT SUM(haunt_xp) s FROM players').first();
    assert.equal(p.s, 0, 'no XP for any rejection');
  });

  test('reply inside the target thread counts; duplicates by status are blocked', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env), r2 = await raider(env);
    const rep = reply({ author: r.x, parent: '1555555555555555555', conv: TARGET_ID });
    const s = await r.c.post('/api/haunt/submit', { url: rep.url, targetId });
    assert.equal(s.submission.status, 'AUTO_APPROVED');
    const again = await r.c.post('/api/haunt/submit', { url: rep.url, targetId });
    assert.equal(again.duplicateOf, s.submission.id, 'same player: idempotent');
    assert.equal((await r2.c.post('/api/haunt/submit', { url: rep.url.replace('someone', 'other'), targetId })).error, 'DUPLICATE_STATUS');
    assert.equal((await env.DB.prepare('SELECT haunt_xp FROM players WHERE id=?').bind(r.player.id).first()).haunt_xp, 5);
  });

  test('content: too short, own duplicate text, cross-player copy-paste; vocabulary is fine', async () => {
    const { env, a, targetId } = await setup();
    const r = await raider(env);
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, text: '🔥🔥 $HW' }).url, targetId })).submission.reason, 'CONTENT_TOO_SHORT');
    const ok1 = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, text: 'HALLOWINU is the ghost dog of Solana' }).url, targetId });
    assert.equal(ok1.submission.status, 'AUTO_APPROVED');
    clock.advance(H.limits.minGapMs + 1000);
    const t2 = await newTarget(env, a);
    const dup = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: t2.statusId, conv: t2.statusId, text: 'hallowinu is the GHOST dog of solana!!' }).url, targetId: t2.targetId });
    assert.equal(dup.submission.reason, 'DUPLICATE_CONTENT');
    const vocab = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: t2.statusId, conv: t2.statusId, text: '$HALLOWINU on Solana keeps haunting the memecoin charts' }).url, targetId: t2.targetId });
    assert.equal(vocab.submission.status, 'AUTO_APPROVED', 'same vocabulary, different sentence');
    // copy-paste wave across players
    const text = 'Join the HALLOWINU pack now best memecoin on Solana';
    const res = [];
    for (let i = 0; i < 3; i++) { const p = await raider(env); res.push((await p.c.post('/api/haunt/submit', { url: reply({ author: p.x, text }).url, targetId })).submission); }
    assert.equal(res[0].status, 'AUTO_APPROVED'); assert.equal(res[1].status, 'AUTO_APPROVED'); assert.equal(res[2].reason, 'COPY_PASTE');
  });

  test('targets: expired, inactive, full, one claim per player per target; reward from server config', async () => {
    const { env, a, targetId } = await setup();
    const r = await raider(env);
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId })).submission.status, 'AUTO_APPROVED');
    clock.advance(H.limits.minGapMs + 1);
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId })).error, 'TARGET_ALREADY_DONE');
    const exp = await newTarget(env, a, { mins: 1 });
    clock.advance(2 * 60_000);
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: exp.statusId, conv: exp.statusId }).url, targetId: exp.targetId })).error, 'TARGET_EXPIRED');
    const off = await newTarget(env, a);
    await a.patch(`haunt/targets/${off.targetId}`, { active: false });
    assert.equal((await r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: off.statusId, conv: off.statusId }).url, targetId: off.targetId })).error, 'TARGET_INACTIVE');
    const full = await newTarget(env, a, { max: 1, reward: 12 });
    const p1 = await raider(env), p2 = await raider(env);
    const s1 = await p1.c.post('/api/haunt/submit', { url: reply({ author: p1.x, parent: full.statusId, conv: full.statusId }).url, targetId: full.targetId });
    assert.equal(s1.submission.points, 12, 'reward comes from the target');
    assert.equal((await p2.c.post('/api/haunt/submit', { url: reply({ author: p2.x, parent: full.statusId, conv: full.statusId }).url, targetId: full.targetId })).submission.reason, 'TARGET_FULL');
    const list = await p2.c.get('/api/haunt');
    assert.equal(list.targets.find(t => t.id === full.targetId).full, true);
  });

  test('reward limits: min gap, 3 per 10 minutes, cooldown countdown, expiry, 20 per day', async () => {
    const { env, a } = await setup();
    const r = await raider(env);
    const targets = []; for (let i = 0; i < 24; i++) targets.push(await newTarget(env, a));
    const go = i => r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: targets[i].statusId, conv: targets[i].statusId }).url, targetId: targets[i].targetId });
    const first = await go(0);
    assert.equal(first.submission.status, 'AUTO_APPROVED');
    const T0 = first.submission.createdAt;
    const gap = await go(1);
    assert.equal(gap.error, 'COOLDOWN'); assert.equal(gap.nextAt, T0 + H.limits.minGapMs);
    clock.advance(H.limits.minGapMs); assert.equal((await go(1)).submission.status, 'AUTO_APPROVED');
    clock.advance(H.limits.minGapMs); assert.equal((await go(2)).submission.status, 'AUTO_APPROVED');
    clock.advance(H.limits.minGapMs);
    const win = await go(3);
    assert.equal(win.error, 'COOLDOWN'); assert.equal(win.nextAt, T0 + H.limits.window.ms);
    const st = await r.c.get('/api/haunt');   // page refresh during cooldown
    assert.equal(st.me.state, 'COOLDOWN'); assert.equal(st.me.nextAt, T0 + H.limits.window.ms); assert.equal(st.me.window.used, 3);
    clock.set(T0 + H.limits.window.ms + 1);
    assert.equal((await go(3)).submission.status, 'AUTO_APPROVED', 'cooldown expired');
    // daily cap
    let i = 4;
    while (true) {
      clock.advance(H.limits.window.ms / H.limits.window.count + 1);
      const s = await go(i++);
      if (!s.ok) { assert.equal(s.error, 'DAILY_LIMIT'); break; }
      assert.equal(s.submission.status, 'AUTO_APPROVED');
    }
    assert.equal((await env.DB.prepare('SELECT haunt_count FROM players WHERE id=?').bind(r.player.id).first()).haunt_count, H.limits.perDay);
    assert.equal((await r.c.get('/api/haunt')).me.state, 'DAILY_LIMIT');
  });

  test('multi-tab race: simultaneous submissions cannot bypass limits; same status cannot pay twice', async () => {
    const { env, a } = await setup();
    const r = await raider(env);
    const t1 = await newTarget(env, a), t2 = await newTarget(env, a);
    const tab2 = client(env); tab2.cookie = r.c.cookie;
    const [x, y] = await Promise.all([
      r.c.post('/api/haunt/submit', { url: reply({ author: r.x, parent: t1.statusId, conv: t1.statusId }).url, targetId: t1.targetId }),
      tab2.post('/api/haunt/submit', { url: reply({ author: r.x, parent: t2.statusId, conv: t2.statusId }).url, targetId: t2.targetId }),
    ]);
    assert.equal([x, y].filter(v => v.ok && v.submission.status === 'AUTO_APPROVED').length, 1);
    assert.equal([x, y].filter(v => v.error === 'COOLDOWN').length, 1);
    const p2 = await raider(env);
    clock.advance(H.limits.window.ms + 1);
    const rep = reply({ author: p2.x, parent: t1.statusId, conv: t1.statusId });
    const both = await Promise.all([p2.c.post('/api/haunt/submit', { url: rep.url, targetId: t1.targetId }), p2.c.post('/api/haunt/submit', { url: rep.url, targetId: t1.targetId })]);
    assert.ok(both.some(b => b.ok));
    assert.equal((await env.DB.prepare('SELECT haunt_xp FROM players WHERE id=?').bind(p2.player.id).first()).haunt_xp, 5);
    // forced double-verification of an approved submission
    const sub = await env.DB.prepare("SELECT id FROM haunt_submissions WHERE player_id=? AND status='AUTO_APPROVED'").bind(p2.player.id).first();
    await env.DB.prepare("UPDATE haunt_submissions SET status='VERIFICATION_PENDING' WHERE id=?").bind(sub.id).run();
    await ENGINE.verify(env, sub.id);
    assert.equal((await env.DB.prepare('SELECT haunt_xp FROM players WHERE id=?').bind(p2.player.id).first()).haunt_xp, 5, 'ledger UNIQUE blocks a second award');
    assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM point_transactions WHERE source_id=?").bind(sub.id).first()).n, 1);
  });

  test('X down / rate limited / no credits: queued, never awarded unverified, retried idempotently by cron', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env);
    const rep = reply({ author: r.x });
    const real = tweets.get(rep.id);
    tweets.set(rep.id, { _status: 503 });
    const s = await r.c.post('/api/haunt/submit', { url: rep.url, targetId });
    assert.equal(s.submission.status, 'VERIFICATION_PENDING'); assert.equal(s.submission.points, 0);
    assert.ok(s.submission.nextRetryAt > MID);
    tweets.set(rep.id, { _status: 429 });
    clock.advance(H.retry.baseMs + 1); await cron(env);
    assert.equal((await r.c.get(`/api/haunt/submissions/${s.submission.id}`)).submission.status, 'VERIFICATION_PENDING');
    tweets.set(rep.id, real);
    clock.advance(H.retry.baseMs * 4 + 1); await cron(env); await cron(env);
    const done = await r.c.get(`/api/haunt/submissions/${s.submission.id}`);
    assert.equal(done.submission.status, 'AUTO_APPROVED');
    assert.equal((await env.DB.prepare('SELECT haunt_xp FROM players WHERE id=?').bind(r.player.id).first()).haunt_xp, 5);
    // IDOR: another player cannot read it
    const other = await raider(env);
    assert.equal((await other.c.get(`/api/haunt/submissions/${s.submission.id}`)).status, 404);
    // credits exhausted
    const r2 = await raider(env);
    const rep2 = reply({ author: r2.x }); tweets.set(rep2.id, { _status: 402 });
    assert.equal((await r2.c.post('/api/haunt/submit', { url: rep2.url, targetId })).submission.status, 'VERIFICATION_PENDING');
    const usage = await env.DB.prepare('SELECT SUM(errors) e, SUM(requests) q FROM x_api_usage').first();
    assert.ok(usage.e >= 3 && usage.q >= 4);
  });

  test('daily budget guard pauses verification instead of spending; max retries -> manual review', async () => {
    const { env, a, targetId } = await setup();
    await a.put('settings', { key: 'haunt.dailyBudgetCents', value: 0 });
    const r = await raider(env);
    calls = [];
    const s = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId });
    assert.equal(s.submission.status, 'VERIFICATION_PENDING'); assert.equal(s.submission.reason, 'BUDGET_PAUSED');
    assert.equal(calls.length, 0, 'no paid call over budget');
    for (let i = 0; i < H.retry.maxAttempts; i++) { clock.advance(2 * 3600_000); await cron(env); }
    assert.equal((await r.c.get(`/api/haunt/submissions/${s.submission.id}`)).submission.status, 'MANUAL_REVIEW');
    await a.put('settings', { key: 'haunt.dailyBudgetCents', value: 100 });
    assert.equal((await a.post(`haunt/submissions/${s.submission.id}/retry`)).ok, true);
    assert.equal((await r.c.get(`/api/haunt/submissions/${s.submission.id}`)).submission.status, 'AUTO_APPROVED');
  });

  test('technical rate limit stops API flooding before paid calls', async () => {
    const { env, a } = await setup();
    const r = await raider(env);
    calls = [];
    let last;
    for (let i = 0; i < H.submitRate.limit + 2; i++) last = await r.c.post('/api/haunt/submit', { url: `https://x.com/a/status/${sid()}`, targetId: 424242 });
    assert.equal(last.error, 'RATE_LIMITED');
    assert.equal(calls.length, 0);
  });

  test('admin: target creation verifies via X, invalidation reverses XP, overview shows evidence + usage', async () => {
    const { env, a, targetId } = await setup();
    assert.equal((await a.post('haunt/targets', { url: 'https://x.com/a/status/1234567890999', category: 'SOLANA' })).error, 'STATUS_NOT_FOUND');
    assert.equal((await a.post('haunt/targets', { url: `https://x.com/cryptoKOL/status/${TARGET_ID}`, category: 'SOLANA' })).error, 'TARGET_EXISTS');
    assert.equal((await client(env).post('/api/admin/haunt/targets', { url: 'x' })).status, 401);
    const r = await raider(env);
    const s = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId });
    const ov = await a.get('haunt');
    assert.ok(ov.submissions[0].checks_json.includes('AUTHOR')); assert.ok(ov.usage.length >= 1); assert.equal(ov.xConfigured, true);
    assert.equal((await a.post(`haunt/submissions/${s.submission.id}/invalidate`, { reason: 'deleted after claim' })).ok, true);
    const p = await env.DB.prepare('SELECT haunt_xp, haunt_count FROM players WHERE id=?').bind(r.player.id).first();
    assert.equal(p.haunt_xp, 0); assert.equal(p.haunt_count, 0);
    assert.equal((await env.DB.prepare("SELECT SUM(amount) s FROM point_transactions WHERE currency='HAUNT_XP' AND player_id=?").bind(r.player.id).first()).s, 0);
    assert.equal((await a.post(`haunt/submissions/${s.submission.id}/invalidate`, { reason: 'again' })).error, 'ALREADY_INVALIDATED');
  });

  test('leaderboards (today / week / all) and activity show names only', async () => {
    const { env, a, targetId } = await setup();
    const p1 = await raider(env), p2 = await raider(env);
    await p1.c.post('/api/haunt/submit', { url: reply({ author: p1.x }).url, targetId });
    const t2 = await newTarget(env, a, { reward: 9 });
    await p2.c.post('/api/haunt/submit', { url: reply({ author: p2.x, parent: t2.statusId, conv: t2.statusId }).url, targetId: t2.targetId });
    for (const range of ['today', 'week', 'all']) {
      const lb = await p1.c.get(`/api/haunt/leaderboard?range=${range}`);
      assert.equal(lb.rows.length, 2, range); assert.equal(lb.rows[0].xp, 9); assert.equal(lb.rows[1].me, true);
    }
    clock.advance(8 * 86400_000);
    assert.equal((await p1.c.get('/api/haunt/leaderboard?range=today')).rows.length, 0);
    assert.equal((await p1.c.get('/api/haunt/leaderboard?range=all')).rows.length, 2);
    const act = await client(env).get('/api/haunt/activity');
    assert.equal(act.items.length, 2);
    assert.ok(!JSON.stringify(act).match(/p_|x_user|\d{15,}/), 'no ids or X ids leak');
  });

  test('X not configured: page works, submissions queue instead of failing', async () => {
    const env = makeEnv();
    const r = await walletPlayer(env);
    const st = await r.c.get('/api/haunt');
    assert.equal(st.available, false); assert.deepEqual(st.targets, []);
  });
});

function post({ id = sid(), author, text = 'The ghost dog $HALLOWINU is haunting Solana tonight, join the pack ' + id, media, reply: rep, repost, created = Date.now() - 60_000 } = {}) {
  const refs = rep ? [{ type: 'replied_to', id: rep }] : repost ? [{ type: 'retweeted', id: repost }] : undefined;
  tweets.set(id, { id, author_id: author, conversation_id: rep || id, created_at: new Date(created).toISOString(), text, referenced_tweets: refs, _media: media });
  return { id, url: `https://x.com/me/status/${id}` };
}
let tk = 7300000000000000000n;
function tiktok({ creator = 'ghostmaker', caption = 'Ghost dog dance #hallowinu 👻', handle } = {}) {
  const id = String(tk++);
  tiktoks.set(id, { creator, caption });
  return { id, url: `https://www.tiktok.com/@${handle || creator}/video/${id}?is_from_webapp=1` };
}

describe('THE HAUNT — submission types', () => {
  beforeEach(() => { clock.set(MID); calls = []; tweets.clear(); tiktoks.clear(); installX(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('rules expose 4 types with server-side rewards; v1 client without type = X_REPLY', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env);
    const st = await r.c.get('/api/haunt');
    assert.deepEqual(Object.keys(st.rules.types), ['X_REPLY', 'X_POST', 'X_MEME', 'TIKTOK_POST']);
    assert.equal(st.rules.types.X_MEME.reward, H.types.X_MEME.reward);
    const s = await r.c.post('/api/haunt/submit', { url: reply({ author: r.x }).url, targetId });
    assert.equal(s.submission.type, 'X_REPLY'); assert.equal(s.submission.status, 'AUTO_APPROVED');
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'X_SPACE', url: post({ author: r.x }).url })).error, 'BAD_TYPE');
  });

  test('X_POST: own original post about HALLOWINU → approved with the config reward (browser cannot pick it)', async () => {
    const { env } = await setup();
    const r = await raider(env);
    calls = [];
    const s = await r.c.post('/api/haunt/submit', { type: 'X_POST', url: post({ author: r.x }).url, reward: 9999, points: 9999 });
    assert.equal(s.submission.status, 'AUTO_APPROVED', JSON.stringify(s.submission.checks));
    assert.equal(s.submission.points, H.types.X_POST.reward);
    assert.equal(calls.length, 1, 'one paid read');
    const led = await env.DB.prepare("SELECT amount, source_type, currency FROM point_transactions WHERE player_id = ? AND game = 'haunt'").bind(r.player.id).all();
    assert.deepEqual(led.results.map(x => [x.amount, x.source_type, x.currency]), [[H.types.X_POST.reward, 'HAUNT_X_POST', 'HAUNT_XP']]);
    const me = (await r.c.get('/api/haunt')).me;
    assert.equal(me.submissions[0].type, 'X_POST');
  });

  test('X_POST rejections: not about HALLOWINU, a reply, a repost, someone else\'s post', async () => {
    const { env } = await setup();
    const r = await raider(env);
    const go = async (u) => { clock.advance(3 * 60_000); return (await r.c.post('/api/haunt/submit', { type: 'X_POST', url: u })).submission; };
    assert.equal((await go(post({ author: r.x, text: 'Solana is pumping hard today, what a great day for all of crypto' }).url)).reason, 'NOT_ABOUT_HALLOWINU');
    assert.equal((await go(post({ author: r.x, reply: TARGET_ID }).url)).reason, 'IS_A_REPLY');
    assert.equal((await go(post({ author: r.x, repost: TARGET_ID }).url)).reason, 'IS_REPOST');
    assert.equal((await go(post({ author: '999999' }).url)).reason, 'AUTHOR_MISMATCH');
    assert.equal((await go(post({ author: r.x, created: Date.now() - 3 * 86400_000 }).url)).reason, 'POST_TOO_OLD');
  });

  test('X_MEME: needs image/GIF/video media; detects photo + gif', async () => {
    const { env } = await setup();
    const r = await raider(env);
    const ok = await r.c.post('/api/haunt/submit', { type: 'X_MEME', url: post({ author: r.x, text: '$HALLOWINU 👻', media: ['photo'] }).url });
    assert.equal(ok.submission.status, 'AUTO_APPROVED', JSON.stringify(ok.submission.checks));
    assert.equal(ok.submission.points, H.types.X_MEME.reward);
    assert.ok(calls.some(u => u.includes('attachments.media_keys')));
    clock.advance(3 * 60_000);
    const no = await r.c.post('/api/haunt/submit', { type: 'X_MEME', url: post({ author: r.x, text: '$HALLOWINU 👻 no picture here sorry' }).url });
    assert.equal(no.submission.reason, 'NO_MEDIA');
    clock.advance(3 * 60_000);
    const gif = await r.c.post('/api/haunt/submit', { type: 'X_MEME', url: post({ author: r.x, text: '#hallowinu', media: ['animated_gif'] }).url });
    assert.equal(gif.submission.status, 'AUTO_APPROVED');
  });

  test('wrong platform + short links are rejected before any paid call', async () => {
    const { env, targetId } = await setup();
    const r = await raider(env);
    calls = [];
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: post({ author: r.x }).url })).error, 'WRONG_PLATFORM');
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'X_POST', url: tiktok().url })).error, 'WRONG_PLATFORM');
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'X_REPLY', url: tiktok().url, targetId })).error, 'WRONG_PLATFORM');
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: 'https://vm.tiktok.com/ZMabc123/' })).error, 'TIKTOK_SHORT_LINK');
    assert.equal((await r.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: 'https://tiktok.com.evil.io/@a/video/123456789012' })).error, 'INVALID_URL');
    assert.equal(calls.length, 0);
  });

  test('TIKTOK_POST: video found → MANUAL_REVIEW (no XP), admin approves with a note → XP once; reject path; mismatch', async () => {
    const { env, a } = await setup();
    const p = await walletPlayer(env);             // TikTok does not need a connected X account
    const v = tiktok();
    const s = await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: v.url });
    assert.equal(s.submission.status, 'MANUAL_REVIEW', JSON.stringify(s));
    assert.equal(s.submission.reason, 'TIKTOK_OWNERSHIP_REVIEW');
    assert.equal(s.submission.points, 0);
    assert.equal((await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: v.url.replace('?is_from_webapp=1', '') })).duplicateOf, s.submission.id);
    const thief = await walletPlayer(env);
    assert.equal((await thief.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: v.url })).error, 'DUPLICATE_STATUS');
    // unauthorized review
    assert.equal((await client(env).post(`/api/admin/haunt/submissions/${s.submission.id}/review`, { decision: 'approve', note: 'ok' })).status, 401);
    assert.equal((await a.post(`haunt/submissions/${s.submission.id}/review`, { decision: 'approve' })).error, 'NOTE_REQUIRED');
    const ap = await a.post(`haunt/submissions/${s.submission.id}/review`, { decision: 'approve', note: 'bio links wallet' });
    assert.equal(ap.ok, true, JSON.stringify(ap));
    assert.equal((await a.post(`haunt/submissions/${s.submission.id}/review`, { decision: 'approve', note: 'again' })).error, 'NOT_IN_REVIEW');
    const pl = await env.DB.prepare('SELECT haunt_xp FROM players WHERE id = ?').bind(p.player.id).first();
    assert.equal(pl.haunt_xp, H.types.TIKTOK_POST.reward);
    const view = await p.c.get(`/api/haunt/submissions/${s.submission.id}`);
    assert.equal(view.submission.status, 'MANUAL_APPROVED');
    // reject path
    clock.advance(3 * 60_000);
    const s2 = await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: tiktok().url });
    await a.post(`haunt/submissions/${s2.submission.id}/review`, { decision: 'reject', note: 'not the player' });
    assert.equal((await p.c.get(`/api/haunt/submissions/${s2.submission.id}`)).submission.status, 'MANUAL_REJECTED');
    // creator mismatch + not found + not about project
    clock.advance(3 * 60_000);
    assert.equal((await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: tiktok({ creator: 'someoneelse', handle: 'me' }).url })).submission.reason, 'CREATOR_MISMATCH');
    clock.advance(3 * 60_000);
    assert.equal((await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: 'https://www.tiktok.com/@me/video/7399999999999999999' })).submission.reason, 'VIDEO_NOT_FOUND');
    // approved TikTok counts on the leaderboard; invalidation reverses it
    const lb = await p.c.get('/api/haunt/leaderboard?range=today');
    assert.equal(lb.rows[0].xp, H.types.TIKTOK_POST.reward); assert.equal(lb.rows[0].me, true);
    await a.post(`haunt/submissions/${s.submission.id}/invalidate`, { reason: 'stolen video' });
    assert.equal((await env.DB.prepare('SELECT haunt_xp FROM players WHERE id = ?').bind(p.player.id).first()).haunt_xp, 0);
  });

  test('TikTok down → VERIFICATION_PENDING, never fake-approved', async () => {
    const { env } = await setup();
    const p = await walletPlayer(env);
    const v = tiktok(); tiktoks.set(v.id, { _status: 503 });
    const s = await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: v.url });
    assert.equal(s.submission.status, 'VERIFICATION_PENDING');
    assert.equal(s.submission.points, 0);
  });

  test('per-type daily limits are enforced atomically per type', async () => {
    const { env } = await setup();
    const p = await walletPlayer(env);
    for (let i = 0; i < H.types.TIKTOK_POST.perDay; i++) {
      const s = await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: tiktok().url });
      assert.equal(s.ok, true, JSON.stringify(s));
      clock.advance(H.limits.minGapMs + 1000);
      if ((i + 1) % H.limits.window.count === 0) clock.advance(H.limits.window.ms);
    }
    assert.equal((await p.c.post('/api/haunt/submit', { type: 'TIKTOK_POST', url: tiktok().url })).error, 'TYPE_DAILY_LIMIT');
    const st = await p.c.get('/api/haunt');
    assert.equal(st.me.types.TIKTOK_POST.used, H.types.TIKTOK_POST.perDay);
  });
});

describe('haunt content + relevance', () => {
  test('URL parsing', () => {
    assert.equal(parseStatusUrl('https://x.com/user/status/1800000000000000001?s=20').id, '1800000000000000001');
    assert.equal(parseStatusUrl('https://twitter.com/user/status/123456789').normalizedUrl, 'https://x.com/i/status/123456789');
    assert.equal(parseStatusUrl('https://mobile.x.com/i/web/status/123456789').id, '123456789');
    for (const bad of ['https://x.com.evil.io/u/status/123456', 'https://x.com/u/likes', 'ftp://x.com/u/status/123456', '']) assert.equal(parseStatusUrl(bad), null);
    assert.deepEqual(parseTikTokUrl('https://m.tiktok.com/@Ghost.Dog/video/7300000000000000001?lang=en'), { id: '7300000000000000001', handle: 'ghost.dog', normalizedUrl: 'https://www.tiktok.com/@Ghost.Dog/video/7300000000000000001' });
    assert.equal(parseTikTokUrl('https://www.tiktok.com/@a/live'), null);
    assert.equal(mentionsProject('the $HallowInu pack'), true); assert.equal(mentionsProject('random solana meme'), false);
  });
  test('fingerprint ignores case, spacing, emoji and the reply mention', () => {
    assert.equal(fingerprint('@kol HALLOWINU is   early 👻!!'), fingerprint('hallowinu is early'));
    assert.equal(checkReplyContent('@kol 🔥🔥🔥 https://t.co/x').ok, false);
  });
  test('relevance needs multiple signals, never a single keyword', () => {
    assert.equal(cryptoRelevance({ text: 'Nice wallet photo' }).pass, false);
    const s = cryptoRelevance({ text: 'Solana memecoin liquidity is wild, $BONK on the dex', authorBio: 'crypto trader', likes: 50 });
    assert.equal(s.pass, true); assert.ok(s.score >= CONFIG.haunt.discovered.minRelevance);
    assert.equal(cryptoRelevance({ text: 'solana solana solana solana' }).pass, false);
  });
});
