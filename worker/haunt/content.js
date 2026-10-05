/* Reply content checks + crypto relevance scoring (pure functions, unit-tested). */
import { CONFIG } from '../config.js';

const H = CONFIG.haunt;

/* Strip leading @mentions, links, emoji/punctuation → comparable text. Repeated vocabulary ($HALLOWINU, Solana…) is fine. */
export function cleanReply(text) {
  return String(text || '')
    .replace(/^(\s*@\w{1,15})+/g, ' ')        // reply prefix mentions
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function letterCount(text) { return (cleanReply(text).match(/\p{L}/gu) || []).length; }

/* Fingerprint for duplicate/copy-paste detection: case-, spacing-, punctuation- and emoji-insensitive. */
export function fingerprint(text) {
  return cleanReply(text).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}$#]+/gu, '');
}

export function checkReplyContent(text) {
  if (letterCount(text) < H.reply.minLetters) return { ok: false, reason: 'CONTENT_TOO_SHORT' };
  return { ok: true };
}

/* Phase 2 (discovered targets): multi-signal relevance score 0..100. Never passes on a single keyword. */
export function cryptoRelevance({ text = '', authorId = '', authorBio = '', likes = 0, replies = 0 }, cfg = H.discovered) {
  const t = ` ${String(text).toLowerCase()} `;
  const w = cfg.weights;
  let score = 0; const signals = [];
  if (cfg.denylist.includes(authorId)) return { score: 0, pass: false, signals: ['DENYLISTED_AUTHOR'] };
  const hits = cfg.terms.filter(term => new RegExp(`[^a-z0-9]${term.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')}[^a-z0-9]`).test(t));
  if (hits.length) { score += Math.min(w.maxTerms, hits.length * w.terms); signals.push(`TERMS:${hits.slice(0, 5).join(',')}`); }
  if (/\$[a-z][a-z0-9]{1,9}\b/i.test(text)) { score += w.cashtag; signals.push('CASHTAG'); }
  if (/#(solana|crypto|memecoin|sol|web3|defi)\b/i.test(text)) { score += w.hashtag; signals.push('HASHTAG'); }
  if (cfg.allowlist.includes(authorId)) { score += w.allowlistedAuthor; signals.push('ALLOWLISTED_AUTHOR'); }
  if (/(crypto|solana|web3|defi|memecoin|degen|onchain|nft)/i.test(authorBio)) { score += w.cryptoBio; signals.push('CRYPTO_BIO'); }
  if (likes + replies >= 20) { score += w.engagement; signals.push('ENGAGEMENT'); }
  // single-signal guard: at least two independent signal groups are required
  const groups = signals.filter(s => s !== 'ENGAGEMENT').length;
  score = Math.min(100, score);
  return { score, pass: score >= cfg.minRelevance && groups >= 2, signals };
}

/* Parse any public X/Twitter status URL → { id, normalizedUrl } or null. */
export function parseStatusUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 400) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|mobile)\./, '');
  if (host !== 'x.com' && host !== 'twitter.com') return null;
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web|i)\/status(?:es)?\/(\d{5,25})(?:\/.*)?$/);
  if (!m) return null;
  return { id: m[1], normalizedUrl: `https://x.com/i/status/${m[1]}` };
}
