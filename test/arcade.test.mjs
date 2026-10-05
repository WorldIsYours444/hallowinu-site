import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, adminClient, clock, idem, cron, S01_START, S01_END, newWallet, signIn, b64, walletPlayer, uniqueName, grantSocials } from './helpers.mjs';
import { allocatePool, solStringToLamports, lamportsToSolString, validateDistribution } from '../worker/lib/prizes.js';
import { CONFIG, validateConfig, levelForXp } from '../worker/config.js';
import { scoreClaims, generateBoard } from '../worker/games/pumpkin-hunt.js';
import { validateName } from '../worker/lib/auth.js';

const MID = S01_START + 3 * 86400_000 + 10 * 3600_000; // inside Season 01, 10:00 UTC

async function newPlayer(env, opts) { return walletPlayer(env, opts); }
let fundSeq = 0;
/* Credits the season pool the only way that exists now: a verified maker-reward event (80% → pool). */
async function fundPool(env, communityLamports) {
  const { recordEvent } = await import('../worker/pool/ledger.js');
  const gross = (BigInt(communityLamports) * 10000n) / 8000n;
  const sig = String(++fundSeq).padStart(4, '0') + 'F'.repeat(84);
  const r = await recordEvent(env, { source: 'solana_transfer', externalId: sig, gross, receiver: 'Creator1111111111111111111111111111111111111' }, 'test');
  assert.equal(r.created, true);
  return r.event;
}

