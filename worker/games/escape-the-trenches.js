/* ESCAPE THE TRENCHES — server side.
   Never trusts the browser's score: every run is replayed here with the shared deterministic
   simulation (dist/ett/sim.js) from the server-generated seed + the uploaded input log.
   Lifecycle:  start → (play) → finish [VERIFY] → next start [AUTO-REDEEM previous VALIDATED runs].
   Redemption writes ONE row into the existing ledger (point_transactions, reference 'ett:<run id>',
   UNIQUE) in an atomic batch, so the same run can never be credited twice. */
import { CONFIG } from '../config.js';
import { ETT } from '../../dist/ett/config.js';
import { replayRun, decodeInputs } from '../../dist/ett/sim.js';
import { ApiError, now, dayKey, randomId, randomToken, isUniqueViolation, IDEM_RE } from '../lib/util.js';
import { loadSettings, rateLimit, auditStmt } from '../lib/platform.js';
import { getActiveSeason, RANKED } from '../lib/seasons.js';
import { postSettle, setCounterMax } from '../lib/rewards.js';

const C = CONFIG.escapeTrenches;
const RUN_ID = /^r_[a-z2-9]{16}$/;

export async function settingsFor(env) {
  const s = await loadSettings(env);
  return {
    rewardsEnabled: typeof s['ett.rewardsEnabled'] === 'boolean' ? s['ett.rewardsEnabled'] : C.rewardsEnabled,
    seasonCredit: typeof s['ett.seasonCredit'] === 'boolean' ? s['ett.seasonCredit'] : C.seasonCredit,
    dailyCap: Number.isInteger(s['ett.dailyCap']) ? s['ett.dailyCap'] : C.dailyCap,
  };
}

export function publicRules(S) {
  return {
    rulesVersion: ETT.version,
    coins: Object.fromEntries(ETT.coinOrder.map(k => [k, { value: ETT.COINS[k].value, weight: ETT.COINS[k].weight }])),
    rewardsEnabled: S.rewardsEnabled, seasonCredit: S.seasonCredit, dailyCap: S.dailyCap,
  };
}

function character(v) { return C.maxCharacters.includes(v) ? v : C.maxCharacters[0]; }

export function runView(r) {
  if (!r) return null;
  return {
    id: r.id, character: r.character, state: r.state, verification: r.verification, redemption: r.redemption,
    rejectReason: r.reject_reason || null, flags: r.flags ? r.flags.split(',') : [],
    score: r.score, distance: r.distance, durationMs: r.duration_ms,
    jumps: r.jumps, slides: r.slides, leftSwitches: r.left_switches, rightSwitches: r.right_switches,
    coins: { HALLOWINU: r.coins_hallowinu, USDC: r.coins_usdc, SOLANA: r.coins_solana },
    points: { HALLOWINU: r.coins_hallowinu * ETT.COINS.HALLOWINU.value, USDC: r.coins_usdc * ETT.COINS.USDC.value, SOLANA: r.coins_solana * ETT.COINS.SOLANA.value },
    maxSpeed: r.max_speed_x10 / 10, stumbles: r.stumbles, nearMisses: r.near_misses, endReason: r.end_reason,
    awardedPoints: r.awarded_points, seasonCredited: !!r.season_id,
    startedAt: r.started_at, finishedAt: r.finished_at, redeemedAt: r.redeemed_at,
  };
}

