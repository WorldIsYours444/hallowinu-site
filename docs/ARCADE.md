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
| `worker/lib/session.js` | Phase-1 identity (server player id + HttpOnly cookie) |
| `worker/games/*.js` | One module per game |
| `migrations/*.sql` | D1 schema + seed (Season 01, quiz bank) |
| `dist/arcade.js/.css` | Arcade UI |
| `dist/admin.html/.js` | Admin console (token protected) |
| `test/` | `npm test` — 35 automated tests on a D1-compatible SQLite shim |
| `tools/dev-server.mjs` | Local server: `node tools/dev-server.mjs 8788 /tmp/dev.db` |
| `tools/site/` | Builds `dist/index.html` from the template (`python3 tools/site/build.py`) |

## 2. Security model (never trust the client)
* The browser only sends **intent** (choice, target id, answer index). The server decides outcomes with `crypto.getRandomValues` (unbiased), computes points, enforces limits and timestamps.
* **Identity:** `POST /api/session` creates a server-generated `player_id` (`p_…`) and a random 256-bit token in an `HttpOnly; Secure; SameSite=Lax; Path=/api` cookie. Only the SHA-256 of the token is stored. Player ids in request bodies are ignored.
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
| Verify a winner (Phase 1) | Players → Manual payout verification (only after real identity + wallet-ownership checks) |
| Approve payouts / mark paid | Seasons → Approve payouts; Entitlements → Mark paid (payout tx) |

API equivalent: `curl -H "authorization: Bearer $ADMIN_TOKEN" -H "x-hw-client: 1" -H "content-type: application/json" https://<site>/api/admin/overview`

### Configuration (Cloudflare → Worker → Settings → Variables and secrets)
* `ADMIN_TOKEN` (**secret**, ≥24 chars) — enables admin. Without it admin is disabled.
* `POOL_WALLET` (plain text, public address) — enables on-chain verification.
* Optional: `SOLANA_RPC_URL` (default public mainnet RPC), `ALLOWED_ORIGINS`, `IP_SALT` (secret).

## 7. Phase-1 limitations (honest)
* Anonymous cookie identities cannot stop one person from creating several players (clearing cookies, other devices). Creation is rate-limited per IP, but this is **not** Sybil protection. That is why payouts require verification.
* Pumpkin Hunt sends the spawn schedule to the client (needed to render it); a bot could still click perfectly within human-plausible timing. Server timing rules cap what is possible; finalization review + disqualification is the backstop.
* D1 free tier: 100k row writes/day (~8 writes per play → ~10k plays/day). Upgrade to Workers Paid ($5/mo) if the Arcade grows.
* Real-money prize promotions are regulated differently per country (e.g. NL "promotionele kansspelen"). Get legal advice before paying out; the rules text says "not available where prohibited".

## 8. Phase 2 — Telegram integration boundary
* Keep `players.id` as the internal key. Link Telegram via `identity_links(provider='telegram', external_id=<telegram user id>)` — never usernames.
* Recommended flow: bot issues a short-lived one-time code (or Telegram Login Widget signature) → `POST /api/link/telegram` verifies it server-side (HMAC with the bot token) → inserts the link and sets `verified_at`.
* The bot can then read/write through the same Worker API with a service token, sharing points, leaderboard and seasons. No game code changes are needed.
* Wallets: add `identity_links(provider='solana_wallet')` after verifying a signed message (ed25519) — public key only. Apply a cooldown / manual review for wallet changes close to season end.
