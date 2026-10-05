import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, adminClient, clock, cron, S01_START, walletPlayer } from './helpers.mjs';
import { CONFIG } from '../worker/config.js';
import { parseStatusUrl, cryptoRelevance, fingerprint, checkReplyContent } from '../worker/haunt/content.js';
import * as ENGINE from '../worker/haunt/engine.js';

const MID = S01_START + 3 * 86400_000 + 10 * 3600_000;
const H = CONFIG.haunt;
const XENV = { X_BEARER_TOKEN: 'test-bearer', X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'cs' };
const TARGET_ID = '1800000000000000001', TARGET_AUTHOR = '777';
let seq = 5000;
const sid = () => String(1900000000000000000n + BigInt(seq++));

/* ---------- fake X API ---------- */
const tweets = new Map();       // id -> data | { _status }
let calls = [];
let realFetch;
function installX() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    calls.push(url);
    const m = url.match(/\/2\/tweets\/(\d+)\?/);
    if (!m) throw new Error('unexpected ' + url);
    const t = tweets.get(m[1]);
    if (!t) return new Response(JSON.stringify({ errors: [{ title: 'Not Found Error', type: 'https://api.twitter.com/2/problems/resource-not-found' }] }), { status: 200 });
    if (t._status) return new Response(JSON.stringify({ title: 'err' }), { status: t._status });
    const includes = url.includes('expansions=author_id') ? { users: [{ id: t.author_id, username: t._username || 'cryptoKOL', public_metrics: { followers_count: 5000 } }] } : undefined;
    return new Response(JSON.stringify({ data: t, includes }), { status: 200 });
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
  beforeEach(() => { clock.set(MID); calls = []; tweets.clear(); installX(); });
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
    assert.deepEqual(s.submission.checks.map(c => c.key), ['URL', 'ACCOUNT', 'DUPLICATE', 'TARGET', 'LIMITS', 'POST', 'AUTHOR', 'REPLY', 'CONTEXT', 'TIMING', 'CONTENT', 'ORIGINALITY', 'CRYPTO']);
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

describe('haunt content + relevance', () => {
  test('URL parsing', () => {
    assert.equal(parseStatusUrl('https://x.com/user/status/1800000000000000001?s=20').id, '1800000000000000001');
    assert.equal(parseStatusUrl('https://twitter.com/user/status/123456789').normalizedUrl, 'https://x.com/i/status/123456789');
    assert.equal(parseStatusUrl('https://mobile.x.com/i/web/status/123456789').id, '123456789');
    for (const bad of ['https://x.com.evil.io/u/status/123456', 'https://x.com/u/likes', 'ftp://x.com/u/status/123456', '']) assert.equal(parseStatusUrl(bad), null);
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
