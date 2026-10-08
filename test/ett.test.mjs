/* ESCAPE THE TRENCHES — simulation fairness/determinism + server verification & auto-redemption. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ETT } from '../dist/ett/config.js';
import { Sim, INPUT, replayRun, encodeInputs, decodeInputs, speedAt } from '../dist/ett/sim.js';
import { playBot } from './ett-bot.mjs';
import { makeEnv, walletPlayer, client, adminClient, clock, idem } from './helpers.mjs';

/* ================= simulation ================= */
test('sim: same seed + same inputs → identical run (live vs replay)', () => {
  const { sim, inputs } = playBot('det-1', 1200);
  const enc = encodeInputs(inputs);
  assert.deepEqual(decodeInputs(enc), inputs);
  const rep = replayRun('det-1', decodeInputs(enc), sim.tick);
  assert.ok(rep.ok);
  assert.deepEqual(rep.summary, sim.summary());
  // a different seed produces a different world
  const a = new Sim('det-1'), b = new Sim('det-2');
  assert.notDeepEqual(a.obstacles.slice(0, 8).map(o => [o.kind, o.lane, o.zm]), b.obstacles.slice(0, 8).map(o => [o.kind, o.lane, o.zm]));
});

test('sim: three real lanes, cannot leave the road, jump/slide change the hitbox', () => {
  const s = new Sim('lanes');
  s.step([INPUT.LEFT]); for (let i = 0; i < 20; i++) s.step(null);
  assert.equal(s.lane, 0); assert.equal(s.px, ETT.laneX[0]);
  s.step([INPUT.LEFT]); for (let i = 0; i < 10; i++) s.step(null);
  assert.equal(s.lane, 0, 'pressing left in the left lane keeps the runner on the road');
  s.step([INPUT.RIGHT]); s.step([INPUT.RIGHT]); for (let i = 0; i < 30; i++) s.step(null);
  assert.equal(s.lane, 2); assert.equal(s.px, ETT.laneX[2]);
  s.step([INPUT.RIGHT]); assert.equal(s.lane, 2);
  s.step([INPUT.JUMP]); let maxY = 0; for (let i = 0; i < 50; i++) { s.step(null); maxY = Math.max(maxY, s.y); }
  assert.ok(maxY > 1.4 && maxY < 1.7, 'jump apex ' + maxY);
  s.step([INPUT.DUCK]); assert.equal(s.height, ETT.player.slideHeight);
  const st = s.summary();
  assert.equal(st.leftSwitches, 1); assert.equal(st.rightSwitches, 2); assert.equal(st.jumps, 1); assert.equal(st.slides, 1);
});

test('sim: obstacles need the right action (low=jump, high=slide, full=switch) and front hits end the run', () => {
  const kinds = { low: 'tombstone', high: 'chain', full: 'candle' };
  for (const [type, kind] of Object.entries(kinds)) {
    for (const action of [null, INPUT.JUMP, INPUT.DUCK]) {
      const s = new Sim('obs-' + type);
      s.obstacles.length = 0; s.coins.length = 0; s.noGen = true;
      const spec = ETT.obstacles[kind], hd = ETT.player.halfDepth;
      s.obstacles.push({ id: 1, kind, type: spec.type, lane: 1, zm: 30, len: spec.len, k: 0, h: spec.h || 0, b: spec.b || 0, A: 30 - hd, B: 30 + spec.len + hd });
      while (!s.dead && s.pz < 40) {
        const dist = 30 - s.pz;
        s.step(action !== null && dist < 3.5 && dist > 3.0 && s.grounded ? [action] : null);
      }
      const survives = (type === 'low' && action === INPUT.JUMP) || (type === 'high' && action === INPUT.DUCK);
      assert.equal(!s.dead, survives, `${type} + ${action}`);
      if (s.dead) assert.equal(s.reason, 'crash');
    }
  }
});

test('sim: bumping a wagon side while switching = stumble; a second stumble = caught', () => {
  const s = new Sim('stumble');
  s.obstacles.length = 0; s.coins.length = 0; s.noGen = true;
  const hd = ETT.player.halfDepth;
  for (const [id, z] of [[1, 20], [2, 70]]) s.obstacles.push({ id, kind: 'cargoWagon', type: 'full', lane: 0, zm: z, len: 30, k: 0, h: 0, b: 0, A: z - hd, B: z + 30 + hd });
  while (s.pz < 30) s.step(null);
  s.step([INPUT.LEFT]); for (let i = 0; i < 20; i++) s.step(null);
  assert.equal(s.dead, false); assert.equal(s.stats.stumbles, 1); assert.equal(s.lane, 1);
  while (s.pz < 80) s.step(null);
  s.step([INPUT.LEFT]); for (let i = 0; i < 20; i++) s.step(null);
  assert.equal(s.dead, true); assert.equal(s.reason, 'caught');
});