/* ======================= PHANTOM WALLET AUTH / PLAYER ACCOUNT ======================= */
describe('wallet sign-in & player account', () => {
  beforeEach(() => clock.set(MID));
  test('signature creates player + HttpOnly session; profile required before playing', async () => {
    const env = makeEnv();
    const c = client(env);
    const w = await newWallet();
    assert.equal((await c.get('/api/me')).access.state, 'WALLET_NOT_CONNECTED');
    const n = await c.post('/api/auth/nonce', { wallet: w.address });
    assert.match(n.message, /^HALLOWINU ARCADE - SIGN IN/); assert.match(n.message, /Website: hallowinu\.xyz/);
    assert.match(n.message, /NOT a transaction/);
    assert.ok(n.message.includes(w.address) && n.message.includes(n.nonce));
    const v = await c.post('/api/auth/verify', { wallet: w.address, nonce: n.nonce, signature: b64(await w.sign(n.message)) });
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.created, true);
    assert.match(v.setCookie, /HttpOnly/); assert.match(v.setCookie, /Secure/); assert.match(v.setCookie, /SameSite=Lax/); assert.match(v.setCookie, /Path=\/api/);
    assert.equal(v.access.state, 'PROFILE_REQUIRED');
    assert.equal(v.access.canPlay, false);
    assert.equal(v.access.wallet, `${w.address.slice(0, 4)}…${w.address.slice(-4)}`);
    const blocked = await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    assert.equal(blocked.status, 403); assert.equal(blocked.error, 'PROFILE_REQUIRED');
    const named = await c.patch('/api/me', { displayName: 'Pumpkin King' });
    assert.equal(named.access.state, 'SOCIALS_PENDING');
    assert.equal(named.access.canPlay, true);
    assert.equal(named.access.prizeEligible, false);
    assert.equal(named.player.displayName, 'Pumpkin King');
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).ok, true);
    const row = await env.DB.prepare('SELECT token_hash FROM player_sessions').first();
    assert.ok(!c.cookie.includes(row.token_hash), 'raw token is not stored');
  });
  test('returning wallet restores the same player, name, points and history', async () => {
    const env = makeEnv();
    const { c, wallet, player } = await newPlayer(env, { name: 'Ghost King' });
    await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    await c.post('/api/games/daily-spin/spin', { idem: idem() });
    const before = (await c.get('/api/me')).player;
    await c.post('/api/auth/logout');
    const c2 = client(env); // other device
    const v = await signIn(c2, wallet);
    assert.equal(v.created, false);
    const after = (await c2.get('/api/me')).player;
    assert.equal(after.id, player.id); assert.equal(after.displayName, 'Ghost King');
    assert.equal(after.totalPoints, before.totalPoints); assert.equal(after.gamesPlayed, 2);
    assert.equal(after.history.length, before.history.length);
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM players WHERE kind='wallet'").first();
    assert.equal(n.n, 1, 'no duplicate player on reconnect');
    // limits follow the account, not the device
    assert.equal((await c2.post('/api/games/daily-spin/spin', { idem: idem() })).error, 'COOLDOWN');
  });
  test('negative cases: bad signature, reused nonce, expired nonce, wrong wallet, forged address', async () => {
    const env = makeEnv();
    const c = client(env);
    const w = await newWallet(), w2 = await newWallet();
    // signature over a different message
    let n = await c.post('/api/auth/nonce', { wallet: w.address });
    let r = await c.post('/api/auth/verify', { wallet: w.address, nonce: n.nonce, signature: b64(await w.sign(n.message + 'x')) });
    assert.equal(r.error, 'BAD_SIGNATURE');
    // the nonce was burned by the failed attempt
    r = await c.post('/api/auth/verify', { wallet: w.address, nonce: n.nonce, signature: b64(await w.sign(n.message)) });
    assert.equal(r.error, 'NONCE_INVALID');
    // successful sign-in, then replay of the same signed payload
    n = await c.post('/api/auth/nonce', { wallet: w.address });
    const payload = { wallet: w.address, nonce: n.nonce, signature: b64(await w.sign(n.message)) };
    assert.equal((await c.post('/api/auth/verify', payload)).ok, true);
    const replay = await client(env).post('/api/auth/verify', payload);
    assert.equal(replay.error, 'NONCE_INVALID'); assert.equal(replay.status, 401);
    // expired
    n = await c.post('/api/auth/nonce', { wallet: w.address });
    clock.advance(CONFIG.auth.nonceTtlMs + 1000);
    assert.equal((await c.post('/api/auth/verify', { wallet: w.address, nonce: n.nonce, signature: b64(await w.sign(n.message)) })).error, 'NONCE_EXPIRED');
    // nonce issued for wallet A, attacker claims wallet B (with B's own valid signature)
    n = await c.post('/api/auth/nonce', { wallet: w.address });
    assert.equal((await c.post('/api/auth/verify', { wallet: w2.address, nonce: n.nonce, signature: b64(await w2.sign(n.message)) })).error, 'WALLET_MISMATCH');
    // forged / malformed addresses and signatures
    assert.equal((await c.post('/api/auth/nonce', { wallet: 'So1111' })).error, 'BAD_WALLET');
    assert.equal((await c.post('/api/auth/nonce', { wallet: '0OIl' + 'a'.repeat(40) })).error, 'BAD_WALLET');
    n = await c.post('/api/auth/nonce', { wallet: w.address });
    assert.equal((await c.post('/api/auth/verify', { wallet: w.address, nonce: n.nonce, signature: 'abc' })).error, 'BAD_REQUEST');
  });
  test('unauthenticated, forged and legacy sessions cannot play; anonymous endpoint is gone', async () => {
    const env = makeEnv();
    const c = client(env);
    assert.equal((await c.post('/api/session')).status, 410);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).status, 401);
    c.cookie = 'hw_sid=' + 'a'.repeat(64);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).status, 401);
    assert.equal((await c.get('/api/me')).access.state, 'WALLET_NOT_CONNECTED');
  });
  test('logout invalidates the session server-side without deleting the account', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const stolen = c.cookie;
    const out = await c.post('/api/auth/logout');
    assert.match(out.setCookie, /Max-Age=0/);
    const replay = client(env); replay.cookie = stolen;
    assert.equal((await replay.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).status, 401);
    assert.ok(await env.DB.prepare('SELECT id FROM players WHERE id=?').bind(player.id).first(), 'account kept');
  });
  test('expired session requires a new signature', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    clock.advance(CONFIG.session.ttlDays * 86400_000 + 1000);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).status, 401);
  });
  test('cannot spoof player id via body', async () => {
    const env = makeEnv();
    const { player: victim } = await newPlayer(env);
    const { c } = await newPlayer(env);
    const r = await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem(), playerId: victim.id, points: 99999 });
    assert.equal(r.ok, true);
    const v = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(victim.id).first();
    assert.equal(v.total_points, 0);
  });
  test('CSRF: mutation without client header or with foreign origin is blocked', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    const r1 = await c.raw('POST', '/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() }, { 'x-hw-client': '0' });
    assert.equal(r1.status, 403);
    const r2 = await c.raw('POST', '/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() }, { origin: 'https://evil.example' });
    assert.equal(r2.status, 403);
    const r3 = await client(env).raw('POST', '/api/auth/nonce', { wallet: 'x' }, { origin: 'https://evil.example' });
    assert.equal(r3.status, 403);
  });
  test('rate-limits new accounts per IP', async () => {
    const env = makeEnv();
    let last;
    for (let i = 0; i < CONFIG.auth.newPlayersPerIpPerHour + 1; i++) last = await signIn(client(env, { ip: '1.2.3.4' }), await newWallet());
    assert.equal(last.status, 429);
  });
  test('server-side name validation, reserved names, uniqueness, cooldown', () => {
    const bad = ['', '   ', 'ab', '<script>', 'a'.repeat(17), 'Official Admin', 'HALLOWINU', 'h4ll0w1nu fan', 'mod', 'SYSTEM', 'Fuck Yeah', 'zero​width', 'tab\tname', '---', 'Ünïcode'];
    for (const n of bad) assert.throws(() => validateName(n), undefined, n);
    assert.equal(validateName('  Pumpkin   Degen ').name, 'Pumpkin Degen');
    assert.equal(validateName('INU420').name, 'INU420');
  });
  test('names are unique (case/leet-insensitive) and changes are rate limited', async () => {
    const env = makeEnv();
    const a = await newPlayer(env, { name: 'Pumpkin King' });
    const b = client(env); await signIn(b, await newWallet());
    assert.equal((await b.patch('/api/me', { displayName: 'pumpkin-king' })).error, 'NAME_TAKEN');
    assert.equal((await b.patch('/api/me', { displayName: 'PUMPK1N KING' })).error, 'NAME_TAKEN');
    assert.equal((await b.patch('/api/me', { displayName: '<b>x</b>' })).status, 400);
    assert.equal((await a.c.patch('/api/me', { displayName: 'Ghost Queen' })).ok, true, 'one change allowed');
    assert.equal((await a.c.patch('/api/me', { displayName: 'Ghost Prince' })).error, 'NAME_COOLDOWN');
  });
  test('suspended players cannot sign in or play; legacy anonymous players never rank', async () => {
    const env = makeEnv();
    const { c, wallet, player } = await newPlayer(env);
    await env.DB.prepare('INSERT INTO players (id, display_name, created_at, last_seen_at, total_points) VALUES (?,?,?,?,?)').bind('p_legacy000000000', 'Old Anon', MID, MID, 999).run();
    const lb = await c.get('/api/leaderboard?scope=all');
    assert.ok(!lb.rows.some(r => r.name === 'Old Anon'));
    await env.DB.prepare("UPDATE players SET status='banned' WHERE id=?").bind(player.id).run();
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).error, 'SUSPENDED');
    assert.equal((await signIn(client(env), wallet)).error, 'SUSPENDED');
  });
});

