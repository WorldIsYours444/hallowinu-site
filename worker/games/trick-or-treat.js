/* GAME 1 — TRICK OR TREAT. Server picks the outcome AFTER the player's choice. */
import { ApiError, weightedPick, IDEM_RE } from '../lib/util.js';
import { consumeLimit, beginAttempt, settle } from '../lib/rewards.js';

export const id = 'trick-or-treat';

export async function play(env, player, cfg, body) {
  const choice = body.choice;
  if (choice !== 'trick' && choice !== 'treat') throw new ApiError(400, 'BAD_CHOICE', 'Pick trick or treat.');
  if (typeof body.idem !== 'string' || !IDEM_RE.test(body.idem)) throw new ApiError(400, 'BAD_IDEM', 'Missing request id.');

  // Replay of the same request -> return the stored result, never a second reward.
  const pre = await env.DB.prepare('SELECT * FROM game_attempts WHERE player_id=? AND game=? AND idem_key=?').bind(player.id, id, body.idem).first();
  if (pre) return replayResult(pre);

  const lim = await consumeLimit(env, player, id, cfg);
  const { attempt, replay } = await beginAttempt(env, player, id, body.idem, lim.period);
  if (replay) { await lim.refund(); return replayResult(attempt); }

  try {
    const { item } = weightedPick(cfg.tables[choice]);
    const result = { choice, points: item.points, label: item.label, jackpot: item.label === 'JACKPOT!' };
    const settled = await settle(env, player, {
      gameId: id, attemptId: attempt.id, reference: `tot:${attempt.id}`, points: item.points,
      reason: `${cfg.name} (${choice})`, xp: cfg.xpPerPlay + item.points, win: item.points > 0,
      counters: { [choice === 'trick' ? 'tot_trick' : 'tot_treat']: 1 }, result,
    });
    return { ...result, attemptId: attempt.id, remaining: cfg.limit.count - lim.used, ...settled };
  } catch (e) {
    await env.DB.prepare("UPDATE game_attempts SET status='void' WHERE id=? AND status='pending'").bind(attempt.id).run();
    await lim.refund();
    throw e;
  }
}

function replayResult(a) {
  if (a.status !== 'complete') throw new ApiError(409, 'IN_PROGRESS', 'That play is still being processed.');
  return { ...JSON.parse(a.result_json || '{}'), attemptId: a.id, replay: true };
}
