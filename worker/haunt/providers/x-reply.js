/* X_REPLY — a reply under a curated Haunt target. (Unchanged rules from v1; parent is never re-fetched.) */
import { CONFIG } from '../../config.js';
import { fetchTweet, XNotFound, XUnavailable } from '../xclient.js';
import { checkReplyContent, fingerprint, cleanReply } from '../content.js';

const H = CONFIG.haunt;

export async function verify({ env, sub, target, add, fetchImpl }) {
  if (!target) return { decision: 'REJECT', reason: 'TARGET_NOT_FOUND' };
  let tw;
  try { tw = await fetchTweet(env, sub.external_id, fetchImpl ? { fetchImpl } : {}); }
  catch (e) {
    if (e instanceof XNotFound) { add('POST', false, 'not found'); return { decision: 'REJECT', reason: 'STATUS_NOT_FOUND' }; }
    if (e instanceof XUnavailable) { add('POST', false, e.code); return { decision: 'PENDING', reason: 'VERIFICATION_PENDING', detail: e.code }; }
    throw e;
  }
  const d = tw.data;
  add('POST', true, `status ${d.id}`);
  const ev = evidenceOf(d);
  if (d.author_id !== sub.x_user_id) { add('AUTHOR', false, `author ${d.author_id} ≠ connected ${sub.x_user_id}`); return { decision: 'REJECT', reason: 'AUTHOR_MISMATCH', evidence: ev }; }
  add('AUTHOR', true, `author ${d.author_id}`);
  if (!ev.parent_status_id) { add('REPLY', false, 'no replied_to reference'); return { decision: 'REJECT', reason: 'NOT_A_REPLY', evidence: ev }; }
  add('REPLY', true, `reply to ${ev.parent_status_id}`);
  const targetConv = target.conversation_id || target.x_status_id;
  if (ev.parent_status_id !== target.x_status_id && d.conversation_id !== targetConv) {
    add('CONTEXT', false, `parent ${ev.parent_status_id} / conversation ${d.conversation_id} ≠ HAUNT #${target.id}`);
    return { decision: 'REJECT', reason: 'WRONG_TARGET', evidence: ev };
  }
  add('CONTEXT', true, `HAUNT #${target.id} (${ev.parent_status_id === target.x_status_id ? 'direct reply' : 'same thread'})`);
  if (ev.reply_created_at && ev.reply_created_at < target.created_at - 120_000) { add('TIMING', false, 'posted before the Haunt opened'); return { decision: 'REJECT', reason: 'REPLY_BEFORE_HAUNT', evidence: ev }; }
  if (ev.reply_created_at && sub.created_at - ev.reply_created_at > H.reply.maxAgeMs) { add('TIMING', false, 'too old'); return { decision: 'REJECT', reason: 'REPLY_TOO_OLD', evidence: ev }; }
  add('TIMING', true, d.created_at || 'ok');
  const c = checkReplyContent(d.text);
  if (!c.ok) { add('CONTENT', false, `${cleanReply(d.text).length} chars`); return { decision: 'REJECT', reason: c.reason, evidence: ev }; }
  add('CONTENT', true, 'natural reply');
  return { decision: 'APPROVE', evidence: ev, reward: target.reward, originality: true, capacity: true, contextLabel: `curated ${target.category}` };
}

export function evidenceOf(d, extra = {}) {
  return {
    reply_author_id: d.author_id || null, conversation_id: d.conversation_id || null,
    parent_status_id: (d.referenced_tweets || []).find(r => r.type === 'replied_to')?.id || null,
    reply_created_at: d.created_at ? Date.parse(d.created_at) : null,
    text_excerpt: String(d.text || '').slice(0, 280), content_fingerprint: fingerprint(d.text), ...extra,
  };
}
