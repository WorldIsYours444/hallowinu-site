# HALLOWINU Arcade — technical documentation

## 1. Architecture

```
Browser (dist/arcade.js)  ──fetch /api/*──►  Cloudflare Worker (worker/index.js)  ──►  D1 (SQLite) "hallowinu-arcade"
        presentation only                         authoritative game engine                 all state
```

* One Worker serves the static site (`dist/`, assets binding) **and** the API (`/api/*`).
* Deploy: push to `main` → Workers Builds runs
  `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` (config: `wrangler.jsonc`).
* Cron (`*/10 * * * *`) activates/finalizes seasons and cleans rate-limit rows.
* No external dependencies, no npm packages at runtime.

### Code map
| Path | Purpose |
|---|---|
| `worker/config.js` | **All tunable numbers**: odds, rewards, limits, hunt timing, quiz rewards/streaks, XP curve, achievements, prize distribution |
| `worker/index.js` | Router, guards (CSRF/origin), views (profile, leaderboard, season), admin API, cron |
| `worker/lib/rewards.js` | Shared engine: limits/cooldowns, idempotent attempts, ledger settlement, XP/levels, achievements |
| `worker/lib/seasons.js` | Season state, prize pool, ranking, finalization, disqualification, approval |
| `worker/lib/prizes.js` | Lamport math (BigInt only) |
| `worker/lib/solana.js` | Read-only on-chain verification of pool deposits |
| `worker/lib/auth.js` | Phantom wallet sign-in (nonce → signed message → ed25519 verify), player names |
| `worker/lib/session.js` | Wallet sessions (HttpOnly cookie, hashed token, rotation, logout) |
| `worker/lib/socials.js` | X (OAuth 2.0 PKCE + follow check) and Telegram (Login Widget HMAC + group membership) |
| `tools/site/site.json` | **Single source of truth** for official links (website / X / Telegram) and game metadata (name, icon, tagline, route, type) |
| `worker/site-meta.js`, `dist/site-config.js` | Generated from `site.json` by `python3 tools/site/build.py` — never edit by hand |
| `worker/games/*.js` | One module per game |
| `migrations/*.sql` | D1 schema + seed (Season 01, quiz bank) |
| `dist/arcade.js/.css` | Arcade UI |
| `dist/admin.html/.js` | Admin console (token protected) |
| `test/` | `npm test` — 47 automated tests on a D1-compatible SQLite shim; `test/e2e.mjs` (browser, mock Phantom with real keys); `test/responsive.mjs` (8 widths) |
| `tools/dev-server.mjs` | Local server: `node tools/dev-server.mjs 8788 /tmp/dev.db` |
| `tools/site/` | Builds `dist/index.html` from the template (`python3 tools/site/build.py`) |

## 2. Security model (never trust the client)
* The browser only sends **intent** (choice, target id, answer index). The server decides outcomes with `crypto.getRandomValues` (unbiased), computes points, enforces limits and timestamps.
* **Identity (Phantom):** `POST /api/auth/nonce {wallet}` returns a single-use nonce (5 min) and a human-readable message (SIWS style: domain, wallet, "not a transaction", nonce, issued/expiry). The wallet signs it with `signMessage` (never a transaction). `POST /api/auth/verify {wallet, nonce, signature}` burns the nonce first (atomic), checks expiry, wallet + origin binding and the **ed25519 signature** (WebCrypto). The wallet maps to one immutable internal `player_id` via `player_identities (UNIQUE provider+id, UNIQUE player+provider)`, so reconnecting restores the same player. A fresh random 256-bit session token is issued every sign-in (rotation) in an `HttpOnly; Secure; SameSite=Lax; Path=/api` cookie, 30-day expiry; only its SHA-256 is stored. `POST /api/auth/logout` deletes the session server-side. Player ids in request bodies are ignored.
* **Access states (server):** `WALLET_NOT_CONNECTED → (client: WALLET_CONNECTED) → PROFILE_REQUIRED → SOCIALS_PENDING → ARCADE_READY`, plus `SUSPENDED`. Games require a wallet session + chosen name. Prize eligibility requires wallet + X + Telegram.
* **Names:** validated server-side only (3–16 chars, letters/numbers/space/-_., NFKC, no control/zero-width chars, reserved words like admin/system/hallowinu/moderator, small profanity list, unique on a normalized key that also folds look-alikes like 0→o, 1→i), one change per 24 h.
* **Socials:** Telegram = Login Widget data verified with HMAC-SHA256 (bot token) + `getChatMember` on the official group; X = OAuth 2.0 PKCE (state single-use, bound to the session) + the player's following list must contain the official account. Stable platform ids are stored, usernames are display only. If credentials are missing the UI says "COMING SOON" and nothing is marked verified.
* **CSRF/origin:** every mutation requires `x-hw-client: 1` + JSON body; a foreign `Origin` is rejected.
* **Idempotency:** each play carries an `idem` key → `UNIQUE(player_id, game, idem_key)`; every reward has a `UNIQUE reference_id` in `point_transactions`. Replays return the stored result; a duplicate reward makes the whole D1 batch roll back.
* **Limits:** one shared system (`usage_limits` daily counters via atomic upsert `… WHERE used < limit`, `cooldowns` via atomic upsert `… WHERE next_at <= now`). Refresh, new tabs, localStorage or device clock cannot bypass them. Day boundary: **00:00 UTC**.
* **Rate limits:** D1 fixed windows per player (game actions, hunt claims), per IP-hash (new players), admin failures.
* **Pumpkin Hunt anti-cheat:** board generated and stored server-side; claims validated against *server* time (≥140 ms after spawn, ≤ lifetime + 700 ms grace, ≥90 ms between claims), target must exist and belong to the player's active session, `UNIQUE(session_id, target_id)`; one active hunt per player (partial unique index); score recomputed server-side; impossible scores are zeroed and flagged.
* **Quiz:** correct answer never sent before answering; answers shuffled per attempt; first answer wins (atomic update); one open question per player; rewarded questions never repeat per player (partial unique index).
* Errors never expose internals (generic `INTERNAL` message; details only in Worker logs).