/* ---------------- auto-redemption ---------------- */
async function redeemOne(env, player, run, S, season, attempt = 0) {
  const t = now();
  if (!S.rewardsEnabled || run.score <= 0) {
    await env.DB.prepare("UPDATE ett_runs SET redemption='NONE', redeemed_at=? WHERE id=? AND redemption='PENDING'").bind(t, run.id).run();
    return { runId: run.id, score: run.score, awarded: 0, capped: false, reason: S.rewardsEnabled ? 'NO_POINTS' : 'REWARDS_PAUSED' };
  }
  const day = dayKey(t);
  const used = (await env.DB.prepare('SELECT redeemed FROM ett_daily WHERE player_id=? AND day=?').bind(player.id, day).first())?.redeemed || 0;
  const room = Math.max(0, S.dailyCap - used);
  const awarded = Math.min(run.score, room);
  const seasonId = S.seasonCredit && season ? season.id : null;
  const capped = awarded < run.score;
  const flags = capped ? [run.flags, 'DAILY_CAP'].filter(Boolean).join(',') : run.flags;
  const c = run;
  const reason = `Escape The Trenches: ${c.coins_hallowinu}×HALLOWINU ${c.coins_usdc}×USDC ${c.coins_solana}×SOLANA · ${c.distance} m`;
  const stmts = [
    env.DB.prepare("UPDATE ett_runs SET redemption='REDEEMED', awarded_points=?, redeemed_at=?, season_id=?, flags=? WHERE id=? AND redemption='PENDING'")
      .bind(awarded, t, seasonId, flags || null, run.id),
  ];
  if (awarded > 0) {
    stmts.push(
      env.DB.prepare(`INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at, source_type, source_id, currency)
        VALUES (?,?,?,?,?,?,?, 'ESCAPE_TRENCHES', ?, 'ARCADE_POINTS')`).bind(player.id, seasonId, C.id, awarded, reason.slice(0, 200), `ett:${run.id}`, t, run.id),
      env.DB.prepare('UPDATE players SET total_points = total_points + ?1, xp = xp + ?2, last_point_at = ?3, last_seen_at = ?3 WHERE id = ?4')
        .bind(awarded, awarded * C.xpPerPoint, t, player.id),
      env.DB.prepare(`INSERT INTO ett_daily (player_id, day, redeemed, cap) VALUES (?,?,?,?)
        ON CONFLICT(player_id, day) DO UPDATE SET redeemed = redeemed + excluded.redeemed, cap = excluded.cap`).bind(player.id, day, awarded, S.dailyCap),
      env.DB.prepare(`INSERT INTO player_counters (player_id, key, value) VALUES (?, 'ett_points', ?)
        ON CONFLICT(player_id, key) DO UPDATE SET value = value + excluded.value`).bind(player.id, awarded),
    );
    if (seasonId) stmts.push(env.DB.prepare(
      `INSERT INTO season_player_stats (season_id, player_id, points, games_played, updated_at) VALUES (?,?,?,1,?)
       ON CONFLICT(season_id, player_id) DO UPDATE SET points = points + excluded.points, games_played = games_played + 1, updated_at = excluded.updated_at`)
      .bind(seasonId, player.id, awarded, t));
  }
  try { await env.DB.batch(stmts); }
  catch (e) {
    if (isUniqueViolation(e)) return null;                                    // another request already redeemed it
    if (/CHECK constraint/i.test(String(e && e.message)) && attempt < 2) return redeemOne(env, player, run, S, season, attempt + 1);   // daily-cap race
    throw e;
  }
  return { runId: run.id, score: run.score, awarded, capped, seasonCredited: !!seasonId };
}

export async function redeemPending(env, player, S) {
  S = S || await settingsFor(env);
  const { results } = await env.DB.prepare(
    "SELECT * FROM ett_runs WHERE player_id=? AND verification='VALIDATED' AND redemption='PENDING' ORDER BY finished_at ASC LIMIT 50").bind(player.id).all();
  if (!results.length) return [];
  const season = S.seasonCredit ? await getActiveSeason(env) : null;
  const out = [];
  for (const run of results) { const r = await redeemOne(env, player, run, S, season); if (r) out.push(r); }
  if (out.some(r => r.awarded > 0)) await postSettle(env, player.id);
  return out;
}

/* ---------------- start a run ---------------- */
export async function start(env, player, body) {
  await rateLimit(env, `ettstart:${player.id}`, C.rateLimits.starts);
  const idem = typeof body.idem === 'string' && IDEM_RE.test(body.idem) ? body.idem : null;
  if (!idem) throw new ApiError(400, 'BAD_IDEM', 'Missing request key.');
  const S = await settingsFor(env);
  const existing = await env.DB.prepare('SELECT * FROM ett_runs WHERE player_id=? AND idem_key=?').bind(player.id, idem).first();
  if (existing) return { run: { id: existing.id, seed: existing.seed, rulesVersion: existing.rules_version, startedAt: existing.started_at }, redeemed: [], replay: true, rules: publicRules(S) };

  // 1) the previous run(s) are validated already (at finish) → credit them now
  const redeemed = await redeemPending(env, player, S);
  // 2) create the new run with a fresh server seed
  const t = now();
  const run = { id: randomId('r_', 16), seed: randomToken(16), rulesVersion: ETT.version, startedAt: t };
  try {
    await env.DB.prepare('INSERT INTO ett_runs (id, player_id, idem_key, seed, rules_version, character, started_at) VALUES (?,?,?,?,?,?,?)')
      .bind(run.id, player.id, idem, run.seed, run.rulesVersion, character(body.character), t).run();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const r = await env.DB.prepare('SELECT * FROM ett_runs WHERE player_id=? AND idem_key=?').bind(player.id, idem).first();
    return { run: { id: r.id, seed: r.seed, rulesVersion: r.rules_version, startedAt: r.started_at }, redeemed, replay: true, rules: publicRules(S) };
  }
  return { run, redeemed, rules: publicRules(S), balance: await balance(env, player.id, S) };
}