test('sim: generated world is fair and coins are never inside solids or in wagon paths', () => {
  for (let n = 0; n < 6; n++) {
    const s = new Sim('world-' + n);
    s._generate(40000);
    const hd = ETT.player.halfDepth;
    // fairness: at every row there is a passable lane reachable from the previous row
    const rows = new Map();
    for (const o of s.obstacles) { if (!rows.has(o.zm)) rows.set(o.zm, []); rows.get(o.zm).push(o); }
    const zs = [...rows.keys()].sort((a, b) => a - b);
    for (const z of zs) {
      let full = 0;
      for (const o of s.obstacles) if (o.type === 'full' && o.A <= z + 0.5 && o.B >= z - 0.5) full |= 1 << o.lane;
      assert.notEqual(full, 7, `all lanes blocked at ${z}`);
    }
    for (const c of s.coins) {
      for (const o of s.obstacles) {
        if (o.lane !== c.lane) continue;
        if (o.k) {
          const MW = ETT.movingWagon;
          assert.ok(c.z < o.zm - MW.clearBehind + 1 || c.z > o.zm + o.len + MW.reserveAhead - 1, `coin in a moving wagon path (seed ${n}, z ${c.z})`);
          continue;
        }
        if (c.z < o.zm - 0.6 || c.z > o.zm + o.len + 0.6) continue;
        if (o.type === 'full') assert.fail(`coin inside a wagon/candle (seed ${n}, z ${c.z})`);
        if (o.type === 'low') assert.ok(c.y - ETT.coins.pickupHalfHeight >= o.h - 1e-9, 'coin inside a low obstacle');
        if (o.type === 'high') assert.ok(c.y + ETT.coins.pickupHalfHeight <= o.b + 1e-9, 'coin inside a high obstacle');
      }
    }
    assert.ok(s.obstacles.some(o => o.k), 'moving wagons appear');
    void hd;
  }
});

test('sim: coin rarity follows the configured weights (HALLOWINU > USDC > SOLANA)', () => {
  const count = { HALLOWINU: 0, USDC: 0, SOLANA: 0 };
  for (let n = 0; n < 4; n++) { const s = new Sim('rarity-' + n); s._generate(60000); for (const c of s.coins) count[c.type]++; }
  const total = count.HALLOWINU + count.USDC + count.SOLANA;
  const pct = k => (100 * count[k]) / total;
  assert.ok(count.HALLOWINU > count.USDC && count.USDC > count.SOLANA, JSON.stringify(count));
  assert.ok(Math.abs(pct('HALLOWINU') - 85) < 4, 'HALLOWINU ' + pct('HALLOWINU'));
  assert.ok(Math.abs(pct('USDC') - 12) < 3, 'USDC ' + pct('USDC'));
  assert.ok(pct('SOLANA') > 1.5 && pct('SOLANA') < 6, 'SOLANA ' + pct('SOLANA'));
  // points use the configured values
  const s = new Sim('pts'); s.stats.coins = { HALLOWINU: 42, USDC: 8, SOLANA: 3 };
  assert.equal(s.points, 112);
});

test('sim: speed and difficulty ramp up with distance', () => {
  assert.equal(speedAt(0), ETT.speed.start);
  assert.ok(speedAt(2000) > speedAt(500));
  assert.equal(speedAt(1e6), ETT.speed.max);
});

test('sim: a look-ahead bot survives long runs on most seeds (no unavoidable layouts)', () => {
  let ok = 0;
  for (let n = 0; n < 6; n++) { const r = playBot('fair-' + n, 3500); if (!r.sim.dead) ok++; }
  assert.ok(ok >= 5, `bot survived ${ok}/6 runs to 3.5 km`);
});

test('replay rejects malformed logs', () => {
  assert.equal(replayRun('x', [[5, 9]], 100).ok, false);
  assert.equal(replayRun('x', [[50, 1], [10, 1]], 100).ok, false);
  assert.equal(replayRun('x', [[150, 1]], 100).ok, false);
  assert.equal(replayRun('x', [], ETT.maxRunTicks + 1).ok, false);
  assert.equal(decodeInputs([-1]), null);
});

