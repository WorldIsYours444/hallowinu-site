/* GAME 2 — PUMPKIN HUNT.
   The server generates the board (spawn time, lifetime, position, type) and keeps the
   authoritative copy. Every claim is validated against SERVER time relative to the session
   start; points are computed server-side at finish. */
import { ApiError, now, randomId, randomInt, weightedPick, IDEM_RE, isUniqueViolation } from '../lib/util.js';
import { consumeLimit, beginAttempt, settle } from '../lib/rewards.js';
import { rateLimit, RL } from '../lib/platform.js';

export const id = 'pumpkin-hunt';

export function generateBoard(cfg) {
  const types = Object.entries(cfg.targets).map(([type, t]) => ({ type, ...t }));
  const targets = [];
  let golden = 0;
  const span = cfg.durationMs - 1200;
  for (let i = 0; i < cfg.targetCount; i++) {
    let pick = weightedPick(types).item;
    if (pick.type === 'golden' && golden >= (cfg.targets.golden.maxPerSession ?? 1)) pick = types.find(t => t.type === 'normal');
    if (pick.type === 'golden') golden++;
    // Spread spawns over the round with jitter; positions in % of the board (kept off edges).
    const base = Math.floor((span / cfg.targetCount) * i);
    targets.push({
      id: randomId('t', 8),
      type: pick.type,
      spawnMs: 300 + base + randomInt(Math.max(1, Math.floor(span / cfg.targetCount))),
      lifeMs: pick.lifeMs,
      x: 6 + randomInt(86), y: 10 + randomInt(78),
    });
  }
  targets.sort((a, b) => a.spawnMs - b.spawnMs);
  const decoyKinds = ['grave', 'ghost', 'bat', 'tree', 'lantern', 'candy'];
  const decoys = Array.from({ length: cfg.decoys }, () => ({ kind: decoyKinds[randomInt(decoyKinds.length)], x: 4 + randomInt(90), y: 8 + randomInt(84) }));
  return { targets, decoys };
}