## 3. Database (see `migrations/0001_arcade_init.sql`)
`players`, `player_sessions`, `identity_links` (future Telegram/wallet), `seasons`, `point_transactions` (ledger), `game_attempts`, `usage_limits`, `cooldowns`, `hunt_sessions`, `hunt_claims`, `quiz_questions`, `quiz_attempts`, `player_counters` (generic counters → achievements), `player_achievements`, `season_player_stats`, `season_disqualifications`, `season_final_standings` (permanent snapshot), `prize_entitlements`, `prize_pool_transactions` (funding ledger), `audit_log`, `settings`, `rate_limits`.

`players.total_points` / `season_player_stats.points` are caches updated in the **same atomic batch** as the ledger row; `point_transactions` is the audit source of truth.

## 4. Games & configuration
All values live in `worker/config.js` (`CONFIG.games.*`). Current rules:
* **Trick or Treat** — 3/day. TREAT 60/25/10/4/1 % → 5/10/25/50/150; TRICK 45/30/15/8/2 % → 0/10/25/50/200.
* **Pumpkin Hunt** — 2/day, 30 s, 28 targets: normal 5 / rare 15 / golden 50 (max 2 golden), combo bonus +2 (≥3 in a row) / +5 (≥6).
* **Daily Spin** — 1 per rolling 24 h; segments and odds in config (shown publicly on the wheel).
* **Quiz** — 5 rewarded/day (then practice without points), 45 s per question, easy 5 / medium 10 / hard 20, streak bonus +10 at 3, +25 at 5.
* **XP** = points + participation XP per play. Level n needs `100(n−1) + 25(n−1)(n−2)` XP. Levels are cosmetic (no financial rewards).
* **Achievements** — 9 defined in config, evaluated server-side after every settlement, `PRIMARY KEY(player, achievement)` prevents duplicates.
* Runtime toggles without deploy (admin → Games & limits): game enabled/disabled, daily limits. Everything else = edit config + push.

### Adding game #5
1. Add `CONFIG.games['my-game']` (name, enabled, limit, xpPerPlay, rules).
2. Create `worker/games/my-game.js` using `consumeLimit` → `beginAttempt` → `settle` from `lib/rewards.js`.
3. Register it in the `GAMES` map in `worker/index.js`.
4. Add a cabinet card + game screen in `dist/arcade.js`. Ledger, XP, seasons, leaderboard and prizes work automatically.

## 5. Seasons, prize pool & payouts
* `seasons` row: dates, status (`UPCOMING → ACTIVE → FINALIZING → FINALIZED`), distribution in **basis points** (Season 01: 40/20/12/8/6/4/3/3/2/2 %).
* Season points are credited only while a season is live; lifetime points never reset.
* **Announced base pool** (`seasons.announced_lamports`, Season 01 = 1 SOL) is a public promise shown separately. Prize math ALWAYS uses the **current verified pool**. Distribution (bps): 3000/1750/1250/900/750/600/500/450/400/400 = 3.00/1.75/1.25/0.90/0.75/0.60/0.50/0.45/0.40/0.40 per 10 SOL; every rank scales proportionally.
* **Prize positions** go to the Top 10 **prize-eligible** players (wallet + X + Telegram verified) in ranking order; ineligible players keep their rank but get no prize. Legacy Phase-1 anonymous test players never rank.
* **Prize pool = sum of VERIFIED `prize_pool_transactions`** for the season. `PENDING`/`REJECTED` never count. `tx_signature` is UNIQUE (a deposit can never be counted twice). The seed contains Season 01's 10 SOL `INITIAL_FUNDING` as **PENDING** — it only shows publicly after an admin verifies it.
* All SOL math is integer lamports (BigInt). Allocation: `floor(pool × bps / 10000)` per rank, rounding dust to #1, so the Top 10 always sum to exactly the pool. If fewer than 10 eligible winners exist, the unfilled shares are reported as `unallocated` (roll-over), never silently assigned.
* **Finalization** (cron at `ends_at`, or admin): freeze pool + status `FINALIZING` atomically → permanent `season_final_standings` snapshot → Top-10 `prize_entitlements` (`FINALIZING`). Funding is refused once frozen.
* **Disqualification** (admin, with reason/evidence): removes the player, everyone below moves up, entitlements recomputed; before/after recorded in `audit_log`.
* **Approval** requires every winner to be `payout_verified` with a verified wallet link. Phase-1 anonymous players are **never** verified by gameplay → approval is blocked until each winner is verified (or disqualified). Then `APPROVED` → `PAID` (with payout tx signature). **No automatic SOL transfers exist.**

