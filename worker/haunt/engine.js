/* THE HAUNT — automatic verification engine.
   Order: cheap local checks first (URL, account, duplicate, technical rate limit, target, reward limits, budget),
   then exactly ONE paid X API read of the reply. Curated targets are pre-verified, so the parent post is never
   re-fetched per submission. Every decision is stored with its checks (audit trail). */
import { CONFIG, levelForXp } from '../config.js';
import { ApiError, now, randomId, isUniqueViolation, dayKey, nextDayStart } from '../lib/util.js';
import { rateLimit, auditStmt, loadSettings } from '../lib/platform.js';
import { RANKED } from '../lib/seasons.js';
import { fetchTweet, todayCostMicros, xConfigured, XNotFound, XUnavailable } from './xclient.js';
import { parseStatusUrl, checkReplyContent, fingerprint, cleanReply } from './content.js';

const H = CONFIG.haunt;
const ACTIVE = "('VERIFYING','VERIFICATION_PENDING','AUTO_APPROVED','MANUAL_REVIEW')";

export const REASONS = {
  INVALID_URL: 'That is not an X post link. Copy the link of YOUR reply (Share → Copy link).',
  X_NOT_CONNECTED: 'Connect your X account first.',
  DUPLICATE_STATUS: 'This reply was already submitted.',
  TARGET_REQUIRED: 'Pick a Haunt first.',
  TARGET_NOT_FOUND: 'This Haunt does not exist.',
  TARGET_INACTIVE: 'This Haunt is closed.',
  TARGET_EXPIRED: 'This Haunt has expired.',
  TARGET_FULL: 'This Haunt reached its maximum number of claims.',
  TARGET_ALREADY_DONE: 'You already completed this Haunt. Pick another one.',
  STATUS_NOT_FOUND: 'X could not find this post. Is it deleted or from a protected account?',
  AUTHOR_MISMATCH: 'This reply belongs to a different X account than the one you connected.',
  NOT_A_REPLY: 'This post is not a reply. Reply to the Haunt target on X and submit that reply.',
  WRONG_TARGET: 'This reply is not under the selected Haunt.',
  REPLY_BEFORE_HAUNT: 'This reply was posted before the Haunt opened.',
  REPLY_TOO_OLD: 'This reply is too old to claim.',
  CONTENT_TOO_SHORT: 'Write a real reply — a few words at least, not just tags or links.',
  DUPLICATE_CONTENT: 'You already used this exact text. Write something new.',
  COPY_PASTE: 'This exact text is being copy-pasted by several players. Write your own reply.',
  VERIFICATION_PENDING: 'X is busy right now. Your haunt is queued and will be checked automatically — no XP is lost.',
  BUDGET_PAUSED: 'Verification is paused for a moment. Your haunt is queued and will be checked automatically.',
  MAX_RETRIES: 'X could not be reached for a while. The team will review this haunt.',
};

const CHECK_LABELS = {
  URL: 'Checking link', ACCOUNT: 'Checking connected X account', DUPLICATE: 'Checking duplicates', TARGET: 'Checking Haunt',
  LIMITS: 'Checking haunt limits', POST: 'Checking post', AUTHOR: 'Checking author', REPLY: 'Checking reply', CONTEXT: 'Checking target',
  TIMING: 'Checking time', CONTENT: 'Checking content', ORIGINALITY: 'Checking originality', CAPACITY: 'Checking Haunt capacity', CRYPTO: 'Checking crypto context',
};

async function xAccount(env, playerId) {
  return env.DB.prepare("SELECT provider_user_id, username FROM player_identities WHERE player_id = ? AND provider = 'x'").bind(playerId).first();
}
async function hauntEnabled(env) {
  const s = await loadSettings(env);
  return typeof s['haunt.enabled'] === 'boolean' ? s['haunt.enabled'] : true;
}
async function budgetMicros(env) {
  const s = await loadSettings(env);
  const cents = Number.isInteger(s['haunt.dailyBudgetCents']) ? s['haunt.dailyBudgetCents'] : (Number(env.HAUNT_DAILY_BUDGET_CENTS) || H.budget.dailyCents);
  return cents * 10_000;
}

