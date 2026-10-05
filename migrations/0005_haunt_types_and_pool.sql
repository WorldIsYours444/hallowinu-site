-- HALLOWINU — Haunt submission types (X reply / X post / X meme / TikTok) + automated community reward pool.
-- Safe migration: existing rows are copied, nothing is deleted.

-- =====================================================================
-- 1) haunt_submissions: platform-neutral identity (rebuild, data preserved)
-- =====================================================================
CREATE TABLE haunt_submissions_v2 (
  id                   TEXT PRIMARY KEY,
  player_id            TEXT NOT NULL REFERENCES players(id),
  platform             TEXT NOT NULL CHECK (platform IN ('X','TIKTOK')),
  external_id          TEXT NOT NULL,                     -- X status id / TikTok video id
  submission_type      TEXT NOT NULL CHECK (submission_type IN ('X_REPLY','X_POST','X_MEME','TIKTOK_POST')),
  x_user_id            TEXT,                              -- connected X account at submit time (X types)
  x_status_id          TEXT,                              -- X types only (kept for compatibility)
  author_handle        TEXT,                              -- TikTok @handle / X username as reported by the platform
  target_id            INTEGER REFERENCES haunt_targets(id),
  normalized_url       TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('RECEIVED','VERIFYING','AUTO_APPROVED','AUTO_REJECTED','VERIFICATION_PENDING','MANUAL_REVIEW','MANUAL_APPROVED','MANUAL_REJECTED','INVALIDATED')),
  reason               TEXT,
  reply_author_id      TEXT,
  parent_status_id     TEXT,
  conversation_id      TEXT,
  reply_created_at     INTEGER,
  media_count          INTEGER,
  content_fingerprint  TEXT,
  text_excerpt         TEXT,
  crypto_relevance     INTEGER,
  points_awarded       INTEGER NOT NULL DEFAULT 0,
  checks_json          TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  next_retry_at        INTEGER,
  ip_key               TEXT,
  reviewed_by          TEXT,
  created_at           INTEGER NOT NULL,
  verified_at          INTEGER,
  updated_at           INTEGER NOT NULL,
  UNIQUE (platform, external_id)                          -- one post/video can only ever be submitted once
);
INSERT INTO haunt_submissions_v2 (id, player_id, platform, external_id, submission_type, x_user_id, x_status_id, target_id, normalized_url, status, reason,
  reply_author_id, parent_status_id, conversation_id, reply_created_at, content_fingerprint, text_excerpt, crypto_relevance, points_awarded, checks_json,
  attempts, next_retry_at, ip_key, created_at, verified_at, updated_at)
SELECT id, player_id, 'X', x_status_id, 'X_REPLY', x_user_id, x_status_id, target_id, normalized_url, status, reason,
  reply_author_id, parent_status_id, conversation_id, reply_created_at, content_fingerprint, text_excerpt, crypto_relevance, points_awarded, checks_json,
  attempts, next_retry_at, ip_key, created_at, verified_at, updated_at
FROM haunt_submissions;
DROP TABLE haunt_submissions;
ALTER TABLE haunt_submissions_v2 RENAME TO haunt_submissions;
CREATE INDEX idx_hs_player_time ON haunt_submissions (player_id, created_at DESC);
CREATE INDEX idx_hs_player_type ON haunt_submissions (player_id, submission_type, created_at DESC);
CREATE INDEX idx_hs_status_time ON haunt_submissions (status, verified_at DESC);
CREATE INDEX idx_hs_target ON haunt_submissions (target_id, status);
CREATE INDEX idx_hs_fingerprint ON haunt_submissions (content_fingerprint, created_at);
CREATE INDEX idx_hs_retry ON haunt_submissions (status, next_retry_at);

-- =====================================================================
-- 2) Community reward pool: 80% of VERIFIED, RECEIVED maker/creator rewards
-- =====================================================================
CREATE TABLE maker_reward_events (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  source                 TEXT NOT NULL,                    -- adapter id, e.g. 'solana_transfer'
  external_id            TEXT NOT NULL,                    -- on-chain tx signature / provider event id
  asset                  TEXT NOT NULL,                    -- 'SOL' (base unit: lamports)
  decimals               INTEGER NOT NULL,
  gross_base_units       INTEGER NOT NULL CHECK (gross_base_units > 0),
  community_bps          INTEGER NOT NULL CHECK (community_bps BETWEEN 0 AND 10000),
  community_base_units   INTEGER NOT NULL,
  remaining_base_units   INTEGER NOT NULL,                 -- the 20% that stays OUTSIDE the community pool
  receiver               TEXT NOT NULL,                    -- public creator wallet that received it
  payer_hint             TEXT,                             -- recognized reward-source account found in the tx
  block_time             INTEGER,
  slot                   INTEGER,
  confirmation           TEXT NOT NULL,                    -- 'finalized'
  status                 TEXT NOT NULL CHECK (status IN ('PROCESSED','VOIDED')),
  season_id              TEXT REFERENCES seasons(id),      -- season prize pool that received the community share (NULL = unassigned)
  evidence_json          TEXT,
  created_at             INTEGER NOT NULL,
  processed_at           INTEGER NOT NULL,
  actor                  TEXT NOT NULL,                    -- 'cron' | 'admin:…'
  void_reason            TEXT,
  voided_at              INTEGER,
  UNIQUE (source, external_id),                            -- one reward event can never fund the pool twice
  CHECK (community_base_units + remaining_base_units = gross_base_units)
);
CREATE INDEX idx_mre_time ON maker_reward_events (processed_at DESC);

-- every transaction of the creator wallet that the scanner already looked at (no repeated RPC work)
CREATE TABLE maker_reward_scan (
  external_id   TEXT PRIMARY KEY,
  result        TEXT NOT NULL,                             -- PROCESSED | NOT_A_REWARD | FAILED_TX | PENDING_CONFIRMATION | ERROR
  detail        TEXT,
  checked_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1
);

-- labelled, reasoned, audited admin corrections (never shown as maker revenue)
CREATE TABLE community_pool_adjustments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id     TEXT NOT NULL REFERENCES seasons(id),
  kind          TEXT NOT NULL CHECK (kind IN ('ADJUSTMENT','EVENT_VOID')),
  maker_event_id INTEGER REFERENCES maker_reward_events(id),
  asset         TEXT NOT NULL,
  base_units    INTEGER NOT NULL CHECK (base_units != 0),
  reason        TEXT NOT NULL,
  actor         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- prize-pool rows created by the maker-reward pipeline link back to their event
ALTER TABLE prize_pool_transactions ADD COLUMN maker_event_id INTEGER REFERENCES maker_reward_events(id);

-- The community pool replaces manual funding: the pending manual base pool and the public "announced" amount are retired.
UPDATE prize_pool_transactions
   SET status = 'REJECTED', verified_at = 1791331200000,
       notes = COALESCE(notes, '') || ' | Retired: Season rewards are now funded automatically by 80% of verified maker rewards.'
 WHERE status = 'PENDING' AND source IN ('INITIAL_FUNDING','MANUAL_CONTRIBUTION');
UPDATE seasons SET announced_lamports = NULL WHERE status IN ('UPCOMING','ACTIVE');
INSERT INTO audit_log (actor, action, target, details_json, created_at) VALUES
  ('migration', 'pool.model', NULL, '{"model":"80% of verified maker rewards -> community pool; manual funding + announced pool retired","why":"0005"}', 1791331200000);
