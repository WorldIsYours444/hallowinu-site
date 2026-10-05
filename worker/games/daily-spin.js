/* GAME 3 — DAILY SPIN. Result decided and credited server-side before any animation. */
import { ApiError, weightedPick, IDEM_RE } from '../lib/util.js';
import { consumeLimit, beginAttempt, settle } from '../lib/rewards.js';

export const id = 'daily-spin';

export function publicWheel(cfg) {
  return cfg.segments.map(s => ({ id: s.id, label: s.label, points: s.points, rare: !!s.rare, weight: s.weight })); // odds are public
}

export async function spin(env, player, cfg, body) {
  if (typeof body.idem !== 'string' || !IDEM_RE.test(body.idem)) throw new ApiError(400, 'BAD_IDEM', 'Missing request id.');
  const pre = await env.DB.prepare('SELECT * FROM game_attempts WHERE player_id=? AND game=? AND idem_key=?').bind(player.id, id, body.idem).first();
  if (pre) {
    if (pre.status !== 'complete') throw new ApiError(409, 'IN_PROGRESS', 'Spin is still being processed.');
    return { ...JSON.parse(pre.result_json), replay: true };
  }
  const lim = await consumeLimit(env, player, id, cfg);   // atomic: two parallel spins -> only one passes
  const { attempt, replay } = await beginAttempt(env, player, id, body.idem, lim.period);
  if (replay) { await lim.refund(); throw new ApiError(409, 'IN_PROGRESS', 'Spin is still being processed.'); }
  try {
    const { item, index } = weightedPick(cfg.segments);
    const result = { segmentId: item.id, segmentIndex: index, label: item.label, points: item.points, rare: !!item.rare, nextAt: lim.nextAt };
    const settled = await settle(env, player, {
      gameId: id, attemptId: attempt.id, reference: `spin:${attempt.id}`, points: item.points,
      reason: `${cfg.name} (${item.label})`, xp: cfg.xpPerPlay + item.points, win: true,
      counters: item.rare ? { spin_rare: 1 } : {}, result,
    });
    return { ...result, attemptId: attempt.id, ...settled };
  } catch (e) {
    await env.DB.prepare("UPDATE game_attempts SET status='void' WHERE id=? AND status='pending'").bind(attempt.id).run();
    await lim.refund();
    throw e;
  }
}