/* ---------- limits / status ---------- */
export async function limitState(env, playerId, t = now()) {
  const L = H.limits;
  const dayStart = Date.parse(dayKey(t) + 'T00:00:00Z');
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?1 AND status IN ${ACTIVE} AND created_at > ?2) AS win,
       (SELECT MIN(created_at) FROM haunt_submissions WHERE player_id = ?1 AND status IN ${ACTIVE} AND created_at > ?2) AS win_oldest,
       (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?1 AND status IN ${ACTIVE} AND created_at >= ?3) AS today,
       (SELECT MAX(created_at) FROM haunt_submissions WHERE player_id = ?1 AND status IN ${ACTIVE}) AS last_at`)
    .bind(playerId, t - L.window.ms, dayStart).first();
  let state = 'ACTIVE', nextAt = null;
  if (r.today >= L.perDay) { state = 'DAILY_LIMIT'; nextAt = nextDayStart(t); }
  else if (r.win >= L.window.count) { state = 'COOLDOWN'; nextAt = r.win_oldest + L.window.ms; }
  else if (r.last_at && r.last_at + L.minGapMs > t) { state = 'COOLDOWN'; nextAt = r.last_at + L.minGapMs; }
  return { state, nextAt, window: { used: r.win, limit: L.window.count, minutes: L.window.ms / 60_000 }, today: { used: r.today, limit: L.perDay }, minGapMinutes: L.minGapMs / 60_000 };
}

/* ---------- submit ---------- */
export async function submit(env, player, body, ipKey) {
  if (!(await hauntEnabled(env))) throw new ApiError(503, 'HAUNT_CLOSED', 'THE HAUNT is closed for maintenance.');
  const checks = [];
  const ok = (key, detail) => checks.push({ key, label: CHECK_LABELS[key], ok: true, detail });
  // 1. URL syntax (no network)
  const parsed = parseStatusUrl(body && body.url);
  if (!parsed) throw new ApiError(400, 'INVALID_URL', REASONS.INVALID_URL);
  ok('URL', parsed.normalizedUrl);
  // 2. connected X account (immutable X user id)
  const xa = await xAccount(env, player.id);
  if (!xa) throw new ApiError(403, 'X_NOT_CONNECTED', REASONS.X_NOT_CONNECTED);
  ok('ACCOUNT', xa.username ? `@${xa.username}` : 'connected');
  // 3. duplicate status (DB)
  const dup = await env.DB.prepare('SELECT id, player_id FROM haunt_submissions WHERE x_status_id = ?').bind(parsed.id).first();
  if (dup) {
    if (dup.player_id === player.id) return { duplicateOf: dup.id, submission: await view(env, dup.id, player.id) };
    throw new ApiError(409, 'DUPLICATE_STATUS', REASONS.DUPLICATE_STATUS);
  }
  ok('DUPLICATE', 'new reply');
  // 4. technical abuse protection — before anything that can cost money
  await rateLimit(env, `hauntsubmit:${player.id}`, H.submitRate);
  await rateLimit(env, `hauntsubmitip:${ipKey}`, H.submitRatePerIp);
  // 5. target (system content, chosen by id — never derived from the user's URL)
  const targetId = Number(body && body.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    if (!H.discovered.enabled) throw new ApiError(400, 'TARGET_REQUIRED', REASONS.TARGET_REQUIRED);
  }
  const t = now();
  const target = await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(targetId).first();
  if (!target) throw new ApiError(404, 'TARGET_NOT_FOUND', REASONS.TARGET_NOT_FOUND);
  if (!target.active) throw new ApiError(409, 'TARGET_INACTIVE', REASONS.TARGET_INACTIVE);
  if (target.expires_at && target.expires_at <= t) throw new ApiError(409, 'TARGET_EXPIRED', REASONS.TARGET_EXPIRED);
  const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM haunt_submissions WHERE player_id = ? AND target_id = ? AND status IN ${ACTIVE}`).bind(player.id, target.id).first();
  if (mine.n >= H.limits.perTargetPerPlayer) throw new ApiError(409, 'TARGET_ALREADY_DONE', REASONS.TARGET_ALREADY_DONE);
  ok('TARGET', `HAUNT #${target.id}`);
  // 6. reward limits — atomic: the row is only inserted while the player is under every limit (multi-tab safe)
  const id = randomId('hs_', 16);
  const L = H.limits;
  const dayStart = Date.parse(dayKey(t) + 'T00:00:00Z');
  ok('LIMITS', 'within limits');
  let row;
  try {
    row = await env.DB.prepare(
      `INSERT INTO haunt_submissions (id, player_id, x_user_id, x_status_id, target_id, normalized_url, status, ip_key, checks_json, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'VERIFYING', ?7, ?8, ?9, ?9
       WHERE (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at > ?10) < ?11
         AND (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at >= ?12) < ?13
         AND NOT EXISTS (SELECT 1 FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at > ?14)
         AND (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND target_id = ?5 AND status IN ${ACTIVE}) < ?15
       RETURNING id`)
      .bind(id, player.id, xa.provider_user_id, parsed.id, target.id, parsed.normalizedUrl, ipKey, JSON.stringify(checks), t,
        t - L.window.ms, L.window.count, dayStart, L.perDay, t - L.minGapMs, L.perTargetPerPlayer).first();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'DUPLICATE_STATUS', REASONS.DUPLICATE_STATUS);
    throw e;
  }
  if (!row) {
    const st = await limitState(env, player.id, t);
    if (st.state === 'DAILY_LIMIT') throw new ApiError(429, 'DAILY_LIMIT', `You reached ${L.perDay} haunts today. The graveyard reopens at 00:00 UTC.`, { nextAt: st.nextAt });
    throw new ApiError(429, 'COOLDOWN', 'Cooldown active. Your next haunt can be claimed soon.', { nextAt: st.nextAt || t + L.minGapMs });
  }
  await verify(env, id);
  return { submission: await view(env, id, player.id) };
}

