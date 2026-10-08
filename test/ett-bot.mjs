/* Look-ahead bot for Escape The Trenches tests: plays the real simulation and records its inputs.
   Used to prove generated layouts are survivable and to produce realistic runs for the API tests. */
import { Sim, INPUT } from '../dist/ett/sim.js';

const { LEFT: L, RIGHT: R, JUMP: J, DUCK: D } = INPUT;
const CHOICES = [[], [L], [R], [J], [D], [L, J], [R, J], [L, D], [R, D], [L, L], [R, R]];
const WAITS = [6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 10];   // look-ahead decision spacing (ticks) per level

function safe(sim, ticks) {
  const s = sim.clone();
  for (let i = 0; i < ticks && !s.dead; i++) s.step(null);
  return !s.dead && s.stats.stumbles === sim.stats.stumbles;
}
/* Returns a list of [tickOffset, codes] or null when nothing survives. */
function search(sim, level = 0, offset = 0, seen = new Set()) {
  const key = `${sim.tick}|${sim.lane}|${Math.round(sim.px * 4)}|${Math.round(sim.y * 4)}|${Math.round(sim.vy)}|${sim.slideT > 0 ? sim.slideT >> 3 : 0}|${sim.jumpBuf > 0}`;
  if (seen.has(key)) return null;
  seen.add(key);
  if (safe(sim, 80)) return [];
  if (level === WAITS.length) return null;
  const wait = WAITS[level];
  for (const ch of CHOICES) {
    if (!ch.length) continue;
    const s = sim.clone();
    s.step(ch);
    for (let i = 1; i < wait && !s.dead; i++) s.step(null);
    if (s.dead || s.stats.stumbles !== sim.stats.stumbles) continue;
    const rest = search(s, level + 1, offset + wait, seen);
    if (rest) return [[offset, ch], ...rest];
  }
  // doing nothing for now, deciding later
  const s = sim.clone();
  for (let i = 0; i < wait && !s.dead; i++) s.step(null);
  if (!s.dead && s.stats.stumbles === sim.stats.stumbles) {
    const rest = search(s, level + 1, offset + wait, seen);
    if (rest) return rest;
  }
  return null;
}

/* Plays until `metres` (or death). Returns { sim, inputs:[[tick,code]], stuck } */
export function playBot(seed, metres, { greedyCoins = true, every = 6 } = {}) {
  const sim = new Sim(seed);
  const inputs = [];
  let plan = [], stuck = null;
  while (!sim.dead && sim.pz < metres) {
    if (!plan.length && sim.tick % every === 0) {
      const p = search(sim);
      if (p === null) { if (!stuck) stuck = { tick: sim.tick, pz: sim.pz }; }
      else plan = p.map(([off, ch]) => [sim.tick + off, ch]);
      if (greedyCoins && p && !p.length) {
        const c = sim.coins.find(c => !c.taken && c.z > sim.pz + 6 && c.z < sim.pz + 40);
        if (c && c.lane !== sim.lane) {
          const ch = [c.lane < sim.lane ? L : R];
          const s = sim.clone(); s.step(ch);
          if (safe(s, 90)) plan = [[sim.tick, ch]];
        }
      }
    }
    let act = null;
    if (plan.length && plan[0][0] === sim.tick) act = plan.shift()[1];
    if (act) for (const c of act) inputs.push([sim.tick, c]);
    sim.step(act);
    sim.events.length = 0;
  }
  return { sim, inputs, stuck };
}
