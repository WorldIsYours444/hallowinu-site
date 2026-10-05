# THE HAUNT — X replies, X posts, X memes, TikTok

Page: `/haunt` (`tools/site/haunt.html`, `dist/haunt.js`, `dist/haunt.css`, shared `dist/wallet.js`).
Server: `worker/haunt/` (`engine.js` type router + shared anti-abuse + ledger + read models, `providers/x-reply.js`, `providers/x-post.js` (X_POST + X_MEME), `providers/tiktok.js`, `xclient.js` X API + cache + metering, `content.js` URL/content/relevance).
Schema: `migrations/0004_haunt.sql`, `0005_haunt_types_and_pool.sql` (platform, external_id, submission_type; UNIQUE(platform, external_id)).
Full leaderboard: `/leaderboard` (`tools/site/leaderboard.html`, `dist/leaderboard.js`); /haunt shows a compact rank preview. Config: `CONFIG.haunt` in `worker/config.js` (all numbers live there).

## Loop
Phantom sign-in → player name (Arcade) → connect X (OAuth 2.0, immutable X user id) → pick a Haunt → reply on X → paste reply URL → automatic verification → Haunt XP → leaderboard.

## Submission types (one terminal, server-side rewards in `CONFIG.haunt.types`)
| Type | Proof | Reward | Per day |
|---|---|---|---|
| `X_REPLY` | reply under a curated Haunt, author = connected X id (unchanged strict v1 rules) | target reward | 20 |
| `X_POST` | own original post (no reply/repost), ≥ 16 letters, mentions HALLOWINU/$HALLOWINU/#hallowinu/@HIonchains, < 48 h | 10 XP | 5 |
| `X_MEME` | own post with photo/GIF/video (`expansions=attachments.media_keys`), mentions the project, < 48 h | 15 XP | 5 |
| `TIKTOK_POST` | free public oEmbed: video exists, link handle = creator, caption mentions the project → **MANUAL_REVIEW** (ownership can't be proven without TikTok Login Kit) → admin Approve/Reject with a note | 20 XP | 3 |
The browser never sends a reward; a missing `type` = `X_REPLY` (v1 clients). Wrong-platform links, short `vm.tiktok.com` links and invalid URLs are rejected before any paid call. Statuses add `MANUAL_APPROVED` / `MANUAL_REJECTED`. Ledger `source_type`: `HAUNT_X_REPLY|HAUNT_X_POST|HAUNT_X_MEME|HAUNT_TIKTOK`.

## Entity boundaries
* `haunt_targets` = system/admin content. Only admins create them (verified through X on creation).
* `haunt_submissions` = user content. A submission can never become a target or instructions; it is rendered escaped, text only.
* Haunt XP (`currency = HAUNT_XP` in `point_transactions`) is separate from Arcade Points and **never** counts toward Season SOL prizes. It does add to player XP/level.

## Verification order (cheap first, one paid call)
1. URL syntax → 2. session + connected X account → 3. duplicate status (DB) → 4. technical rate limit (per player + IP) →
5. target active / not expired / not already done → 6. reward limits (atomic insert: 3 per 10 min, 2 min apart, 20 per UTC day, 1 per target) →
7. daily budget guard → 8. **one** `GET /2/tweets/:id` (app Bearer token) → author = connected X id (`AUTHOR_MISMATCH`) → is a reply → parent = target or same conversation (`WRONG_TARGET`) →
posted after the Haunt opened and < 48 h old → content (≥ 8 letters) → originality (own duplicate text 7 days, same text by 3+ players in 24 h) → capacity → approve.
Approval = one atomic batch: ledger row (UNIQUE `haunt:<submission>`), player caches, submission state. A second award is impossible.

States: `VERIFYING → AUTO_APPROVED | AUTO_REJECTED | VERIFICATION_PENDING (X down/429/credits/budget; cron retries, exponential) → MANUAL_REVIEW (after 6 attempts) | INVALIDATED (admin)`.
Every check + result is stored in `checks_json` (admin → THE HAUNT → Submissions). Tokens are never stored or logged.

## X API (pay-per-use, Feb 2026 pricing)
| Use | Endpoint | Cost |
|---|---|---|
| Connect account | `POST /2/oauth2/token`, `GET /2/users/me` (user token, revoked right after) | ~$0.001 (owned read) |
| Verify a reply | `GET /2/tweets/:id?tweet.fields=author_id,conversation_id,created_at,referenced_tweets,in_reply_to_user_id,text` | $0.005 |
| Create a target | same + `expansions=author_id` (cached 6 h) | $0.015 |

Estimated: 100 haunts/day ≈ $17/month · 500 ≈ $83 · 1,000 ≈ $165 · 5,000 ≈ $825. Daily budget guard default $1/day (`haunt.dailyBudgetCents`, admin-adjustable 0–1000).
Batching checks hourly does **not** lower the bill (X charges per post read, not per request), so verification is immediate.
The follow lookup is billed per returned user (up to $10 per check) and is OFF (`X_FOLLOW_CHECK` unset): X verification proves account ownership.

## Configuration (Cloudflare → Worker → Variables and secrets)
* `X_BEARER_TOKEN` (**secret**) — app-only token for reading posts.
* `X_CLIENT_ID` (plain) + `X_CLIENT_SECRET` (**secret**) — OAuth 2.0 for connecting accounts. Callback: `https://hallowinu.xyz/api/socials/x/callback`, scopes `users.read tweet.read`.
* Optional: `HAUNT_DAILY_BUDGET_CENTS`, `X_FOLLOW_CHECK=on`.

## Admin (`/admin` → THE HAUNT)
Create target (URL, category, reward, expiry, max claims) · enable/disable · change reward/expiry · inspect submissions with evidence and every check · invalidate (reverses XP via a negative ledger row) · retry pending/manual-review · suspicious players (≥3 suspicious rejections in 24 h) · X API usage per day/endpoint with estimated cost. Ban via Players → Ban.

## Phase 2 (prepared, off)
`CONFIG.haunt.discovered` + `cryptoRelevance()` (multi-signal score, configurable threshold; a single keyword never passes). Deleted-reply checks: evidence (text excerpt, fingerprint, ids, timestamps) is stored at approval for later sampling.

## Tests
`npm test` (81 incl. 25 Haunt + 10 pool tests with fake X / TikTok / Solana RPC) · `DEV_FAKE_X=1 node tools/dev-server.mjs 8789 /tmp/h.db` + `node test/e2e-haunt.mjs` (browser, desktop + mobile).
