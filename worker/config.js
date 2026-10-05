/* =========================================================
   HALLOWINU ARCADE — CENTRAL CONFIGURATION
   Every tunable game/reward/season number lives here.
   Game engine code reads from this file only.
   Runtime overrides (admin "settings" table) are limited to
   the keys listed in OVERRIDABLE_SETTINGS.
   ========================================================= */

import { SITE } from './site-meta.js';
const GAME_META = Object.fromEntries(SITE.games.map(g => [g.id, g]));

export const CONFIG = {
  /* Day boundary for daily limits: 00:00 UTC (02:00 CEST / 01:00 CET). */
  dayBoundary: 'UTC',

  session: {
    cookieName: 'hw_sid',
    ttlDays: 30,                       // wallet sessions expire; a new signature rotates the token
  },

  /* Phantom / Solana wallet sign-in (message signing, never a transaction). */
  auth: {
    nonceTtlMs: 5 * 60_000,            // a sign-in request is valid for 5 minutes and usable once
    noncesPerIpPerHour: 60,
    verifyPerIpPerHour: 60,
    newPlayersPerIpPerHour: 10,        // anti-spam, not anti-Sybil (see docs)
    statement: 'Sign in to the HALLOWINU Arcade.',
  },

  /* Social eligibility. Both X and Telegram must be verified for prize eligibility. */
  socials: {
    xHandle: SITE.links.xHandle,       // official account players must follow (tools/site/site.json)
    xFollowPages: 1,                   // pages of the player's "following" list checked (1000 most recent follows each)
    // The X "following" lookup is billed per returned user ($0.01 each → up to $10 per check), so it is OFF by
    // default. With it off, X verification = proven ownership of the X account (OAuth). Env X_FOLLOW_CHECK=on enables it.
    xFollowCheckDefault: false,
    telegramMaxAuthAgeSec: 24 * 3600,  // Telegram login data older than this is rejected
    oauthStateTtlMs: 10 * 60_000,
  },

  names: {
    minLength: 3,
    maxLength: 16,
    pattern: /^[A-Za-z0-9 _.\-]+$/,
    changeCooldownMs: 24 * 60 * 60 * 1000,
    // Compared against the normalized name (lowercase, separators removed, 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s).
    reserved: ['admin', 'system', 'hallowinu', 'moderator', 'official', 'support', 'helpdesk'],      // blocked anywhere in the name
    reservedExact: ['mod', 'mods', 'dev', 'devs', 'bot', 'team', 'staff', 'root', 'owner', 'null', 'undefined'],
    profanity: ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rape', 'hitler', 'nazi', 'porn', 'dick', 'pussy', 'cock'],
  },

  rateLimits: {
    // requests per window (fixed window, per player)
    gameActions: { limit: 40, windowMs: 60_000 },
    huntClaims: { limit: 25, windowMs: 10_000 },
    reads: { limit: 120, windowMs: 60_000 },
    socialChecks: { limit: 10, windowMs: 10 * 60_000 },
    adminFailures: { limit: 10, windowMs: 15 * 60_000 },
  },

  games: {
    'trick-or-treat': {
      name: GAME_META['trick-or-treat'].name,
      enabled: true,
      limit: { type: 'daily', count: 3 },
      xpPerPlay: 5,
      // Weighted outcome tables. weight = percent. Must sum to 100.
      tables: {
        treat: [
          { weight: 60, points: 5, label: 'TREAT!' },
          { weight: 25, points: 10, label: 'SWEET TREAT!' },
          { weight: 10, points: 25, label: 'LUCKY GHOST!' },
          { weight: 4, points: 50, label: 'LUCKY GHOST!' },
          { weight: 1, points: 150, label: 'JACKPOT!' },
        ],
        trick: [
          { weight: 45, points: 0, label: 'NOTHING BUT BONES!' },
          { weight: 30, points: 10, label: 'TRICK!' },
          { weight: 15, points: 25, label: 'GHOSTED… IN YOUR FAVOUR!' },
          { weight: 8, points: 50, label: 'LUCKY GHOST!' },
          { weight: 2, points: 200, label: 'JACKPOT!' },
        ],
      },
    },

    'pumpkin-hunt': {
      name: GAME_META['pumpkin-hunt'].name,
      enabled: true,
      limit: { type: 'daily', count: 2 },
      xpPerPlay: 10,
      countdownMs: 3000,      // 3-2-1 before the board goes live
      durationMs: 30_000,
      finishGraceMs: 4000,    // late network grace after the timer
      targetCount: 28,
      targets: {
        normal: { points: 5, weight: 76, lifeMs: 1900 },
        rare: { points: 15, weight: 19, lifeMs: 1400 },
        golden: { points: 50, weight: 5, lifeMs: 1000, maxPerSession: 2 },
      },
      minReactionMs: 140,     // claims faster than this after spawn are rejected
      claimGraceMs: 700,      // network latency allowance after a target despawns
      minClaimIntervalMs: 90, // humanly impossible to hit two targets faster
      combo: { windowMs: 1600, bonuses: [{ min: 3, bonus: 2 }, { min: 6, bonus: 5 }] },
      decoys: 14,             // cosmetic graves/ghosts/bats on the board
    },

    'daily-spin': {
      name: GAME_META['daily-spin'].name,
      enabled: true,
      limit: { type: 'cooldown', ms: 24 * 60 * 60 * 1000 },
      xpPerPlay: 5,
      segments: [
        { id: 'p5', label: '+5', points: 5, weight: 28 },
        { id: 'p10', label: '+10', points: 10, weight: 24 },
        { id: 'p20', label: '+20', points: 20, weight: 18 },
        { id: 'p25', label: '+25', points: 25, weight: 13 },
        { id: 'p50', label: '+50', points: 50, weight: 9 },
        { id: 'p100', label: '+100', points: 100, weight: 5 },
        { id: 'p250', label: '+250', points: 250, weight: 2.5, rare: true },
        { id: 'jackpot', label: 'JACKPOT', points: 1000, weight: 0.5, rare: true },
      ],
    },

    quiz: {
      name: GAME_META.quiz.name,
      enabled: true,
      limit: { type: 'daily', count: 5 },  // rewarded questions per day
      xpPerPlay: 3,
      answerTimeMs: 45_000,
      rewards: { easy: 5, medium: 10, hard: 20 },
      streakBonuses: [{ at: 3, bonus: 10 }, { at: 5, bonus: 25 }],
      practiceAfterLimit: true,           // unrewarded practice questions
    },
  },

  /* XP & levels: xp needed to REACH level n = 100*(n-1) + 25*(n-1)*(n-2) */
  levels: {
    max: 50,
    xpForLevel(n) { return n <= 1 ? 0 : 100 * (n - 1) + 25 * (n - 1) * (n - 2); },
    titles: [
      [1, 'Lost Soul'], [3, 'Graveyard Pup'], [5, 'Pumpkin Scout'], [8, 'Lantern Keeper'],
      [12, 'Ghost Hound'], [16, 'Night Stalker'], [20, 'Spectral Inu'], [30, 'Phantom Alpha'], [40, 'Legend of the Grave'],
    ],
  },

  /* Achievements are evaluated server-side from player counters. */
  achievements: [
    { id: 'first_blood', name: 'FIRST BLOOD', description: 'Play your first Arcade game.', icon: 'skull', test: c => (c.games_played || 0) >= 1, points: 0 },
    { id: 'pumpkin_slayer', name: 'PUMPKIN SLAYER', description: 'Find 50 pumpkins.', icon: 'hunt', test: c => (c.pumpkins_found || 0) >= 50, points: 0 },
    { id: 'golden_hunter', name: 'GOLDEN HUNTER', description: 'Find your first Golden Pumpkin.', icon: 'trophy', test: c => (c.golden_found || 0) >= 1, points: 0 },
    { id: 'lucky_ghost', name: 'LUCKY GHOST', description: 'Hit a rare Daily Spin reward.', icon: 'wheel', test: c => (c.spin_rare || 0) >= 1, points: 0 },
    { id: 'trickster', name: 'TRICKSTER', description: 'Choose Trick 25 times.', icon: 'bag', test: c => (c.tot_trick || 0) >= 25, points: 0 },
    { id: 'sweet_tooth', name: 'SWEET TOOTH', description: 'Choose Treat 25 times.', icon: 'candy', test: c => (c.tot_treat || 0) >= 25, points: 0 },
    { id: 'brain_of_the_grave', name: 'BRAIN OF THE GRAVE', description: 'Answer 25 quiz questions correctly.', icon: 'quiz', test: c => (c.quiz_correct || 0) >= 25, points: 0 },
    { id: 'perfect_night', name: 'PERFECT NIGHT', description: 'Reach a 5-answer quiz streak.', icon: 'moon', test: c => (c.quiz_best_streak || 0) >= 5, points: 0 },
    { id: 'halloween_degen', name: 'HALLOWEEN DEGEN', description: 'Play every Arcade game at least once.', icon: 'chest', test: c => ['played_trick-or-treat', 'played_pumpkin-hunt', 'played_daily-spin', 'played_quiz'].every(k => (c[k] || 0) >= 1), points: 0 },
  ],

  /* =========================================================
     THE HAUNT — X raid board. All tunables live here.
     ========================================================= */
  haunt: {
    currency: 'HAUNT_XP',              // separate from Arcade Points: never counts toward Season SOL prizes
    sourceType: 'HAUNT_X_REPLY',          // legacy ledger source for X replies (per-type below)
    defaultReward: 5,
    /* Submission types. Rewards are decided HERE (server) — never by the browser.
       X_REPLY uses the target's reward (default 5). perDay = extra per-type cap inside the global limits. */
    types: {
      X_REPLY:     { label: 'X REPLY',  platform: 'X',      reward: null, perDay: 20, needsTarget: true,  ledgerSource: 'HAUNT_X_REPLY' },
      X_POST:      { label: 'X POST',   platform: 'X',      reward: 10,   perDay: 5,  needsTarget: false, ledgerSource: 'HAUNT_X_POST' },
      X_MEME:      { label: 'X MEME',   platform: 'X',      reward: 15,   perDay: 5,  needsTarget: false, ledgerSource: 'HAUNT_X_MEME' },
      TIKTOK_POST: { label: 'TIKTOK',   platform: 'TIKTOK', reward: 20,   perDay: 3,  needsTarget: false, ledgerSource: 'HAUNT_TIKTOK' },
    },
    // X_POST / X_MEME / TIKTOK must be about the project: at least one of these (case-insensitive) in the text/caption.
    projectTerms: ['hallowinu', '$hallowinu', '#hallowinu', '@hionchains', 'hallow inu', 'ghost dog'],
    tiktok: { maxAgeMs: 7 * 86400_000, oembedTimeoutMs: 8000 },
    maxReward: 100,
    // Reward limits (approved haunts). In-flight verifications count too, so parallel tabs cannot exceed them.
    limits: {
      window: { count: 3, ms: 10 * 60_000 },   // max 3 approved haunts per rolling 10 minutes
      minGapMs: 2 * 60_000,                    // at least 2 minutes between two rewarded haunts
      perDay: 20,                              // per UTC day
      perTargetPerPlayer: 1,                   // one rewarded reply per player per target (no thread spamming)
    },
    // Technical abuse protection (applies BEFORE any paid X API call, counts every submit attempt).
    submitRate: { limit: 20, windowMs: 10 * 60_000 },
    submitRatePerIp: { limit: 60, windowMs: 60 * 60_000 },
    reply: {
      maxAgeMs: 48 * 3600_000,                 // reply must be at most 48h old when submitted
      minLetters: 8,                           // letters after removing @mentions, links and emoji
      maxDuplicatesPerPlayerDays: 7,           // identical text by the same player within 7 days = DUPLICATE_CONTENT
      maxSameTextAcrossPlayers24h: 3,          // same text from 3+ different players in 24h = COPY_PASTE (rejects the 3rd+)
    },
    targets: { defaultExpiryMin: 24 * 60, maxPerPage: 30 },
    retry: { baseMs: 5 * 60_000, maxAttempts: 6, batch: 20 },
    // X API cost guard (pay-per-use). Above the daily budget new verifications wait in VERIFICATION_PENDING.
    budget: { dailyCents: 100 },               // $1.00/day default, admin-adjustable (settings: haunt.dailyBudgetCents)
    costMicros: { postRead: 5000, userRead: 10000, ownedRead: 1000 },   // $0.005 / $0.010 / $0.001 per resource
    cacheTtlMs: { target: 6 * 3600_000, user: 24 * 3600_000 },
    // Phase 2 (disabled): replies under non-curated crypto posts, scored on several signals.
    discovered: {
      enabled: false,
      minRelevance: 70,
      maxTargetAgeMs: 72 * 3600_000,
      terms: ['crypto', 'solana', '$sol', 'memecoin', 'memecoins', 'onchain', 'on-chain', 'defi', 'web3', 'dex', 'pump.fun', 'pumpfun', 'raydium', 'jupiter', 'trading', 'market cap', 'mcap', 'liquidity', 'token', 'wallet', 'launch', 'airdrop', 'degen', 'bonk', 'wif', 'ct'],
      weights: { terms: 12, maxTerms: 48, cashtag: 15, hashtag: 5, allowlistedAuthor: 40, cryptoBio: 20, engagement: 10 },
      allowlist: [],                           // X user ids of known crypto accounts
      denylist: [],
    },
  },

  /* =========================================================
     COMMUNITY REWARD POOL — 80% of VERIFIED, RECEIVED maker/creator rewards.
     The pool is an accounting ledger (no automatic on-chain transfers, no keys on the server).
     ========================================================= */
  communityPool: {
    communityBps: 8000,                // 80.00% to the community pool, the remaining 20% stays outside
    asset: 'SOL', decimals: 9,         // the Solana adapter measures the creator wallet's SOL balance delta (lamports)
    scan: { limit: 40, retryPendingMs: 10 * 60_000, maxAttempts: 12 },
    commitment: 'finalized',
  },

  seasons: {
    // Prize distribution in basis points (1/100 of a percent). MUST sum to 10000.
    // #1 3.00 · #2 1.75 · #3 1.25 · #4 0.90 · #5 0.75 · #6 0.60 · #7 0.50 · #8 0.45 · #9 0.40 · #10 0.40 (per 10 SOL).
    // Every rank scales proportionally with the CURRENT VERIFIED pool.
    defaultDistributionBps: [3000, 1750, 1250, 900, 750, 600, 500, 450, 400, 400],
    leaderboardSize: 100,
  },

  solana: {
    lamportsPerSol: 1_000_000_000n,
    defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
  },
};

