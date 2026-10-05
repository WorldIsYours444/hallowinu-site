-- THE HAUNT — X raid board with automatic verification.
-- Strict entity boundaries:
--   haunt_targets      = SYSTEM/ADMIN content (what to raid). Only admins (or the future discovery job) create rows.
--   haunt_submissions  = USER content (proof of a reply). Never becomes a target, never shown as instructions.
-- Haunt XP is a separate currency from Arcade Points: it never counts toward Season SOL prizes.

-- ---------- ledger: source + currency (existing rows = Arcade points) ----------
ALTER TABLE point_transactions ADD COLUMN source_type TEXT NOT NULL DEFAULT 'ARCADE_GAME';
ALTER TABLE point_transactions ADD COLUMN source_id TEXT;
ALTER TABLE point_transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'ARCADE_POINTS';   -- 'ARCADE_POINTS' | 'HAUNT_XP'
CREATE INDEX idx_ptx_source ON point_transactions (source_type, source_id);

-- ---------- player haunt totals (caches; the ledger is authoritative) ----------
ALTER TABLE players ADD COLUMN haunt_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN haunt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN haunt_last_at INTEGER;

-- ---------- OAuth return page (arcade / haunt) ----------
ALTER TABLE oauth_states ADD COLUMN return_to TEXT;

-- ---------- targets (system/admin content) ----------
CREATE TABLE haunt_targets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,   -- shown as HAUNT #id
  kind               TEXT NOT NULL DEFAULT 'CURATED' CHECK (kind IN ('CURATED','DISCOVERED')),
  x_status_id        TEXT NOT NULL UNIQUE,
  url                TEXT NOT NULL,
  author_id          TEXT NOT NULL,
  author_username    TEXT,
  conversation_id    TEXT,
  posted_at          INTEGER,                             -- creation time of the target post on X
  text_preview       TEXT,                                -- first 280 chars, display only
  category           TEXT NOT NULL,
  reward             INTEGER NOT NULL CHECK (reward >= 0 AND reward <= 1000),
  max_submissions    INTEGER,                             -- NULL = unlimited
  active             INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER,                             -- NULL = no expiry
  updated_at         INTEGER NOT NULL,
  evidence_json      TEXT
);
CREATE INDEX idx_haunt_targets_active ON haunt_targets (active, expires_at);

-- ---------- submissions (user content) ----------
CREATE TABLE haunt_submissions (
  id                   TEXT PRIMARY KEY,                  -- hs_…
  player_id            TEXT NOT NULL REFERENCES players(id),
  x_user_id            TEXT NOT NULL,                     -- connected X account at submit time
  x_status_id          TEXT NOT NULL UNIQUE,              -- one reply can only ever be submitted once
  target_id            INTEGER REFERENCES haunt_targets(id),
  submission_type      TEXT NOT NULL DEFAULT 'X_REPLY',
  normalized_url       TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('RECEIVED','VERIFYING','AUTO_APPROVED','AUTO_REJECTED','VERIFICATION_PENDING','MANUAL_REVIEW','INVALIDATED')),
  reason               TEXT,                              -- machine code, e.g. AUTHOR_MISMATCH
  reply_author_id      TEXT,
  parent_status_id     TEXT,
  conversation_id      TEXT,
  reply_created_at     INTEGER,
  content_fingerprint  TEXT,
  text_excerpt         TEXT,                              -- evidence (first 280 chars), never rendered as HTML
  crypto_relevance     INTEGER,
  points_awarded       INTEGER NOT NULL DEFAULT 0,
  checks_json          TEXT,                              -- every check + result (audit trail)
  attempts             INTEGER NOT NULL DEFAULT 0,
  next_retry_at        INTEGER,
  ip_key               TEXT,
  created_at           INTEGER NOT NULL,
  verified_at          INTEGER,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_hs_player_time ON haunt_submissions (player_id, created_at DESC);
CREATE INDEX idx_hs_status_time ON haunt_submissions (status, verified_at DESC);
CREATE INDEX idx_hs_target ON haunt_submissions (target_id, status);
CREATE INDEX idx_hs_fingerprint ON haunt_submissions (content_fingerprint, created_at);
CREATE INDEX idx_hs_retry ON haunt_submissions (status, next_retry_at);

-- ---------- X API cache + usage metering ----------
CREATE TABLE x_api_cache (
  cache_key   TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE x_api_usage (
  day          TEXT NOT NULL,                             -- UTC YYYY-MM-DD
  endpoint     TEXT NOT NULL,
  requests     INTEGER NOT NULL DEFAULT 0,
  resources    INTEGER NOT NULL DEFAULT 0,
  cache_hits   INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  cost_micros  INTEGER NOT NULL DEFAULT 0,                -- estimated cost in millionths of a USD
  PRIMARY KEY (day, endpoint)
);
