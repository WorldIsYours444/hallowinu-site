-- HALLOWINU ARCADE — wallet identity, social verification, announced prize pool.
-- Replaces Phase-1 anonymous cookie players with Phantom wallet sign-in.
-- Internal key stays players.id; wallet + socials hang off player_identities.

-- ---------- players ----------
-- kind: 'legacy' = Phase-1 anonymous test player (excluded from rankings, cannot sign in)
--       'wallet' = account created by a verified Solana wallet signature
ALTER TABLE players ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE players ADD COLUMN name_key TEXT;          -- normalized name for uniqueness (lowercase, no separators)
ALTER TABLE players ADD COLUMN name_set_at INTEGER;    -- NULL until the player chose a public name
CREATE UNIQUE INDEX uq_players_name_key ON players (name_key) WHERE name_key IS NOT NULL;
CREATE INDEX idx_players_kind ON players (kind, status);

-- ---------- identities (wallet, X, Telegram) ----------
CREATE TABLE player_identities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id         TEXT NOT NULL REFERENCES players(id),
  provider          TEXT NOT NULL CHECK (provider IN ('solana_wallet','x','telegram')),
  provider_user_id  TEXT NOT NULL,                     -- wallet address / stable X user id / Telegram user id
  username          TEXT,                              -- display only, never authoritative
  verified_at       INTEGER NOT NULL,
  method            TEXT NOT NULL,                     -- 'signature' | 'oauth2' | 'oauth2+follow' | 'telegram_login+member' | 'admin_manual'
  evidence_json     TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id),                  -- one account per external identity
  UNIQUE (player_id, provider)                          -- one identity per provider per player
);
CREATE INDEX idx_identities_player ON player_identities (player_id);

INSERT INTO player_identities (player_id, provider, provider_user_id, username, verified_at, method, evidence_json, created_at, updated_at)
  SELECT player_id, provider, external_id, NULL, COALESCE(verified_at, created_at), COALESCE(verification, 'admin_manual'), NULL, created_at, created_at
  FROM identity_links WHERE provider IN ('solana_wallet','telegram');
DROP TABLE identity_links;

-- ---------- wallet sign-in nonces (single use, short lived) ----------
CREATE TABLE auth_nonces (
  nonce       TEXT PRIMARY KEY,
  wallet      TEXT NOT NULL,
  message     TEXT NOT NULL,                           -- exact text the wallet must sign
  origin      TEXT NOT NULL,
  ip_key      TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX idx_nonces_expiry ON auth_nonces (expires_at);

-- ---------- OAuth state for X (PKCE) ----------
CREATE TABLE oauth_states (
  state       TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  provider    TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- ---------- sessions ----------
-- Every Phase-1 anonymous session ends: the Arcade now requires a wallet signature.
DELETE FROM player_sessions;
ALTER TABLE player_sessions ADD COLUMN wallet TEXT;

-- ---------- seasons: announced base pool + new prize weighting ----------
ALTER TABLE seasons ADD COLUMN announced_lamports INTEGER;

UPDATE seasons
   SET distribution_json = '[3000,1750,1250,900,750,600,500,450,400,400]',
       announced_lamports = 1000000000
 WHERE id = 's01' AND status IN ('UPCOMING','ACTIVE');

-- Season 01 base pool is 1 SOL (was a pending 10 SOL commitment that was never verified).
UPDATE prize_pool_transactions
   SET status = 'REJECTED', verified_at = 1791158400000,
       notes = COALESCE(notes, '') || ' | Superseded: Season 01 base pool changed to 1 SOL.'
 WHERE season_id = 's01' AND source = 'INITIAL_FUNDING' AND status = 'PENDING' AND amount_lamports = 10000000000;

INSERT INTO prize_pool_transactions (season_id, amount_lamports, source, status, notes, created_at, actor)
  SELECT 's01', 1000000000, 'INITIAL_FUNDING', 'PENDING',
         'Season 01 base pool: 1 SOL. Counts only after an admin verifies it.', 1791158400000, 'migration'
  WHERE EXISTS (SELECT 1 FROM seasons WHERE id = 's01' AND status IN ('UPCOMING','ACTIVE'))
    AND NOT EXISTS (SELECT 1 FROM prize_pool_transactions WHERE season_id = 's01' AND source = 'INITIAL_FUNDING' AND status IN ('PENDING','VERIFIED'));

INSERT INTO audit_log (actor, action, target, details_json, created_at) VALUES
  ('migration', 'season.update', 's01', '{"distributionBps":[3000,1750,1250,900,750,600,500,450,400,400],"announcedLamports":"1000000000","why":"0003_wallet_identity"}', 1791158400000),
  ('migration', 'identity.upgrade', NULL, '{"why":"Phantom wallet sign-in replaces anonymous Phase-1 players; legacy players excluded from rankings"}', 1791158400000);
