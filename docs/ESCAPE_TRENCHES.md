# HALLOWINU — ESCAPE THE TRENCHES

Standalone 3D voxel endless runner at **`/escape-the-trenches`** (opens in a new tab from the
"ESCAPE THE TRENCHES" button in the site header, mobile menu and footer). It is **not** part of the
Arcade: own page, own menus, own leaderboard. Points land in the existing HALLOWINU point ledger.

## 1. Architecture

```
Browser  dist/escape-the-trenches.html + dist/ett/*            Worker  worker/games/escape-the-trenches.js
  game.js   UI, input, run lifecycle, uploads                       start  → auto-redeem previous runs, new server seed
  world.js  Three.js renderer (presentation only)        ──/api/ett/*──►  finish → REPLAY the run with sim.js, store result
  sim.js    DETERMINISTIC game rules  ◄──── same file ────────────── imported by the Worker
  config.js coin values, rarity, speed, obstacles  ◄──── same file ── imported by the Worker
```

* `dist/ett/sim.js` is pure JavaScript (no DOM, no clock, no `Math.random`, only + − × ÷ and integer ops)
  so the browser and the Worker produce bit-identical results.
* Fixed 60 Hz simulation; the renderer interpolates between ticks.
* Three.js r186 is vendored as one bundle (`dist/ett/vendor/three.bundle.js`, MIT) — no CDN at runtime.
* All models are original code-built voxels (`dist/ett/models.js`); music + SFX are synthesized with
  Web Audio (`dist/ett/audio.js`) — no third-party assets.

| File | Purpose |
|---|---|
| `dist/ett/config.js` | **Central game config**: coin values + rarity weights, lanes, jump/slide physics, speed curve, obstacle catalogue, generation rules |
| `dist/ett/sim.js` | Seeded PRNG, world generation with fairness rules, collisions, coins, stats, `replayRun()` |
| `dist/ett/world.js` | Scene, sky/moon, biomes, road, instanced scenery, obstacle/coin pools, chase, particles, camera, quality presets |
| `dist/ett/models.js` | 4 Inus, skeleton, bone dog, obstacles, wagons, coins, props |
| `dist/ett/game.js` | Screens, keyboard/buttons/swipes, fullscreen, settings, leaderboard, uploads |
| `worker/games/escape-the-trenches.js` | Run start/finish, server replay verification, auto-redemption, history, leaderboard, admin review |
| `worker/config.js` → `CONFIG.escapeTrenches` | Reward rules: season credit, daily cap, rate limits, review thresholds |
| `migrations/0006_escape_the_trenches.sql` | `ett_runs`, `ett_daily` |

## 2. Gameplay rules (all in `dist/ett/config.js`)

* Three lanes (x = −2.5 / 0 / +2.5 m). ← → switch, SPACE jump, ↓ duck/slide (↓ in the air = slam down).
  Extra keys: A/D/W/S/↑, plus one optional custom key per action (Settings). Mobile: swipes + 4 buttons.
* Obstacles: **low** (grave, pumpkin, low wall, bone fence, crashed chart, mine cart) → jump or switch;
  **high** (chain, branch, floating ghost) → slide or switch; **full** (bear candle, funeral wagon,
  cursed carriage, ghost cargo wagon, abandoned cursed wagon) → switch lane. Some wagons drive towards you.
* Front hit = crash. Bumping a wagon's side while switching = stumble (the skeleton and bone dog catch up);
  a second stumble within 6 s = caught.
* Speed 13 → 31 m/s over 5.2 km; difficulty ramps over 4.2 km.
* **Fairness**: every row is generated so that from every group of lanes you could be in, at least one lane
  of that group stays passable; moving wagons keep their lane clear; coins are never inside solids or in a
  wagon's path. `npm test` checks this on long generated worlds and lets a look-ahead bot run 3.5 km on
  several seeds.
* Coins: **HALLOWINU +1** (weight 98.3), **USDC +5** (weight 1.5, ≈3 per km), **SOLANA +10** (weight 0.2, ≈1 per 2 km), plus rare
  bonus spots (arc apex over a jump, under a chain, beside a wagon) that hold USDC/SOLANA. Weights are
  relative, not a per-run guarantee. Distance never adds redeemable points.