/* ---------- verification (submit + idempotent retries) ---------- */
export async function verify(env, submissionId, fetchImpl) {
  const sub = await env.DB.prepare('SELECT * FROM haunt_submissions WHERE id = ?').bind(submissionId).first();
  if (!sub || !['VERIFYING', 'VERIFICATION_PENDING'].includes(sub.status)) return sub;
  const target = sub.target_id ? await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(sub.target_id).first() : null;
  const checks = JSON.parse(sub.checks_json || '[]').filter(c => !['POST', 'AUTHOR', 'REPLY', 'CONTEXT', 'TIMING', 'CONTENT', 'ORIGINALITY', 'CAPACITY', 'CRYPTO'].includes(c.key));
  const t = now();
  const add = (key, okv, detail) => checks.push({ key, label: CHECK_LABELS[key], ok: okv, detail });
  const reject = (reason, extra = {}) => finish(env, sub, 'AUTO_REJECTED', reason, checks, extra);

  if (!target) return reject('TARGET_NOT_FOUND');
  // cost guard: over budget → queue (never award unverified, never punish)
  if (!xConfigured(env) || (await todayCostMicros(env)) + H.costMicros.postRead > (await budgetMicros(env))) {
    return pending(env, sub, checks, xConfigured(env) ? 'BUDGET_PAUSED' : 'VERIFICATION_PENDING', t + 60 * 60_000);
  }
  let tw;
  try { tw = await fetchTweet(env, sub.x_status_id, fetchImpl ? { fetchImpl } : {}); }
  catch (e) {
    if (e instanceof XNotFound) { add('POST', false, 'not found'); return reject('STATUS_NOT_FOUND'); }
    if (e instanceof XUnavailable) { add('POST', false, e.code); return pending(env, sub, checks, 'VERIFICATION_PENDING', t + H.retry.baseMs * 2 ** sub.attempts, e.code); }
    throw e;
  }
  const d = tw.data;
  add('POST', true, `status ${d.id}`);
  const evidence = {
    reply_author_id: d.author_id || null, conversation_id: d.conversation_id || null,
    parent_status_id: (d.referenced_tweets || []).find(r => r.type === 'replied_to')?.id || null,
    reply_created_at: d.created_at ? Date.parse(d.created_at) : null,
    text_excerpt: String(d.text || '').slice(0, 280), content_fingerprint: fingerprint(d.text),
  };
  // WHO
  if (d.author_id !== sub.x_user_id) { add('AUTHOR', false, `author ${d.author_id} ≠ connected ${sub.x_user_id}`); return reject('AUTHOR_MISMATCH', evidence); }
  add('AUTHOR', true, `author ${d.author_id}`);
  // WHERE
  if (!evidence.parent_status_id) { add('REPLY', false, 'no replied_to reference'); return reject('NOT_A_REPLY', evidence); }
  add('REPLY', true, `reply to ${evidence.parent_status_id}`);
  const targetConv = target.conversation_id || target.x_status_id;
  if (evidence.parent_status_id !== target.x_status_id && d.conversation_id !== targetConv) {
    add('CONTEXT', false, `parent ${evidence.parent_status_id} / conversation ${d.conversation_id} ≠ HAUNT #${target.id}`);
    return reject('WRONG_TARGET', evidence);
  }
  add('CONTEXT', true, `HAUNT #${target.id} (${evidence.parent_status_id === target.x_status_id ? 'direct reply' : 'same thread'})`);
  // WHEN
  if (evidence.reply_created_at && evidence.reply_created_at < target.created_at - 120_000) { add('TIMING', false, 'posted before the Haunt opened'); return reject('REPLY_BEFORE_HAUNT', evidence); }
  if (evidence.reply_created_at && sub.created_at - evidence.reply_created_at > H.reply.maxAgeMs) { add('TIMING', false, 'too old'); return reject('REPLY_TOO_OLD', evidence); }
  add('TIMING', true, d.created_at || 'ok');
  // WHAT
  const c = checkReplyContent(d.text);
  if (!c.ok) { add('CONTENT', false, `${cleanReply(d.text).length} chars`); return reject(c.reason, evidence); }
  add('CONTENT', true, 'natural reply');
  const fp = evidence.content_fingerprint;
  const own = await env.DB.prepare("SELECT COUNT(*) AS n FROM haunt_submissions WHERE player_id = ? AND content_fingerprint = ? AND status = 'AUTO_APPROVED' AND created_at > ?")
    .bind(sub.player_id, fp, t - H.reply.maxDuplicatesPerPlayerDays * 86400_000).first();
  if (own.n > 0) { add('ORIGINALITY', false, 'same text used before'); return reject('DUPLICATE_CONTENT', evidence); }
  const others = await env.DB.prepare("SELECT COUNT(DISTINCT player_id) AS n FROM haunt_submissions WHERE content_fingerprint = ? AND status = 'AUTO_APPROVED' AND player_id != ? AND created_at > ?")
    .bind(fp, sub.player_id, t - 86400_000).first();
  if (others.n >= H.reply.maxSameTextAcrossPlayers24h - 1) { add('ORIGINALITY', false, `${others.n} other players used this text`); return reject('COPY_PASTE', evidence); }
  add('ORIGINALITY', true, 'original');
  // capacity (curated cap)
  if (target.max_submissions) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM haunt_submissions WHERE target_id = ? AND status = 'AUTO_APPROVED'").bind(target.id).first();
    if (n.n >= target.max_submissions) { add('CAPACITY', false, 'full'); return reject('TARGET_FULL', evidence); }
  }
  add('CRYPTO', true, target.kind === 'CURATED' ? `curated ${target.category}` : 'scored');
  // APPROVE: reward is looked up server-side from the target
  const reward = Math.max(0, Math.min(H.maxReward, target.reward));
  return approve(env, sub, target, reward, checks, evidence);
}

