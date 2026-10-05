/* THE HAUNT — submission engine.
   SUBMISSION → TYPE ROUTER (X_REPLY | X_POST | X_MEME | TIKTOK_POST) → provider verifier → shared anti-abuse
   → eligibility → reward engine (server-side reward lookup) → ledger → history.
   Cheap local checks run first (URL/platform, account, duplicate, technical rate limit, target, reward limits,
   budget); only then ONE paid X read (TikTok uses the free public oEmbed). Every decision is stored with its checks. */
import { CONFIG, levelForXp } from '../config.js';
import { ApiError, now, randomId, isUniqueViolation, dayKey, nextDayStart } from '../lib/util.js';
import { rateLimit, auditStmt, loadSettings } from '../lib/platform.js';
import { RANKED } from '../lib/seasons.js';
import { fetchTweet, todayCostMicros, xConfigured, XNotFound, XUnavailable } from './xclient.js';
import { parseStatusUrl, parseTikTokUrl, isShortTikTok } from './content.js';
import * as XReply from './providers/x-reply.js';
import * as XPost from './providers/x-post.js';
import * as TikTok from './providers/tiktok.js';

const H = CONFIG.haunt;
export const TYPES = Object.keys(H.types);
const ACTIVE = "('VERIFYING','VERIFICATION_PENDING','AUTO_APPROVED','MANUAL_REVIEW','MANUAL_APPROVED')";
export const APPROVED = "('AUTO_APPROVED','MANUAL_APPROVED')";
const PROVIDERS = {
  X_REPLY: XReply.verify,
  X_POST: XPost.makeVerifier('X_POST'),
  X_MEME: XPost.makeVerifier('X_MEME'),
  TIKTOK_POST: TikTok.verify,
};

export const REASONS = {
  INVALID_URL: 'That is not a valid link for this type. Copy the link of YOUR post (Share → Copy link).',
  WRONG_PLATFORM: 'This link is from another platform than the type you selected.',
  TIKTOK_SHORT_LINK: 'Open the short TikTok link first and paste the full tiktok.com/@you/video/… link.',
  BAD_TYPE: 'Choose what you created: X reply, X post, X meme or TikTok.',
  X_NOT_CONNECTED: 'Connect your X account first.',
  DUPLICATE_STATUS: 'This post was already submitted.',
  TARGET_REQUIRED: 'Pick a Haunt first.',
  TARGET_NOT_FOUND: 'This Haunt does not exist.',
  TARGET_INACTIVE: 'This Haunt is closed.',
  TARGET_EXPIRED: 'This Haunt has expired.',
  TARGET_FULL: 'This Haunt reached its maximum number of claims.',
  TARGET_ALREADY_DONE: 'You already completed this Haunt. Pick another one.',
  STATUS_NOT_FOUND: 'X could not find this post. Is it deleted or from a protected account?',
  AUTHOR_MISMATCH: 'This post belongs to a different X account than the one you connected.',
  NOT_A_REPLY: 'This post is not a reply. Reply to the Haunt target on X and submit that reply.',
  WRONG_TARGET: 'This reply is not under the selected Haunt.',
  REPLY_BEFORE_HAUNT: 'This reply was posted before the Haunt opened.',
  REPLY_TOO_OLD: 'This reply is too old to claim.',
  POST_TOO_OLD: 'This post is too old to claim (max 48 hours).',
  IS_REPOST: 'Reposts do not count. Post something of your own.',
  IS_A_REPLY: 'This is a reply — submit it as X REPLY under a Haunt.',
  NO_MEDIA: 'No image, GIF or video found on this post. Memes need media.',
  NOT_ABOUT_HALLOWINU: 'Mention HALLOWINU, $HALLOWINU or @HIonchains so the pack knows it is about us.',
  CONTENT_TOO_SHORT: 'Write a real post — a few words at least, not just tags or links.',
  DUPLICATE_CONTENT: 'You already used this exact text. Write something new.',
  COPY_PASTE: 'This exact text is being copy-pasted by several players. Write your own.',
  VIDEO_NOT_FOUND: 'TikTok could not find this video (deleted or private).',
  CREATOR_MISMATCH: 'The video belongs to a different TikTok account than the link says.',
  TIKTOK_OWNERSHIP_REVIEW: 'Video found! TikTok accounts cannot be verified automatically yet — the team reviews it and awards the XP.',
  VERIFICATION_PENDING: 'The platform is busy right now. Your haunt is queued and checked automatically — no XP is lost.',
  BUDGET_PAUSED: 'Verification is paused for a moment. Your haunt is queued and will be checked automatically.',
  MAX_RETRIES: 'The platform could not be reached for a while. The team will review this haunt.',
  TYPE_DAILY_LIMIT: 'Daily limit for this type reached. Try another type or come back tomorrow.',
};