* Characters are cosmetic only: identical speed, jump and hitbox.

## 3. Points, verification & automatic redemption

1. **PLAY** → `POST /api/ett/start {idem, character}`:
   first every VALIDATED + PENDING run of the player is redeemed, then a new run with a fresh random server seed is created.
2. The browser plays the seed and records every input as `(tick, action)`.
3. **Game over** → `POST /api/ett/finish {runId, ticks, inputs, score, dead}`. The Worker replays the run
   with `sim.js` and stores the **server's** result. Rejected when:
   `MISMATCH` (claimed score/death differs from the replay) · `TOO_FAST` (more game time than real time since start) ·
   `INPUT_RATE` (> 14 inputs/s average) · `BAD_INPUTS` · `EXPIRED` (> 7 days) · `RULES_CHANGED`.
   The run is now `VALIDATED` + redemption `PENDING` (or `REJECTED`).
4. The next **PLAY** (also on a later visit) redeems it: one atomic D1 batch writes
   `point_transactions` (`currency ARCADE_POINTS`, `source_type ESCAPE_TRENCHES`, `reference_id 'ett:<run id>'` UNIQUE),
   `players.total_points` / `xp`, `ett_daily`, and marks the run `REDEEMED`. A duplicate reference rolls the whole
   batch back → a run can **never** be credited twice.
5. If the upload fails (offline, closed tab), the payload stays in `localStorage` and is re-sent before the next start.
   Runs that are never finished become `ABANDONED` after 8 days (cron).

States per run: `state` ACTIVE/FINISHED/ABANDONED · `verification` PENDING/VALIDATED/REJECTED ·
`redemption` PENDING/REDEEMED/NONE. Only VALIDATED runs appear on leaderboards.

### Reward settings (admin console → settings, no deploy needed)

| Setting | Default | Meaning |
|---|---|---|
| `ett.rewardsEnabled` | `true` | `false` = runs are still verified and ranked, but nothing is credited |
| `ett.dailyCap` | `1000` | max points credited per player per UTC day (plays stay unlimited) |
| `ett.seasonCredit` | **`false`** | `true` = runner points also count for the Season SOL prize ranking |

Runner points always count for **lifetime Arcade Points**; Season credit (= real SOL prizes) is **off by default**.

### Admin review
* `GET /api/admin/ett/runs?filter=flagged|rejected` — recent runs with flags (`HIGH_RATE`, `LONG_RUN`, `DAILY_CAP`, `TRAILING_INPUTS`).
* `POST /api/admin/ett/runs/<id>/reject {reason}` — rejects a run; if it was already credited the points are reversed
  in the ledger (`ESCAPE_TRENCHES_VOID`) and the action is audited.

## 4. Honest limitations

* The seed is known to the browser while playing (it has to render the world). A scripted bot that plays in real
  time with perfect reactions produces a *valid* run. Replay verification stops forged scores, speed-hacks and
  tampered logs — not a perfect bot. That is why Season credit is opt-in, credit is capped per day and long or
  unusually fast-scoring runs are flagged for review.
* Replaying costs Worker CPU: ≈ 0.7 ms per 1,000 ticks (a 4-minute run ≈ 10 ms). The Workers **free** plan
  allows 10 ms CPU per request, so long runs need **Workers Paid** ($5/month), which the Arcade already recommends.
* iPhone Safari has no fullscreen API for pages: the game falls back to full-window mode and suggests
  "Add to Home Screen".

## 5. Tests

* `npm test` — includes `test/ett.test.mjs` (determinism, lanes/physics, obstacle actions, stumble/caught,
  fairness, coin rarity, server verification, tampering, idempotent auto-redemption, daily cap, season opt-in,
  admin reversal).
* `NODE_PATH=$(npm root -g) node test/e2e-ett.mjs` (dev server running) — full browser flow with a mock Phantom
  wallet: guest run, sign-in, character choice, real-time run, server verification, auto-redemption on PLAY AGAIN,
  leaderboard + history.

## 6. Deploy

Push to `main` as usual. Workers Builds runs `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`,
which applies `0006_escape_the_trenches.sql` automatically. No new secrets are needed.
