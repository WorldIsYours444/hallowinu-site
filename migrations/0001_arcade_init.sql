-- HALLOWINU ARCADE — initial schema
-- All timestamps are epoch milliseconds (server time).
-- Lamport amounts are INTEGER (1 SOL = 1_000_000_000 lamports).

CREATE TABLE players (
  id               TEXT PRIMARY KEY,               -- server-generated, never user supplied
  display_name     TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  name_changed_at  INTEGER,
  total_points     INTEGER NOT NULL DEFAULT 0,      -- cache; point_transactions is authoritative
  xp               INTEGER NOT NULL DEFAULT 0,
  level            INTEGER NOT NULL DEFAULT 1,
  games_played     INTEGER NOT NULL DEFAULT 0,
  wins             INTEGER NOT NULL DEFAULT 0,
  losses           INTEGER NOT NULL DEFAULT 0,
  current_streak   INTEGER NOT NULL DEFAULT 0,
  best_streak      INTEGER NOT NULL DEFAULT 0,
  last_point_at    INTEGER,
  payout_verified  INTEGER NOT NULL DEFAULT 0       -- Phase 1: always 0 unless an admin verifies identity + wallet
);
CREATE INDEX idx_players_alltime ON players (total_points DESC, last_point_at ASC);

CREATE TABLE player_sessions (
  token_hash   TEXT PRIMARY KEY,                    -- SHA-256 of the cookie token; raw token never stored
  player_id    TEXT NOT NULL REFERENCES players(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_player ON player_sessions (player_id);

-- Future identity providers (Telegram, Solana wallet). player_id stays the internal key.
CREATE TABLE identity_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL REFERENCES players(id),
  provider     TEXT NOT NULL CHECK (provider IN ('telegram','solana_wallet')),
  external_id  TEXT NOT NULL,
  verified_at  INTEGER,
  verification TEXT,                                -- e.g. 'signature', 'admin_manual'
  created_at   INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);
CREATE INDEX idx_identity_player ON identity_links (player_id);

CREATE TABLE seasons (
  id                    TEXT PRIMARY KEY,           -- e.g. 's01'
  name                  TEXT NOT NULL,
  starts_at             INTEGER NOT NULL,
  ends_at               INTEGER NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('UPCOMING','ACTIVE','FINALIZING','FINALIZED')),
  distribution_json     TEXT NOT NULL,              -- basis points per rank, sums to 10000
  rules_json            TEXT NOT NULL DEFAULT '{}',
  frozen_pool_lamports  INTEGER,                    -- set at finalization
  finalized_at          INTEGER,
  approved_at           INTEGER,
  created_at            INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);

-- Auditable point ledger. reference_id makes every reward idempotent.
CREATE TABLE point_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT NOT NULL REFERENCES players(id),
  season_id    TEXT REFERENCES seasons(id),
  game         TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_ptx_player ON point_transactions (player_id, created_at DESC);
CREATE INDEX idx_ptx_season ON point_transactions (season_id, player_id);

-- One row per game play (all games).
CREATE TABLE game_attempts (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id),
  game         TEXT NOT NULL,
  idem_key     TEXT NOT NULL,
  period_key   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','complete','void')),
  points       INTEGER NOT NULL DEFAULT 0,
  result_json  TEXT,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (player_id, game, idem_key)
);
CREATE INDEX idx_attempts_player ON game_attempts (player_id, created_at DESC);

-- Shared daily-limit counters. Atomic upsert with WHERE used < limit.
CREATE TABLE usage_limits (
  player_id  TEXT NOT NULL,
  game       TEXT NOT NULL,
  period_key TEXT NOT NULL,                         -- 'YYYY-MM-DD' (UTC)
  used       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, game, period_key)
);

-- Shared rolling cooldowns (e.g. Daily Spin 24h).
CREATE TABLE cooldowns (
  player_id TEXT NOT NULL,
  game      TEXT NOT NULL,
  next_at   INTEGER NOT NULL,
  PRIMARY KEY (player_id, game)
);

CREATE TABLE hunt_sessions (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id),
  attempt_id   TEXT NOT NULL REFERENCES game_attempts(id),
  created_at   INTEGER NOT NULL,
  starts_at    INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  targets_json TEXT NOT NULL,                       -- authoritative board (server copy)
  status       TEXT NOT NULL CHECK (status IN ('active','finished')),
  score        INTEGER,
  finished_at  INTEGER,
  flags        TEXT
);
-- At most one active hunt per player.
CREATE UNIQUE INDEX uq_hunt_active ON hunt_sessions (player_id) WHERE status = 'active';