const CHECK_LABELS = {
  TYPE_SELECT: 'Checking type', URL: 'Checking link', ACCOUNT: 'Checking connected account', DUPLICATE: 'Checking duplicates', TARGET: 'Checking Haunt',
  LIMITS: 'Checking haunt limits', POST: 'Checking post', AUTHOR: 'Checking author', REPLY: 'Checking reply', CONTEXT: 'Checking target', TYPE: 'Checking post type',
  MEDIA: 'Checking media', TIMING: 'Checking time', CONTENT: 'Checking content', PROJECT: 'Checking HALLOWINU relevance', ORIGINALITY: 'Checking originality',
  CAPACITY: 'Checking Haunt capacity', CRYPTO: 'Checking crypto context', OWNERSHIP: 'Checking account ownership',
};
const PROVIDER_KEYS = ['POST', 'AUTHOR', 'REPLY', 'CONTEXT', 'TYPE', 'MEDIA', 'TIMING', 'CONTENT', 'PROJECT', 'ORIGINALITY', 'CAPACITY', 'CRYPTO', 'OWNERSHIP'];

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
  const { results: perType } = await env.DB.prepare(`SELECT submission_type AS t, COUNT(*) AS n FROM haunt_submissions WHERE player_id = ? AND status IN ${ACTIVE} AND created_at >= ? GROUP BY submission_type`).bind(playerId, dayStart).all();
  const used = Object.fromEntries(perType.map(x => [x.t, x.n]));
  let state = 'ACTIVE', nextAt = null;
  if (r.today >= L.perDay) { state = 'DAILY_LIMIT'; nextAt = nextDayStart(t); }
  else if (r.win >= L.window.count) { state = 'COOLDOWN'; nextAt = r.win_oldest + L.window.ms; }
  else if (r.last_at && r.last_at + L.minGapMs > t) { state = 'COOLDOWN'; nextAt = r.last_at + L.minGapMs; }
  return {
    state, nextAt, window: { used: r.win, limit: L.window.count, minutes: L.window.ms / 60_000 }, today: { used: r.today, limit: L.perDay }, minGapMinutes: L.minGapMs / 60_000,
    types: Object.fromEntries(TYPES.map(k => [k, { used: used[k] || 0, limit: H.types[k].perDay }])),
  };
}