async function finish(env, sub, status, reason, checks, evidence = {}) {
  const t = now();
  await env.DB.prepare(
    `UPDATE haunt_submissions SET status = ?, reason = ?, checks_json = ?, reply_author_id = COALESCE(?, reply_author_id), parent_status_id = COALESCE(?, parent_status_id),
       conversation_id = COALESCE(?, conversation_id), reply_created_at = COALESCE(?, reply_created_at), text_excerpt = COALESCE(?, text_excerpt),
       content_fingerprint = COALESCE(?, content_fingerprint), verified_at = ?, updated_at = ?, attempts = attempts + 1, next_retry_at = NULL
     WHERE id = ? AND status IN ('VERIFYING','VERIFICATION_PENDING')`)
    .bind(status, reason, JSON.stringify(checks), evidence.reply_author_id ?? null, evidence.parent_status_id ?? null, evidence.conversation_id ?? null,
      evidence.reply_created_at ?? null, evidence.text_excerpt ?? null, evidence.content_fingerprint ?? null, t, t, sub.id).run();
  return { status, reason };
}

async function pending(env, sub, checks, reason, retryAt, detail) {
  const t = now();
  const giveUp = sub.attempts + 1 >= H.retry.maxAttempts;
  await env.DB.prepare(
    `UPDATE haunt_submissions SET status = ?, reason = ?, checks_json = ?, attempts = attempts + 1, next_retry_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('VERIFYING','VERIFICATION_PENDING')`)
    .bind(giveUp ? 'MANUAL_REVIEW' : 'VERIFICATION_PENDING', giveUp ? 'MAX_RETRIES' : reason, JSON.stringify(checks), giveUp ? null : retryAt, t, sub.id).run();
  if (detail) console.warn('haunt_pending', sub.id, detail);
  return { status: 'VERIFICATION_PENDING', reason };
}