/* ---------------- finish = upload input log, server replays ---------------- */
export async function finish(env, player, body) {
  const runId = typeof body.runId === 'string' && RUN_ID.test(body.runId) ? body.runId : null;
  if (!runId) throw new ApiError(400, 'BAD_RUN', 'Unknown run.');
  const row = await env.DB.prepare('SELECT * FROM ett_runs WHERE id=? AND player_id=?').bind(runId, player.id).first();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Unknown run.');
  if (row.state === 'FINISHED') return { run: runView(row), replay: true, ...(await bests(env, player.id, row.id)) };
  if (row.state === 'ABANDONED') throw new ApiError(409, 'RUN_ABANDONED', 'This run expired.');

  const t = now(), elapsed = t - row.started_at;
  const ticks = body.ticks;
  const encoded = Array.isArray(body.inputs) ? body.inputs : null;
  let verification = 'VALIDATED', reason = null, summary = null;
  const flags = [];
  const inputs = encoded && encoded.length <= ETT.limits.maxInputs ? decodeInputs(encoded) : null;
  if (!inputs) { verification = 'REJECTED'; reason = 'BAD_INPUTS'; }
  else if (row.rules_version !== ETT.version) { verification = 'REJECTED'; reason = 'RULES_CHANGED'; }
  else if (elapsed > C.lateFinishMs) { verification = 'REJECTED'; reason = 'EXPIRED'; }
  else {
    const rep = replayRun(row.seed, inputs, ticks);
    if (!rep.ok) { verification = 'REJECTED'; reason = rep.error; }
    else {
      summary = rep.summary;
      const simMs = ticks * 1000 / ETT.tickRate, secs = ticks / ETT.tickRate;
      if (simMs > elapsed + C.finishGraceMs) { verification = 'REJECTED'; reason = 'TOO_FAST'; }
      else if (summary.ticks !== ticks || summary.score !== body.score || summary.dead !== !!body.dead) { verification = 'REJECTED'; reason = 'MISMATCH'; }
      else if (secs >= C.minSecondsForRateCheck && inputs.length / secs > ETT.limits.maxInputsPerSecond) { verification = 'REJECTED'; reason = 'INPUT_RATE'; }
      if (summary.durationMs > 60_000 && summary.score / (summary.durationMs / 60_000) > C.review.scorePerMinute) flags.push('HIGH_RATE');
      if (summary.distance > C.review.longRunMetres) flags.push('LONG_RUN');
      if (rep.unusedInputs) flags.push('TRAILING_INPUTS');
    }
  }
  const s = summary || {};
  const redemption = verification === 'VALIDATED' && (s.score || 0) > 0 ? 'PENDING' : 'NONE';
  const updated = await env.DB.prepare(
    `UPDATE ett_runs SET state='FINISHED', verification=?, redemption=?, reject_reason=?, flags=?, character=?,
       score=?, distance=?, duration_ms=?, ticks=?, jumps=?, slides=?, left_switches=?, right_switches=?,
       coins_hallowinu=?, coins_usdc=?, coins_solana=?, max_speed_x10=?, stumbles=?, near_misses=?, end_reason=?,
       claimed_score=?, input_count=?, inputs_json=?, finished_at=?
     WHERE id=? AND state='ACTIVE' RETURNING *`).bind(
    verification, redemption, reason, flags.length ? flags.join(',') : null, character(body.character || row.character),
    s.score || 0, s.distance || 0, s.durationMs || 0, Number.isInteger(ticks) ? ticks : 0, s.jumps || 0, s.slides || 0, s.leftSwitches || 0, s.rightSwitches || 0,
    s.coins ? s.coins.HALLOWINU : 0, s.coins ? s.coins.USDC : 0, s.coins ? s.coins.SOLANA : 0, Math.round((s.maxSpeed || 0) * 10), s.stumbles || 0, s.nearMisses || 0, s.reason || (s.dead === false ? 'quit' : null),
    Number.isInteger(body.score) ? body.score : null, inputs ? inputs.length : 0, inputs ? JSON.stringify(encoded) : null, t, runId).first();
  const final = updated || await env.DB.prepare('SELECT * FROM ett_runs WHERE id=?').bind(runId).first();
  if (updated && s.distance) await setCounterMax(env, player.id, 'ett_best_distance', s.distance).run();
  return { run: runView(final), ...(await bests(env, player.id, runId)), balance: await balance(env, player.id, await settingsFor(env)) };
}