/* ---------- submit (type router + cheap checks) ---------- */
export async function submit(env, player, body, ipKey) {
  if (!(await hauntEnabled(env))) throw new ApiError(503, 'HAUNT_CLOSED', 'THE HAUNT is closed for maintenance.');
  const type = body && body.type == null ? 'X_REPLY' : body && body.type;   // v1 clients sent no type (= X reply)
  const T = H.types[type];
  if (!T) throw new ApiError(400, 'BAD_TYPE', REASONS.BAD_TYPE);
  const checks = [];
  const ok = (key, detail) => checks.push({ key, label: CHECK_LABELS[key], ok: true, detail });
  ok('TYPE_SELECT', T.label);
  // 1. URL + platform (no network). A link from the other platform is rejected before anything else.
  const raw = body && body.url;
  let parsed;
  if (T.platform === 'X') {
    parsed = parseStatusUrl(raw);
    if (!parsed) throw new ApiError(400, parseTikTokUrl(raw) || isShortTikTok(raw) ? 'WRONG_PLATFORM' : 'INVALID_URL', parseTikTokUrl(raw) || isShortTikTok(raw) ? REASONS.WRONG_PLATFORM : REASONS.INVALID_URL);
  } else {
    if (isShortTikTok(raw)) throw new ApiError(400, 'TIKTOK_SHORT_LINK', REASONS.TIKTOK_SHORT_LINK);
    parsed = parseTikTokUrl(raw);
    if (!parsed) throw new ApiError(400, parseStatusUrl(raw) ? 'WRONG_PLATFORM' : 'INVALID_URL', parseStatusUrl(raw) ? REASONS.WRONG_PLATFORM : REASONS.INVALID_URL);
  }
  ok('URL', parsed.normalizedUrl);
  // 2. connected account (X types: immutable X user id)
  let xa = null;
  if (T.platform === 'X') {
    xa = await xAccount(env, player.id);
    if (!xa) throw new ApiError(403, 'X_NOT_CONNECTED', REASONS.X_NOT_CONNECTED);
    ok('ACCOUNT', xa.username ? `@${xa.username}` : 'connected');
  } else ok('ACCOUNT', 'TikTok creator checked against the link');
  // 3. duplicate (DB) — per platform
  const dup = await env.DB.prepare('SELECT id, player_id FROM haunt_submissions WHERE platform = ? AND external_id = ?').bind(T.platform, parsed.id).first();
  if (dup) {
    if (dup.player_id === player.id) return { duplicateOf: dup.id, submission: await view(env, dup.id, player.id) };
    throw new ApiError(409, 'DUPLICATE_STATUS', REASONS.DUPLICATE_STATUS);
  }
  ok('DUPLICATE', 'new');
  // 4. technical abuse protection — before anything that can cost money
  await rateLimit(env, `hauntsubmit:${player.id}`, H.submitRate);
  await rateLimit(env, `hauntsubmitip:${ipKey}`, H.submitRatePerIp);
  // 5. target (system content, chosen by id — only for replies)
  const t = now();
  let target = null;
  if (T.needsTarget) {
    const targetId = Number(body && body.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new ApiError(400, 'TARGET_REQUIRED', REASONS.TARGET_REQUIRED);
    target = await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(targetId).first();
    if (!target) throw new ApiError(404, 'TARGET_NOT_FOUND', REASONS.TARGET_NOT_FOUND);
    if (!target.active) throw new ApiError(409, 'TARGET_INACTIVE', REASONS.TARGET_INACTIVE);
    if (target.expires_at && target.expires_at <= t) throw new ApiError(409, 'TARGET_EXPIRED', REASONS.TARGET_EXPIRED);
    const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM haunt_submissions WHERE player_id = ? AND target_id = ? AND status IN ${ACTIVE}`).bind(player.id, target.id).first();
    if (mine.n >= H.limits.perTargetPerPlayer) throw new ApiError(409, 'TARGET_ALREADY_DONE', REASONS.TARGET_ALREADY_DONE);
    ok('TARGET', `HAUNT #${target.id}`);
  }
  // 6. reward limits — atomic: inserted only while under EVERY limit (multi-tab / parallel safe)
  const id = randomId('hs_', 16);
  const L = H.limits;
  const dayStart = Date.parse(dayKey(t) + 'T00:00:00Z');
  ok('LIMITS', 'within limits');
  let row;
  try {
    row = await env.DB.prepare(
      `INSERT INTO haunt_submissions (id, player_id, platform, external_id, submission_type, x_user_id, x_status_id, author_handle, target_id, normalized_url, status, ip_key, checks_json, created_at, updated_at)
       SELECT ?1, ?2, ?16, ?4, ?17, ?3, ?18, ?19, ?5, ?6, 'VERIFYING', ?7, ?8, ?9, ?9
       WHERE (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at > ?10) < ?11
         AND (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at >= ?12) < ?13
         AND NOT EXISTS (SELECT 1 FROM haunt_submissions WHERE player_id = ?2 AND status IN ${ACTIVE} AND created_at > ?14)
         AND (?5 IS NULL OR (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND target_id = ?5 AND status IN ${ACTIVE}) < ?15)
         AND (SELECT COUNT(*) FROM haunt_submissions WHERE player_id = ?2 AND submission_type = ?17 AND status IN ${ACTIVE} AND created_at >= ?12) < ?20
       RETURNING id`)
      .bind(id, player.id, xa ? xa.provider_user_id : null, parsed.id, target ? target.id : null, parsed.normalizedUrl, ipKey, JSON.stringify(checks), t,
        t - L.window.ms, L.window.count, dayStart, L.perDay, t - L.minGapMs, L.perTargetPerPlayer,
        T.platform, type, T.platform === 'X' ? parsed.id : null, parsed.handle || null, T.perDay).first();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'DUPLICATE_STATUS', REASONS.DUPLICATE_STATUS);
    throw e;
  }
  if (!row) {
    const st = await limitState(env, player.id, t);
    if (st.state === 'DAILY_LIMIT') throw new ApiError(429, 'DAILY_LIMIT', `You reached ${L.perDay} haunts today. The graveyard reopens at 00:00 UTC.`, { nextAt: st.nextAt });
    if (st.state === 'COOLDOWN') throw new ApiError(429, 'COOLDOWN', 'Cooldown active. Your next haunt can be claimed soon.', { nextAt: st.nextAt || t + L.minGapMs });
    if (st.types[type].used >= st.types[type].limit) throw new ApiError(429, 'TYPE_DAILY_LIMIT', `${T.label}: ${T.perDay} per day reached. Try another type or come back tomorrow.`, { nextAt: nextDayStart(t) });
    throw new ApiError(409, 'TARGET_ALREADY_DONE', REASONS.TARGET_ALREADY_DONE);
  }
  await verify(env, id);
  return { submission: await view(env, id, player.id) };
}