/* ================= server ================= */
async function playRun(c, { metres = 500, character = 'super-inu', tamper } = {}) {
  const st = await c.post('/api/ett/start', { idem: idem(), character });
  assert.ok(st.ok, JSON.stringify(st));
  const { sim, inputs } = playBot(st.run.seed, metres);
  clock.advance(Math.ceil(sim.tick * 1000 / 60) + 50);   // the run takes real time
  const body = { runId: st.run.id, ticks: sim.tick, inputs: encodeInputs(inputs), score: sim.points, dead: sim.dead, character };
  if (tamper) tamper(body);
  const fin = await c.post('/api/ett/finish', body);
  return { st, fin, sim };
}

test('api: guests can read rules but must sign in to start an earning run', async () => {
  const env = makeEnv();
  const g = client(env);
  const me = await g.get('/api/ett/me');
  assert.equal(me.ok, true); assert.equal(me.access.state, 'WALLET_NOT_CONNECTED');
  assert.equal(me.rules.coins.HALLOWINU.value, 1); assert.equal(me.rules.coins.USDC.value, 5); assert.equal(me.rules.coins.SOLANA.value, 10);
  const st = await g.post('/api/ett/start', { idem: idem() });
  assert.equal(st.status, 401);
});

test('api: run is replayed server-side, stays pending, and is auto-redeemed exactly once on the next start', async () => {
  const env = makeEnv();
  const { c, player } = await walletPlayer(env);
  const { st, fin, sim } = await playRun(c, { metres: 700 });
  assert.equal(fin.run.verification, 'VALIDATED', JSON.stringify(fin.run));
  assert.equal(fin.run.redemption, 'PENDING');
  assert.equal(fin.run.score, sim.points);
  assert.ok(fin.run.score > 0);
  assert.equal(fin.run.coins.HALLOWINU + fin.run.coins.USDC * 5 + fin.run.coins.SOLANA * 10, fin.run.score);
  assert.equal(fin.run.character, 'super-inu');
  assert.equal(fin.personalBest.newBestScore, true);
  assert.equal(fin.balance.pendingPoints, sim.points);

  // finishing again is idempotent
  const again = await c.post('/api/ett/finish', { runId: st.run.id, ticks: sim.tick, inputs: [], score: 0, dead: true });
  assert.equal(again.replay, true); assert.equal(again.run.score, sim.points);

  // not credited yet
  let meRes = await c.get('/api/me');
  assert.equal(meRes.player.totalPoints, 0);

  // next start → automatic redemption into the existing ledger
  const st2 = await c.post('/api/ett/start', { idem: idem() });
  assert.equal(st2.redeemed.length, 1);
  assert.equal(st2.redeemed[0].awarded, sim.points);
  assert.equal(st2.balance.totalPoints, sim.points);
  meRes = await c.get('/api/me');
  assert.equal(meRes.player.totalPoints, sim.points);
  const ledger = await env.DB.prepare("SELECT * FROM point_transactions WHERE source_type='ESCAPE_TRENCHES'").all();
  assert.equal(ledger.results.length, 1);
  assert.equal(ledger.results[0].reference_id, 'ett:' + st.run.id);
  assert.equal(ledger.results[0].currency, 'ARCADE_POINTS');
  assert.equal(ledger.results[0].season_id, null, 'season credit is off by default');

  // a third start does not redeem it again
  const st3 = await c.post('/api/ett/start', { idem: idem() });
  assert.equal(st3.redeemed.length, 0);
  assert.equal((await c.get('/api/me')).player.totalPoints, sim.points);

  // history + leaderboard
  const hist = await c.get('/api/ett/me');
  assert.equal(hist.history[0].redemption, 'REDEEMED');
  assert.equal(hist.personalBest.score, sim.points);
  const lb = await c.get('/api/ett/leaderboard?range=today&metric=best');
  assert.equal(lb.rows[0].best, sim.points); assert.equal(lb.rows[0].me, true);
  assert.equal(player.displayName, lb.rows[0].name);
});