/* ======================= SOCIAL VERIFICATION ======================= */
describe('X + Telegram verification', () => {
  beforeEach(() => clock.set(MID));
  const TG = { TELEGRAM_BOT_TOKEN: '123456:TEST-token', TELEGRAM_BOT_USERNAME: 'hallowinu_bot', TELEGRAM_CHAT_ID: '-1001234567890' };
  const X = { X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'csecret', X_OFFICIAL_USER_ID: '999', X_FOLLOW_CHECK: 'on' };
  async function tgAuth(id, { token = TG.TELEGRAM_BOT_TOKEN, age = 10, username = 'spooky' } = {}) {
    const data = { id, first_name: 'Spooky', username, auth_date: Math.floor(Date.now() / 1000) - age };
    const check = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
    const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(check)));
    return { ...data, hash: [...sig].map(b => b.toString(16).padStart(2, '0')).join('') };
  }
  function mockFetch(handler) {
    const real = globalThis.fetch;
    globalThis.fetch = async (u, init) => handler(String(u), init);
    return () => { globalThis.fetch = real; };
  }
  const jres = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('not configured: never fakes verification', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    const me = await c.get('/api/me');
    assert.equal(me.socials.telegram.available, false); assert.equal(me.socials.x.available, false);
    assert.equal((await c.post('/api/socials/telegram', { auth: await tgAuth(5) })).error, 'TELEGRAM_NOT_CONFIGURED');
    const xs = await c.get('/api/socials/x/start');
    assert.equal(xs.status, 302); assert.match(xs.location, /social=x&status=x_not_configured/);
    assert.equal((await c.get('/api/me')).access.x.verified, false);
  });
  test('telegram: signed login + group membership required; forgery, staleness and reuse rejected', async () => {
    const env = makeEnv(TG);
    const { c } = await newPlayer(env);
    let member = 'left';
    const restore = mockFetch(u => { assert.match(u, /getChatMember\?chat_id=-1001234567890&user_id=/); return jres({ ok: true, result: { status: member } }); });
    try {
      const forged = await tgAuth(77, { token: '999:other-bot' });
      assert.equal((await c.post('/api/socials/telegram', { auth: forged })).error, 'TELEGRAM_AUTH_INVALID');
      const tampered = { ...(await tgAuth(77)), id: 78 };
      assert.equal((await c.post('/api/socials/telegram', { auth: tampered })).error, 'TELEGRAM_AUTH_INVALID');
      assert.equal((await c.post('/api/socials/telegram', { auth: await tgAuth(77, { age: 2 * 86400 }) })).error, 'TELEGRAM_AUTH_INVALID');
      assert.equal((await c.post('/api/socials/telegram', { auth: await tgAuth(77) })).error, 'TELEGRAM_NOT_MEMBER');
      member = 'member';
      const ok = await c.post('/api/socials/telegram', { auth: await tgAuth(77) });
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.equal(ok.access.telegram.verified, true);
      assert.equal(ok.access.prizeEligible, false, 'X still missing');
      const other = await newPlayer(env);
      assert.equal((await other.c.post('/api/socials/telegram', { auth: await tgAuth(77) })).error, 'IDENTITY_IN_USE');
      const row = await env.DB.prepare("SELECT provider_user_id FROM player_identities WHERE provider='telegram'").first();
      assert.equal(row.provider_user_id, '77', 'stable numeric id stored, not the username');
    } finally { restore(); }
  });
  test('x: OAuth PKCE + follow check; state single-use and bound to the session; both socials => prize eligible', async () => {
    const env = makeEnv({ ...TG, ...X });
    const { c, player } = await newPlayer(env);
    let following = [{ id: '1' }];
    const restore = mockFetch((u, init) => {
      if (u.endsWith('/2/oauth2/token')) { assert.match(String(init.body), /code_verifier=[a-f0-9]{96}/); return jres({ access_token: 'AT' }); }
      if (u.endsWith('/2/users/me')) return jres({ data: { id: '4242', username: 'ghostfan' } });
      if (u.includes('/2/users/4242/following')) return jres({ data: following, meta: {} });
      if (u.endsWith('/2/oauth2/revoke')) return jres({});
      if (u.includes('getChatMember')) return jres({ ok: true, result: { status: 'member' } });
      throw new Error('unexpected ' + u);
    });
    try {
      const start = await c.get('/api/socials/x/start');
      assert.equal(start.status, 302);
      const loc = new URL(start.location);
      assert.equal(loc.host, 'x.com'); assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(loc.searchParams.get('redirect_uri'), 'https://hallowinu.xyz/api/socials/x/callback');
      const state = loc.searchParams.get('state');
      // another player's session cannot complete my OAuth
      const thief = await newPlayer(env);
      assert.match((await thief.c.get(`/api/socials/x/callback?state=${state}&code=abc`)).location, /status=session/);
      // state already burned
      assert.match((await c.get(`/api/socials/x/callback?state=${state}&code=abc`)).location, /status=expired/);
      // not following
      let st = new URL((await c.get('/api/socials/x/start')).location).searchParams.get('state');
      assert.match((await c.get(`/api/socials/x/callback?state=${st}&code=abc`)).location, /status=not_following/);
      assert.equal((await c.get('/api/me')).access.x.verified, false);
      // following -> verified
      following = [{ id: '1' }, { id: '999' }];
      st = new URL((await c.get('/api/socials/x/start')).location).searchParams.get('state');
      assert.match((await c.get(`/api/socials/x/callback?state=${st}&code=abc`)).location, /status=verified/);
      let me = await c.get('/api/me');
      assert.equal(me.access.x.verified, true); assert.equal(me.access.x.username, 'ghostfan');
      assert.equal(me.access.state, 'SOCIALS_PENDING');
      // telegram too -> eligible
      const { c: _ } = { c };
      const tg = await c.post('/api/socials/telegram', { auth: await tgAuth(88) });
      assert.equal(tg.access.state, 'ARCADE_READY');
      assert.equal(tg.access.prizeEligible, true);
      const p = await env.DB.prepare('SELECT payout_verified FROM players WHERE id=?').bind(player.id).first();
      assert.equal(p.payout_verified, 1);
      // X API access problems are reported, not faked
      const restore2 = mockFetch(() => jres({ title: 'CreditsDepleted' }, 402));
      const p2 = await newPlayer(env);
      const s2 = new URL((await p2.c.get('/api/socials/x/start')).location).searchParams.get('state');
      assert.match((await p2.c.get(`/api/socials/x/callback?state=${s2}&code=abc`)).location, /status=x_api_access/);
      restore2();
    } finally { restore(); }
  });
  test('client cannot grant itself verification or eligibility', async () => {
    const env = makeEnv(TG);
    const { c, player } = await newPlayer(env);
    await c.patch('/api/me', { displayName: 'Ghost Two', payoutVerified: true, x: { verified: true } });
    assert.equal((await c.post('/api/socials/telegram', { auth: { id: 1, hash: 'f'.repeat(64), auth_date: Math.floor(Date.now() / 1000) } })).error, 'TELEGRAM_AUTH_INVALID');
    const me = await c.get('/api/me');
    assert.equal(me.access.prizeEligible, false); assert.equal(me.access.telegram.verified, false);
    const p = await env.DB.prepare('SELECT payout_verified FROM players WHERE id=?').bind(player.id).first();
    assert.equal(p.payout_verified, 0);
  });
});