/* ---------- verification (submit + idempotent retries) ---------- */
export async function verify(env, submissionId, fetchImpl) {
  const sub = await env.DB.prepare('SELECT * FROM haunt_submissions WHERE id = ?').bind(submissionId).first();
  if (!sub || !['VERIFYING', 'VERIFICATION_PENDING'].includes(sub.status)) return sub;
  const T = H.types[sub.submission_type];
  const target = sub.target_id ? await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(sub.target_id).first() : null;
  const checks = JSON.parse(sub.checks_json || '[]').filter(c => !PROVIDER_KEYS.includes(c.key));
  const t = now();
  const add = (key, okv, detail) => checks.push({ key, label: CHECK_LABELS[key], ok: okv, detail });
  // cost guard for paid X reads (TikTok oEmbed is free)
  if (T.platform === 'X') {
    if (!xConfigured(env)) return pending(env, sub, checks, 'VERIFICATION_PENDING', t + 60 * 60_000);
    if ((await todayCostMicros(env)) + H.costMicros.postRead > (await budgetMicros(env))) return pending(env, sub, checks, 'BUDGET_PAUSED', t + 60 * 60_000);
  }
  const r = await PROVIDERS[sub.submission_type]({ env, sub, target, add, fetchImpl });
  if (r.decision === 'PENDING') return pending(env, sub, checks, r.reason, t + H.retry.baseMs * 2 ** sub.attempts, r.detail);
  if (r.decision === 'REJECT') return finish(env, sub, 'AUTO_REJECTED', r.reason, checks, r.evidence);
  // shared anti-abuse: originality (text fingerprints) + target capacity
  const ev = r.evidence || {};
  if (r.originality && ev.content_fingerprint) {
    const own = await env.DB.prepare(`SELECT COUNT(*) AS n FROM haunt_submissions WHERE player_id = ? AND content_fingerprint = ? AND status IN ${APPROVED} AND created_at > ?`)
      .bind(sub.player_id, ev.content_fingerprint, t - H.reply.maxDuplicatesPerPlayerDays * 86400_000).first();
    if (own.n > 0) { add('ORIGINALITY', false, 'same text used before'); return finish(env, sub, 'AUTO_REJECTED', 'DUPLICATE_CONTENT', checks, ev); }
    const others = await env.DB.prepare(`SELECT COUNT(DISTINCT player_id) AS n FROM haunt_submissions WHERE content_fingerprint = ? AND status IN ${APPROVED} AND player_id != ? AND created_at > ?`)
      .bind(ev.content_fingerprint, sub.player_id, t - 86400_000).first();
    if (others.n >= H.reply.maxSameTextAcrossPlayers24h - 1) { add('ORIGINALITY', false, `${others.n} other players used this text`); return finish(env, sub, 'AUTO_REJECTED', 'COPY_PASTE', checks, ev); }
    add('ORIGINALITY', true, 'original');
  }
  if (r.capacity && target && target.max_submissions) {
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM haunt_submissions WHERE target_id = ? AND status IN ${APPROVED}`).bind(target.id).first();
    if (n.n >= target.max_submissions) { add('CAPACITY', false, 'full'); return finish(env, sub, 'AUTO_REJECTED', 'TARGET_FULL', checks, ev); }
  }
  if (r.decision === 'REVIEW') return finish(env, sub, 'MANUAL_REVIEW', r.reason, checks, ev);
  if (r.contextLabel) add('CRYPTO', true, r.contextLabel);
  // APPROVE — reward looked up server-side (target for replies, config for other types)
  const reward = Math.max(0, Math.min(H.maxReward, Number(r.reward) || 0));
  return approve(env, sub, target, reward, checks, ev, 'AUTO_APPROVED');
}

async function finish(env, sub, status, reason, checks, evidence = {}) {
  const t = now();
  await env.DB.prepare(
    `UPDATE haunt_submissions SET status = ?, reason = ?, checks_json = ?, reply_author_id = COALESCE(?, reply_author_id), parent_status_id = COALESCE(?, parent_status_id),
       conversation_id = COALESCE(?, conversation_id), reply_created_at = COALESCE(?, reply_created_at), text_excerpt = COALESCE(?, text_excerpt),
       content_fingerprint = COALESCE(?, content_fingerprint), media_count = COALESCE(?, media_count), author_handle = COALESCE(?, author_handle),
       verified_at = ?, updated_at = ?, attempts = attempts + 1, next_retry_at = NULL
     WHERE id = ? AND status IN ('VERIFYING','VERIFICATION_PENDING')`)
    .bind(status, reason, JSON.stringify(checks), evidence.reply_author_id ?? null, evidence.parent_status_id ?? null, evidence.conversation_id ?? null,
      evidence.reply_created_at ?? null, evidence.text_excerpt ?? null, evidence.content_fingerprint ?? null, evidence.media_count ?? null, evidence.author_handle ?? null,
      status === 'MANUAL_REVIEW' ? null : t, t, sub.id).run();
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

/* One atomic batch: ledger row (UNIQUE haunt:<id>) + player caches + submission state. A second award is impossible. */
async function approve(env, sub, target, reward, checks, evidence, status, fromStatuses = "('VERIFYING','VERIFICATION_PENDING')", actor = null) {
  const t = now();
  const ref = `haunt:${sub.id}`;
  const T = H.types[sub.submission_type];
  const cond = `EXISTS (SELECT 1 FROM haunt_submissions WHERE id = ? AND status IN ${fromStatuses})`;
  const label = target ? `THE HAUNT #${target.id} (${T.label})` : `THE HAUNT (${T.label})`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO point_transactions (player_id, season_id, game, amount, reason, reference_id, created_at, source_type, source_id, currency)
         SELECT ?, NULL, 'haunt', ?, ?, ?, ?, ?, ?, ? WHERE ${cond}`)
        .bind(sub.player_id, reward, label, ref, t, T.ledgerSource, sub.id, H.currency, sub.id),
      env.DB.prepare(
        `UPDATE players SET haunt_xp = haunt_xp + ?, xp = xp + ?, haunt_count = haunt_count + 1, haunt_last_at = ?, last_seen_at = ?
         WHERE id = ? AND ${cond} AND EXISTS (SELECT 1 FROM point_transactions WHERE reference_id = ?)`)
        .bind(reward, reward, t, t, sub.player_id, sub.id, ref),
      env.DB.prepare(
        `UPDATE haunt_submissions SET status = ?, reason = NULL, points_awarded = ?, checks_json = COALESCE(?, checks_json), reply_author_id = COALESCE(?, reply_author_id),
           parent_status_id = COALESCE(?, parent_status_id), conversation_id = COALESCE(?, conversation_id), reply_created_at = COALESCE(?, reply_created_at),
           text_excerpt = COALESCE(?, text_excerpt), content_fingerprint = COALESCE(?, content_fingerprint), media_count = COALESCE(?, media_count),
           author_handle = COALESCE(?, author_handle), reviewed_by = COALESCE(?, reviewed_by), verified_at = ?, updated_at = ?, attempts = attempts + 1, next_retry_at = NULL
         WHERE id = ? AND status IN ${fromStatuses}`)
        .bind(status, reward, checks ? JSON.stringify(checks) : null, evidence.reply_author_id ?? null, evidence.parent_status_id ?? null, evidence.conversation_id ?? null,
          evidence.reply_created_at ?? null, evidence.text_excerpt ?? null, evidence.content_fingerprint ?? null, evidence.media_count ?? null, evidence.author_handle ?? null,
          actor, t, t, sub.id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return { status, reason: null, replay: true };
    throw e;
  }
  const p = await env.DB.prepare('SELECT xp, level FROM players WHERE id = ?').bind(sub.player_id).first();
  const lvl = levelForXp(p.xp);
  if (lvl !== p.level) await env.DB.prepare('UPDATE players SET level = ? WHERE id = ?').bind(lvl, sub.player_id).run();
  return { status, points: reward };
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
    id: s.id, type: s.submission_type, typeLabel: H.types[s.submission_type]?.label || s.submission_type, platform: s.platform,
    status: s.status, reason: s.reason, message: s.reason ? REASONS[s.reason] || s.reason : null,
    points: s.points_awarded, targetId: s.target_id, url: s.normalized_url,
    checks: JSON.parse(s.checks_json || '[]').map(c => ({ key: c.key, label: c.label, ok: c.ok })),
    createdAt: s.created_at, verifiedAt: s.verified_at, nextRetryAt: s.next_retry_at,
  };
}

export async function targetsFor(env, player) {
  const t = now();
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.url, t.author_username, t.category, t.reward, t.expires_at, t.max_submissions, t.text_preview, t.created_at,
       (SELECT COUNT(*) FROM haunt_submissions s WHERE s.target_id = t.id AND s.status IN ${APPROVED}) AS claims
     FROM haunt_targets t WHERE t.active = 1 AND (t.expires_at IS NULL OR t.expires_at > ?) ORDER BY t.created_at DESC LIMIT ?`)
    .bind(t, H.targets.maxPerPage).all();
  let mine = {};
  if (player) {
    const { results: m } = await env.DB.prepare(`SELECT target_id, status FROM haunt_submissions WHERE player_id = ? AND status IN ${ACTIVE} AND target_id IS NOT NULL`).bind(player.id).all();
    mine = Object.fromEntries(m.map(x => [x.target_id, x.status === 'MANUAL_APPROVED' ? 'AUTO_APPROVED' : x.status]));
  }
  return results.map(r => ({
    id: r.id, url: r.url, author: r.author_username, category: r.category, reward: r.reward, expiresAt: r.expires_at, openedAt: r.created_at,
    preview: r.text_preview, claims: r.claims, maxClaims: r.max_submissions, full: !!(r.max_submissions && r.claims >= r.max_submissions),
    mine: mine[r.id] || null,
  }));
}

