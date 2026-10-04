/* GAME 4 — HALLOWINU QUIZ. The correct answer never leaves the server before answering. */
import { ApiError, now, randomId, randomInt, shuffle, isUniqueViolation } from '../lib/util.js';
import { consumeLimit, beginAttempt, settle, getCounters, setCounterMax } from '../lib/rewards.js';

export const id = 'quiz';

export async function next(env, player, cfg) {
  const t = now();
  // Expire stale pending questions (they still count as used).
  await env.DB.prepare("UPDATE quiz_attempts SET status='expired' WHERE player_id=? AND status='pending' AND expires_at < ?").bind(player.id, t).run();
  // Resume an open question instead of handing out a new one.
  const open = await env.DB.prepare("SELECT * FROM quiz_attempts WHERE player_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(player.id).first();
  if (open) return presentAttempt(env, open);

  let rewarded = true, lim = null;
  try { lim = await consumeLimit(env, player, id, cfg); }
  catch (e) {
    if (e.code !== 'DAILY_LIMIT' || !cfg.practiceAfterLimit) throw e;
    rewarded = false;
  }
  // Rewarded: never a question this player has already been served in rewarded mode.
  const pickSql = rewarded
    ? `SELECT id FROM quiz_questions q WHERE active=1 AND NOT EXISTS
         (SELECT 1 FROM quiz_attempts a WHERE a.player_id=? AND a.question_id=q.id AND a.rewarded=1)`
    : `SELECT id FROM quiz_questions WHERE active=1 AND ? IS NOT NULL`;
  const { results: pool } = await env.DB.prepare(pickSql).bind(player.id).all();
  if (!pool.length) {
    if (lim) await lim.refund();
    throw new ApiError(409, 'NO_QUESTIONS', 'You have answered every question in the crypt. New ones are coming!');
  }
  const qid = pool[randomInt(pool.length)].id;
  const q = await env.DB.prepare('SELECT * FROM quiz_questions WHERE id=?').bind(qid).first();
  const order = shuffle([0, 1, 2, 3]);
  const attempt = { id: randomId('q_', 16), player_id: player.id, question_id: q.id, rewarded: rewarded ? 1 : 0, order_json: JSON.stringify(order), created_at: t, expires_at: t + cfg.answerTimeMs };
  try {
    await env.DB.prepare("INSERT INTO quiz_attempts (id, player_id, question_id, rewarded, order_json, status, created_at, expires_at) VALUES (?,?,?,?,?,'pending',?,?)")
      .bind(attempt.id, attempt.player_id, attempt.question_id, attempt.rewarded, attempt.order_json, attempt.created_at, attempt.expires_at).run();
  } catch (e) {
    if (lim) await lim.refund();
    if (isUniqueViolation(e)) throw new ApiError(409, 'RETRY', 'The ghosts shuffled the cards. Try again.');
    throw e;
  }
  return { ...(await presentAttempt(env, attempt, q)), remaining: lim ? cfg.limit.count - lim.used : 0 };
}

async function presentAttempt(env, a, q) {
  q = q || await env.DB.prepare('SELECT * FROM quiz_questions WHERE id=?').bind(a.question_id).first();
  const answers = JSON.parse(q.answers_json), order = JSON.parse(a.order_json);
  return {
    attemptId: a.id, question: q.question, category: q.category, difficulty: q.difficulty,
    answers: order.map(i => answers[i]),             // no correct index included
    rewarded: !!a.rewarded, expiresAt: a.expires_at, serverNow: now(),
  };
}

export async function answer(env, player, cfg, body) {
  const { attemptId } = body; const choice = body.choice;
  if (typeof attemptId !== 'string' || !Number.isInteger(choice) || choice < 0 || choice > 3) throw new ApiError(400, 'BAD_ANSWER', 'Pick one of the four answers.');
  const t = now();
  const a = await env.DB.prepare('SELECT * FROM quiz_attempts WHERE id=?').bind(attemptId).first();
  if (!a || a.player_id !== player.id) throw new ApiError(404, 'NO_SESSION_FOUND', 'Question not found.');
  if (a.status === 'answered') throw new ApiError(409, 'ALREADY_ANSWERED', 'You already answered this one.');
  const q = await env.DB.prepare('SELECT * FROM quiz_questions WHERE id=?').bind(a.question_id).first();
  const order = JSON.parse(a.order_json);
  const correctDisplayed = order.indexOf(q.correct_index);
  const expired = t > a.expires_at;
  const correct = !expired && order[choice] === q.correct_index;
  // Atomic: only the first answer counts.
  const upd = await env.DB.prepare("UPDATE quiz_attempts SET status='answered', choice=?, correct=?, answered_at=? WHERE id=? AND status='pending' RETURNING id")
    .bind(choice, correct ? 1 : 0, t, a.id).first();
  if (!upd) throw new ApiError(409, 'ALREADY_ANSWERED', expired ? 'Time ran out on that question.' : 'You already answered this one.');

  const base = { correct, correctIndex: correctDisplayed, expired, rewarded: !!a.rewarded };
  if (!a.rewarded) return { ...base, points: 0, practice: true };

  const counters = await getCounters(env, player.id);
  const streak = correct ? (counters.quiz_streak || 0) + 1 : 0;
  let bonus = 0;
  if (correct) for (const s of cfg.streakBonuses) if (streak === s.at) bonus = s.bonus;
  const points = correct ? cfg.rewards[q.difficulty] + bonus : 0;
  // game_attempts row for the shared history/ledger link
  const { attempt } = await beginAttempt(env, player, id, `quiz_${a.id}`.slice(0, 64), `q:${a.id}`);
  const result = { ...base, points, bonus, streak, difficulty: q.difficulty };
  const settled = await settle(env, player, {
    gameId: id, attemptId: attempt.id, reference: `quiz:${a.id}`, points,
    reason: `Quiz (${q.difficulty}${bonus ? `, streak ${streak}` : ''})`, xp: cfg.xpPerPlay + points, win: correct,
    counters: correct ? { quiz_correct: 1 } : {}, result,
    extraStatements: [
      env.DB.prepare('UPDATE quiz_attempts SET points=? WHERE id=?').bind(points, a.id),
      env.DB.prepare(`INSERT INTO player_counters (player_id, key, value) VALUES (?, 'quiz_streak', ?)
        ON CONFLICT(player_id, key) DO UPDATE SET value = excluded.value`).bind(player.id, streak),
      setCounterMax(env, player.id, 'quiz_best_streak', streak),
    ],
  });
  return { ...result, ...settled };
}
