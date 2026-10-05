/* X_POST (original HALLOWINU post) and X_MEME (post with image/GIF/video). Separate rules from X_REPLY:
   no parent/target required; must be the player's own, not a repost, about the project, and (meme) carry media. */
import { CONFIG } from '../../config.js';
import { fetchTweet, XNotFound, XUnavailable } from '../xclient.js';
import { cleanReply, letterCount, mentionsProject } from '../content.js';
import { evidenceOf } from './x-reply.js';

const H = CONFIG.haunt;
const MEDIA_TYPES = ['photo', 'animated_gif', 'video'];

export function makeVerifier(kind) {   // 'X_POST' | 'X_MEME'
  const meme = kind === 'X_MEME';
  return async function verify({ env, sub, add, fetchImpl }) {
    let tw;
    try { tw = await fetchTweet(env, sub.external_id, { withMedia: meme, ...(fetchImpl ? { fetchImpl } : {}) }); }
    catch (e) {
      if (e instanceof XNotFound) { add('POST', false, 'not found'); return { decision: 'REJECT', reason: 'STATUS_NOT_FOUND' }; }
      if (e instanceof XUnavailable) { add('POST', false, e.code); return { decision: 'PENDING', reason: 'VERIFICATION_PENDING', detail: e.code }; }
      throw e;
    }
    const d = tw.data;
    add('POST', true, `status ${d.id}`);
    const refs = d.referenced_tweets || [];
    const media = (d.attachments?.media_keys || []).map(k => (tw.includes.media || []).find(m => m.media_key === k)).filter(Boolean);
    const ev = evidenceOf(d, { media_count: media.length });
    if (d.author_id !== sub.x_user_id) { add('AUTHOR', false, `author ${d.author_id} ≠ connected ${sub.x_user_id}`); return { decision: 'REJECT', reason: 'AUTHOR_MISMATCH', evidence: ev }; }
    add('AUTHOR', true, `author ${d.author_id}`);
    if (refs.some(r => r.type === 'retweeted')) { add('TYPE', false, 'repost'); return { decision: 'REJECT', reason: 'IS_REPOST', evidence: ev }; }
    if (!meme && refs.some(r => r.type === 'replied_to')) { add('TYPE', false, 'reply'); return { decision: 'REJECT', reason: 'IS_A_REPLY', evidence: ev }; }
    add('TYPE', true, meme ? 'post with media' : refs.some(r => r.type === 'quoted') ? 'quote post' : 'original post');
    if (meme) {
      const ok = media.filter(m => MEDIA_TYPES.includes(m.type));
      if (!ok.length) { add('MEDIA', false, 'no image/GIF/video attached'); return { decision: 'REJECT', reason: 'NO_MEDIA', evidence: ev }; }
      add('MEDIA', true, ok.map(m => m.type).join(', '));
    }
    const created = ev.reply_created_at;
    if (created && sub.created_at - created > H.reply.maxAgeMs) { add('TIMING', false, 'too old'); return { decision: 'REJECT', reason: 'POST_TOO_OLD', evidence: ev }; }
    add('TIMING', true, d.created_at || 'ok');
    if (!meme && letterCount(d.text) < H.reply.minLetters * 2) { add('CONTENT', false, `${cleanReply(d.text).length} chars`); return { decision: 'REJECT', reason: 'CONTENT_TOO_SHORT', evidence: ev }; }
    if (!mentionsProject(d.text)) { add('PROJECT', false, 'no HALLOWINU / $HALLOWINU / @HIonchains'); return { decision: 'REJECT', reason: 'NOT_ABOUT_HALLOWINU', evidence: ev }; }
    add('PROJECT', true, 'mentions HALLOWINU');
    const textual = letterCount(d.text) >= 20;   // memes with only a tag/caption are not compared as text
    return { decision: 'APPROVE', evidence: ev, reward: H.types[kind].reward, originality: textual, capacity: false, contextLabel: meme ? 'HALLOWINU meme' : 'HALLOWINU post' };
  };
}
