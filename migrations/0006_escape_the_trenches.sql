-- HALLOWINU — ESCAPE THE TRENCHES (standalone 3D runner at /escape-the-trenches)
-- Every run gets a server seed; the browser uploads its input log and the Worker replays the run
-- with the shared simulation (dist/ett/sim.js) to compute the score. Points of a VALIDATED run are
-- redeemed into the existing point ledger (point_transactions, currency ARCADE_POINTS,
-- source_type ESCAPE_TRENCHES, reference_id 'ett:<run id>' → can never be credited twice)
-- automatically when the player starts the next run.

CREATE TABLE ett_runs (
  id                 TEXT PRIMARY KEY,                -- 'r_' + random, server generated
  player_id          TEXT NOT NULL REFERENCES players(id),
  idem_key           TEXT NOT NULL,
  seed               TEXT NOT NULL,                   -- server-generated random seed (never client supplied)
  rules_version      INTEGER NOT NULL,
  character          TEXT NOT NULL DEFAULT 'hallow-inu',
  state              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','FINISHED','ABANDONED')),
  verification       TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification IN ('PENDING','VALIDATED','REJECTED')),
  redemption         TEXT NOT NULL DEFAULT 'PENDING' CHECK (redemption IN ('PENDING','REDEEMED','NONE')),
  reject_reason      TEXT,
  flags              TEXT,                            -- comma separated review flags
  -- authoritative results (from the server replay)
  score              INTEGER NOT NULL DEFAULT 0,
  distance           INTEGER NOT NULL DEFAULT 0,      -- metres
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  ticks              INTEGER NOT NULL DEFAULT 0,
  jumps              INTEGER NOT NULL DEFAULT 0,
  slides             INTEGER NOT NULL DEFAULT 0,
  left_switches      INTEGER NOT NULL DEFAULT 0,
  right_switches     INTEGER NOT NULL DEFAULT 0,
  coins_hallowinu    INTEGER NOT NULL DEFAULT 0,
  coins_usdc         INTEGER NOT NULL DEFAULT 0,
  coins_solana       INTEGER NOT NULL DEFAULT 0,
  max_speed_x10      INTEGER NOT NULL DEFAULT 0,      -- m/s × 10
  stumbles           INTEGER NOT NULL DEFAULT 0,
  near_misses        INTEGER NOT NULL DEFAULT 0,
  end_reason         TEXT,
  -- what the browser claimed (kept for review)
  claimed_score      INTEGER,
  input_count        INTEGER NOT NULL DEFAULT 0,
  inputs_json        TEXT,                            -- encoded input log (audit / re-verification)
  awarded_points     INTEGER NOT NULL DEFAULT 0,      -- what was actually credited (daily cap may lower it)
  season_id          TEXT REFERENCES seasons(id),     -- set only when season credit is enabled
  started_at         INTEGER NOT NULL,
  finished_at        INTEGER,
  redeemed_at        INTEGER,
  UNIQUE (player_id, idem_key)
);
CREATE INDEX idx_ett_player ON ett_runs (player_id, started_at DESC);
CREATE INDEX idx_ett_pending ON ett_runs (player_id, verification, redemption);
CREATE INDEX idx_ett_board ON ett_runs (verification, finished_at);
CREATE INDEX idx_ett_active ON ett_runs (state, started_at);

-- Daily redemption counter. The CHECK makes an over-cap redemption fail inside the atomic batch,
-- so two parallel requests can never exceed the cap together.
CREATE TABLE ett_daily (
  player_id TEXT NOT NULL REFERENCES players(id),
  day       TEXT NOT NULL,                            -- 'YYYY-MM-DD' (UTC)
  redeemed  INTEGER NOT NULL DEFAULT 0,
  cap       INTEGER NOT NULL,
  PRIMARY KEY (player_id, day),
  CHECK (redeemed <= cap)
);