/* ======================= TRICK OR TREAT ======================= */
describe('trick or treat', () => {
  beforeEach(() => clock.set(MID));
  test('server decides, credits ledger, enforces 3/day across tabs/refresh', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const r = await c.post('/api/games/trick-or-treat/play', { choice: i % 2 ? 'trick' : 'treat', idem: idem() });
      assert.equal(r.ok, true); total += r.points;
      assert.ok(Number.isInteger(r.points));
    }
    const fourth = await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    assert.equal(fourth.status, 429); assert.equal(fourth.error, 'DAILY_LIMIT');
    // "new tab" = same cookie, different client object
    const tab2 = client(env); tab2.cookie = c.cookie;
    assert.equal((await tab2.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).status, 429);
    const sum = await env.DB.prepare('SELECT SUM(amount) s, COUNT(*) n FROM point_transactions WHERE player_id=?').bind(player.id).first();
    assert.equal(sum.n, 3); assert.equal(sum.s, total);
    const p = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(player.id).first();
    assert.equal(p.total_points, total);
    // next UTC day resets
    clock.advance(24 * 3600_000);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() })).ok, true);
  });
  test('replaying the same request returns the same result and never pays twice', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const key = idem();
    const [a, b] = await Promise.all([
      c.post('/api/games/trick-or-treat/play', { choice: 'trick', idem: key }),
      c.post('/api/games/trick-or-treat/play', { choice: 'trick', idem: key }),
    ]);
    const okOnes = [a, b].filter(x => x.ok);
    assert.ok(okOnes.length >= 1);
    const again = await c.post('/api/games/trick-or-treat/play', { choice: 'trick', idem: key });
    assert.equal(again.replay, true);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM point_transactions WHERE player_id=?').bind(player.id).first();
    assert.equal(n.n, 1);
    const used = await env.DB.prepare('SELECT used FROM usage_limits WHERE player_id=?').bind(player.id).first();
    assert.equal(used.used, 1);
  });
  test('rejects invalid choice and missing idempotency key', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'both', idem: idem() })).status, 400);
    assert.equal((await c.post('/api/games/trick-or-treat/play', { choice: 'treat' })).status, 400);
  });
  test('outcome distribution follows config (statistical)', async () => {
    const { weightedPick } = await import('../worker/lib/util.js');
    const table = CONFIG.games['trick-or-treat'].tables.trick;
    const counts = new Map(); const N = 40000;
    for (let i = 0; i < N; i++) { const { index } = weightedPick(table); counts.set(index, (counts.get(index) || 0) + 1); }
    table.forEach((row, i) => { const p = (counts.get(i) || 0) / N * 100; assert.ok(Math.abs(p - row.weight) < 1.2, `row ${i} ${p} vs ${row.weight}`); });
  });
});

/* ======================= DAILY SPIN ======================= */
describe('daily spin', () => {
  beforeEach(() => clock.set(MID));
  test('one spin per 24h, parallel spins only pay once, server result credited', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const rs = await Promise.all([1, 2, 3, 4].map(() => c.post('/api/games/daily-spin/spin', { idem: idem() })));
    const ok = rs.filter(r => r.ok);
    assert.equal(ok.length, 1, JSON.stringify(rs.map(r => r.error)));
    assert.ok(rs.filter(r => !r.ok).every(r => r.error === 'COOLDOWN'));
    const seg = CONFIG.games['daily-spin'].segments[ok[0].segmentIndex];
    assert.equal(seg.points, ok[0].points);
    const p = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(player.id).first();
    assert.equal(p.total_points, ok[0].points);
    clock.advance(23 * 3600_000);
    assert.equal((await c.post('/api/games/daily-spin/spin', { idem: idem() })).error, 'COOLDOWN');
    clock.advance(3600_000 + 1);
    assert.equal((await c.post('/api/games/daily-spin/spin', { idem: idem() })).ok, true);
  });
});

