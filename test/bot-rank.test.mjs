/* /api/bot/rank — read-only rank lookup for the official Telegram bot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeInputs } from '../dist/ett/sim.js';
import { playBot } from './ett-bot.mjs';
import { makeEnv, walletPlayer, client, clock, idem } from './helpers.mjs';

const SECRET = 'bot-secret-0123456789abcdefXYZ';
const auth = { authorization: `Bearer ${SECRET}` };

async function linkTelegram(env, playerId, tgId) {
  const t = Date.now();
  await env.DB.prepare("INSERT INTO player_identities (player_id, provider, provider_user_id, verified_at, method, created_at, updated_at) VALUES (?, 'telegram', ?, ?, 'telegram_login+member', ?, ?)")
    .bind(playerId, String(tgId), t, t, t).run();
}

test('bot rank: disabled without secret, rejects bad/missing tokens and ids', async () => {
  const off = client(makeEnv());
  assert.equal((await off.get('/api/bot/rank?telegram_id=1', auth)).status, 503);
  const env = makeEnv({ BOT_API_TOKEN: SECRET });
  const c = client(env);
  assert.equal((await c.get('/api/bot/rank?telegram_id=1')).status, 401);
  assert.equal((await c.get('/api/bot/rank?telegram_id=1', { authorization: 'Bearer wrong-token-0123456789abcdef' })).status, 401);
  assert.equal((await c.get('/api/bot/rank?telegram_id=abc', auth)).status, 400);
});

test('bot rank: unlinked Telegram user is never guessed', async () => {
  const env = makeEnv({ BOT_API_TOKEN: SECRET });
  await walletPlayer(env, { name: 'Casper' });
  const r = await client(env).get('/api/bot/rank?telegram_id=777', auth);
  assert.equal(r.ok, true);
  assert.equal(r.linked, false);
});

test('bot rank: linked player gets name + ranks (same ranking as the website), no wallet', async () => {
  clock.reset();
  const env = makeEnv({ BOT_API_TOKEN: SECRET });
  const { c, player, wallet } = await walletPlayer(env, { name: 'Trench Ghost' });
  await linkTelegram(env, player.id, 4242);

  const st = await c.post('/api/ett/start', { idem: idem(), character: 'hallow-inu' });
  assert.ok(st.ok, JSON.stringify(st));
  const { sim, inputs } = playBot(st.run.seed, 600);
  clock.advance(Math.ceil(sim.tick * 1000 / 60) + 50);
  const fin = await c.post('/api/ett/finish', { runId: st.run.id, ticks: sim.tick, inputs: encodeInputs(inputs), score: sim.points, dead: sim.dead, character: 'hallow-inu' });
  assert.ok(fin.ok, JSON.stringify(fin));

  const r = await client(env).get('/api/bot/rank?telegram_id=4242', auth);
  assert.equal(r.linked, true);
  assert.equal(r.player.name, 'Trench Ghost');
  const lb = await client(env).get('/api/ett/leaderboard?range=all');
  const row = lb.rows.find(x => x.name === 'Trench Ghost');
  assert.ok(row, 'run is on the public leaderboard');
  assert.equal(r.ett.rank, row.rank);
  assert.equal(r.ett.best, row.best);
  assert.equal(r.haunt.rank, null);
  assert.ok(!JSON.stringify(r).includes(wallet.address), 'wallet never exposed');
  assert.ok(!JSON.stringify(r).includes(player.id), 'internal id never exposed');
  clock.reset();
});
