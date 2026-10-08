/* =========================================================
   HALLOWINU — ESCAPE THE TRENCHES — CENTRAL GAME CONFIGURATION
   ---------------------------------------------------------
   Shared by the browser AND the server (worker/games/escape-the-trenches.js
   imports this exact file), so the server replays every run with the same
   rules the player saw. Change a number here → both sides change together.

   Coin values and rarity weights live in COINS below.
   Server-side reward rules (season credit, daily cap, rate limits) live in
   worker/config.js → CONFIG.games['escape-the-trenches'].
   ========================================================= */

export const ETT = Object.freeze({
  version: 1,                     // bump when gameplay rules change (old runs keep their own version)

  /* ---------- simulation ---------- */
  tickRate: 60,                   // fixed simulation steps per second (render is interpolated)
  maxRunTicks: 60 * 60 * 45,      // 45 minutes hard cap per run

  /* ---------- lanes & player ---------- */
  laneX: [-2.5, 0, 2.5],          // LEFT, CENTER, RIGHT (metres)
  laneHalfWidth: 1.05,            // obstacle half-width inside a lane
  laneSwitchSpeed: 17,            // metres per second sideways (one lane ≈ 0.15 s)
  player: {
    halfWidth: 0.4,
    halfDepth: 0.45,
    height: 1.5,                  // standing
    slideHeight: 0.72,            // while sliding
  },
  jump: { velocity: 9.6, gravity: 30, bufferTicks: 8 },   // apex ≈ 1.54 m, airtime ≈ 0.64 s
  slide: { ticks: 44, fastFallVelocity: -26 },            // ≈ 0.73 s; pressing DOWN in the air slams down
  stumble: { recoverTicks: 60 * 6 },                      // a 2nd side-bump within 6 s = caught by the skeletons

  /* ---------- speed & difficulty (distance based) ---------- */
  speed: { start: 13, max: 31, rampMetres: 5200 },
  difficulty: { rampMetres: 4200 },
  safeStartMetres: 70,            // no obstacles at the very start (opening chase)

  /* ---------- obstacle generation ---------- */
  rows: {
    gapSecondsEasy: 1.3,          // time between obstacle rows at difficulty 0
    gapSecondsHard: 0.66,         // … at difficulty 1
    gapJitterSeconds: 0.35,
    afterAllActionMinSeconds: 0.9,// breathing room after a row that forces a jump/slide everywhere
    maxRerolls: 12,
  },
  movingWagon: { minK: 0.45, maxK: 0.9, clearBehind: 32, reserveAhead: 75 },

  /* Obstacle catalogue.  type: low = jump (or switch), high = slide (or switch), full = switch lane.
     h = top height (low), b = bottom height (high). len = depth in metres. */
  obstacles: {
    tombstone:    { type: 'low',  h: 0.95, len: 0.7 },
    pumpkin:      { type: 'low',  h: 1.0,  len: 1.5 },
    lowWall:      { type: 'low',  h: 0.85, len: 0.8 },
    boneFence:    { type: 'low',  h: 0.9,  len: 0.5 },
    chartCrash:   { type: 'low',  h: 0.95, len: 0.7 },
    mineCart:     { type: 'low',  h: 1.05, len: 2.3 },
    chain:        { type: 'high', b: 1.05, len: 0.4 },
    branch:       { type: 'high', b: 1.0,  len: 0.9 },
    ghost:        { type: 'high', b: 0.95, len: 1.0 },
    candle:       { type: 'full', len: 1.3 },
    funeralWagon: { type: 'full', len: 9,  wagon: true },
    carriage:     { type: 'full', len: 7.5, wagon: true },
    cargoWagon:   { type: 'full', len: 13, wagon: true },
    cursedWagon:  { type: 'full', len: 10, wagon: true, stationaryOnly: true },
  },
  lowKinds: ['tombstone', 'pumpkin', 'lowWall', 'boneFence', 'chartCrash', 'mineCart'],
  highKinds: ['chain', 'branch', 'ghost'],
  wagonKinds: ['funeralWagon', 'carriage', 'cargoWagon', 'cursedWagon'],

  /* ---------- collectible coins ---------- */
  COINS: {
    HALLOWINU: { value: 1,  weight: 85, label: 'HALLOWINU' },
    USDC:      { value: 5,  weight: 12, label: 'USDC' },
    SOLANA:    { value: 10, weight: 3,  label: 'SOLANA' },
  },
  coinOrder: ['HALLOWINU', 'USDC', 'SOLANA'],
  coins: {
    trailChance: 0.82,            // chance that a gap between rows gets a coin trail
    trailSpacing: 2.6,            // metres between coins in a trail
    trailMax: 9,
    height: 0.9,
    lowHeight: 0.42,              // under chains/branches (slide to collect)
    pickupRadiusX: 1.0, pickupRadiusZ: 0.95, pickupHalfHeight: 0.5,
    arcChance: 0.5,               // coin arc over a jumpable obstacle
    bonusChance: 0.16,            // per row: a single bonus coin in a harder spot
    bonusWeights: { USDC: 80, SOLANA: 20 },   // which rare coin a bonus spot holds
  },

  /* ---------- verification sanity limits (server) ---------- */
  limits: {
    maxInputsPerSecond: 14,       // sustained average above this is rejected as non-human
    maxInputs: 60 * 45 * 14,
  },
});

export const LANES = 3;
