/* =========================================================
   HALLOWINU — ESCAPE THE TRENCHES — DETERMINISTIC SIMULATION
   ---------------------------------------------------------
   Pure game rules: no DOM, no rendering, no clock, no Math.random.
   The SAME file runs in the browser (to play) and in the Cloudflare
   Worker (to replay a run from its seed + recorded inputs and compute
   the score server-side). Only + - * / and integer ops are used so the
   result is bit-identical across JavaScript engines.

   Coordinate system: the runner moves along +z ("pz" = distance in metres),
   x = lateral (lanes), y = height.
   ========================================================= */
import { ETT } from './config.js';

export const INPUT = Object.freeze({ LEFT: 0, RIGHT: 1, JUMP: 2, DUCK: 3 });

/* ---------- seeded PRNG (cyrb128 → sfc32) ---------- */
export function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
export function makeRng(seed) {
  let [a, b, c, d] = hashSeed(String(seed));
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/* Lanes in a bitmask that are reachable from each other (a full lane splits them). */
const components = m => (m === 5 ? [1, 4] : m ? [m] : []);

export function speedAt(z, cfg = ETT) {
  const s = cfg.speed;
  return s.start + (s.max - s.start) * clamp01(z / s.rampMetres);
}
export function difficultyAt(z, cfg = ETT) { return clamp01(z / cfg.difficulty.rampMetres); }

/* World z of an obstacle's front face when the runner is at distance pz.
   Moving wagons drive toward the runner: their position is a pure function of pz. */
export function obstacleWorldZ(o, pz) { return o.k ? o.zm + o.k * (o.zm - pz) : o.zm; }

export class Sim {
  constructor(seed, cfg = ETT) {
    this.cfg = cfg;
    this.seed = String(seed);
    this.rng = makeRng(this.seed);
    this.dt = 1 / cfg.tickRate;
    this.tick = 0;
    // runner
    this.pz = 0; this.px = cfg.laneX[1]; this.lane = 1; this.laneFrom = 1;
    this.y = 0; this.vy = 0; this.grounded = true;
    this.slideT = 0; this.jumpBuf = 0; this.slideQueued = false;
    this.stumbleT = 0;
    this.speed = speedAt(0, cfg);
    this.dead = false; this.reason = null;
    this.stats = { jumps: 0, slides: 0, left: 0, right: 0, stumbles: 0, nearMisses: 0, maxSpeed: this.speed,
      coins: { HALLOWINU: 0, USDC: 0, SOLANA: 0 } };
    // world
    this.obstacles = []; this.coins = [];
    this._firstObs = 0; this._firstCoin = 0;
    this._obsId = 0; this._coinId = 0;
    this.events = [];
    this.gen = { zNext: cfg.safeStartMetres, prevNonFull: 7, blockedUntil: [-1e9, -1e9, -1e9], reservedUntil: [-1e9, -1e9, -1e9], lastStuff: [-1e9, -1e9, -1e9], rows: 0 };
    this._generate(260);
  }

  /* Lightweight copy for look-ahead (bots/tests). Shares the generated world, never generates. */
  clone() {
    const c = Object.create(Sim.prototype);
    Object.assign(c, this);
    c.stats = { ...this.stats, coins: { ...this.stats.coins } };
    c.events = []; c.noGen = true;
    c.obstacles = this.obstacles; c.coins = this.coins;
    c._collect = () => {};
    return c;
  }

  /* ---------------- score ---------------- */
  get points() {
    const C = this.cfg.COINS, c = this.stats.coins;
    return c.HALLOWINU * C.HALLOWINU.value + c.USDC * C.USDC.value + c.SOLANA * C.SOLANA.value;
  }
  get height() { return this.slideT > 0 ? this.cfg.player.slideHeight : this.cfg.player.height; }

  summary() {
    const C = this.cfg.COINS, c = this.stats.coins;
    return {
      version: this.cfg.version,
      ticks: this.tick,
      durationMs: Math.round(this.tick * 1000 / this.cfg.tickRate),
      distance: Math.floor(this.pz),
      jumps: this.stats.jumps, slides: this.stats.slides,
      leftSwitches: this.stats.left, rightSwitches: this.stats.right,
      stumbles: this.stats.stumbles, nearMisses: this.stats.nearMisses,
      coins: { HALLOWINU: c.HALLOWINU, USDC: c.USDC, SOLANA: c.SOLANA },
      points: { HALLOWINU: c.HALLOWINU * C.HALLOWINU.value, USDC: c.USDC * C.USDC.value, SOLANA: c.SOLANA * C.SOLANA.value },
      score: this.points,
      maxSpeed: Math.round(this.stats.maxSpeed * 10) / 10,
      dead: this.dead, reason: this.reason,
    };
  }

  /* ---------------- input ---------------- */
  _ev(e) { if (!this.silent) this.events.push(e); }

  _input(code) {
    const cfg = this.cfg;
    if (code === INPUT.LEFT) {
      if (this.lane > 0) { this.laneFrom = this.lane; this.lane--; this.stats.left++; this._ev({ t: 'lane', dir: -1 }); }
      else this._ev({ t: 'edge', dir: -1 });
    } else if (code === INPUT.RIGHT) {
      if (this.lane < 2) { this.laneFrom = this.lane; this.lane++; this.stats.right++; this._ev({ t: 'lane', dir: 1 }); }
      else this._ev({ t: 'edge', dir: 1 });
    } else if (code === INPUT.JUMP) {
      if (this.grounded) this._jump(); else this.jumpBuf = cfg.jump.bufferTicks;
    } else if (code === INPUT.DUCK) {
      if (this.grounded) this._slide();
      else { if (this.vy > cfg.slide.fastFallVelocity) this.vy = cfg.slide.fastFallVelocity; this.slideQueued = true; this.jumpBuf = 0; }
    }
  }
  _jump() {
    this.vy = this.cfg.jump.velocity; this.grounded = false; this.slideT = 0; this.slideQueued = false; this.jumpBuf = 0;
    this.stats.jumps++; this._ev({ t: 'jump' });
  }
  _slide() {
    if (this.slideT <= 0) { this.stats.slides++; this._ev({ t: 'slide' }); }
    this.slideT = this.cfg.slide.ticks;
  }

  /* ---------------- one fixed step ---------------- */
  step(inputs) {
    if (this.dead) return;
    const cfg = this.cfg, dt = this.dt, P = cfg.player;
    if (inputs) for (let i = 0; i < inputs.length; i++) this._input(inputs[i]);

    const prevPz = this.pz, prevX = this.px;
    this.speed = speedAt(this.pz, cfg);
    if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
    this.pz += this.speed * dt;

    // lateral
    const tx = cfg.laneX[this.lane], dx = tx - this.px, stepX = cfg.laneSwitchSpeed * dt;
    this.px = dx <= stepX && dx >= -stepX ? tx : this.px + (dx > 0 ? stepX : -stepX);

    // vertical
    if (!this.grounded) {
      this.vy -= cfg.jump.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0; this.grounded = true;
        this._ev({ t: 'land' });
        if (this.jumpBuf > 0) this._jump();
        else if (this.slideQueued) { this.slideQueued = false; this._slide(); }
      }
    }
    if (this.jumpBuf > 0) this.jumpBuf--;
    if (this.slideT > 0) this.slideT--;
    if (this.stumbleT > 0) this.stumbleT--;

    if (!this.noGen) this._generate(this.pz + 260);
    this._collide(prevPz, prevX);
    if (!this.dead) this._collect();
    this.tick++;
    if (this.tick >= cfg.maxRunTicks && !this.dead) { this.dead = true; this.reason = 'timeout'; }
  }

  _collide(prevPz, prevX) {
    const cfg = this.cfg, P = cfg.player, obs = this.obstacles, reach = cfg.laneHalfWidth + P.halfWidth;
    while (this._firstObs < obs.length && obs[this._firstObs].B < this.pz - 1) this._firstObs++;
    const top = this.y + this.height;
    for (let i = this._firstObs; i < obs.length; i++) {
      const o = obs[i];
      if (o.A > this.pz + 1) break;
      const zNow = this.pz >= o.A && this.pz <= o.B;
      // obstacle just passed this tick → near-miss detection (stateless: shared world stays read-only)
      if (!zNow) {
        if (prevPz <= o.B && this.pz > o.B) {
          const lx = cfg.laneX[o.lane], ax = this.px - lx < 0 ? lx - this.px : this.px - lx;
          if ((o.type === 'full' && ax >= reach && ax < reach + 1.2) || (o.type === 'low' && ax < reach && this.y - o.h < 0.3)) {
            this.stats.nearMisses++; this._ev({ t: 'nearmiss', id: o.id });
          }
        }
        continue;
      }
      const lx = cfg.laneX[o.lane];
      const ax = this.px - lx < 0 ? lx - this.px : this.px - lx;
      if (ax >= reach) continue;
      const hit = o.type === 'full' || (o.type === 'low' && this.y < o.h) || (o.type === 'high' && top > o.b);
      if (!hit) continue;
      const zPrev = prevPz >= o.A && prevPz <= o.B;
      const axPrev = prevX - lx < 0 ? lx - prevX : prevX - lx;
      if (zPrev && axPrev >= reach) {
        // bumped into the SIDE while switching lanes → stumble back
        this.stats.stumbles++;
        this.lane = this.laneFrom; this.px = prevX;
        if (this.stumbleT > 0) { this._die('caught', o); return; }
        this.stumbleT = cfg.stumble.recoverTicks;
        this._ev({ t: 'stumble', id: o.id });
        return;
      }
      this._die('crash', o);
      return;
    }
  }
  _die(reason, o) {
    this.dead = true; this.reason = reason;
    this._ev({ t: 'dead', reason, id: o ? o.id : null, kind: o ? o.kind : null });
  }

  _collect() {
    const cfg = this.cfg, C = cfg.coins, coins = this.coins, top = this.y + this.height;
    while (this._firstCoin < coins.length && coins[this._firstCoin].z < this.pz - 3) this._firstCoin++;
    for (let i = this._firstCoin; i < coins.length; i++) {
      const c = coins[i];
      if (c.z > this.pz + C.pickupRadiusZ) break;
      if (c.taken) continue;
      const dz = c.z - this.pz, dx = c.x - this.px;
      if (dz > C.pickupRadiusZ || dz < -C.pickupRadiusZ || dx > C.pickupRadiusX || dx < -C.pickupRadiusX) continue;
      if (c.y + C.pickupHalfHeight < this.y || c.y - C.pickupHalfHeight > top) continue;
      c.taken = true;
      this.stats.coins[c.type]++;
      this._ev({ t: 'coin', type: c.type, id: c.id });
    }
  }

  /* ---------------- procedural generation ---------------- */
  _pickWeighted(table) {
    let total = 0; for (const k in table) total += table[k];
    let r = this.rng() * total;
    for (const k in table) { if (r < table[k]) return k; r -= table[k]; }
    return Object.keys(table)[0];
  }
  _coinType() {
    const C = this.cfg.COINS, w = {};
    for (const k of this.cfg.coinOrder) w[k] = C[k].weight;
    return this._pickWeighted(w);
  }
  _addCoin(z, lane, y, type) {
    const c = { id: this._coinId++, z, lane, x: this.cfg.laneX[lane], y, type, taken: false };
    const arr = this.coins; let i = arr.length;
    arr.push(c);
    while (i > 0 && arr[i - 1].z > z) { arr[i] = arr[i - 1]; i--; }
    arr[i] = c;
    const g = this.gen; if (z > g.lastStuff[lane]) g.lastStuff[lane] = z;
  }

  _generate(horizon) {
    while (this.gen.zNext < horizon) this._row();
  }

  _row() {
    const cfg = this.cfg, g = this.gen, rng = this.rng, R = cfg.rows;
    const z = g.zNext, d = difficultyAt(z, cfg), v = speedAt(z, cfg);
    let plan = null;
    for (let attempt = 0; attempt < R.maxRerolls && !plan; attempt++) plan = this._planRow(z, d, v);
    if (!plan) plan = { items: [], nonFull: this._nonFullAt(z, []), allAction: false };

    // commit obstacles (sorted by A so the collision scan can stop early)
    const created = [];
    for (const it of plan.items) {
      const spec = cfg.obstacles[it.kind];
      const k = it.k || 0, hd = cfg.player.halfDepth;
      const o = { id: this._obsId++, kind: it.kind, type: spec.type, lane: it.lane, zm: z, len: spec.len, k,
        h: spec.h || 0, b: spec.b || 0, variant: Math.floor(rng() * 4),
        A: k ? z - hd / (1 + k) : z - hd, B: k ? z + (spec.len + hd) / (1 + k) : z + spec.len + hd };
      created.push(o);
      if (spec.type === 'full') g.blockedUntil[it.lane] = Math.max(g.blockedUntil[it.lane], o.B);
      if (k) g.reservedUntil[it.lane] = z + spec.len + cfg.movingWagon.reserveAhead;
      g.lastStuff[it.lane] = Math.max(g.lastStuff[it.lane], k ? z + spec.len + cfg.movingWagon.reserveAhead : z + spec.len);
    }
    created.sort((a, b) => a.A - b.A);
    for (const o of created) this.obstacles.push(o);
    g.prevNonFull = plan.nonFull;
    g.rows++;

    // coins attached to this row's obstacles
    const C = cfg.coins;
    let bonusLeft = rng() < C.bonusChance ? 1 : 0;
    for (const o of created) {
      if (o.k) continue;
      if (o.type === 'low' && rng() < C.arcChance) {
        const zc = z + o.len / 2;
        for (let j = -2; j <= 2; j++) {
          const dz = j * 2, t = dz / v;
          const yy = cfg.jump.velocity * cfg.jump.velocity / (2 * cfg.jump.gravity) - 0.5 * cfg.jump.gravity * t * t + 0.6;
          let type = this._coinType();
          if (j === 0 && bonusLeft) { type = this._pickWeighted(C.bonusWeights); bonusLeft = 0; }
          this._addCoin(zc + dz, o.lane, yy < C.height ? C.height : yy, type);
        }
      } else if (o.type === 'high' && (rng() < 0.45 || bonusLeft)) {
        let type = this._coinType();
        if (bonusLeft) { type = this._pickWeighted(C.bonusWeights); bonusLeft = 0; }
        this._addCoin(z + o.len / 2, o.lane, C.lowHeight, type);
      }
    }
    // bonus next to a stationary wagon (needs a lane switch at the right moment)
    if (bonusLeft) {
      const w = created.find(o => o.type === 'full' && !o.k && o.len > 5);
      if (w) {
        const side = [w.lane - 1, w.lane + 1].filter(l => l >= 0 && l <= 2 && this._laneClear(l, z, z + w.len));
        if (side.length) this._addCoin(z + w.len * 0.6, side[Math.floor(rng() * side.length)], C.height, this._pickWeighted(C.bonusWeights));
      }
    }

    // gap until the next row
    let gapS = R.gapSecondsEasy + (R.gapSecondsHard - R.gapSecondsEasy) * d + rng() * R.gapJitterSeconds;
    if (plan.allAction && gapS < R.afterAllActionMinSeconds) gapS = R.afterAllActionMinSeconds;
    let gap = v * gapS;
    const longest = created.reduce((m, o) => (o.k ? m : Math.max(m, o.len)), 0);
    if (gap < longest + 6) gap = longest + 6;

    // coin trail in the gap
    const z1 = z + 6 + longest, z2 = z + gap - 7;
    if (z2 - z1 > C.trailSpacing * 2 && rng() < C.trailChance) {
      const lanes = [0, 1, 2].filter(l => this._laneClear(l, z1 - 1, z2 + 1));
      if (lanes.length) {
        const lane = lanes[Math.floor(rng() * lanes.length)];
        const n = Math.min(C.trailMax, Math.floor((z2 - z1) / C.trailSpacing) + 1);
        for (let j = 0; j < n; j++) this._addCoin(z1 + j * C.trailSpacing, lane, C.height, this._coinType());
      }
    }
    g.zNext = z + gap;
  }

  _laneClear(l, z1, z2) {
    const g = this.gen;
    if (g.blockedUntil[l] >= z1 - 1) return false;
    if (g.reservedUntil[l] > z1) return false;
    // stationary obstacles of the current row in this lane
    for (let i = this.obstacles.length - 1; i >= 0 && i >= this.obstacles.length - 6; i--) {
      const o = this.obstacles[i];
      if (o.lane === l && o.zm + o.len >= z1 - 1 && o.zm <= z2 + 1) return false;
    }
    return true;
  }

  _nonFullAt(z, items) {
    const g = this.gen; let full = 0;
    for (let l = 0; l < 3; l++) if (g.blockedUntil[l] > z - 1) full |= 1 << l;
    for (const it of items) if (this.cfg.obstacles[it.kind].type === 'full') full |= 1 << it.lane;
    return 7 & ~full;
  }

  /* Proposes a row and validates the fairness rules. Returns null to re-roll. */
  _planRow(z, d, v) {
    const cfg = this.cfg, g = this.gen, rng = this.rng, MW = cfg.movingWagon;
    const r = rng();
    const nOcc = r < 0.42 - 0.22 * d ? 1 : r < 0.86 - 0.12 * d ? 2 : 3;
    const order = [0, 1, 2];
    for (let i = 2; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const items = [];
    for (let n = 0; n < nOcc; n++) {
      const lane = order[n];
      if (g.blockedUntil[lane] > z - 1 || g.reservedUntil[lane] > z - 6) continue;   // lane still occupied by a wagon
      const q = rng();
      const pWagon = 0.2 + 0.14 * d, pCandle = 0.07 + 0.04 * d, pHigh = 0.33;
      let kind, k = 0;
      if (q < pWagon) {
        kind = cfg.wagonKinds[Math.floor(rng() * cfg.wagonKinds.length)];
        const canMove = !cfg.obstacles[kind].stationaryOnly && g.lastStuff[lane] < z - MW.clearBehind && z > 250;
        if (canMove && rng() < 0.12 + 0.48 * d) k = MW.minK + (MW.maxK - MW.minK) * rng();
      } else if (q < pWagon + pCandle) kind = 'candle';
      else if (q < pWagon + pCandle + (1 - pWagon - pCandle) * pHigh) kind = cfg.highKinds[Math.floor(rng() * cfg.highKinds.length)];
      else kind = cfg.lowKinds[Math.floor(rng() * cfg.lowKinds.length)];
      if (kind === 'mineCart' && d < 0.15) kind = 'tombstone';
      items.push({ lane, kind, k });
    }
    // all three lanes occupied → at least one must be passable with a jump or slide
    const occupied = new Set(items.map(i => i.lane));
    for (let l = 0; l < 3; l++) if (g.blockedUntil[l] > z - 1) occupied.add(l);
    const nonFull = this._nonFullAt(z, items);
    if (!nonFull) return null;
    // fairness: from every group of lanes the runner could be in at the previous row,
    // at least one lane of that same group must still be passable now
    for (const comp of components(g.prevNonFull)) if (!(nonFull & comp)) return null;
    // early game: never force an action on every lane
    const allAction = occupied.size === 3;
    if (allAction && d < 0.12) return null;
    // a moving wagon must leave a calm lane next to it early in the run
    if (items.some(i => i.k) && d < 0.3 && items.length > 1) return null;
    return { items, nonFull, allAction };
  }
}

/* ---------- input log encoding (compact, for upload) ----------
   Each entry = (deltaTick << 2) | code, deltaTick relative to the previous input. */
export function encodeInputs(list) {
  const out = []; let last = 0;
  for (const [tick, code] of list) { out.push(((tick - last) * 4) + code); last = tick; }
  return out;
}
export function decodeInputs(arr) {
  const out = []; let t = 0;
  for (const n of arr) {
    if (!Number.isInteger(n) || n < 0) return null;
    t += Math.floor(n / 4);
    out.push([t, n % 4]);
  }
  return out;
}

/* Replays a run. Returns the authoritative summary or { ok:false, error }.
   claimedTicks: the tick count the browser reported (must match when the runner died). */
export function replayRun(seed, inputs, claimedTicks, cfg = ETT) {
  if (!Number.isInteger(claimedTicks) || claimedTicks < 0 || claimedTicks > cfg.maxRunTicks) return { ok: false, error: 'BAD_TICKS' };
  if (inputs.length > cfg.limits.maxInputs) return { ok: false, error: 'TOO_MANY_INPUTS' };
  for (let i = 0; i < inputs.length; i++) {
    const [t, c] = inputs[i];
    if (c < 0 || c > 3 || t >= claimedTicks || (i && t < inputs[i - 1][0])) return { ok: false, error: 'BAD_INPUTS' };
  }
  const sim = new Sim(seed, cfg);
  sim.silent = true;
  let p = 0; const buf = [];
  while (sim.tick < claimedTicks && !sim.dead) {
    buf.length = 0;
    while (p < inputs.length && inputs[p][0] === sim.tick) buf.push(inputs[p++][1]);
    sim.step(buf);
  }
  return { ok: true, summary: sim.summary(), unusedInputs: inputs.length - p };
}