export async function playerStatus(env, player) {
  const p = await env.DB.prepare('SELECT haunt_xp, haunt_count, haunt_last_at FROM players WHERE id = ?').bind(player.id).first();
  const rank = p.haunt_xp > 0 ? (await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM players p WHERE ${RANKED} AND p.haunt_xp > ?1 OR (${RANKED} AND p.haunt_xp = ?1 AND p.haunt_last_at < ?2)`)
    .bind(p.haunt_xp, p.haunt_last_at ?? 0).first()).r : null;
  const xa = await xAccount(env, player.id);
  const lim = await limitState(env, player.id);
  const { results: recent } = await env.DB.prepare('SELECT id FROM haunt_submissions WHERE player_id = ? ORDER BY created_at DESC LIMIT 10').bind(player.id).all();
  return {
    xp: p.haunt_xp, haunts: p.haunt_count, rank, today: lim.today, window: lim.window, types: lim.types, state: lim.state, nextAt: lim.nextAt, minGapMinutes: lim.minGapMinutes,
    x: xa ? { connected: true, username: xa.username } : { connected: false },
    submissions: await Promise.all(recent.map(r => view(env, r.id, player.id))),
  };
}

export function typeRules() {
  return Object.fromEntries(TYPES.map(k => [k, { label: H.types[k].label, platform: H.types[k].platform, reward: H.types[k].reward, perDay: H.types[k].perDay, needsTarget: H.types[k].needsTarget }]));
}

function rangeStart(range, t = now()) {
  if (range === 'today') return Date.parse(dayKey(t) + 'T00:00:00Z');
  if (range === 'week') { const d = new Date(Date.parse(dayKey(t) + 'T00:00:00Z')); const dow = (d.getUTCDay() + 6) % 7; return d.getTime() - dow * 86400_000; }  // Monday 00:00 UTC
  return 0;
}
export async function leaderboard(env, player, range, size = 100) {
  let rows;
  if (range === 'all') {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.display_name, p.haunt_xp AS xp, p.haunt_count AS haunts, p.level, p.total_points AS arcade FROM players p WHERE ${RANKED} AND p.haunt_xp > 0
       ORDER BY p.haunt_xp DESC, p.haunt_last_at ASC, p.id ASC LIMIT ?`).bind(size).all();
    rows = results;
  } else {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.display_name, p.level, p.total_points AS arcade, SUM(s.points_awarded) AS xp, COUNT(*) AS haunts, MAX(s.verified_at) AS last
       FROM haunt_submissions s JOIN players p ON p.id = s.player_id
       WHERE s.status IN ${APPROVED} AND s.verified_at >= ? AND ${RANKED}
       GROUP BY p.id ORDER BY xp DESC, last ASC, p.id ASC LIMIT ?`).bind(rangeStart(range), size).all();
    rows = results;
  }
  const out = rows.map((r, i) => ({ rank: i + 1, name: r.display_name, xp: r.xp, haunts: r.haunts, level: r.level, arcade: r.arcade, me: !!player && r.id === player.id }));
  let me = null;
  if (player && !out.some(r => r.me)) {
    if (range === 'all') {
      const st = await playerStatus(env, player);
      if (st.rank) me = { rank: st.rank, xp: st.xp, haunts: st.haunts, name: player.display_name };
    } else {
      const mine = await env.DB.prepare(`SELECT COALESCE(SUM(points_awarded),0) AS xp, COUNT(*) AS haunts, MAX(verified_at) AS last FROM haunt_submissions WHERE player_id = ? AND status IN ${APPROVED} AND verified_at >= ?`).bind(player.id, rangeStart(range)).first();
      if (mine.xp > 0) {
        const r = await env.DB.prepare(
          `SELECT COUNT(*) + 1 AS r FROM (SELECT s.player_id, SUM(s.points_awarded) AS xp, MAX(s.verified_at) AS last FROM haunt_submissions s JOIN players p ON p.id = s.player_id
             WHERE s.status IN ${APPROVED} AND s.verified_at >= ?1 AND ${RANKED} GROUP BY s.player_id) x WHERE x.xp > ?2 OR (x.xp = ?2 AND x.last < ?3)`).bind(rangeStart(range), mine.xp, mine.last).first();
        me = { rank: r.r, xp: mine.xp, haunts: mine.haunts, name: player.display_name };
      }
    }
  }
  return { range, rows: out, me };
}

export async function activity(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.display_name, s.target_id, s.submission_type, s.points_awarded, s.verified_at FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     WHERE s.status IN ${APPROVED} AND ${RANKED} ORDER BY s.verified_at DESC LIMIT 20`).all();
  return results.map(r => ({ name: r.display_name, targetId: r.target_id, type: r.submission_type, typeLabel: H.types[r.submission_type]?.label, xp: r.points_awarded, at: r.verified_at }));
}