/* Admin-adjustable runtime settings (stored in the `settings` table). */
export const OVERRIDABLE_SETTINGS = {
  'games.trick-or-treat.enabled': 'boolean',
  'games.pumpkin-hunt.enabled': 'boolean',
  'games.daily-spin.enabled': 'boolean',
  'games.quiz.enabled': 'boolean',
  'games.trick-or-treat.dailyLimit': 'int',
  'games.pumpkin-hunt.dailyLimit': 'int',
  'games.quiz.dailyLimit': 'int',
  'haunt.enabled': 'boolean',
  'haunt.dailyBudgetCents': 'int',
};

export function levelForXp(xp) {
  const L = CONFIG.levels;
  let lvl = 1;
  while (lvl < L.max && xp >= L.xpForLevel(lvl + 1)) lvl++;
  return lvl;
}
export function levelInfo(xp) {
  const level = levelForXp(xp);
  const L = CONFIG.levels;
  const cur = L.xpForLevel(level), next = level >= L.max ? null : L.xpForLevel(level + 1);
  let title = L.titles[0][1];
  for (const [min, t] of L.titles) if (level >= min) title = t;
  return { level, title, xp, levelXp: cur, nextLevelXp: next, xpToNext: next == null ? 0 : next - xp };
}

/* Validate config at startup/tests. Throws on inconsistent values. */
export function validateConfig() {
  const sum = a => a.reduce((s, x) => s + x, 0);
  for (const [k, t] of Object.entries(CONFIG.games['trick-or-treat'].tables)) {
    if (Math.abs(sum(t.map(r => r.weight)) - 100) > 1e-9) throw new Error(`trick-or-treat ${k} weights must sum to 100`);
  }
  if (Math.abs(sum(CONFIG.games['daily-spin'].segments.map(s => s.weight)) - 100) > 1e-9) throw new Error('spin weights must sum to 100');
  if (sum(CONFIG.seasons.defaultDistributionBps) !== 10000) throw new Error('distribution must sum to 10000 bps');
  return true;
}