async function approve(env, sub, target, reward, checks, evidence) {
  const t = now();
  const ref = `haunt:${sub.id}`;
  const cond = "EXISTS (SELECT 1 FROM haunt_submissions WHERE id = ? AND status IN ('VERIFYING','VERIFICATION_PENDING'))";
  try {
    await env.DB.batch([
      // 1) ledger row — UNIQUE reference makes a second award impossible (whole batch rolls back)
      env.DB.prepare(
        `INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at, source_type, source_id, currency)
         SELECT ?, NULL, 'haunt', ?, ?, ?, ?, ?, ?, ? WHERE ${cond}`)
        .bind(sub.player_id, reward, `THE HAUNT #${target.id} (X reply)`, ref, t, H.sourceType, sub.id, H.currency, sub.id),
      // 2) player caches, only if the ledger row was written in this batch
      env.DB.prepare(
        `UPDATE players SET haunt_xp = haunt_xp + ?, xp = xp + ?, haunt_count = haunt_count + 1, haunt_last_at = ?, last_seen_at = ?
         WHERE id = ? AND ${cond} AND EXISTS (SELECT 1 FROM point_transactions WHERE reference_id = ?)`)
        .bind(reward, reward, t, t, sub.player_id, sub.id, ref),
      // 3) submission state + evidence
      env.DB.prepare(
        `UPDATE haunt_submissions SET status = 'AUTO_APPROVED', reason = NULL, points_awarded = ?, checks_json = ?, reply_author_id = ?, parent_status_id = ?,
           conversation_id = ?, reply_created_at = ?, text_excerpt = ?, content_fingerprint = ?, verified_at = ?, updated_at = ?, attempts = attempts + 1, next_retry_at = NULL
         WHERE id = ? AND status IN ('VERIFYING','VERIFICATION_PENDING')`)
        .bind(reward, JSON.stringify(checks), evidence.reply_author_id, evidence.parent_status_id, evidence.conversation_id, evidence.reply_created_at,
          evidence.text_excerpt, evidence.content_fingerprint, t, t, sub.id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'AUTO_APPROVED', reason: null, replay: true };
    throw e;
  }
  // level (cosmetic) — same curve as the Arcade
  const p = await env.DB.prepare('SELECT xp, level FROM players WHERE id = ?').bind(sub.player_id).first();
  const lvl = levelForXp(p.xp);
  if (lvl !== p.level) await env.DB.prepare('UPDATE players SET level = ? WHERE id = ?').bind(lvl, sub.player_id).run();
  return { status: 'AUTO_APPROVED', points: reward };
}

/* Cron: idempotent retries of queued verifications. */
export async function retryPending(env) {
  const { results } = await env.DB.prepare("SELECT id FROM haunt_submissions WHERE status = 'VERIFICATION_PENDING' AND next_retry_at <= ? ORDER BY next_retry_at LIMIT ?")
    .bind(now(), H.retry.batch).all();
  for (const r of results) { try { await verify(env, r.id); } catch (e) { console.error('haunt_retry', r.id, e.message); } }
  return results.length;
}

/* ---------- read models ---------- */
export async function view(env, id, playerId) {
  const s = await env.DB.prepare('SELECT * FROM haunt_submissions WHERE id = ? AND player_id = ?').bind(id, playerId).first();   // IDOR: own only
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Submission not found.');
  return {
    id: s.id, status: s.status, reason: s.reason, message: s.reason ? REASONS[s.reason] || s.reason : null,
    points: s.points_awarded, targetId: s.target_id, url: s.normalized_url,
    checks: JSON.parse(s.checks_json || '[]').map(c => ({ key: c.key, label: c.label, ok: c.ok })),
    createdAt: s.created_at, verifiedAt: s.verified_at, nextRetryAt: s.next_retry_at,
  };
}

export async function targetsFor(env, player) {
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.url, t.author_username, t.category, t.reward, t.expires_at, t.max_submissions, t.text_preview, t.created_at,
       (SELECT COUNT(*) FROM haunt_submissions s WHERE s.target_id = t.id AND s.status = 'AUTO_APPROVED') AS claims
     FROM haunt_targets t WHERE t.active = 1 AND (t.expires_at IS NULL OR t.expires_at > ?) ORDER BY t.created_at DESC LIMIT ?`)
    .bind(t, H.targets.maxPerPage).all();
  let mine = {};
  if (player) {
    const { results: m } = await env.DB.prepare(`SELECT target_id, status FROM haunt_submissions WHERE player_id = ? AND status IN ${ACTIVE} AND target_id IS NOT NULL`).bind(player.id).all();
    mine = Object.fromEntries(m.map(x => [x.target_id, x.status]));
  }
  return results.map(r => ({
    id: r.id, url: r.url, author: r.author_username, category: r.category, reward: r.reward, expiresAt: r.expires_at, openedAt: r.created_at,
    preview: r.text_preview, claims: r.claims, maxClaims: r.max_submissions, full: !!(r.max_submissions && r.claims >= r.max_submissions),
    mine: mine[r.id] || null,
  }));
}

export async function playerStatus(env, player) {
  const p = await env.DB.prepare('SELECT haunt_xp, haunt_count, haunt_last_at, kind, name_set_at, status FROM players WHERE id = ?').bind(player.id).first();
  const rank = p.haunt_xp > 0 ? (await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM players p WHERE ${RANKED} AND p.haunt_xp > ?1 OR (${RANKED} AND p.haunt_xp = ?1 AND p.haunt_last_at < ?2)`)
    .bind(p.haunt_xp, p.haunt_last_at ?? 0).first()).r : null;
  const xa = await xAccount(env, player.id);
  const lim = await limitState(env, player.id);
  const { results: recent } = await env.DB.prepare('SELECT id FROM haunt_submissions WHERE player_id = ? ORDER BY created_at DESC LIMIT 8').bind(player.id).all();
  return {
    xp: p.haunt_xp, haunts: p.haunt_count, rank, today: lim.today, window: lim.window, state: lim.state, nextAt: lim.nextAt, minGapMinutes: lim.minGapMinutes,
    x: xa ? { connected: true, username: xa.username } : { connected: false },
    submissions: await Promise.all(recent.map(r => view(env, r.id, player.id))),
  };
}

