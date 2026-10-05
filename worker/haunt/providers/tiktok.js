/* TIKTOK_POST — TikTok's public oEmbed endpoint (free, no key) proves the video exists and shows creator + caption.
   It can NOT prove that the creator account belongs to this player → never auto-approved: MANUAL_REVIEW
   (until TikTok Login Kit / Display API is connected; see docs/HAUNT.md). */
import { CONFIG } from '../../config.js';
import { fingerprint, mentionsProject } from '../content.js';

const H = CONFIG.haunt;

export async function fetchOEmbed(url, fetchImpl = fetch) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), H.tiktok.oembedTimeoutMs) : null;
  try {
    const res = await fetchImpl(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, ctl ? { signal: ctl.signal } : {});
    if (res.status === 400 || res.status === 404) return { notFound: true };
    if (!res.ok) return { unavailable: `TIKTOK_${res.status}` };
    const j = await res.json().catch(() => null);
    if (!j || (j.status_msg && !j.author_unique_id)) return { notFound: true };
    return { data: j };
  } catch { return { unavailable: 'TIKTOK_NETWORK' }; }
  finally { if (timer) clearTimeout(timer); }
}

export async function verify({ sub, add, fetchImpl }) {
  const r = await fetchOEmbed(sub.normalized_url, fetchImpl);
  if (r.notFound) { add('POST', false, 'video not found / private'); return { decision: 'REJECT', reason: 'VIDEO_NOT_FOUND' }; }
  if (r.unavailable) { add('POST', false, r.unavailable); return { decision: 'PENDING', reason: 'VERIFICATION_PENDING', detail: r.unavailable }; }
  const d = r.data;
  add('POST', true, 'video exists (public)');
  const urlHandle = (sub.author_handle || '').toLowerCase();
  const creator = String(d.author_unique_id || '').toLowerCase();
  const ev = { text_excerpt: String(d.title || '').slice(0, 280), content_fingerprint: fingerprint(d.title), reply_author_id: creator || null, author_handle: creator || null };
  if (d.embed_product_id && String(d.embed_product_id) !== String(sub.external_id)) { add('AUTHOR', false, 'video id mismatch'); return { decision: 'REJECT', reason: 'VIDEO_NOT_FOUND', evidence: ev }; }
  if (urlHandle && creator && urlHandle !== creator) { add('AUTHOR', false, `link @${urlHandle} ≠ creator @${creator}`); return { decision: 'REJECT', reason: 'CREATOR_MISMATCH', evidence: ev }; }
  add('AUTHOR', true, `creator @${creator}`);
  if (!mentionsProject(d.title)) { add('PROJECT', false, 'caption does not mention HALLOWINU'); return { decision: 'REJECT', reason: 'NOT_ABOUT_HALLOWINU', evidence: ev }; }
  add('PROJECT', true, 'caption mentions HALLOWINU');
  add('OWNERSHIP', null, 'TikTok account ownership cannot be verified automatically yet → team review');
  return { decision: 'REVIEW', reason: 'TIKTOK_OWNERSHIP_REVIEW', evidence: ev, reward: H.types.TIKTOK_POST.reward };
}