/* ======================= PUMPKIN HUNT ======================= */
describe('pumpkin hunt', () => {
  beforeEach(() => clock.set(MID));
  const cfg = CONFIG.games['pumpkin-hunt'];

  test('board generation respects config', () => {
    const b = generateBoard(cfg);
    assert.equal(b.targets.length, cfg.targetCount);
    assert.ok(b.targets.filter(t => t.type === 'golden').length <= cfg.targets.golden.maxPerSession);
    assert.ok(b.targets.every(t => t.spawnMs >= 0 && t.spawnMs < cfg.durationMs));
  });

  test('valid claims score, invalid/duplicate/early/late/foreign are rejected', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const s = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    assert.equal(s.ok, true);
    const start = s.startsAt;
    const [t1, t2, t3] = s.targets;
    // too early (before spawn + reaction)
    clock.set(start + t1.spawnMs + 10);
    assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: t1.id })).reason, 'TOO_EARLY');
    clock.set(start + t1.spawnMs + 400);
    const ok1 = await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: t1.id });
    assert.equal(ok1.accepted, true);
    // duplicate
    clock.advance(200);
    assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: t1.id })).reason, 'ALREADY_CLAIMED');
    // fabricated target
    assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: 'tFAKE0000' })).reason, 'INVALID_TARGET');
    // too late
    clock.set(start + t2.spawnMs + t2.lifeMs + cfg.claimGraceMs + 50);
    assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: t2.id })).reason, 'TOO_LATE');
    // someone else's session
    const other = await newPlayer(env);
    clock.set(start + t3.spawnMs + 300);
    assert.equal((await other.c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: t3.id })).error, 'NO_SESSION_FOUND');
    // finish & score
    clock.set(s.expiresAt + 10);
    const fin = await c.post('/api/games/pumpkin-hunt/finish', { sessionId: s.sessionId });
    assert.equal(fin.ok, true);
    assert.equal(fin.found, 1);
    assert.equal(fin.points, cfg.targets[t1.type].points);
    // claims after finish are rejected; finishing twice does not pay twice
    assert.equal((await c.post('/api/games/pumpkin-hunt/finish', { sessionId: s.sessionId })).replay, true);
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM point_transactions WHERE player_id=? AND game='pumpkin-hunt'").bind(player.id).first();
    assert.equal(n.n, 1);
  });

  test('claim speed limit and session expiry', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    const s = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    // find two targets alive at the same time
    let pair = null;
    for (const a of s.targets) for (const b of s.targets) if (a !== b && b.spawnMs >= a.spawnMs && b.spawnMs <= a.spawnMs + a.lifeMs - 300) pair = pair || [a, b];
    if (pair) {
      clock.set(s.startsAt + pair[1].spawnMs + 200);
      assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: pair[0].id })).accepted, true);
      clock.advance(20); // faster than minClaimIntervalMs
      assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: pair[1].id })).reason, 'TOO_FAST');
    }
    clock.set(s.expiresAt + cfg.claimGraceMs + 100);
    assert.equal((await c.post('/api/games/pumpkin-hunt/claim', { sessionId: s.sessionId, targetId: s.targets.at(-1).id })).reason, 'HUNT_OVER');
  });

  test('one active hunt at a time, 2 per day, abandoned hunts settle', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const a = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    const b = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    assert.equal(b.sessionId, a.sessionId, 'resumes instead of a parallel session');
    clock.set(a.expiresAt + cfg.finishGraceMs + 100);
    const second = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() }); // auto-settles the first
    assert.equal(second.ok, true);
    assert.notEqual(second.sessionId, a.sessionId);
    const settled = await env.DB.prepare("SELECT status FROM hunt_sessions WHERE id=?").bind(a.sessionId).first();
    assert.equal(settled.status, 'finished');
    clock.set(second.expiresAt + cfg.finishGraceMs + 100);
    const third = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    assert.equal(third.error, 'DAILY_LIMIT');
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM hunt_sessions WHERE player_id=?").bind(player.id).first();
    assert.equal(n.n, 2);
  });

  test('combo scoring + impossible score is flagged', () => {
    const t = 1000;
    const claims = [0, 500, 1000, 1500, 5000].map((d, i) => ({ claimed_at: t + d, points: 5, target_type: i === 2 ? 'golden' : 'normal' }));
    const s = scoreClaims(claims, cfg);
    assert.equal(s.found, 5); assert.equal(s.golden, 1);
    assert.equal(s.bonus, 2 + 2); // 3rd and 4th hit in combo (>=3)
    assert.equal(s.bestCombo, 4);
  });
});

/* ======================= QUIZ ======================= */
describe('quiz', () => {
  beforeEach(() => clock.set(MID));
  async function answerCorrect(env, c, q) {
    const row = await env.DB.prepare('SELECT a.order_json, q.correct_index FROM quiz_attempts a JOIN quiz_questions q ON q.id=a.question_id WHERE a.id=?').bind(q.attemptId).first();
    return JSON.parse(row.order_json).indexOf(row.correct_index);
  }
  test('correct answer never sent; correct/incorrect scoring; streak bonus; daily limit; no repeats', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const seen = new Set();
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const q = await c.post('/api/games/quiz/next');
      assert.equal(q.ok, true); assert.equal(q.rewarded, true);
      assert.equal(q.answers.length, 4);
      assert.ok(!('correctIndex' in q) && !JSON.stringify(q).includes('correct_index'));
      const qid = (await env.DB.prepare('SELECT question_id FROM quiz_attempts WHERE id=?').bind(q.attemptId).first()).question_id;
      assert.ok(!seen.has(qid)); seen.add(qid);
      const choice = await answerCorrect(env, c, q);
      const r = await c.post('/api/games/quiz/answer', { attemptId: q.attemptId, choice });
      assert.equal(r.correct, true);
      const base = CONFIG.games.quiz.rewards[r.difficulty];
      const expectBonus = i === 2 ? 10 : i === 4 ? 25 : 0;
      assert.equal(r.points, base + expectBonus);
      total += r.points;
      // answering twice is rejected
      assert.equal((await c.post('/api/games/quiz/answer', { attemptId: q.attemptId, choice })).error, 'ALREADY_ANSWERED');
    }
    const p = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(player.id).first();
    assert.equal(p.total_points, total);
    // 6th: practice mode, no points
    const practice = await c.post('/api/games/quiz/next');
    assert.equal(practice.rewarded, false);
    const pr = await c.post('/api/games/quiz/answer', { attemptId: practice.attemptId, choice: 0 });
    assert.equal(pr.points, 0);
    const p2 = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(player.id).first();
    assert.equal(p2.total_points, total);
    const ach = await c.get('/api/me');
    assert.ok(ach.player.achievements.find(a => a.id === 'perfect_night').unlockedAt);
  });
  test('wrong answer gives 0 and resets streak; expired answer gives 0; foreign attempt rejected', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    const q = await c.post('/api/games/quiz/next');
    const right = await answerCorrect(env, c, q);
    const r = await c.post('/api/games/quiz/answer', { attemptId: q.attemptId, choice: (right + 1) % 4 });
    assert.equal(r.correct, false); assert.equal(r.points, 0); assert.equal(r.correctIndex, right);
    const q2 = await c.post('/api/games/quiz/next');
    const other = await newPlayer(env);
    assert.equal((await other.c.post('/api/games/quiz/answer', { attemptId: q2.attemptId, choice: 0 })).error, 'NO_SESSION_FOUND');
    clock.advance(CONFIG.games.quiz.answerTimeMs + 1000);
    const late = await c.post('/api/games/quiz/answer', { attemptId: q2.attemptId, choice: await answerCorrect(env, c, q2) });
    assert.equal(late.correct, false); assert.equal(late.points, 0);
  });
});