export async function start(env, player, cfg, body) {
  if (typeof body.idem !== 'string' || !IDEM_RE.test(body.idem)) throw new ApiError(400, 'BAD_IDEM', 'Missing request id.');
  await settleExpired(env, player, cfg);
  const pre = await env.DB.prepare('SELECT * FROM game_attempts WHERE player_id=? AND game=? AND idem_key=?').bind(player.id, id, body.idem).first();
  if (pre) {
    const s = await env.DB.prepare("SELECT * FROM hunt_sessions WHERE attempt_id=?").bind(pre.id).first();
    if (s && s.status === 'active') return publicSession(s, cfg);
    throw new ApiError(409, 'ALREADY_PLAYED', 'That hunt already ended.');
  }
  const active = await env.DB.prepare("SELECT * FROM hunt_sessions WHERE player_id=? AND status='active'").bind(player.id).first();
  if (active) return publicSession(active, cfg); // resume instead of a parallel session

  const lim = await consumeLimit(env, player, id, cfg);
  const { attempt, replay } = await beginAttempt(env, player, id, body.idem, lim.period);
  if (replay) { await lim.refund(); throw new ApiError(409, 'IN_PROGRESS', 'Hunt already starting.'); }
  const t = now();
  const board = generateBoard(cfg);
  const session = {
    id: randomId('h_', 16), player_id: player.id, attempt_id: attempt.id, created_at: t,
    starts_at: t + cfg.countdownMs, expires_at: t + cfg.countdownMs + cfg.durationMs,
    targets_json: JSON.stringify(board), status: 'active',
  };
  try {
    await env.DB.prepare(
      'INSERT INTO hunt_sessions (id, player_id, attempt_id, created_at, starts_at, expires_at, targets_json, status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(session.id, session.player_id, session.attempt_id, session.created_at, session.starts_at, session.expires_at, session.targets_json, 'active').run();
  } catch (e) {
    await env.DB.prepare("UPDATE game_attempts SET status='void' WHERE id=?").bind(attempt.id).run();
    await lim.refund();
    if (isUniqueViolation(e)) throw new ApiError(409, 'HUNT_ACTIVE', 'You already have a hunt running.');
    throw e;
  }
  return { ...publicSession(session, cfg), remaining: cfg.limit.count - lim.used };
}

function publicSession(s, cfg) {
  const board = JSON.parse(s.targets_json);
  const t = now();
  return {
    sessionId: s.id, serverNow: t, startsAt: s.starts_at, expiresAt: s.expires_at,
    durationMs: cfg.durationMs, startsInMs: s.starts_at - t,
    points: Object.fromEntries(Object.entries(cfg.targets).map(([k, v]) => [k, v.points])),
    // Spawn schedule is relative to startsAt. Point values are public game rules, not authority.
    targets: board.targets.map(({ id, type, spawnMs, lifeMs, x, y }) => ({ id, type, spawnMs, lifeMs, x, y })),
    decoys: board.decoys,
  };
}

export async function claim(env, player, cfg, body) {
  const { sessionId, targetId } = body;
  if (typeof sessionId !== 'string' || typeof targetId !== 'string' || targetId.length > 20) throw new ApiError(400, 'BAD_REQUEST', 'Invalid claim.');
  await rateLimit(env, `hunt:${player.id}`, RL.huntClaims);
  const t = now();
  const s = await env.DB.prepare('SELECT * FROM hunt_sessions WHERE id=?').bind(sessionId).first();
  if (!s || s.player_id !== player.id) throw new ApiError(404, 'NO_SESSION_FOUND', 'Hunt not found.');
  // Gameplay rejections are normal outcomes (not errors): { accepted: false, reason }.
  const reject = reason => ({ accepted: false, reason, targetId, points: 0 });
  if (s.status !== 'active' || t > s.expires_at + cfg.claimGraceMs) return reject('HUNT_OVER');
  const board = JSON.parse(s.targets_json);
  const target = board.targets.find(x => x.id === targetId);
  if (!target) return reject('INVALID_TARGET');
  const elapsed = t - s.starts_at;
  if (elapsed < target.spawnMs + cfg.minReactionMs) return reject('TOO_EARLY');
  if (elapsed > target.spawnMs + target.lifeMs + cfg.claimGraceMs) return reject('TOO_LATE');
  const last = await env.DB.prepare('SELECT MAX(claimed_at) AS m FROM hunt_claims WHERE session_id=?').bind(s.id).first();
  if (last?.m && t - last.m < cfg.minClaimIntervalMs) return reject('TOO_FAST');
  const points = cfg.targets[target.type].points;
  try {
    await env.DB.prepare('INSERT INTO hunt_claims (session_id, target_id, target_type, player_id, claimed_at, points) VALUES (?,?,?,?,?,?)')
      .bind(s.id, target.id, target.type, player.id, t, points).run();
  } catch (e) {
    if (isUniqueViolation(e)) return reject('ALREADY_CLAIMED');
    throw e;
  }
  return { accepted: true, targetId: target.id, type: target.type, points };
}

/* Score = sum of validated claims + combo bonuses (claims within combo window). */
export function scoreClaims(claims, cfg) {
  const sorted = claims.slice().sort((a, b) => a.claimed_at - b.claimed_at);
  let base = 0, bonus = 0, combo = 0, bestCombo = 0, prev = null, golden = 0, rare = 0;
  for (const c of sorted) {
    base += c.points;
    combo = prev != null && c.claimed_at - prev <= cfg.combo.windowMs ? combo + 1 : 1;
    prev = c.claimed_at; bestCombo = Math.max(bestCombo, combo);
    let b = 0; for (const tier of cfg.combo.bonuses) if (combo >= tier.min) b = tier.bonus;
    bonus += b;
    if (c.target_type === 'golden') golden++;
    if (c.target_type === 'rare') rare++;
  }
  return { base, bonus, total: base + bonus, found: sorted.length, bestCombo, golden, rare };
}

export async function finish(env, player, cfg, body) {
  const { sessionId } = body;
  if (typeof sessionId !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'Invalid session.');
  const s = await env.DB.prepare('SELECT * FROM hunt_sessions WHERE id=?').bind(sessionId).first();
  if (!s || s.player_id !== player.id) throw new ApiError(404, 'NO_SESSION_FOUND', 'Hunt not found.');
  if (s.status === 'finished') {
    const a = await env.DB.prepare('SELECT result_json FROM game_attempts WHERE id=?').bind(s.attempt_id).first();
    return { ...JSON.parse(a?.result_json || '{}'), replay: true };
  }
  // Finishing early is allowed (it only forfeits remaining time); claims after this are rejected.
  return finalizeSession(env, player, cfg, s);
}

async function finalizeSession(env, player, cfg, s) {
  // Close the session first (atomic guard) so only one finisher settles it.
  const closed = await env.DB.prepare("UPDATE hunt_sessions SET status='finished', finished_at=? WHERE id=? AND status='active' RETURNING id").bind(now(), s.id).first();
  if (!closed) {
    const a = await env.DB.prepare('SELECT result_json FROM game_attempts WHERE id=?').bind(s.attempt_id).first();
    return { ...JSON.parse(a?.result_json || '{}'), replay: true };
  }
  const { results: claims } = await env.DB.prepare('SELECT claimed_at, points, target_type FROM hunt_claims WHERE session_id=?').bind(s.id).all();
  const sc = scoreClaims(claims, cfg);
  // Plausibility: cannot exceed the board maximum.
  const board = JSON.parse(s.targets_json);
  const maxBase = board.targets.reduce((a, t) => a + cfg.targets[t.type].points, 0);
  const flags = sc.base > maxBase || sc.found > board.targets.length ? 'IMPOSSIBLE_SCORE' : null;
  const points = flags ? 0 : sc.total;
  const result = { sessionId: s.id, ...sc, points, flagged: !!flags };
  const settled = await settle(env, player, {
    gameId: id, attemptId: s.attempt_id, reference: `hunt:${s.id}`, points,
    reason: `${cfg.name} (${sc.found} found)`, xp: cfg.xpPerPlay + points, win: points > 0,
    counters: { pumpkins_found: sc.found, golden_found: sc.golden }, result,
    extraStatements: [env.DB.prepare('UPDATE hunt_sessions SET score=?, flags=? WHERE id=?').bind(points, flags, s.id)],
  });
  return { ...result, ...settled };
}

/* Abandoned hunts are settled with whatever was legitimately claimed. */
export async function settleExpired(env, player, cfg) {
  const { results } = await env.DB.prepare("SELECT * FROM hunt_sessions WHERE player_id=? AND status='active' AND expires_at + ? < ?")
    .bind(player.id, cfg.finishGraceMs, now()).all();
  for (const s of results) await finalizeSession(env, player, cfg, s);
}
