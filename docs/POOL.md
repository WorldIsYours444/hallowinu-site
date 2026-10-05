# Community reward pool — 80% of verified maker rewards

Code: `worker/pool/ledger.js` (accounting) + `worker/pool/solana-adapter.js` (reward source). Schema: `migrations/0005_haunt_types_and_pool.sql`.
Config: `CONFIG.communityPool` (`communityBps: 8000`, asset SOL / lamports, commitment `finalized`).

## Flow
```
creator wallet RECEIVES a maker/creator reward on-chain (finalized)
  → adapter 'solana_transfer' verifies it (cron scan every 10 min, or admin "Verify & credit")
  → maker_reward_events  (UNIQUE source + external_id → idempotent)
      community = floor(gross × 8000 / 10000)   → prize_pool_transactions MAKER_REWARD VERIFIED → open Season → Top 10
      remaining = gross − community             → recorded only, stays OUTSIDE the pool
```
One atomic D1 batch writes the event, the pool row and the scan row (plus audit). A replay, a second cron run or two
admins at once can never credit the same transaction twice (UNIQUE keys; tested with concurrent calls).

## What counts as a maker reward (adapter rules)
1. transaction exists at **finalized** commitment and succeeded (`meta.err == null`)
2. `CREATOR_WALLET` is in the transaction
3. at least one account from `MAKER_REWARD_SOURCES` (launchpad fee program / creator-fee vault) is in the transaction
4. the creator wallet's SOL balance went **up**; that net delta is the gross reward (fees already subtracted)

Not counted, ever: estimated/unclaimed fees, pending transactions, failed transactions, ordinary deposits from other wallets, outgoing transfers.

## Configuration (Cloudflare → Worker → Variables — all PUBLIC values, no secrets)
| Variable | Meaning |
|---|---|
| `CREATOR_WALLET` | public address that receives the creator/maker rewards |
| `MAKER_REWARD_SOURCES` | comma-separated public accounts that pay those rewards (fee program / vault) |
| `MAKER_REWARD_SINCE` | optional unix seconds; older transactions are ignored |
| `SOLANA_RPC_URL` | optional dedicated RPC (default public mainnet RPC) |

Until `CREATOR_WALLET` + `MAKER_REWARD_SOURCES` are set: state **AWAITING_REWARD_SOURCE**, no RPC calls, no values shown.
Configured but no reward yet: **WAITING_FOR_FIRST_REWARD**. After the first event: **LIVE**.

## No automatic transfers
This is an accounting ledger. It never moves funds and needs no private key. Prizes are still approved by the team and paid
manually (Entitlements → Mark paid with the payout tx). Automatic transfers would require a hot wallet key on the server and are
deliberately not built.

## Seasons
Community money goes to the season that is running now, else the next UPCOMING one. A frozen/finalized season never receives
new money. If no season is open, the event is held **unassigned** and attached exactly once when the next season is created (or on the next cron).

## Admin (`/admin.html` → Community reward pool)
* Verify & credit a signature now · Scan wallet now
* Reconciliation: totals (received, 80%, 20%, unassigned, adjustments, paid out, owed) + automatic checks (split, bps, pool row per event, totals) → "Reconciliation OK" or the exact issue
* Labelled adjustment (lamports, reason ≥ 10 chars, confirmation `I CONFIRM THIS ADJUSTMENT`, never shown as maker revenue, pool can't go negative, refused on frozen seasons)
* Void an event (reward clawed back) → reverses its community share via a labelled `EVENT_VOID` adjustment
* Manual funding (`POST /api/admin/funding`) and the announced pool are **retired** (410).

## Public API
`GET /api/pool` → `{ state, communityPercent, totals (LIVE only), season { poolSol }, recent [ signature, communitySol, at ], lastScanAt }`.
Shown on `/leaderboard#pool`, in the Arcade prize panel and on `/token` (model explanation).

## Tests
`test/pool.test.mjs`: 80/20 integer split + rounding, adapter rules, awaiting state, valid / invalid / unconfirmed / failed / foreign tx,
replay, multiple events via cron, concurrency, adjustments (auth, reason, confirmation, negative guard), void, unassigned → next season, reconciliation.