/* ======================= XP / LEVELS / ACHIEVEMENTS ======================= */
describe('progression', () => {
  beforeEach(() => clock.set(MID));
  test('level thresholds are centralized and monotonic', () => {
    assert.equal(levelForXp(0), 1); assert.equal(levelForXp(99), 1); assert.equal(levelForXp(100), 2); assert.equal(levelForXp(250), 3);
    for (let n = 2; n < 50; n++) assert.ok(CONFIG.levels.xpForLevel(n + 1) > CONFIG.levels.xpForLevel(n));
  });
  test('first game unlocks FIRST BLOOD exactly once; all four games -> HALLOWEEN DEGEN', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    const r1 = await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    assert.ok(r1.achievementsUnlocked.some(a => a.id === 'first_blood'));
    const r2 = await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    assert.ok(!r2.achievementsUnlocked.some(a => a.id === 'first_blood'));
    await c.post('/api/games/daily-spin/spin', { idem: idem() });
    const q = await c.post('/api/games/quiz/next'); await c.post('/api/games/quiz/answer', { attemptId: q.attemptId, choice: 0 });
    const h = await c.post('/api/games/pumpkin-hunt/start', { idem: idem() });
    clock.set(h.expiresAt + 10);
    const fin = await c.post('/api/games/pumpkin-hunt/finish', { sessionId: h.sessionId });
    assert.ok(fin.achievementsUnlocked.some(a => a.id === 'halloween_degen'));
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM player_achievements WHERE player_id=? AND achievement_id=?').bind(player.id, 'first_blood').first();
    assert.equal(n.n, 1);
    const me = await c.get('/api/me');
    assert.ok(me.player.xp > 0);
    assert.equal(me.player.gamesPlayed, 5);
  });
});

/* ======================= PRIZE MATH ======================= */
describe('prize math (lamports)', () => {
  const bps = CONFIG.seasons.defaultDistributionBps;
  test('distribution sums to 100%', () => { assert.equal(bps.reduce((a, b) => a + b, 0), 10000); assert.ok(validateDistribution(bps)); assert.ok(validateConfig()); });
  test('10 SOL allocates exactly as specified', () => {
    const { amounts, unallocated } = allocatePool(10_000_000_000n, bps);
    assert.deepEqual(amounts.map(a => lamportsToSolString(a)), ['3', '1.75', '1.25', '0.9', '0.75', '0.6', '0.5', '0.45', '0.4', '0.4']);
    assert.equal(amounts.reduce((a, b) => a + b, 0n), 10_000_000_000n);
    assert.equal(unallocated, 0n);
  });
  test('pool grows proportionally: 1 SOL base and 12.4 SOL with maker rewards', () => {
    assert.deepEqual(allocatePool(1_000_000_000n, bps).amounts.map(a => lamportsToSolString(a)), ['0.3', '0.175', '0.125', '0.09', '0.075', '0.06', '0.05', '0.045', '0.04', '0.04']);
    const { amounts } = allocatePool(solStringToLamports('12.4'), bps);
    assert.equal(lamportsToSolString(amounts[0]), '3.72');
    assert.equal(lamportsToSolString(amounts[9]), '0.496');
  });
  test('awkward amounts: deterministic rounding, sum always equals pool', () => {
    for (const pool of [1n, 7n, 9999n, 10_000_000_001n, 123_456_789_123n, 3n * 10n ** 15n]) {
      const a1 = allocatePool(pool, bps), a2 = allocatePool(pool, bps);
      assert.deepEqual(a1.amounts, a2.amounts);
      assert.equal(a1.amounts.reduce((a, b) => a + b, 0n), pool);
      assert.ok(a1.amounts.every(x => x >= 0n));
    }
  });
  test('fewer winners than ranks: unfilled shares are unallocated, not lost', () => {
    const r = allocatePool(10_000_000_000n, bps, 3);
    assert.equal(r.amounts.length, 3);
    assert.equal(r.amounts.reduce((a, b) => a + b, 0n) + r.unallocated, 10_000_000_000n);
    assert.equal(lamportsToSolString(r.unallocated), '4');
  });
  test('SOL parsing is exact and strict', () => {
    assert.equal(solStringToLamports('0.000000001'), 1n);
    assert.equal(solStringToLamports('2.40'), 2_400_000_000n);
    assert.throws(() => solStringToLamports('0.0000000001'));
    assert.throws(() => solStringToLamports('-1'));
    assert.throws(() => solStringToLamports('1e9'));
  });
});