function rangeStart(range, t = now()) {
  if (range === 'today') return Date.parse(dayKey(t) + 'T00:00:00Z');
  if (range === 'week') { const d = new Date(Date.parse(dayKey(t) + 'T00:00:00Z')); const dow = (d.getUTCDay() + 6) % 7; return d.getTime() - dow * 86400_000; }  // Monday 00:00 UTC
  return 0;
}
export async function leaderboard(env, player, range) {
  const size = 100;
  let rows;
  if (range === 'all') {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.display_name, p.haunt_xp AS xp, p.haunt_count AS haunts FROM players p WHERE ${RANKED} AND p.haunt_xp > 0
       ORDER BY p.haunt_xp DESC, p.haunt_last_at ASC, p.id ASC LIMIT ?`).bind(size).all();
    rows = results;
  } else {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.display_name, SUM(s.points_awarded) AS xp, COUNT(*) AS haunts, MAX(s.verified_at) AS last
       FROM haunt_submissions s JOIN players p ON p.id = s.player_id
       WHERE s.status = 'AUTO_APPROVED' AND s.verified_at >= ? AND ${RANKED}
       GROUP BY p.id ORDER BY xp DESC, last ASC, p.id ASC LIMIT ?`).bind(rangeStart(range), size).all();
    rows = results;
  }
  return { range, rows: rows.map((r, i) => ({ rank: i + 1, name: r.display_name, xp: r.xp, haunts: r.haunts, me: !!player && r.id === player.id })) };
}