async function bests(env, playerId, excludeId) {
  const prev = await env.DB.prepare(
    "SELECT COALESCE(MAX(score),0) AS score, COALESCE(MAX(distance),0) AS distance FROM ett_runs WHERE player_id=? AND verification='VALIDATED' AND id != ?").bind(playerId, excludeId).first();
  const cur = await env.DB.prepare("SELECT score, distance, verification FROM ett_runs WHERE id=?").bind(excludeId).first();
  const ok = cur && cur.verification === 'VALIDATED';
  return { personalBest: { score: Math.max(prev.score, ok ? cur.score : 0), distance: Math.max(prev.distance, ok ? cur.distance : 0),
    newBestScore: !!ok && cur.score > prev.score, newBestDistance: !!ok && cur.distance > prev.distance } };
}

async function balance(env, playerId, S) {
  const p = await env.DB.prepare('SELECT total_points FROM players WHERE id=?').bind(playerId).first();
  const today = await env.DB.prepare('SELECT redeemed FROM ett_daily WHERE player_id=? AND day=?').bind(playerId, dayKey()).first();
  const pending = await env.DB.prepare("SELECT COALESCE(SUM(score),0) AS pts, COUNT(*) AS n FROM ett_runs WHERE player_id=? AND verification='VALIDATED' AND redemption='PENDING'").bind(playerId).first();
  const earned = await env.DB.prepare("SELECT COALESCE(SUM(awarded_points),0) AS pts FROM ett_runs WHERE player_id=? AND redemption='REDEEMED'").bind(playerId).first();
  return { totalPoints: p ? p.total_points : 0, redeemedToday: today ? today.redeemed : 0, dailyCap: S.dailyCap,
    pendingPoints: pending.pts, pendingRuns: pending.n, ettPointsEarned: earned.pts };
}

/* ---------------- reads ---------------- */
export async function me(env, player) {
  const S = await settingsFor(env);
  const { results } = await env.DB.prepare("SELECT * FROM ett_runs WHERE player_id=? AND state != 'ACTIVE' ORDER BY started_at DESC LIMIT ?").bind(player.id, C.historySize).all();
  const best = await env.DB.prepare(
    "SELECT COALESCE(MAX(score),0) AS score, COALESCE(MAX(distance),0) AS distance, COUNT(*) AS runs FROM ett_runs WHERE player_id=? AND verification='VALIDATED'").bind(player.id).first();
  // finished-but-unredeemed runs are listed so the page can say "pending — redeemed on your next run"
  return { rules: publicRules(S), balance: await balance(env, player.id, S), personalBest: best, history: results.map(runView) };
}

function rangeStart(range, t = now()) {
  if (range === 'today') return Date.parse(dayKey(t) + 'T00:00:00Z');
  if (range === 'week') { const d = Date.parse(dayKey(t) + 'T00:00:00Z'); const dow = (new Date(d).getUTCDay() + 6) % 7; return d - dow * 86400_000; }
  return 0;
}
const METRICS = { best: 'best', total: 'total', distance: 'dist' };