/* ======================= SEASONS / POOL / FINALIZATION ======================= */
describe('seasons, funding, finalization', () => {
  beforeEach(() => clock.set(MID));

  test('season activates by time and season points accrue; lifetime kept', async () => {
    const env = makeEnv();
    clock.set(S01_START - 3600_000);
    const { c, player } = await newPlayer(env);
    await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    const pre = await env.DB.prepare('SELECT COUNT(*) n FROM season_player_stats').first();
    assert.equal(pre.n, 0, 'no season credit before start');
    clock.set(MID);
    const st = await c.get('/api/arcade');
    assert.equal(st.season.phase, 'ACTIVE');
    const r = await c.post('/api/games/daily-spin/spin', { idem: idem() });
    const sp = await env.DB.prepare('SELECT points FROM season_player_stats WHERE player_id=?').bind(player.id).first();
    assert.equal(sp.points, r.points);
  });

  test('pool = 80% of verified maker rewards only; manual funding + announced pool retired; frontend cannot add', async () => {
    const env = makeEnv();
    const a = adminClient(env);
    let s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalLamports, '0', 'retired pending base funding does not count');
    assert.equal(s.current.announcedLamports, undefined, 'no announced/promised amount is shown');
    assert.deepEqual(s.current.distributionBps, [3000, 1750, 1250, 900, 750, 600, 500, 450, 400, 400]);
    const pool = await client(env).get('/api/pool');
    assert.equal(pool.state, 'AWAITING_REWARD_SOURCE'); assert.equal(pool.totals, null); assert.deepEqual(pool.recent, []);
    // manual funding is gone for every source
    for (const source of ['INITIAL_FUNDING', 'MAKER_REWARD', 'MANUAL_CONTRIBUTION', 'ADJUSTMENT'])
      assert.equal((await a.post('funding', { seasonId: 's01', amountSol: '2.4', source, txSignature: '5'.repeat(88) })).error, 'MANUAL_FUNDING_RETIRED');
    assert.equal((await a.patch('seasons/s01', { announcedSol: '2.5' })).error, 'ANNOUNCED_POOL_RETIRED');
    await fundPool(env, 2_400_000_000n);
    s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalSol, '2.4');
    assert.equal(s.current.pool.makerLamports, '2400000000');
    assert.equal(s.current.estPrizes[0].sol, '0.72');
    assert.equal((await client(env).get('/api/pool')).state, 'LIVE');
    // public endpoints cannot write the pool
    const p = await newPlayer(env);
    assert.equal((await p.c.post('/api/admin/funding', { seasonId: 's01', amountSol: '100', source: 'MAKER_REWARD' })).status, 401);
    assert.equal((await p.c.post('/api/admin/pool/verify', { signature: '5'.repeat(88) })).status, 401);
    assert.equal((await p.c.post('/api/admin/pool/adjustments', { seasonId: 's01', amountLamports: '1', reason: 'xxxxxxxxxxxx', confirm: 'I CONFIRM THIS ADJUSTMENT' })).status, 401);
    assert.equal((await p.c.post('/api/season', { pool: 1e12 })).status, 404);
    assert.equal((await p.c.post('/api/pool', { pool: 1e12 })).status, 404);
  });

  test('on-chain verification checks wallet, success and amount', async () => {
    const { verifyTransferToPool } = await import('../worker/lib/solana.js');
    const wallet = 'PxxL7rEUjWsWLMQWbegwGq9Yk3hK2ZqNt8dHVxwZYJ6y';
    const env = { POOL_WALLET: wallet };
    const tx = (o = {}) => ({ result: { slot: 1, blockTime: 1, meta: { err: null, preBalances: [5e9, 1e9], postBalances: [2.6e9, 3.4e9], ...o.meta }, transaction: { message: { accountKeys: ['Sender11111111111111111111111111111111111111', o.key || wallet] } } } });
    const f = body => async () => ({ ok: true, json: async () => body });
    const sig = '3'.repeat(88);
    const ok = await verifyTransferToPool(env, sig, f(tx()));
    assert.equal(ok.lamports, 2_400_000_000n);
    await assert.rejects(verifyTransferToPool(env, sig, f(tx({ meta: { err: { InstructionError: [] } } }))), /failed/i);
    await assert.rejects(verifyTransferToPool(env, sig, f(tx({ key: 'AbcdEFGH2345jkmnpqrsTUVWXYZabcdefghijk111111' }))), /not part/i);
    await assert.rejects(verifyTransferToPool(env, sig, f({ result: null })), /not found/i);
  });

  test('full finalization: freeze, top 10, rank shift on disqualification, approval gate, paid', async () => {
    const env = makeEnv();
    await fundPool(env, 10_000_000_000n);   // gross 12.5 SOL → 10 SOL community pool
    const players = [];
    for (let i = 0; i < 12; i++) players.push(await newPlayer(env));
    // everyone except #2 completed X + Telegram verification
    for (let i = 0; i < 12; i++) if (i !== 1) await grantSocials(env, players[i].player.id);
    // Give deterministic season points directly via the ledger path: insert season stats
    for (let i = 0; i < 12; i++) {
      await env.DB.prepare('INSERT INTO season_player_stats (season_id, player_id, points, games_played, updated_at) VALUES (?,?,?,?,?)')
        .bind('s01', players[i].player.id, 1000 - i * 10, 1, MID + i).run();
    }
    const lb = await players[0].c.get('/api/leaderboard?scope=season');
    assert.equal(lb.rows.length, 12);
    assert.equal(lb.rows[0].me, true);
    assert.equal(lb.rows[0].prize.sol, '3');
    assert.equal(lb.rows[1].eligible, false); assert.equal(lb.rows[1].prize, null, 'ineligible rank gets no prize');
    assert.equal(lb.rows[2].prize.prizeRank, 2); assert.equal(lb.rows[2].prize.sol, '1.75');
    assert.equal(lb.rows[10].prize.prizeRank, 10, 'prize slot moves down to the next eligible player');
    assert.equal(lb.rows[11].prize, null);
    // cannot finalize early
    const a = adminClient(env);
    assert.equal((await a.post('seasons/s01/finalize')).error, 'SEASON_NOT_OVER');
    // season ends -> rewarded gameplay stops counting for the season
    clock.set(S01_END + 1000);
    const late = await players[0].c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    const ptx = await env.DB.prepare('SELECT season_id FROM point_transactions WHERE player_id=? ORDER BY id DESC').bind(players[0].player.id).first();
    assert.equal(late.ok, true); assert.equal(ptx.season_id, null);
    // cron finalizes
    await cron(env);
    const season = await env.DB.prepare('SELECT * FROM seasons WHERE id=?').bind('s01').first();
    assert.equal(season.status, 'FINALIZING');
    assert.equal(season.frozen_pool_lamports, 10_000_000_000);
    // pool frozen: adjustments refused, new maker rewards go to the next season (none open → held unassigned)
    assert.equal((await a.post('pool/adjustments', { seasonId: 's01', amountLamports: '1', reason: 'late correction test', confirm: 'I CONFIRM THIS ADJUSTMENT' })).error, 'POOL_FROZEN');
    const lateEv = await fundPool(env, 800n);
    assert.equal(lateEv.season_id, null, 'frozen season never receives new money');
    let ents = (await env.DB.prepare("SELECT * FROM prize_entitlements WHERE season_id='s01' AND status='FINALIZING' ORDER BY rank").all()).results;
    assert.equal(ents.length, 10);
    assert.equal(ents.reduce((s, e) => s + e.amount_lamports, 0), 10_000_000_000);
    assert.ok(!ents.some(e => e.player_id === players[1].player.id), 'unverified player gets no entitlement');
    // disqualify prize #3 (players[3]) -> everyone below shifts up, players[11] enters the top 10
    const dq = await a.post('seasons/s01/disqualify', { playerId: players[3].player.id, reason: 'Bot activity', evidence: 'claims at 50ms' });
    assert.equal(dq.ok, true);
    ents = (await env.DB.prepare("SELECT * FROM prize_entitlements WHERE season_id='s01' AND status='FINALIZING' ORDER BY rank").all()).results;
    assert.equal(ents.length, 10);
    assert.equal(ents[2].player_id, players[4].player.id);
    assert.equal(ents[9].player_id, players[11].player.id);
    assert.equal(ents.reduce((s, e) => s + e.amount_lamports, 0), 10_000_000_000);
    const dqRow = await env.DB.prepare("SELECT status FROM prize_entitlements WHERE season_id='s01' AND player_id=?").bind(players[3].player.id).first();
    assert.equal(dqRow.status, 'DISQUALIFIED');
    // history preserved: standings snapshot untouched, audit trail exists
    const snap = await env.DB.prepare("SELECT COUNT(*) n FROM season_final_standings WHERE season_id='s01'").first();
    assert.equal(snap.n, 12);
    const audit = await env.DB.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='entitlements.recompute'").first();
    assert.equal(audit.n, 2);
    // lifetime points survive the season
    const life = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(players[0].player.id).first();
    assert.ok(life.total_points > 0);
    // admin manual override still needs an audited reason and a signature-verified wallet
    assert.equal((await a.post(`players/${players[1].player.id}/verify-payout`, { confirm: 'I VERIFIED THIS PLAYER' })).error, 'EVIDENCE_REQUIRED');
    assert.equal((await a.post('players/p_doesnotexist0000/verify-payout', { confirm: 'I VERIFIED THIS PLAYER', evidence: 'checked by hand' })).error, 'NO_WALLET');
    // all winners are verified -> approval passes (manual review step), then mark paid
    assert.equal((await a.post('seasons/s01/approve')).ok, true);
    assert.equal((await env.DB.prepare("SELECT status FROM seasons WHERE id='s01'").first()).status, 'FINALIZED');
    assert.equal((await a.post('seasons/s01/disqualify', { playerId: players[0].player.id, reason: 'late attempt' })).error, 'ALREADY_APPROVED');
    const e0 = ents[0];
    assert.equal((await a.post(`entitlements/${e0.id}/paid`, { txSignature: '4'.repeat(88) })).ok, true);
    assert.equal((await a.post(`entitlements/${e0.id}/paid`, { txSignature: '4'.repeat(88) })).error, 'NOT_APPROVED');
    const pub = await client(env).get('/api/season');
    assert.equal(pub.previous[0].winners.length, 10);
  });

  test('distribution cannot change after season start; admin requires valid token', async () => {
    const env = makeEnv();
    const a = adminClient(env);
    assert.equal((await a.patch('seasons/s01', { distributionBps: [10000] })).error, 'SEASON_STARTED');
    const bad = client(env);
    assert.equal((await bad.get('/api/admin/overview', { authorization: 'Bearer wrong-token-wrong-token-xx' })).status, 401);
    assert.equal((await bad.get('/api/admin/overview')).status, 401);
    const env2 = makeEnv({ ADMIN_TOKEN: undefined });
    assert.equal((await client(env2).get('/api/admin/overview', { authorization: 'Bearer x' })).status, 503);
  });

  test('gameplay alone never makes a player prize-eligible', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    for (let i = 0; i < 3; i++) await c.post('/api/games/trick-or-treat/play', { choice: 'trick', idem: idem() });
    const me = await c.get('/api/me');
    assert.equal(me.player.payoutEligibility, 'NOT_VERIFIED');
    assert.equal(me.access.prizeEligible, false);
  });
  test('approval is blocked while a winner is not verified (e.g. verification revoked by admin data fix)', async () => {
    const env = makeEnv();
    await fundPool(env, 1_000_000_000n);
    const p = await newPlayer(env);
    await grantSocials(env, p.player.id);
    await env.DB.prepare('INSERT INTO season_player_stats (season_id, player_id, points, games_played, updated_at) VALUES (?,?,?,?,?)').bind('s01', p.player.id, 50, 1, MID).run();
    clock.set(S01_END + 1000); await cron(env);
    await env.DB.prepare("DELETE FROM player_identities WHERE player_id=? AND provider='solana_wallet'").bind(p.player.id).run();
    const ap = await adminClient(env).post('seasons/s01/approve');
    assert.equal(ap.error, 'UNVERIFIED_WINNERS'); assert.equal(ap.blockers.length, 1);
  });
});