export async function activity(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.display_name, s.target_id, s.points_awarded, s.verified_at FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     WHERE s.status = 'AUTO_APPROVED' AND ${RANKED} ORDER BY s.verified_at DESC LIMIT 20`).all();
  return results.map(r => ({ name: r.display_name, targetId: r.target_id, xp: r.points_awarded, at: r.verified_at }));
}

/* ---------- admin ---------- */
export async function adminCreateTarget(env, actor, body) {
  const parsed = parseStatusUrl(body.url);
  if (!parsed) throw new ApiError(400, 'INVALID_URL', 'Paste the link of the X post to raid.');
  const category = String(body.category || '').trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9 /&.\-]{2,40}$/.test(category)) throw new ApiError(400, 'BAD_CATEGORY', 'Category: 2–40 letters (e.g. SOLANA / MEMECOINS).');
  const reward = body.reward == null || body.reward === '' ? H.defaultReward : Number(body.reward);
  if (!Number.isInteger(reward) || reward < 1 || reward > H.maxReward) throw new ApiError(400, 'BAD_REWARD', `Reward must be 1–${H.maxReward}.`);
  const mins = body.expiresInMinutes == null || body.expiresInMinutes === '' ? H.targets.defaultExpiryMin : Number(body.expiresInMinutes);
  if (!Number.isInteger(mins) || mins < 0 || mins > 60 * 24 * 30) throw new ApiError(400, 'BAD_EXPIRY', 'Expiry: 0 (never) to 43200 minutes.');
  const max = body.maxSubmissions == null || body.maxSubmissions === '' ? null : Number(body.maxSubmissions);
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 100000)) throw new ApiError(400, 'BAD_MAX', 'Max claims must be a positive number.');
  // verify the target through X (cached so re-adding/editing does not pay twice)
  let tw;
  try { tw = await fetchTweet(env, parsed.id, { expandAuthor: true, cacheTtlMs: H.cacheTtlMs.target }); }
  catch (e) {
    if (e instanceof XNotFound) throw new ApiError(404, 'STATUS_NOT_FOUND', 'X cannot find this post.');
    if (e instanceof XUnavailable) throw new ApiError(503, e.code, e.code === 'X_NOT_CONFIGURED' ? 'X API is not configured (X_BEARER_TOKEN).' : `X API unavailable (${e.code}).`);
    throw e;
  }
  const d = tw.data, author = (tw.includes.users || []).find(u => u.id === d.author_id) || {};
  const t = now();
  try {
    const r = await env.DB.prepare(
      `INSERT INTO haunt_targets (kind, x_status_id, url, author_id, author_username, conversation_id, posted_at, text_preview, category, reward, max_submissions, active, created_by, created_at, expires_at, updated_at, evidence_json)
       VALUES ('CURATED',?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?) RETURNING id`)
      .bind(d.id, `https://x.com/${author.username || 'i'}/status/${d.id}`, d.author_id, author.username || null, d.conversation_id || d.id,
        d.created_at ? Date.parse(d.created_at) : null, String(d.text || '').slice(0, 280), category, reward, max, actor, t, mins ? t + mins * 60_000 : null, t,
        JSON.stringify({ metrics: d.public_metrics || null, followers: author.public_metrics?.followers_count ?? null })).first();
    await auditStmt(env, actor, 'haunt.target.create', String(r.id), { statusId: d.id, author: author.username, category, reward, mins, max }).run();
    return { id: r.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'TARGET_EXISTS', 'This post is already a Haunt.');
    throw e;
  }
}

export async function adminUpdateTarget(env, actor, id, body) {
  const tg = await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(id).first();
  if (!tg) throw new ApiError(404, 'NOT_FOUND', 'Target not found.');
  const active = body.active == null ? tg.active : (body.active ? 1 : 0);
  const reward = body.reward == null ? tg.reward : Number(body.reward);
  if (!Number.isInteger(reward) || reward < 0 || reward > H.maxReward) throw new ApiError(400, 'BAD_REWARD', 'Invalid reward.');
  let expires = tg.expires_at;
  if (body.expiresInMinutes !== undefined) { const m = Number(body.expiresInMinutes); if (!Number.isInteger(m) || m < 0) throw new ApiError(400, 'BAD_EXPIRY', 'Invalid expiry.'); expires = m ? now() + m * 60_000 : null; }
  const max = body.maxSubmissions === undefined ? tg.max_submissions : (body.maxSubmissions === null || body.maxSubmissions === '' ? null : Number(body.maxSubmissions));
  await env.DB.batch([
    env.DB.prepare('UPDATE haunt_targets SET active = ?, reward = ?, expires_at = ?, max_submissions = ?, updated_at = ? WHERE id = ?').bind(active, reward, expires, max, now(), id),
    auditStmt(env, actor, 'haunt.target.update', String(id), { before: { active: tg.active, reward: tg.reward, expires: tg.expires_at, max: tg.max_submissions }, after: { active, reward, expires, max } }),
  ]);
  return { ok: true };
}