/* ---------- admin: manual review (TikTok, or X after max retries) ---------- */
export async function adminReview(env, actor, id, body) {
  const s = await env.DB.prepare('SELECT * FROM haunt_submissions WHERE id = ?').bind(id).first();
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Submission not found.');
  if (s.status !== 'MANUAL_REVIEW') throw new ApiError(409, 'NOT_IN_REVIEW', 'Only submissions in MANUAL_REVIEW can be decided.');
  const note = String(body.note || '').trim().slice(0, 300);
  if (note.length < 3) throw new ApiError(400, 'NOTE_REQUIRED', 'Write what you checked (e.g. "creator @x is this player, bio link verified").');
  if (body.decision === 'approve') {
    const T = H.types[s.submission_type];
    const target = s.target_id ? await env.DB.prepare('SELECT * FROM haunt_targets WHERE id = ?').bind(s.target_id).first() : null;
    const reward = Math.max(0, Math.min(H.maxReward, T.needsTarget ? (target?.reward ?? H.defaultReward) : T.reward));
    const r = await approve(env, s, target, reward, null, {}, 'MANUAL_APPROVED', "('MANUAL_REVIEW')", actor);
    await auditStmt(env, actor, 'haunt.submission.approve', id, { note, reward }).run();
    return { ok: true, points: r.points ?? reward };
  }
  if (body.decision === 'reject') {
    const r = await env.DB.prepare("UPDATE haunt_submissions SET status = 'MANUAL_REJECTED', reason = ?, reviewed_by = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status = 'MANUAL_REVIEW' RETURNING id")
      .bind(`REVIEW: ${note}`.slice(0, 200), actor, now(), now(), id).first();
    if (!r) throw new ApiError(409, 'NOT_IN_REVIEW', 'Already decided.');
    await auditStmt(env, actor, 'haunt.submission.reject', id, { note }).run();
    return { ok: true };
  }
  throw new ApiError(400, 'BAD_DECISION', 'decision must be approve or reject.');
}


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
  if ((s.status === 'AUTO_APPROVED' || s.status === 'MANUAL_APPROVED') && s.points_awarded > 0) {
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
  const r = await env.DB.prepare("UPDATE haunt_submissions SET status = 'VERIFICATION_PENDING', next_retry_at = ?, attempts = 0 WHERE id = ? AND status IN ('VERIFICATION_PENDING','MANUAL_REVIEW') AND platform = 'X' RETURNING id").bind(now(), id).first();
  if (!r) throw new ApiError(409, 'NOT_RETRYABLE', 'Only pending / manual-review X submissions can be retried (TikTok needs a manual decision).');
  await auditStmt(env, actor, 'haunt.submission.retry', id, {}).run();
  await verify(env, id);
  return { ok: true };
}

