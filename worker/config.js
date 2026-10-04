/* =========================================================
   HALLOWINU ARCADE — CENTRAL CONFIGURATION
   Every tunable game/reward/season number lives here.
   Game engine code reads from this file only.
   Runtime overrides (admin "settings" table) are limited to
   the keys listed in OVERRIDABLE_SETTINGS.
   ========================================================= */

export const CONFIG = {
  /* Day boundary for daily limits: 00:00 UTC (02:00 CEST / 01:00 CET). */
  dayBoundary: 'UTC',

  session: {
    cookieName: 'hw_sid',
    ttlDays: 180,
    // New anonymous players per IP-hash per hour (anti-spam, not anti-Sybil).
    newPlayersPerIpPerHour: 6,
  },

  names: {
    minLength: 3,
    maxLength: 18,
    pattern: /^[A-Za-z0-9 _.\-]+$/,
    changeCooldownMs: 60 * 60 * 1000,
    blocked: ['admin', 'hallowinu team', 'moderator', 'official', 'support'],
  },

  rateLimits: {
    // requests per window (fixed window, per player)
    gameActions: { limit: 40, windowMs: 60_000 },
    huntClaims: { limit: 25, windowMs: 10_000 },
    reads: { limit: 120, windowMs: 60_000 },
    adminFailures: { limit: 10, windowMs: 15 * 60_000 },
  },

  games: {
    'trick-or-treat': {
      name: 'Trick or Treat',
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
      name: 'Pumpkin Hunt',
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
      name: 'Daily Spin',
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
      name: 'HALLOWINU Quiz',
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
    { id: 'pumpkin_slayer', name: 'PUMPKIN SLAYER', description: 'Find 50 pumpkins.', icon: 'pumpkin', test: c => (c.pumpkins_found || 0) >= 50, points: 0 },
    { id: 'golden_hunter', name: 'GOLDEN HUNTER', description: 'Find your first Golden Pumpkin.', icon: 'trophy', test: c => (c.golden_found || 0) >= 1, points: 0 },
    { id: 'lucky_ghost', name: 'LUCKY GHOST', description: 'Hit a rare Daily Spin reward.', icon: 'ghost', test: c => (c.spin_rare || 0) >= 1, points: 0 },
    { id: 'trickster', name: 'TRICKSTER', description: 'Choose Trick 25 times.', icon: 'pumpkin', test: c => (c.tot_trick || 0) >= 25, points: 0 },
    { id: 'sweet_tooth', name: 'SWEET TOOTH', description: 'Choose Treat 25 times.', icon: 'candy', test: c => (c.tot_treat || 0) >= 25, points: 0 },
    { id: 'brain_of_the_grave', name: 'BRAIN OF THE GRAVE', description: 'Answer 25 quiz questions correctly.', icon: 'skull', test: c => (c.quiz_correct || 0) >= 25, points: 0 },
    { id: 'perfect_night', name: 'PERFECT NIGHT', description: 'Reach a 5-answer quiz streak.', icon: 'moon', test: c => (c.quiz_best_streak || 0) >= 5, points: 0 },
    { id: 'halloween_degen', name: 'HALLOWEEN DEGEN', description: 'Play every Arcade game at least once.', icon: 'chest', test: c => ['played_trick-or-treat', 'played_pumpkin-hunt', 'played_daily-spin', 'played_quiz'].every(k => (c[k] || 0) >= 1), points: 0 },
  ],

  seasons: {
    // Prize distribution in basis points (1/100 of a percent). MUST sum to 10000.
    defaultDistributionBps: [4000, 2000, 1200, 800, 600, 400, 300, 300, 200, 200],
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