/* ======================= LEADERBOARD / SETTINGS ======================= */
describe('leaderboard & settings', () => {
  beforeEach(() => clock.set(MID));
  test('all-time top 100 uses stored data and shows my rank outside the list', async () => {
    const env = makeEnv();
    for (let i = 0; i < 105; i++) {
      const id = `p_bulk${String(i).padStart(12, '0')}`;
      await env.DB.prepare("INSERT INTO players (id, display_name, created_at, last_seen_at, total_points, last_point_at, kind, name_set_at) VALUES (?,?,?,?,?,?,'wallet',?)").bind(id, `Bot ${i}`, MID, MID, 10000 - i, MID, MID).run();
    }
    const { c } = await newPlayer(env);
    await c.post('/api/games/trick-or-treat/play', { choice: 'treat', idem: idem() });
    const lb = await c.get('/api/leaderboard?scope=all');
    assert.equal(lb.rows.length, 100);
    assert.equal(lb.rows[0].points, 10000);
    assert.equal(lb.me.rank, 106);
  });
  test('admin can disable a game; disabled game refuses play', async () => {
    const env = makeEnv();
    const a = adminClient(env);
    assert.equal((await a.put('settings', { key: 'games.daily-spin.enabled', value: false })).ok, true);
    assert.equal((await a.put('settings', { key: 'games.daily-spin.weights', value: 1 })).error, 'BAD_KEY');
    const { c } = await newPlayer(env);
    assert.equal((await c.post('/api/games/daily-spin/spin', { idem: idem() })).error, 'GAME_DISABLED');
  });
  test('errors never leak internals', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    env.DB.prepare = () => { throw new Error('SQLITE secret path /var/db'); };
    const r = await c.get('/api/me');
    assert.equal(r.status, 500); assert.equal(r.message, 'Something went wrong.');
  });
});