## 6. Admin operations
Open `https://<site>/admin.html` and paste the `ADMIN_TOKEN` (Cloudflare secret). Everything is audited.

| Task | How |
|---|---|
| Verify the 10 SOL starting pool | Funding → INITIAL_FUNDING row → *Verify manually* (type `I VERIFIED THIS FUNDING`) or *Verify on-chain* (needs `POOL_WALLET` + tx signature) |
| Add maker rewards | Record funding (source `MAKER_REWARD`, amount, **tx signature**) → *Verify on-chain* (checks: tx exists, finalized, succeeded, pool wallet received ≥ amount) |
| Change season end / create next season | Seasons section (start time + distribution lock once a season starts) |
| Disable a game / change a daily limit | Games & limits |
| Disqualify / ban | Entitlements → Disqualify, Players → Ban |
| Eligibility override (exceptional) | Players → Manual eligibility override (player must already have a signature-verified wallet; evidence required; audited) |
| Change the announced pool | Seasons → Edit season → Announced base pool |
| Approve payouts / mark paid | Seasons → Approve payouts; Entitlements → Mark paid (payout tx) |

API equivalent: `curl -H "authorization: Bearer $ADMIN_TOKEN" -H "x-hw-client: 1" -H "content-type: application/json" https://<site>/api/admin/overview`

### Configuration (Cloudflare → Worker → Settings → Variables and secrets)
* `ADMIN_TOKEN` (**secret**, ≥24 chars) — enables admin. Without it admin is disabled.
* `POOL_WALLET` (plain text, public address) — enables on-chain verification.
* Optional: `SOLANA_RPC_URL` (default public mainnet RPC), `ALLOWED_ORIGINS`, `IP_SALT` (secret).
* Telegram verification: `TELEGRAM_BOT_TOKEN` (**secret**), `TELEGRAM_BOT_USERNAME` (plain, without @), `TELEGRAM_CHAT_ID` (plain, e.g. `-100…`). The bot must be in the group (admin recommended) and BotFather `/setdomain` must be `hallowinu.xyz`.
* X verification: `X_CLIENT_ID` (plain), `X_CLIENT_SECRET` (**secret**), optional `X_OFFICIAL_USER_ID` (saves one API call). In the X developer portal: OAuth 2.0, type "Web App" (confidential), callback `https://hallowinu.xyz/api/socials/x/callback`, scopes users.read tweet.read follows.read. X API is pay-per-use (credits needed).

## 7. Limitations (honest)
* One person can own several wallets. X + Telegram verification (one account each per player) raises the cost of multi-accounting but is not perfect Sybil protection; the end-of-season review + disqualification remains the backstop.
* Pumpkin Hunt sends the spawn schedule to the client (needed to render it); a bot could still click perfectly within human-plausible timing. Server timing rules cap what is possible; finalization review + disqualification is the backstop.
* D1 free tier: 100k row writes/day (~8 writes per play → ~10k plays/day). Upgrade to Workers Paid ($5/mo) if the Arcade grows.
* Real-money prize promotions are regulated differently per country (e.g. NL "promotionele kansspelen"). Get legal advice before paying out; the rules text says "not available where prohibited".

## 8. Telegram bot integration (later)
* Keep `players.id` as the internal key. Link Telegram via `identity_links(provider='telegram', external_id=<telegram user id>)` — never usernames.
* Recommended flow: bot issues a short-lived one-time code (or Telegram Login Widget signature) → `POST /api/link/telegram` verifies it server-side (HMAC with the bot token) → inserts the link and sets `verified_at`.
* The bot can then read/write through the same Worker API with a service token, sharing points, leaderboard and seasons. No game code changes are needed.
* Wallets: add `identity_links(provider='solana_wallet')` after verifying a signed message (ed25519) — public key only. Apply a cooldown / manual review for wallet changes close to season end.