export async function adminOverview(env, url) {
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  const where = []; const binds = [];
  if (status) { where.push('s.status = ?'); binds.push(status); }
  if (q) { where.push('(s.player_id = ? OR p.display_name LIKE ? OR s.external_id = ?)'); binds.push(q, `%${q}%`, q); }
  const { results: submissions } = await env.DB.prepare(
    `SELECT s.id, s.player_id, p.display_name, s.platform, s.submission_type, s.external_id, s.author_handle, s.media_count, s.reviewed_by, s.x_user_id, s.x_status_id, s.normalized_url, s.target_id, s.status, s.reason, s.points_awarded, s.text_excerpt,
       s.checks_json, s.attempts, s.created_at, s.verified_at FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC LIMIT 100`).bind(...binds).all();
  const { results: targets } = await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM haunt_submissions s WHERE s.target_id = t.id AND s.status IN ${APPROVED}) AS claims FROM haunt_targets t ORDER BY t.id DESC LIMIT 100`).all();
  const { results: suspicious } = await env.DB.prepare(
    `SELECT s.player_id, p.display_name, COUNT(*) AS rejected, GROUP_CONCAT(DISTINCT s.reason) AS reasons FROM haunt_submissions s JOIN players p ON p.id = s.player_id
     WHERE s.status = 'AUTO_REJECTED' AND s.created_at > ? AND s.reason IN ('AUTHOR_MISMATCH','COPY_PASTE','DUPLICATE_CONTENT','WRONG_TARGET','REPLY_BEFORE_HAUNT')
     GROUP BY s.player_id HAVING COUNT(*) >= 3 ORDER BY rejected DESC LIMIT 25`).bind(now() - 86400_000).all();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM haunt_submissions WHERE created_at > ? GROUP BY status').bind(now() - 86400_000).all();
  const { results: usage } = await env.DB.prepare('SELECT * FROM x_api_usage ORDER BY day DESC, endpoint LIMIT 42').all();
  return { submissions, targets, suspicious, last24h: counts, usage, todayCostMicros: await todayCostMicros(env), budgetMicros: await budgetMicros(env), xConfigured: xConfigured(env) };
}