/* Revoke an approved (fraudulent) haunt: reversing ledger entry + caches; history is kept. */
export async function adminInvalidate(env, actor, id, reason) {
  const s = await env.DB.prepare('SELECT * FROM haunt_submissions WHERE id = ?').bind(id).first();
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Submission not found.');
  if (s.status === 'INVALIDATED') throw new ApiError(409, 'ALREADY_INVALIDATED', 'Already invalidated.');
  const t = now();
  const stmts = [
    env.DB.prepare("UPDATE haunt_submissions SET status = 'INVALIDATED', reason = ?, updated_at = ? WHERE id = ? AND status != 'INVALIDATED'").bind(`INVALIDATED: ${reason}`.slice(0, 200), t, id),
    auditStmt(env, actor, 'haunt.submission.invalidate', id, { previous: s.status, points: s.points_awarded, reason }),
  ];
  if (s.status === 'AUTO_APPROVED' && s.points_awarded > 0) {
    stmts.unshift(
      env.DB.prepare(`INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at, source_type, source_id, currency)
        VALUES (?, NULL, 'haunt', ?, ?, ?, ?, 'HAUNT_INVALIDATION', ?, ?)`).bind(s.player_id, -s.points_awarded, `Invalidated: ${reason}`.slice(0, 200), `haunt-void:${id}`, t, id, H.currency),
      env.DB.prepare('UPDATE players SET haunt_xp = MAX(0, haunt_xp - ?), xp = MAX(0, xp - ?), haunt_count = MAX(0, haunt_count - 1) WHERE id = ?').bind(s.points_awarded, s.points_awarded, s.player_id),
    );
  }
  try { await env.DB.batch(stmts); } catch (e) { if (isUniqueViolation(e)) throw new ApiError(409, 'ALREADY_INVALIDATED', 'Already invalidated.'); throw e; }
  return { ok: true };
}

export async function adminRetry(env, actor, id) {
  const r = await env.DB.prepare("UPDATE haunt_submissions SET status = 'VERIFICATION_PENDING', next_retry_at = ?, attempts = 0 WHERE id = ? AND status IN ('VERIFICATION_PENDING','MANUAL_REVIEW') RETURNING id").bind(now(), id).first();
  if (!r) throw new ApiError(409, 'NOT_RETRYABLE', 'Only pending / manual-review submissions can be retried.');
  await auditStmt(env, actor, 'haunt.submission.retry', id, {}).run();
  await verify(env, id);
  return { ok: true };
}

export async function adminOverview(env, url) {
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  const where = []; const binds = [];
  if (status) { where.push('s.status = ?'); binds.push(status); }
  if (q) { where.push('(s.player_id = ? OR p.display_name LIKE ? OR s.x_status_id = ?)'); binds.push(q, `%${q}%`, q); }
  const { results: submissions } = await env.DB.prepare(
    `SELECT s.id, s.player_id, p.display_name, s.x_user_id, s.x_status_id, s.normalized_url, s.target_id, s.status, s.reason, s.points_awarded, s.text_excerpt,
       s.checks_json, s.attempts, s.created_at, s.verified_at FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC LIMIT 100`).bind(...binds).all();
  const { results: targets } = await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM haunt_submissions s WHERE s.target_id = t.id AND s.status = 'AUTO_APPROVED') AS claims FROM haunt_targets t ORDER BY t.id DESC LIMIT 100`).all();
  const { results: suspicious } = await env.DB.prepare(
    `SELECT s.player_id, p.display_name, COUNT(*) AS rejected, GROUP_CONCAT(DISTINCT s.reason) AS reasons FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     WHERE s.status = 'AUTO_REJECTED' AND s.created_at > ? AND s.reason IN ('AUTHOR_MISMATCH','COPY_PASTE','DUPLICATE_CONTENT','WRONG_TARGET','REPLY_BEFORE_HAUNT')
     GROUP BY s.player_id HAVING COUNT(*) >= 3 ORDER BY rejected DESC LIMIT 25`).bind(now() - 86400_000).all();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM haunt_submissions WHERE created_at > ? GROUP BY status').bind(now() - 86400_000).all();
  const { results: usage } = await env.DB.prepare('SELECT * FROM x_api_usage ORDER BY day DESC, endpoint LIMIT 42').all();
  return { submissions, targets, suspicious, last24h: counts, usage, todayCostMicros: await todayCostMicros(env), budgetMicros: await budgetMicros(env), xConfigured: xConfigured(env) };
}