test('api: tampered scores, too-fast uploads and forged logs are rejected and never credited', async () => {
  const env = makeEnv();
  const { c } = await walletPlayer(env);
  // claimed score differs from the replay
  const a = await playRun(c, { tamper: b => { b.score += 500; } });
  assert.equal(a.fin.run.verification, 'REJECTED'); assert.equal(a.fin.run.rejectReason, 'MISMATCH');
  // claims to have survived longer than the replay
  const b = await playRun(c, { tamper: b => { b.ticks += 600; } });
  assert.equal(b.fin.run.verification, 'REJECTED');
  // uploaded faster than the run could have been played
  const st = await c.post('/api/ett/start', { idem: idem() });
  const { sim, inputs } = playBot(st.run.seed, 500);
  const fast = await c.post('/api/ett/finish', { runId: st.run.id, ticks: sim.tick, inputs: encodeInputs(inputs), score: sim.points, dead: sim.dead });
  assert.equal(fast.run.rejectReason, 'TOO_FAST');
  // garbage inputs
  const st2 = await c.post('/api/ett/start', { idem: idem() });
  clock.advance(60_000);
  const bad = await c.post('/api/ett/finish', { runId: st2.run.id, ticks: 100, inputs: ['x'], score: 0, dead: true });
  assert.equal(bad.run.verification, 'REJECTED');
  // someone else's run
  const other = await walletPlayer(env);
  const st3 = await c.post('/api/ett/start', { idem: idem() });
  const steal = await other.c.post('/api/ett/finish', { runId: st3.run.id, ticks: 10, inputs: [], score: 0, dead: false });
  assert.equal(steal.status, 404);
  // nothing was credited
  await c.post('/api/ett/start', { idem: idem() });
  assert.equal((await c.get('/api/me')).player.totalPoints, 0);
  const lb = await c.get('/api/ett/leaderboard?range=all');
  assert.equal(lb.rows.length, 0, 'rejected runs never rank');
});

test('api: pending run survives a "closed tab" and late upload; daily cap limits credit, not play', async () => {
  const env = makeEnv();
  const { c } = await walletPlayer(env);
  await adminClient(env).put('settings', { key: 'ett.dailyCap', value: 120 });
  let credited = 0, scores = 0, capped = false;
  for (let i = 0; i < 3; i++) {
    const { st, fin } = await playRun(c, { metres: 900 });   // each start auto-redeems the previous run
    for (const r of st.redeemed) { credited += r.awarded; capped = capped || r.capped; }
    assert.equal(fin.run.verification, 'VALIDATED');
    scores += fin.run.score;
  }
  // "closed the tab": the last run stays pending until the next start (next visit)
  const pending = await c.get('/api/ett/me');
  assert.equal(pending.balance.pendingRuns, 1);
  const st = await c.post('/api/ett/start', { idem: idem() });
  for (const r of st.redeemed) { credited += r.awarded; capped = capped || r.capped; }
  assert.equal(credited, Math.min(120, scores));
  assert.ok(capped);
  assert.equal(st.balance.redeemedToday, credited);
  // still allowed to play (unlimited games)
  assert.ok(st.run.seed);
  // next UTC day: new room
  clock.advance(86400_000);
  const { fin } = await playRun(c, { metres: 400 });
  const st2 = await c.post('/api/ett/start', { idem: idem() });
  assert.equal(st2.redeemed[0].awarded, Math.min(120, fin.run.score));
});

test('api: season credit is opt-in; admin can review and reverse a credited run', async () => {
  const env = makeEnv();
  const { c, player } = await walletPlayer(env);
  const adm = adminClient(env);
  await adm.put('settings', { key: 'ett.seasonCredit', value: true });
  clock.set(Date.UTC(2026, 9, 10, 12));
  const { st, fin } = await playRun(c, { metres: 600 });
  await c.post('/api/ett/start', { idem: idem() });
  const row = await env.DB.prepare("SELECT * FROM point_transactions WHERE reference_id=?").bind('ett:' + st.run.id).first();
  assert.equal(row.season_id, 's01');
  const runs = await adm.get('ett/runs');
  assert.ok(runs.runs.some(r => r.id === st.run.id));
  const rej = await adm.post(`ett/runs/${st.run.id}/reject`, { reason: 'review: test' });
  assert.equal(rej.reversed, fin.run.score);
  assert.equal((await c.get('/api/me')).player.totalPoints, 0);
  const again = await adm.post(`ett/runs/${st.run.id}/reject`, { reason: 'twice' });
  assert.equal(again.status, 409);
  clock.reset();
  void player;
});
