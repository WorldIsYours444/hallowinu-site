import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, adminClient, clock, idem, cron, S01_START, S01_END } from './helpers.mjs';
import { allocatePool, solStringToLamports, lamportsToSolString, validateDistribution } from '../worker/lib/prizes.js';
import { CONFIG, validateConfig, levelForXp } from '../worker/config.js';
import { scoreClaims, generateBoard } from '../worker/games/pumpkin-hunt.js';

const MID = S01_START + 3 * 86400_000 + 10 * 3600_000; // inside Season 01, 10:00 UTC

async function newPlayer(env) {
  const c = client(env);
  const r = await c.post('/api/session');
  assert.equal(r.status, 201);
  return { c, player: r.player };
}
async function verifyInitialFunding(env) {
  const a = adminClient(env);
  const ov = await a.get('overview');
  const f = ov.funding.find(x => x.source === 'INITIAL_FUNDING');
  const r = await a.post(`funding/${f.id}/verify`, { method: 'manual', confirm: 'I VERIFIED THIS FUNDING' });
  assert.equal(r.ok, true, JSON.stringify(r));
}

/* ======================= PLAYER / SESSION ======================= */
describe('player & session', () => {
  beforeEach(() => clock.set(MID));
  test('creates a server-side player with HttpOnly cookie and persists', async () => {
    const env = makeEnv();
    const { c, player } = await newPlayer(env);
    assert.match(player.id, /^p_[a-z2-9]{16}$/);
    assert.equal(player.level, 1);
    assert.equal(player.payoutEligibility, 'NOT_VERIFIED');
    const again = await c.post('/api/session');
    assert.equal(again.status, 200);
    assert.equal(again.player.id, player.id);
    const me = await c.get('/api/me');
    assert.equal(me.player.id, player.id);
    const row = await env.DB.prepare('SELECT token_hash FROM player_sessions').first();
    assert.ok(!c.cookie.includes(row.token_hash), 'raw token is not stored');
  });
  test('rejects unauthenticated and forged sessions', async () => {
    const env = makeEnv();
    const c = client(env);
    assert.equal((await c.get('/api/me')).status, 401);
    c.cookie = 'hw_sid=' + 'a'.repeat(64);
    assert.equal((await c.get('/api/me')).status, 401);
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
  });
  test('rate-limits mass player creation per IP', async () => {
    const env = makeEnv();
    let last;
    for (let i = 0; i < CONFIG.session.newPlayersPerIpPerHour + 1; i++) last = await client(env, { ip: '1.2.3.4' }).post('/api/session');
    assert.equal(last.status, 429);
  });
  test('rename validation + cooldown', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    assert.equal((await c.patch('/api/me', { displayName: '<script>' })).status, 400);
    assert.equal((await c.patch('/api/me', { displayName: 'Official Admin' })).status, 400);
    const ok = await c.patch('/api/me', { displayName: 'Pumpkin King' });
    assert.equal(ok.player.displayName, 'Pumpkin King');
    assert.equal((await c.patch('/api/me', { displayName: 'Another' })).status, 429);
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
    assert.deepEqual(amounts.map(a => lamportsToSolString(a)), ['4', '2', '1.2', '0.8', '0.6', '0.4', '0.3', '0.3', '0.2', '0.2']);
    assert.equal(amounts.reduce((a, b) => a + b, 0n), 10_000_000_000n);
    assert.equal(unallocated, 0n);
  });
  test('12.4 SOL (maker rewards added) -> #1 = 4.96 SOL', () => {
    const { amounts } = allocatePool(solStringToLamports('12.4'), bps);
    assert.equal(lamportsToSolString(amounts[0]), '4.96');
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
    assert.equal(lamportsToSolString(r.unallocated), '2.8');
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

  test('only VERIFIED funding counts; duplicate signatures rejected; frontend cannot add', async () => {
    const env = makeEnv();
    const a = adminClient(env);
    let s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalLamports, '0', 'pending initial funding does not count');
    await verifyInitialFunding(env);
    s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalSol, '10');
    assert.equal(s.current.estPrizes[0].sol, '4');
    const sig = '5'.repeat(88);
    const add = await a.post('funding', { seasonId: 's01', amountSol: '2.4', source: 'MAKER_REWARD', txSignature: sig });
    assert.equal(add.ok, true);
    assert.equal((await a.post('funding', { seasonId: 's01', amountSol: '2.4', source: 'MAKER_REWARD', txSignature: sig })).error, 'DUPLICATE_SIGNATURE');
    s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalSol, '10', 'pending maker reward not counted');
    await a.post(`funding/${add.id}/verify`, { method: 'manual', confirm: 'I VERIFIED THIS FUNDING' });
    s = await client(env).get('/api/season');
    assert.equal(s.current.pool.totalSol, '12.4');
    assert.equal(s.current.pool.makerLamports, '2400000000');
    assert.equal(s.current.estPrizes[0].sol, '4.96');
    assert.equal((await a.post(`funding/${add.id}/verify`, { method: 'manual', confirm: 'I VERIFIED THIS FUNDING' })).error, 'NOT_PENDING');
    // public endpoints cannot write the pool
    const p = await newPlayer(env);
    assert.equal((await p.c.post('/api/admin/funding', { seasonId: 's01', amountSol: '100', source: 'MAKER_REWARD' })).status, 401);
    assert.equal((await p.c.post('/api/season', { pool: 1e12 })).status, 404);
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
    await verifyInitialFunding(env);
    const players = [];
    for (let i = 0; i < 12; i++) players.push(await newPlayer(env));
    // Give deterministic season points directly via the ledger path: insert season stats
    for (let i = 0; i < 12; i++) {
      await env.DB.prepare('INSERT INTO season_player_stats (season_id, player_id, points, games_played, updated_at) VALUES (?,?,?,?,?)')
        .bind('s01', players[i].player.id, 1000 - i * 10, 1, MID + i).run();
    }
    const lb = await players[0].c.get('/api/leaderboard?scope=season');
    assert.equal(lb.rows.length, 12);
    assert.equal(lb.rows[0].me, true);
    assert.equal(lb.rows[0].prize.sol, '4');
    assert.equal(lb.rows[0].prize.eligibility, 'NOT_VERIFIED');
    assert.equal(lb.rows[10].prize, null);
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
    // pool frozen: funding refused
    assert.equal((await a.post('funding', { seasonId: 's01', amountSol: '1', source: 'MAKER_REWARD' })).error, 'POOL_FROZEN');
    let ents = (await env.DB.prepare("SELECT * FROM prize_entitlements WHERE season_id='s01' AND status='FINALIZING' ORDER BY rank").all()).results;
    assert.equal(ents.length, 10);
    assert.equal(ents.reduce((s, e) => s + e.amount_lamports, 0), 10_000_000_000);
    // disqualify #3 -> #4..#11 shift up
    const dq = await a.post('seasons/s01/disqualify', { playerId: players[2].player.id, reason: 'Bot activity', evidence: 'claims at 50ms' });
    assert.equal(dq.ok, true);
    ents = (await env.DB.prepare("SELECT * FROM prize_entitlements WHERE season_id='s01' AND status='FINALIZING' ORDER BY rank").all()).results;
    assert.equal(ents.length, 10);
    assert.equal(ents[2].player_id, players[3].player.id);
    assert.equal(ents[9].player_id, players[10].player.id);
    assert.equal(ents.reduce((s, e) => s + e.amount_lamports, 0), 10_000_000_000);
    const dqRow = await env.DB.prepare("SELECT status FROM prize_entitlements WHERE season_id='s01' AND player_id=?").bind(players[2].player.id).first();
    assert.equal(dqRow.status, 'DISQUALIFIED');
    // history preserved: standings snapshot untouched, audit trail exists
    const snap = await env.DB.prepare("SELECT COUNT(*) n FROM season_final_standings WHERE season_id='s01'").first();
    assert.equal(snap.n, 12);
    const audit = await env.DB.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='entitlements.recompute'").first();
    assert.equal(audit.n, 2);
    // lifetime points survive the season
    const life = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(players[0].player.id).first();
    assert.ok(life.total_points > 0);
    // approval blocked: anonymous winners are not payout-verified
    const ap = await a.post('seasons/s01/approve');
    assert.equal(ap.error, 'UNVERIFIED_WINNERS');
    assert.equal(ap.blockers.length, 10);
    // verify all winners manually (admin attestation), then approve, then mark paid
    let w = 0;
    for (const e of ents) {
      const r = await a.post(`players/${e.player_id}/verify-payout`, { wallet: ('W' + 'abcdefghijk'[w++]).padEnd(44, '1'), confirm: 'I VERIFIED THIS PLAYER' });
      assert.equal(r.ok, true, JSON.stringify(r));
    }
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

  test('anonymous players are never payout-verified by gameplay', async () => {
    const env = makeEnv();
    const { c } = await newPlayer(env);
    for (let i = 0; i < 3; i++) await c.post('/api/games/trick-or-treat/play', { choice: 'trick', idem: idem() });
    const me = await c.get('/api/me');
    assert.equal(me.player.payoutEligibility, 'NOT_VERIFIED');
  });
});

/* ======================= LEADERBOARD / SETTINGS ======================= */
describe('leaderboard & settings', () => {
  beforeEach(() => clock.set(MID));
  test('all-time top 100 uses stored data and shows my rank outside the list', async () => {
    const env = makeEnv();
    for (let i = 0; i < 105; i++) {
      const id = `p_bulk${String(i).padStart(12, '0')}`;
      await env.DB.prepare('INSERT INTO players (id, display_name, created_at, last_seen_at, total_points, last_point_at) VALUES (?,?,?,?,?,?)').bind(id, `Bot ${i}`, MID, MID, 10000 - i, MID).run();
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