CREATE TABLE hunt_claims (
  session_id TEXT NOT NULL REFERENCES hunt_sessions(id),
  target_id  TEXT NOT NULL,
  target_type TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  PRIMARY KEY (session_id, target_id)
);

CREATE TABLE quiz_questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  question      TEXT NOT NULL,
  answers_json  TEXT NOT NULL,                      -- JSON array of 4 strings
  correct_index INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE quiz_attempts (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players(id),
  question_id  INTEGER NOT NULL REFERENCES quiz_questions(id),
  rewarded     INTEGER NOT NULL,
  order_json   TEXT NOT NULL,                       -- shuffled index order shown to player
  status       TEXT NOT NULL CHECK (status IN ('pending','answered','expired')),
  choice       INTEGER,
  correct      INTEGER,
  points       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  answered_at  INTEGER
);
-- A rewarded question can be served to a player only once (anti-farming).
CREATE UNIQUE INDEX uq_quiz_rewarded ON quiz_attempts (player_id, question_id) WHERE rewarded = 1;
CREATE INDEX idx_quiz_player ON quiz_attempts (player_id, created_at DESC);
-- At most one open question per player (prevents parallel streak races).
CREATE UNIQUE INDEX uq_quiz_pending ON quiz_attempts (player_id) WHERE status = 'pending';

-- Generic per-player counters (feeds achievements; extensible for new games).
CREATE TABLE player_counters (
  player_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, key)
);

CREATE TABLE player_achievements (
  player_id      TEXT NOT NULL REFERENCES players(id),
  achievement_id TEXT NOT NULL,
  unlocked_at    INTEGER NOT NULL,
  PRIMARY KEY (player_id, achievement_id)
);

CREATE TABLE season_player_stats (
  season_id    TEXT NOT NULL REFERENCES seasons(id),
  player_id    TEXT NOT NULL REFERENCES players(id),
  points       INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,                    -- time the current score was reached (tie-break)
  PRIMARY KEY (season_id, player_id)
);
CREATE INDEX idx_season_rank ON season_player_stats (season_id, points DESC, updated_at ASC);

CREATE TABLE season_disqualifications (
  season_id  TEXT NOT NULL REFERENCES seasons(id),
  player_id  TEXT NOT NULL REFERENCES players(id),
  reason     TEXT NOT NULL,
  evidence   TEXT,
  actor      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, player_id)
);

-- Permanent snapshot taken when a season ends.
CREATE TABLE season_final_standings (
  season_id   TEXT NOT NULL REFERENCES seasons(id),
  rank        INTEGER NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id),
  display_name TEXT NOT NULL,
  points      INTEGER NOT NULL,
  reached_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (season_id, player_id)
);
CREATE INDEX idx_final_rank ON season_final_standings (season_id, rank);

CREATE TABLE prize_entitlements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id       TEXT NOT NULL REFERENCES seasons(id),
  rank            INTEGER NOT NULL,
  player_id       TEXT NOT NULL REFERENCES players(id),
  bps             INTEGER NOT NULL,
  amount_lamports INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('FINALIZING','APPROVED','PAID','DISQUALIFIED')),
  payout_tx       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (season_id, player_id)
);
CREATE INDEX idx_entitlements_season ON prize_entitlements (season_id, rank);

-- Prize pool funding ledger. Only VERIFIED rows count toward the public pool.
CREATE TABLE prize_pool_transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id           TEXT NOT NULL REFERENCES seasons(id),
  amount_lamports     INTEGER NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('INITIAL_FUNDING','MAKER_REWARD','MANUAL_CONTRIBUTION','ADJUSTMENT')),
  tx_signature        TEXT UNIQUE,                  -- a signature can never be credited twice
  status              TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  verification_method TEXT,                         -- 'onchain' | 'admin_manual'
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  verified_at         INTEGER,
  actor               TEXT NOT NULL,
  CHECK (source = 'ADJUSTMENT' OR amount_lamports > 0)
);
CREATE INDEX idx_pool_season ON prize_pool_transactions (season_id, status);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  details_json TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