export async function leaderboard(env, player, range, metric) {
  const col = METRICS[metric] || 'best';
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.display_name, MAX(r.score) AS best, SUM(r.score) AS total, MAX(r.distance) AS dist, COUNT(*) AS runs, MIN(r.finished_at) AS first
     FROM ett_runs r JOIN players p ON p.id = r.player_id
     WHERE r.verification = 'VALIDATED' AND r.finished_at >= ? AND ${RANKED}
     GROUP BY p.id ORDER BY ${col} DESC, dist DESC, first ASC, p.id ASC LIMIT 1000`).bind(rangeStart(range)).all();
  const rows = results.map((r, i) => ({ rank: i + 1, name: r.display_name, best: r.best, total: r.total, distance: r.dist, runs: r.runs, me: !!player && r.id === player.id }));
  const top = rows.slice(0, C.leaderboardSize);
  const mine = rows.find(r => r.me);
  return { range, metric: METRICS[metric] ? metric : 'best', rows: top, me: mine && !top.includes(mine) ? mine : null, serverNow: now() };
}

/* ---------------- admin + cron ---------------- */
export async function adminRuns(env, url) {
  const filter = url.searchParams.get('filter');
  const where = filter === 'flagged' ? 'r.flags IS NOT NULL' : filter === 'rejected' ? "r.verification='REJECTED'" : '1=1';
  const { results } = await env.DB.prepare(
    `SELECT r.*, p.display_name FROM ett_runs r JOIN players p ON p.id=r.player_id WHERE ${where} AND r.state='FINISHED' ORDER BY r.finished_at DESC LIMIT 100`).all();
  const stats = await env.DB.prepare(
    "SELECT COUNT(*) AS runs, SUM(verification='VALIDATED') AS validated, SUM(verification='REJECTED') AS rejected, COALESCE(SUM(awarded_points),0) AS credited FROM ett_runs WHERE state='FINISHED'").first();
  return { stats, runs: results.map(r => ({ ...runView(r), player: r.display_name, playerId: r.player_id, claimedScore: r.claimed_score, inputCount: r.input_count })) };
}

/* Rejects a run after review. If it was already credited, the credit is reversed in the ledger (audited). */
export async function adminReject(env, actor, runId, reason) {
  const r = await env.DB.prepare('SELECT * FROM ett_runs WHERE id=?').bind(runId).first();
  if (!r) throw new ApiError(404, 'NOT_FOUND', 'Run not found.');
  if (r.verification === 'REJECTED') throw new ApiError(409, 'ALREADY_REJECTED', 'Already rejected.');
  const t = now();
  const stmts = [
    env.DB.prepare("UPDATE ett_runs SET verification='REJECTED', redemption=CASE WHEN redemption='PENDING' THEN 'NONE' ELSE redemption END, reject_reason=? WHERE id=? AND verification!='REJECTED'").bind(`ADMIN: ${reason}`.slice(0, 200), runId),
    auditStmt(env, actor, 'ett.reject', runId, { reason, awarded: r.awarded_points, redemption: r.redemption }),
  ];
  if (r.redemption === 'REDEEMED' && r.awarded_points > 0) {
    stmts.push(
      env.DB.prepare(`INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at, source_type, source_id, currency)
        VALUES (?,?,?,?,?,?,?, 'ESCAPE_TRENCHES_VOID', ?, 'ARCADE_POINTS')`).bind(r.player_id, r.season_id, C.id, -r.awarded_points, `Run rejected: ${reason}`.slice(0, 200), `ett-void:${runId}`, t, runId),
      env.DB.prepare('UPDATE players SET total_points = MAX(0, total_points - ?), xp = MAX(0, xp - ?) WHERE id = ?').bind(r.awarded_points, r.awarded_points * C.xpPerPoint, r.player_id),
    );
    if (r.season_id) stmts.push(env.DB.prepare('UPDATE season_player_stats SET points = MAX(0, points - ?) WHERE season_id = ? AND player_id = ?').bind(r.awarded_points, r.season_id, r.player_id));
  }
  await env.DB.batch(stmts);
  return { ok: true, reversed: r.redemption === 'REDEEMED' ? r.awarded_points : 0 };
}

export async function cron(env) {
  await env.DB.prepare(
    "UPDATE ett_runs SET state='ABANDONED', verification='REJECTED', redemption='NONE', reject_reason='NOT_FINISHED' WHERE state='ACTIVE' AND started_at < ?")
    .bind(now() - C.abandonAfterMs).run();
}

