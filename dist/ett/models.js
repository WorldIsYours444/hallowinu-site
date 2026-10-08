/* All voxel models for Escape The Trenches (original designs).
   Units: 1 voxel = 0.1 m unless noted. Characters face +z (the camera sees their back while running). */
import * as THREE from './vendor/three.bundle.js';
import { VB, materials, crand } from './voxel.js';

const G = (...children) => { const g = new THREE.Group(); for (const c of children) if (c) g.add(c); return g; };
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };

/* =========================================================
   CHARACTERS
   ========================================================= */
export const CHARACTERS = [
  { id: 'hallow-inu', name: 'HALLOW INU', tag: 'The ghost dog of Halloween', blurb: 'Ghost-sheet hood, midnight cape and a glowing pumpkin emblem. Cute, spooky, mischievous.', accent: '#ff7a1a' },
  { id: 'super-inu', name: 'SUPER INU', tag: 'Hero of the haunted trenches', blurb: 'Midnight suit, crimson cape and the golden bolt-paw crest. Runs like it owns the night.', accent: '#e8384f' },
  { id: 'artificial-inu', name: 'ARTIFICIAL INU', tag: 'Cyber-shiba unit A.I.-01', blurb: 'Gunmetal plating, neon visor eyes and a humming cyan core. Calculated. Unstoppable.', accent: '#2ef2ff' },
  { id: 'shiba-inu', name: 'SHIBA INU', tag: 'The original good boy', blurb: 'Classic orange-and-cream shiba with a red collar. Pure vibes, zero fear.', accent: '#ffb54a' },
];

const PAL = {
  'hallow-inu': { fur: '#e8892f', furDark: '#c86d1f', cream: '#fbe8cc', paw: '#fbe8cc' },
  'super-inu': { fur: '#e58a3a', furDark: '#c46a22', cream: '#fbe8cc', paw: '#f2b632' },
  'artificial-inu': { fur: '#5b6378', furDark: '#3c4254', cream: '#9aa3b8', paw: '#2a2f3d' },
  'shiba-inu': { fur: '#e9893a', furDark: '#c96c22', cream: '#fff1dc', paw: '#fff1dc' },
};

function part(builder, x, y, z) { const m = builder.mesh(0.1, { shadow: true }); return at(G(m), x, y, z); }
const V = 0.1;   // metres per voxel

/* Chibi upright voxel Inu, reference style: round shiba head with triangle ears, caped back with a
   glowing pumpkin emblem, white rump + socks, curled white-tipped tail.
   Facing +z. Every part pivots at its joint; feet touch y = 0 in the rest pose. */
export function buildInu(id) {
  const P = PAL[id] || PAL['shiba-inu'];
  const robot = id === 'artificial-inu', hero = id === 'super-inu', hallow = id === 'hallow-inu';
  const NEON = '#2ef2ff', VIOLET = '#a855f7';
  const fur = robot ? '#5b6378' : P.fur, furD = robot ? '#3c4254' : P.furDark, cream = robot ? '#9aa3b8' : P.cream;
  const suit = hero ? '#233a8a' : fur;
  const HIP = 4.0, SHOULDER = 7.5, NECK = 8.2;

  // legs: pivot at the hip; thigh+shin and a foot pointing forward
  const leg = side => {
    const b = new VB();
    b.c(0, -3.3, -0.9, 1.9, 3.6, 1.8, suit);
    b.c(0, -4.0, -1.0, 2.0, 0.8, 2.5, hero ? '#f2b632' : robot ? '#2a2f3d' : cream);       // foot / boot / white sock
    if (!hero && !robot) b.c(0, -3.2, -0.95, 1.95, 0.6, 1.9, cream);
    if (robot) b.c(0, -2, 0.91, 1.1, 0.5, 0.1, VIOLET, true);
    if (hero) b.c(0, -1.6, -0.95, 1.95, 0.5, 1.9, '#f2b632');
    return part(b, side * 1.2 * V, HIP * V, 0);
  };
  // torso: pivot at the hip
  const tb = new VB();
  tb.c(0, -0.4, -1.8, 5.0, 4.9, 3.6, suit);
  tb.c(0, 0.2, 1.8, 3.2, 3.6, 0.25, hero ? '#2c48a8' : robot ? '#3c4254' : cream);            // chest / belly
  if (!hero && !robot) { tb.c(0, -0.4, -2.0, 3.4, 2.4, 0.3, cream); tb.c(0, -0.2, -2.15, 2.4, 1.6, 0.2, '#fff8ec'); }   // white rump
  if (hero) { tb.c(0, 1.8, 2.05, 1.6, 1.8, 0.2, '#f2b632', true); tb.c(0, -0.2, -1.85, 5.1, 0.6, 3.7, '#f2b632'); }
  if (robot) { tb.c(0, 1.8, 2.05, 1.4, 1.4, 0.2, NEON, true); tb.c(0, 0.8, -2.6, 3.2, 3.0, 0.9, '#3c4254'); tb.c(-0.9, 1.2, -2.75, 0.6, 2.2, 0.2, '#3b82f6', true); tb.c(0.9, 1.2, -2.75, 0.6, 2.2, 0.2, '#3b82f6', true); }
  if (id === 'shiba-inu') { tb.c(0, 3.8, -1.9, 5.2, 0.7, 3.8, '#d62f3a'); tb.c(0, 3.0, 1.95, 0.9, 0.9, 0.3, '#ffc44d', true); }
  if (hallow) tb.c(0, 2.2, 1.95, 1.3, 1.3, 0.2, '#ff8a1f', true);
  const torso = part(tb, 0, HIP * V, 0);
  // arms: pivot at the shoulder
  const arm = side => {
    const b = new VB();
    b.c(0, -3.0, -0.7, 1.4, 3.2, 1.4, suit);
    b.c(0, -3.6, -0.8, 1.6, 0.9, 1.6, hero ? '#f2b632' : robot ? '#2a2f3d' : cream);
    if (robot) b.c(side * 0.71, -1.8, -0.3, 0.1, 0.9, 0.6, NEON, true);
    return part(b, side * 3.4 * V, SHOULDER * V, 0);
  };
  // head: pivot at the neck
  const hb = new VB();
  hb.c(0, 0, -2.6, 6.4, 4.4, 5.2, fur);
  hb.c(0, 4.4, -2.2, 5.4, 0.8, 4.4, fur);                                // rounded crown
  hb.c(0, -0.4, -2.2, 5.4, 0.4, 4.4, fur);
  for (const s of [-1, 1]) hb.c(s * 3.4, 0.4, -2.0, 0.6, 3.2, 4.0, fur);    // cheek fluff
  hb.c(0, 0, 2.4, 5.6, 2.2, 0.5, cream);                                 // lower face
  hb.c(0, 0.4, 2.6, 2.8, 1.8, 1.5, cream);                               // snout
  hb.c(0, 1.6, 4.0, 1.1, 0.8, 0.3, '#1a0f0a');                           // nose
  hb.c(0, 0.3, 4.05, 1.3, 0.3, 0.15, '#5a1d14');                         // mouth
  if (!robot) for (const s of [-1, 1]) {
    hb.c(s * 1.5, 2.3, 2.6, 1.0, 1.2, 0.25, '#120a08'); hb.c(s * 1.5 - 0.2, 3.0, 2.82, 0.35, 0.35, 0.1, '#ffffff');
    hb.c(s * 1.9, 3.5, 2.55, 1.1, 0.3, 0.15, furD);
    hb.c(s * 2.2, 0.6, 2.62, 1.0, 0.6, 0.1, '#ffb3a6');                   // blush
  }
  for (const s of [-1, 1]) {
    const ec = robot ? '#3c4254' : fur;
    hb.c(s * 2.0, 4.8, -1.0, 2.2, 1.2, 1.8, ec); hb.c(s * 2.1, 6.0, -0.8, 1.6, 1.0, 1.4, ec); hb.c(s * 2.2, 7.0, -0.6, 0.9, 0.9, 1.0, ec);
    if (robot) hb.c(s * 2.2, 7.9, -0.5, 0.7, 0.7, 0.7, VIOLET, true);
    else hb.c(s * 2.05, 5.0, 0.81, 1.2, 1.6, 0.1, cream);
    hb.c(s * 1.5, 0.6, -2.75, 1.4, 3.2, 0.2, furD);                       // darker fur on the back of the head
  }
  if (robot) {
    hb.c(0, 1.9, 2.65, 5.8, 1.4, 0.3, '#1b1f2a');
    hb.c(-1.5, 2.2, 2.9, 1.7, 0.8, 0.2, NEON, true); hb.c(1.5, 2.2, 2.9, 1.7, 0.8, 0.2, NEON, true);
    for (const s of [-1, 1]) { hb.c(s * 3.25, 1.4, -1, 0.2, 2.4, 2.4, '#2a2f3d'); hb.c(s * 3.35, 2.2, -0.2, 0.15, 0.8, 0.8, '#3b82f6', true); }
    hb.c(0.8, 5.2, 0, 0.4, 2.4, 0.4, '#2a2f3d'); hb.c(0.8, 7.6, 0, 0.8, 0.8, 0.8, NEON, true);
    hb.c(0, 0.8, -2.85, 3.6, 3.0, 0.2, '#3c4254'); hb.c(0, 2.0, -2.95, 1.8, 0.8, 0.1, VIOLET, true);
  }
  if (hero) { hb.c(0, 2.0, 2.55, 6.2, 1.5, 0.3, '#14224f'); for (const s of [-1, 1]) { hb.c(s * 1.5, 2.3, 2.8, 1.2, 0.9, 0.15, '#ffffff'); hb.c(s * 1.4, 2.4, 2.9, 0.55, 0.55, 0.1, '#14224f'); } }
  if (hallow) hb.c(0, -0.6, -2.8, 6.6, 1.0, 5.6, '#2b1840');            // dark collar the cape hangs from
  const head = part(hb, 0, NECK * V, 0.1 * V);
  // curled tail with a white tip: pivot at the lower back
  const tl = new VB();
  if (robot) { tl.c(0, 0, -1.4, 1.2, 1.2, 1.4, '#3c4254'); tl.c(0, 0.8, -2.4, 1, 1, 1.2, '#5b6378'); tl.c(0, 1.6, -2.8, 0.9, 0.9, 0.9, NEON, true); }
  else { tl.c(0, 0, -1.2, 1.6, 1.4, 1.4, fur); tl.c(0, 0.8, -2.2, 1.6, 1.4, 1.2, fur); tl.c(0, 1.7, -2.5, 1.5, 1.1, 1.1, cream); tl.c(-0.3, 2.3, -2.0, 1.1, 0.8, 1.0, '#fff8ec'); }
  const tail = part(tl, 0, (HIP - 2.2) * V, -1.4 * V);   // peeks out under the cape hem
  // cape: pivot at the back of the neck, hangs down the back
  let cape = null;
  if (hallow || hero) {
    const cb = new VB();
    const main = hallow ? '#2b1840' : '#c4162b', fold = hallow ? '#3a2056' : '#a5101f', lining = hallow ? '#4a2470' : '#f2b632';
    cb.c(0, -5.0, -0.5, 5.8, 5.4, 0.5, main);
    for (const x of [-1.8, 0, 1.8]) cb.c(x, -4.8, -0.55, 0.5, 4.6, 0.1, fold);
    cb.c(0, -5.0, -0.05, 5.6, 5.2, 0.1, lining);
    for (let i = -2.4; i <= 2.4; i += 1.2) cb.b(i - 0.5, -5.6 - (Math.round(i * 4) % 2 ? 0 : 0.3), -0.5, 1.0, 0.8, 0.5, main);   // ragged hem
    cb.c(0, -0.3, -0.6, 5.6, 0.7, 0.8, lining);
    if (hallow) {
      cb.c(0, -3.6, -0.62, 3.0, 2.4, 0.15, '#ff8a1f', true);
      cb.c(0, -1.2, -0.62, 0.5, 0.5, 0.15, '#4caf50');
      cb.c(-0.75, -2.1, -0.72, 0.6, 0.6, 0.12, '#2a1640'); cb.c(0.75, -2.1, -0.72, 0.6, 0.6, 0.12, '#2a1640');
      cb.c(0, -3.0, -0.72, 1.8, 0.4, 0.12, '#2a1640');
    } else cb.c(0, -3.2, -0.62, 1.6, 2.0, 0.15, '#f2b632', true);
    cape = part(cb, 0, (NECK + 0.2) * V, -2.0 * V);
  }
  let extra = null;
  if (robot) {
    const rb = new VB();
    for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2; rb.c(Math.cos(t) * 4.2, 0, Math.sin(t) * 4.2, 0.7, 0.2, 0.7, a % 2 ? NEON : VIOLET, true); }
    extra = at(G(rb.mesh(0.1)), 0, 0.15, 0);
  }
  const legL = leg(-1), legR = leg(1), armL = arm(-1), armR = arm(1);
  const hip = G(torso, head, armL, armR, legL, legR, tail, cape);
  const root = G(hip, extra);
  root.userData.character = id;
  return { root, parts: { hip, torso, head, armL, armR, legL, legR, tail, cape, extra } };
}

/* =========================================================
   PURSUERS — skeleton + skeleton dog
   ========================================================= */
const BONE = '#ece5cf', BONE_D = '#bdb59b', SOCKET = '#130a14', SPOOK = '#7dff6a';

/* Lanky, slightly goofy skeleton with a tilted top hat and a lantern. ~1.85 m. Facing +z. */
export function buildSkeleton() {
  // skull (pivot at the neck)
  const s = new VB();
  s.c(0, 0.8, -2.0, 4.4, 3.4, 4.2, BONE); s.c(0, 4.2, -1.6, 3.6, 0.7, 3.4, BONE);           // cranium
  s.c(0, 0, 0.6, 3.4, 1.4, 1.6, BONE);                                                     // upper jaw
  s.c(0, -0.9, -0.6, 3.0, 0.9, 2.6, BONE_D);                                               // lower jaw
  for (let i = -1.2; i <= 1.2; i += 0.8) s.c(i, 0.0, 2.1, 0.5, 0.6, 0.2, '#ffffff');        // teeth
  for (const k of [-1, 1]) { s.c(k * 1.0, 2.0, 2.05, 1.3, 1.3, 0.3, SOCKET); s.c(k * 1.0, 2.3, 2.25, 0.55, 0.55, 0.15, SPOOK, true); }
  s.c(0, 1.2, 2.15, 0.6, 0.6, 0.2, SOCKET);
  // crooked top hat
  const hat = new VB(); hat.c(0, 0, -2.4, 5.6, 0.5, 4.8, '#2a1640'); hat.c(0, 0.5, -1.5, 3.4, 3.0, 3.0, '#2a1640'); hat.c(0, 0.6, -1.55, 3.5, 0.6, 3.1, '#ff7a1a');
  const hatG = at(G(hat.mesh(0.1)), 0.05, 0.47, -0.02); hatG.rotation.z = -0.22;
  const head = at(G(s.mesh(0.1, { shadow: true }), hatG), 0, 1.5, 0.02);
  // ribcage + spine + pelvis (pivot at the pelvis)
  const tb = new VB();
  tb.c(0, 0, -0.4, 0.8, 5.6, 0.8, BONE_D);                                                 // spine
  for (let r = 0; r < 4; r++) { const y = 2.2 + r * 0.9, w = 4.0 - r * 0.25; tb.c(0, y, 0.6, w, 0.45, 0.4, BONE); tb.c(-w / 2 + 0.2, y, -1.0, 0.4, 0.45, 1.9, BONE); tb.c(w / 2 - 0.2, y, -1.0, 0.4, 0.45, 1.9, BONE); }
  tb.c(0, 5.6, -0.5, 4.6, 0.6, 1.0, BONE);                                                 // collarbones
  tb.c(0, -0.6, -0.8, 3.0, 1.0, 1.6, BONE);                                                // pelvis
  tb.c(0, 4.5, 0.8, 4.8, 0.9, 0.5, '#5b2a86'); tb.c(1.6, 3.0, 1.0, 1.0, 1.8, 0.4, '#5b2a86');   // tattered scarf
  const torso = at(G(tb.mesh(0.1, { shadow: true })), 0, 0.9, 0);
  // limbs: pivot at the joint, upper + lower bone with a knobbly joint
  const limb = (len, w, extra) => {
    const b = new VB();
    b.c(0, -len / 2, -w / 2, w, len / 2, w, BONE); b.c(0, -len / 2 - 0.3, -w / 2 - 0.1, w + 0.3, 0.6, w + 0.2, BONE_D);
    b.c(0, -len, -w / 2, w * 0.9, len / 2 - 0.2, w * 0.9, BONE);
    if (extra === 'foot') b.c(0, -len - 0.5, -0.6, 1.3, 0.5, 2.0, BONE_D);
    if (extra === 'hand') b.c(0, -len - 0.6, -0.4, 0.9, 0.7, 0.8, BONE_D);
    if (extra === 'lantern') { b.c(0, -len - 0.6, -0.4, 0.9, 0.7, 0.8, BONE_D); b.c(0, -len - 1.6, -0.1, 0.2, 1.0, 0.2, '#2b1a10'); b.c(0, -len - 3.8, -0.9, 1.8, 2.2, 1.8, '#2b1a10'); b.c(0, -len - 3.5, -0.7, 1.4, 1.6, 1.4, '#ffb347', true); }
    return b;
  };
  const armL = at(G(limb(5.6, 0.7, 'hand').mesh(0.1)), -2.4 * V, 1.45, 0);
  const armR = at(G(limb(5.6, 0.7, 'lantern').mesh(0.1)), 2.4 * V, 1.45, 0);
  const legL = at(G(limb(8.4, 0.9, 'foot').mesh(0.1)), -1.0 * V, 0.89, 0);
  const legR = at(G(limb(8.4, 0.9, 'foot').mesh(0.1)), 1.0 * V, 0.89, 0);
  const hip = G(torso, head, armL, armR, legL, legR);
  return { root: G(hip), parts: { hip, torso, head, armL, armR, legL, legR } };
}

/* Four-legged bone dog: elongated skull with glowing eyes, spine, ribs, pelvis, jointed legs. Facing +z. */
export function buildBoneDog() {
  const H = 5.4;                       // spine height (voxels): legs are exactly this long
  const hb = new VB();
  hb.c(0, 0, -1.4, 3.0, 2.6, 2.8, BONE);                                                   // cranium
  hb.c(0, 0.2, 1.4, 1.8, 1.4, 2.4, BONE);                                                  // snout
  hb.c(0, -0.5, 1.0, 1.6, 0.5, 2.6, BONE_D);                                               // jaw
  for (const z of [1.6, 2.4, 3.2]) { hb.c(-0.55, -0.1, z, 0.3, 0.4, 0.3, '#ffffff'); hb.c(0.55, -0.1, z, 0.3, 0.4, 0.3, '#ffffff'); }
  for (const k of [-1, 1]) { hb.c(k * 0.8, 1.3, 1.32, 1.0, 0.9, 0.2, SOCKET); hb.c(k * 0.8, 1.45, 1.45, 0.5, 0.5, 0.15, '#ff5c3a', true); hb.c(k * 1.0, 2.6, -1.1, 0.7, 1.3, 0.8, BONE_D); }
  hb.c(0, 0.9, 3.85, 0.7, 0.5, 0.2, SOCKET);
  const head = at(G(hb.mesh(0.1, { shadow: true })), 0, (H + 1.0) * V, 3.6 * V);
  const bb = new VB();
  for (let i = 0; i < 7; i++) bb.c(0, -0.4, -3.2 + i * 0.95, 0.8, 0.8, 0.7, i % 2 ? BONE : BONE_D);    // spine
  bb.c(0, 0, 2.9, 0.7, 1.4, 0.7, BONE_D);                                                  // neck
  for (let r = 0; r < 3; r++) { const z = 0.4 + r * 0.9; bb.c(-0.95, -2.0, z, 0.35, 1.8, 0.45, BONE); bb.c(0.95, -2.0, z, 0.35, 1.8, 0.45, BONE); bb.c(0, -2.2, z, 2.2, 0.35, 0.45, BONE); }
  bb.c(0, -0.9, -3.6, 2.0, 1.0, 1.4, BONE_D);                                              // pelvis
  const body = at(G(bb.mesh(0.1, { shadow: true })), 0, H * V, 0);
  const legB = front => { const b = new VB();
    b.c(0, -H / 2, -0.3, 0.6, H / 2, 0.6, BONE); b.c(0, -H / 2 - 0.3, -0.4, 0.8, 0.6, 0.8, BONE_D);
    b.c(0, -H + 0.4, -0.25, 0.5, H / 2 - 0.4, 0.5, BONE); b.c(0, -H, front ? -0.3 : -0.5, 0.8, 0.45, 1.1, BONE_D); return b; };
  const mk = (x, z, f) => at(G(legB(f).mesh(0.1)), x * V, H * V, z * V);
  const legFL = mk(-0.9, 2.3, true), legFR = mk(0.9, 2.3, true), legBL = mk(-0.9, -2.9, false), legBR = mk(0.9, -2.9, false);
  const tb = new VB(); for (let i = 0; i < 5; i++) tb.c(0, i * 0.6, -0.6 - i * 0.45, 0.45, 0.55, 0.55, BONE);
  const tail = at(G(tb.mesh(0.1)), 0, (H + 0.1) * V, -3.9 * V);
  const hip = G(body, head, legFL, legFR, legBL, legBR, tail);
  return { root: G(hip), parts: { hip, body, head, legFL, legFR, legBL, legBR, tail } };
}

/* =========================================================
   OBSTACLES  (origin: lane centre, ground, front face at z=0; extends to +z)
   ========================================================= */
const WOOD = '#3a2318', WOOD_D = '#251610', IRON = '#2c2a33', STONE = '#6d6680', STONE_D = '#4d475e', PURP = '#b04cff', ORANGE = '#ff8a1f';

function wheel(b, x, z, r = 4) {
  b.c(x, 0, z - r, 1, r * 2, r * 2, IRON);
  b.c(x, r - 0.6, z - r + 0.6, 1.3, 1.2, r * 2 - 1.2, '#4a4552');
  b.c(x, 0.6, z - 0.6, 1.3, r * 2 - 1.2, 1.2, '#4a4552');
}
function lanternBox(b, x, y, z) { b.c(x, y, z - 0.8, 1.6, 2, 1.6, '#1a1210'); b.c(x, y + 0.3, z - 0.5, 1.2, 1.4, 1.0, '#ffb347', true); b.c(x, y + 2, z - 0.2, 0.4, 0.8, 0.4, '#1a1210'); }
function skull(b, x, y, z, s = 1) { b.c(x, y, z, 1.6 * s, 1.5 * s, 0.4, BONE); b.c(x - 0.4 * s, y + 0.6 * s, z + 0.3, 0.45 * s, 0.45 * s, 0.2, SOCKET); b.c(x + 0.4 * s, y + 0.6 * s, z + 0.3, 0.45 * s, 0.45 * s, 0.2, SOCKET); }

export function buildObstacle(kind, variant = 0) {
  const b = new VB();
  const r = crand(17 + variant * 31 + kind.length * 7);
  switch (kind) {
    case 'tombstone': {   // rounded grave with a skull, like the reference
      b.c(0, 0, 0, 15, 1.2, 8, STONE_D);
      b.c(0, 1.2, 1, 12, 6.6, 5.4, STONE); b.c(0, 7.8, 1.3, 10, 1, 4.8, STONE); b.c(0, 8.8, 1.8, 7, 0.8, 3.8, STONE);
      b.c(0, 1.2, 0.6, 12.6, 1, 6.2, STONE_D);
      skull(b, 0, 3.6, 0.3, 2.2);
      b.c(-0.9, 4.9, 0.05, 0.9, 0.9, 0.2, '#b04cff', true); b.c(0.9, 4.9, 0.05, 0.9, 0.9, 0.2, '#b04cff', true);
      b.c(-4.6, 1.2, 0.2, 1.4, 2.2, 1.4, '#3d6b2a'); b.c(4.4, 6, 0.5, 1.2, 1.2, 1, '#3d6b2a');
      if (variant % 2) { b.c(-6.2, 1.2, -1.4, 1.4, 2.6, 1.4, '#c21a2e'); b.c(-6.2, 3.8, -1.2, 0.5, 0.9, 0.5, '#ffd34d', true); }
      break;
    }
    case 'pumpkin': {
      const O = '#ff7a1a', O2 = '#d95b08';
      b.c(0, 0, 1, 16, 9, 13, O2); b.c(0, 1, 0, 13, 7, 15, O); b.c(0, 0.6, 2, 18, 7.6, 11, O);
      b.c(0, 9, 5.5, 2, 2.5, 2, '#3d7a24'); b.c(1.4, 10.8, 5.5, 2.4, 0.8, 1, '#3d7a24');
      b.c(-4, 4.6, -0.1, 3, 2, 0.4, '#ffd34d', true); b.c(4, 4.6, -0.1, 3, 2, 0.4, '#ffd34d', true);
      b.c(0, 1.8, -0.1, 9, 1.8, 0.4, '#ffd34d', true); b.c(-2.4, 3.4, -0.1, 1.2, 0.8, 0.4, '#ffd34d', true);
      break;
    }
    case 'lowWall': {   // cracked stone blocks with glowing purple runes
      for (let i = 0; i < 3; i++) {
        const x = -6.6 + i * 6.6, h = 7 + (i % 2) * 1.6;
        b.c(x, 0, 1, 6.2, h, 6, i % 2 ? STONE : '#5d5873');
        b.c(x, h, 1.4, 5, 0.8, 5.2, STONE_D);
        b.c(x - 1, 1.5, 0.9, 0.5, h - 3, 0.3, '#c45cff', true);
        b.c(x + 0.6, h - 3, 0.9, 2.2, 0.5, 0.3, '#c45cff', true);
        b.c(x + 1.5, 2, 0.9, 0.5, 2.5, 0.3, '#c45cff', true);
      }
      b.c(7, 0, -1, 3, 1.6, 2, STONE_D);
      break;
    }
    case 'boneFence': {
      for (const x of [-8, 0, 8]) { b.c(x, 0, 1.5, 1.2, 8.5, 1.2, BONE); b.c(x, 8.2, 1.2, 2.2, 1.2, 1.8, BONE_D); }
      b.c(0, 3, 1.3, 18, 1, 1, BONE); b.c(0, 6, 1.3, 18, 1, 1, BONE);
      skull(b, -4, 4.1, 2.2); skull(b, 4.2, 1, 2.2, 0.9);
      b.c(-3.6, 4.7, 2.75, 0.3, 0.3, 0.1, SPOOK, true);
      break;
    }
    case 'chartCrash': {   // broken crypto chart: red down-candles + snapped line on a scaffold
      b.c(0, 0, 0, 18, 1, 6, IRON);
      const hs = [8, 6.5, 7, 4, 5, 2.5];
      hs.forEach((h, i) => { const x = -8 + i * 3.2; const red = i !== 2; b.b(x, 1, 2, 1.6, h, 2, red ? '#ff3b4e' : '#2bd96b', true); b.b(x + 0.6, 1 + h, 2.6, 0.4, 1.2, 0.8, '#ffb3bb'); });
      b.c(0, 9.4, 3, 18, 0.5, 0.5, '#ffc44d');
      b.c(5, 6, 3, 0.6, 3.6, 0.6, '#ffc44d');
      break;
    }
    case 'mineCart': {
      b.c(0, 0, 0, 16, 1, 23, IRON);
      b.c(0, 2, 0.5, 16, 7.6, 22, WOOD); b.c(0, 9.4, 0.3, 17, 0.8, 22.4, WOOD_D);
      for (const z of [3, 19]) { wheel(b, -8.4, z, 2.6); wheel(b, 8.4, z, 2.6); }
      for (let i = 0; i < 6; i++) b.c(-5 + i * 2, 10.2, 3 + (i * 7) % 15, 1.6, 1.6 + (i % 3), 1.6, i % 2 ? PURP : '#6dfff0', true);
      skull(b, 0, 5, -0.4, 1.4);
      b.c(-4.5, 6.2, -0.35, 0.4, 0.4, 0.2, '#ff5c3a', true); b.c(-3.3, 6.2, -0.35, 0.4, 0.4, 0.2, '#ff5c3a', true);
      break;
    }
    case 'chain': {
      for (const s of [-1, 1]) { b.c(s * 9.8, 0, 1, 1.6, 15.5, 1.6, IRON); b.c(s * 9.8, 15.5, 0.6, 2.4, 1.4, 2.4, '#4a4552'); b.c(s * 9.8, 16.9, 1.4, 0.8, 0.8, 0.8, PURP, true); }
      for (let i = 0; i < 19; i++) { const x = -9 + i; const sag = 1.3 * (1 - ((x / 9) ** 2)); b.b(x - 0.5, 10.9 + 1.4 - sag, 1.6, 1, 0.7, 0.8, i % 2 ? '#8b8794' : '#5d5966'); }
      b.c(0, 11.1 - 1.2, 1.5, 1.6, 1.6, 1, '#ff3b4e', true);              // warning lock
      for (const x of [-5, 5]) { b.c(x, 9.6, 1.7, 0.6, 2.6, 0.6, '#5d5966'); skull(b, x, 8.2, 1.6, 0.8); }
      break;
    }
    case 'branch': {
      for (const s of [-1, 1]) b.c(s * 10, 0, 2, 2.6, 16, 2.6, '#2a1c14');
      b.c(0, 10.2, 3, 22, 2.4, 2.4, '#3a281c'); b.c(-3, 12.4, 2.8, 8, 1.2, 2, '#2a1c14');
      for (let i = 0; i < 6; i++) { const x = -8 + i * 3.2; b.b(x, 9 - (i % 2), 3.2, 0.8, 1.6 + (i % 3), 0.8, '#2a1c14'); }
      b.c(5, 9.2, 5.6, 1.6, 1.2, 0.4, ORANGE, true); b.c(-6, 12, 4, 1.4, 1.4, 1.4, '#7dff6a', true);
      for (let i = 0; i < 5; i++) b.c(-9 + i * 4.5, 12.6, 3, 1.2, 1.2 + (i % 2), 1.2, '#3a2b55');
      break;
    }
    case 'ghost': {   // floating sheet ghost blocking head height
      const W = '#f6f2ff', W2 = '#d8d0ef';
      b.c(0, 10, 1, 13, 9, 9, W); b.c(0, 19, 2, 10, 2, 7, W); b.c(0, 21, 3, 6, 1, 5, W);
      for (let i = 0; i < 5; i++) b.b(-6.5 + i * 2.8, 8.5 - (i % 2) * 0.8, 1, 2, 1.6 + (i % 2) * 0.8, 9, W2);
      b.c(-6.9, 13, 3, 1.6, 4, 2, W2); b.c(6.9, 13, 3, 1.6, 4, 2, W2);
      b.c(-2.4, 15.2, 0.8, 2, 2.6, 0.4, '#140b1d'); b.c(2.4, 15.2, 0.8, 2, 2.6, 0.4, '#140b1d');
      b.c(0, 11.6, 0.8, 3, 2, 0.4, '#140b1d');
      b.c(-2.4, 16, 0.6, 0.8, 0.8, 0.2, '#7dd8ff', true); b.c(2.4, 16, 0.6, 0.8, 0.8, 0.2, '#7dd8ff', true);
      break;
    }
    case 'candle': {   // huge red bearish candle
      const RED = '#ff2f45';
      b.c(0, 0, 0, 16, 1, 13, IRON);
      b.c(0, 1, 1, 13, 26, 11, '#c21a2e'); b.c(0, 1.5, 0.6, 12, 25, 0.5, RED, true);
      b.c(0, 27, 6, 1.6, 9, 1.6, '#ffb3bb'); b.c(0, -0.6, 6, 1.6, 1.6, 1.6, '#ffb3bb');
      b.c(0, 18, 0.2, 7, 1.2, 0.4, '#ffffff', true); b.c(2.4, 15.6, 0.2, 1.2, 2.4, 0.4, '#ffffff', true); b.c(-2.4, 15.6, 0.2, 1.2, 2.4, 0.4, '#ffffff', true);
      break;
    }
    case 'funeralWagon': return wagon(b, 'funeral', 90, variant);
    case 'carriage': return wagon(b, 'carriage', 75, variant);
    case 'cargoWagon': return wagon(b, 'cargo', 130, variant);
    case 'cursedWagon': return wagon(b, 'cursed', 100, variant);
    default: b.c(0, 0, 0, 10, 10, 10, '#ff00ff');
  }
  return b.mesh(0.1, { shadow: true });
}

/* Halloween "trains": len in voxels along +z */
function wagon(b, style, len, variant) {
  const body = { funeral: '#16101e', carriage: '#3b1b4f', cargo: WOOD, cursed: '#2b2219' }[style];
  const trim = { funeral: '#8c6bb8', carriage: ORANGE, cargo: WOOD_D, cursed: '#5a4a3a' }[style];
  b.c(0, 2.5, 0, 19, 2.5, len, IRON);                                       // chassis
  for (let z = 7; z < len - 4; z += 22) { wheel(b, -9.6, z, 4.2); wheel(b, 9.6, z, 4.2); }
  if (style === 'funeral') {
    b.c(0, 5, 0, 18, 13, len, body); b.c(0, 18, 1, 19, 1.4, len - 2, trim);
    b.c(0, 19.4, 3, 15, 4.2, len - 6, body); b.c(0, 23.6, 5, 11, 1, len - 10, trim);
    for (let z = 8; z < len - 10; z += 18) { b.c(-9.05, 8, z, 0.3, 7, 12, '#5b2a86', true); b.c(9.05, 8, z, 0.3, 7, 12, '#5b2a86', true); }
    b.c(0, 8, -0.2, 12, 8, 0.3, '#3a1f5c'); b.c(0, 9.5, -0.35, 9, 5, 0.3, '#b04cff', true);
    skull(b, -5.5, 15, -0.5, 1.2); skull(b, 5.5, 15, -0.5, 1.2); skull(b, 0, 24.6, 8, 1.6);
    lanternBox(b, -8, 19.5, 2); lanternBox(b, 8, 19.5, 2);
  } else if (style === 'carriage') {
    b.c(0, 5, 0, 18, 6, len, body);
    b.c(0, 11, 4, 16, 10, len - 8, '#e0670f'); b.c(0, 21, 6, 13, 2, len - 12, '#c4520a');   // pumpkin-shell cabin
    for (let z = 6; z < len - 6; z += 6) { b.c(-8.1, 11, z, 0.3, 10, 1, '#b94a08'); b.c(8.1, 11, z, 0.3, 10, 1, '#b94a08'); }
    b.c(0, 23, len / 2 - 2, 2, 3, 2, '#3d7a24');
    b.c(-8.15, 14, 12, 0.3, 4, 8, '#ffd34d', true); b.c(8.15, 14, 12, 0.3, 4, 8, '#ffd34d', true);
    b.c(0, 13, 3.8, 9, 5, 0.3, '#ffd34d', true); b.c(0, 14.6, 3.6, 7, 1.4, 0.3, '#3b1b4f');
    lanternBox(b, -8.5, 11, 0.6); lanternBox(b, 8.5, 11, 0.6);
    skull(b, 0, 7, -0.4, 1.3);
  } else if (style === 'cargo') {
    b.c(0, 5, 0, 18.5, 1.4, len, WOOD_D);
    for (let z = 2, i = 0; z < len - 12; z += 14, i++) {
      const h = 9 + (i % 3) * 2.5;
      b.c(0, 6.4, z, 16, h, 12, i % 2 ? WOOD : '#4a2e1c');
      b.c(0, 6.4 + h, z + 0.5, 16.4, 0.8, 11, IRON);
      b.c(0, 6.4 + h / 2, z - 0.15, 16.2, 0.6, 0.3, IRON);
      b.c(0, 8, z - 0.25, 6, 4, 0.3, i % 2 ? '#b04cff' : '#6dfff0', true);
    }
    for (let z = 10; z < len - 8; z += 28) { b.c(-9.4, 6.4, z, 0.4, 14, 0.4, '#8b8794'); b.c(9.4, 6.4, z, 0.4, 14, 0.4, '#8b8794'); }
    skull(b, 0, 2.6, -0.4, 1.3); lanternBox(b, 0, 21, 3);
  } else {   // cursed (abandoned, broken, tilted planks)
    b.c(0, 5, 0, 18, 9, len, body);
    for (let z = 0; z < len; z += 9) b.c(r2(z) * 2, 14, z, 18, 1.6 + (z % 3), 7.5, '#3a2e22');
    b.c(-4, 15.6, 30, 3, 10, 3, '#3a2e22'); b.c(-4, 25, 28, 10, 1.2, 1.2, '#3a2e22');
    for (let z = 10; z < len - 10; z += 20) b.c(0, 8, z, 18.4, 3, 1.2, '#55ff8a', true);
    b.c(0, 7, -0.3, 10, 5, 0.3, '#55ff8a', true); b.c(0, 8.4, -0.45, 6, 2, 0.3, '#16101e');
    skull(b, -6, 15.8, 6, 1.4); skull(b, 5, 15.8, 50, 1.2);
    b.c(6, 15.6, 70, 4, 4, 4, '#ff7a1a'); b.c(6, 17, 69.8, 2.6, 1.2, 0.3, '#ffd34d', true);
  }
  // cow-catcher / bone grille front
  for (let i = -3; i <= 3; i++) b.c(i * 2.6, 0.6, -1.5, 1, 4.4 - Math.abs(i) * 0.4, 1.6, BONE_D);
  const g = b.mesh(0.1, { shadow: true });
  g.userData.wagon = style; g.userData.variant = variant;
  return g;
}
function r2(z) { return ((z * 7919) % 5) / 5 - 0.4; }

/* =========================================================
   COINS (geometries for InstancedMesh)
   ========================================================= */
function disk(b, R, fill, rim, depth = 1.2, g = false) {
  for (let y = -R; y < R; y++) {
    const yc = y + 0.5; if (R * R - yc * yc <= 0) continue;
    const half = Math.sqrt(R * R - yc * yc);
    const w = Math.round(half * 2);
    if (w <= 0) continue;
    b.c(0, y, -depth / 2, w, 1, depth, Math.abs(yc) > R - 1.3 || half < 1.5 ? rim : fill, g);
  }
}
export function coinGeometries(type) {
  const lit = new VB(), glow = new VB();
  disk(glow, 4.6, '#e9a925', '#ffd76a', 1.4, true);                         // gold coin + light rim
  const face = { HALLOWINU: '#ff7a1a', USDC: '#2f7bff', SOLANA: '#1a0d33' }[type];
  const inner = new VB(); disk(inner, 3.4, face, face, 1.9, true);
  for (const bx of inner.glow) glow.glow.push(bx);
  const sym = (x, y, w, h, c, g = false) => (g ? glow : lit).c(x, y, -1.1, w, h, 2.2, c, g);
  if (type === 'HALLOWINU') {
    sym(-1.2, 0.3, 1.1, 1.1, '#2a1205'); sym(1.2, 0.3, 1.1, 1.1, '#2a1205'); sym(0, -1.8, 3, 0.8, '#2a1205'); sym(-1.1, -1.2, 0.7, 0.6, '#2a1205'); sym(1.1, -1.2, 0.7, 0.6, '#2a1205');
    sym(0, 3.4, 0.9, 1, '#3d7a24');
  } else if (type === 'USDC') {
    sym(0, -2.5, 0.9, 5, '#ffffff'); sym(0, 1.1, 2.4, 0.7, '#ffffff'); sym(0, -0.3, 2.4, 0.7, '#ffffff'); sym(0, -1.7, 2.4, 0.7, '#ffffff'); sym(-0.9, 0.4, 0.7, 1.1, '#ffffff'); sym(0.9, -1, 0.7, 1.1, '#ffffff');
  } else {
    sym(0.3, 1.2, 4.4, 0.85, '#14f195', true); sym(-0.3, -0.4, 4.4, 0.85, '#7a6bff', true); sym(0.3, -2, 4.4, 0.85, '#c34bff', true);
  }
  return { lit: lit.lit.length ? lit.geometries(0.1).lit : null, glow: glow.glow.length ? glow.geometries(0.1).glow : null };
}

/* =========================================================
   SCENERY PROPS (geometries for instancing, origin on the ground)
   ========================================================= */
export function propGeometries() {
  const out = {};
  const put = (name, b) => { out[name] = b.geometries(0.1); };
  // twisted dead tree
  { const b = new VB(); const T = '#2a1c22', T2 = '#3a2830';
    b.c(0, 0, -1.5, 3.4, 18, 3, T); b.c(1, 18, -1.2, 2.6, 8, 2.4, T2); b.c(-1, 26, -1, 2, 6, 2, T);
    b.c(-5, 16, -0.8, 8, 1.6, 1.6, T2); b.c(-9, 17.6, -0.8, 1.6, 6, 1.6, T); b.c(5, 22, -0.8, 8, 1.4, 1.4, T2); b.c(9, 23.4, -0.8, 1.4, 5, 1.4, T);
    b.c(-3, 30, -0.7, 6, 1.2, 1.2, T2); b.c(2, 31, -0.6, 1, 4, 1, T); b.c(-2, 0, -2.2, 7, 1.4, 4.4, T);
    b.c(-9, 22, -0.4, 1.2, 1.6, 0.8, '#ff8a1f', true);
    put('tree', b); }
  // dark pine
  { const b = new VB(); b.c(0, 0, -1, 2, 6, 2, '#24161c');
    for (let i = 0; i < 6; i++) { const w = 16 - i * 2.6; b.c(0, 5 + i * 5, -w / 2, w, 5, w, i % 2 ? '#1d1a3a' : '#241f45'); }
    put('pine', b); }
  // grave cross
  { const b = new VB(); b.c(0, 0, -2, 6, 1, 4, '#3d3850'); b.c(0, 1, -0.8, 1.6, 11, 1.6, '#76708c'); b.c(0, 7.5, -0.8, 6, 1.6, 1.6, '#76708c'); put('cross', b); }
  // grave slab
  { const b = new VB(); b.c(0, 0, -1.5, 7, 8, 3, '#5d5873'); b.c(0, 8, -1.2, 5, 1, 2.4, '#5d5873'); b.c(0, 0, 1.5, 7, 0.6, 7, '#2c3a26'); b.c(0, 4, 1.55, 3, 0.6, 0.2, '#2f2a3d'); put('grave', b); }
  // iron fence (4 m)
  { const b = new VB(); b.c(0, 9, -0.3, 40, 0.8, 0.6, '#2a2733'); b.c(0, 2, -0.3, 40, 0.8, 0.6, '#2a2733');
    for (let x = -19; x <= 19; x += 3) { b.c(x, 0, -0.3, 0.6, 11, 0.6, '#2a2733'); b.c(x, 11, -0.2, 0.4, 1, 0.4, '#4a4552'); }
    b.c(-20, 0, -0.8, 1.6, 13, 1.6, '#4d475e'); put('fence', b); }
  // lantern post (glow)
  { const b = new VB(); b.c(0, 0, -0.6, 1.2, 26, 1.2, '#1b1820'); b.c(2, 25, -0.4, 5, 0.8, 0.8, '#1b1820');
    b.c(4, 20, -1, 2.2, 4, 2.2, '#1b1820'); b.c(4, 20.6, -0.8, 1.8, 3, 1.8, '#ffb347', true); b.c(4, 24, -0.4, 0.6, 1.2, 0.6, '#1b1820'); put('lamp', b); }
  // small glowing pumpkin
  { const b = new VB(); b.c(0, 0, -2.5, 6, 4.4, 5, '#e2650c'); b.c(0, 0.4, -3, 4, 3.6, 6, '#ff7a1a'); b.c(0, 4.4, -0.4, 0.8, 1.2, 0.8, '#3d7a24');
    b.c(-1.2, 2.2, 3.05, 1, 0.8, 0.2, '#ffd34d', true); b.c(1.2, 2.2, 3.05, 1, 0.8, 0.2, '#ffd34d', true); b.c(0, 0.9, 3.05, 2.8, 0.6, 0.2, '#ffd34d', true); put('pumpkinS', b); }
  // haunted house
  { const b = new VB(); const W = '#241b33', W2 = '#2f2442', R = '#140d1f';
    b.c(0, 0, -20, 44, 40, 40, W); b.c(-10, 40, -14, 16, 22, 26, W2); b.c(12, 40, -16, 14, 14, 30, W2);
    for (let i = 0; i < 6; i++) { b.c(0, 40 + i * 3, -21 + i * 3.3, 46 - i * 7, 3, 42 - i * 6.6, R); }
    b.c(-10, 62, -12, 12, 10, 22, R); b.c(-10, 72, -6, 6, 10, 10, R); b.c(-10, 82, -3, 2, 6, 4, R);
    for (let x = -15; x <= 15; x += 10) for (let y = 8; y < 36; y += 12) b.c(x, y, 20.05, 5, 7, 0.4, (x + y) % 3 ? '#ffb347' : '#ffd36b', true);
    b.c(-10, 48, 12.05, 4, 6, 0.4, '#b04cff', true); b.c(0, 0, 20, 8, 14, 0.6, '#1a1210'); b.c(0, 0, 20, 14, 2, 8, '#3a2e22');
    put('house', b); }
  // mausoleum
  { const b = new VB(); b.c(0, 0, -10, 26, 2, 22, '#4d475e'); b.c(0, 2, -8, 22, 16, 18, '#6d6680'); b.c(0, 18, -9, 25, 2.5, 20, '#4d475e');
    for (let i = 0; i < 4; i++) b.c(0, 20.5 + i * 2, -9 + i * 1.6, 23 - i * 5.5, 2, 20 - i * 3.2, '#5d5873');
    for (const x of [-8, -3, 3, 8]) b.c(x, 2, 9.5, 2, 16, 2, '#8a84a0');
    b.c(0, 2, 10.05, 6, 10, 0.4, '#1a1622'); b.c(0, 13, 10.1, 3, 2, 0.3, '#7dff6a', true); put('mausoleum', b); }
  // gothic arch over the road (spans ±6 m)
  { const b = new VB(); const S = '#4a4260', S2 = '#3a3350';
    for (const s of [-1, 1]) { b.c(s * 57, 0, -3, 8, 64, 6, S); b.c(s * 57, 64, -3.5, 10, 4, 7, S2); b.c(s * 57, 68, -2, 4, 8, 4, S); b.c(s * 57, 76, -1, 1.6, 4, 1.6, '#ff8a1f', true); }
    for (let i = 0; i < 25; i++) { const x = -49 + i * 4; const t = x / 52; const y = 64 + 14 * (1 - t * t); b.c(x, y, -3, 4.4, 5, 6, i % 2 ? S : S2); }
    b.c(0, 76, -3.2, 18, 6, 0.3, '#16101e'); b.c(-5, 77.5, -3.4, 2, 2, 0.3, '#ff8a1f', true); b.c(5, 77.5, -3.4, 2, 2, 0.3, '#ff8a1f', true);
    for (const x of [-30, -10, 10, 30]) lanternBox(b, x, 62 + 14 * (1 - (x / 52) ** 2) - 9, 0);
    put('arch', b); }
  // red/green background candle towers (crypto trenches)
  { const b = new VB(); b.c(0, 0, -6, 12, 70, 12, '#b5142a'); b.c(0, 0.5, 6.05, 11, 69, 0.4, '#ff2f45', true); b.c(0, 70, -1, 2, 20, 2, '#ffb3bb'); b.c(0, -6, -1, 2, 6, 2, '#ffb3bb'); put('candleRed', b); }
  { const b = new VB(); b.c(0, 0, -6, 12, 46, 12, '#13863f'); b.c(0, 0.5, 6.05, 11, 45, 0.4, '#2bd96b', true); b.c(0, 46, -1, 2, 14, 2, '#bfffd6'); put('candleGreen', b); }
  // rocks/bushes
  { const b = new VB(); b.c(0, 0, -4, 9, 4, 8, '#2c2638'); b.c(1, 4, -3, 6, 2.4, 6, '#383049'); put('rock', b); }
  { const b = new VB(); b.c(0, 0, -4, 10, 4, 8, '#1f2a24'); b.c(-1, 3, -3, 7, 3, 6, '#26352c'); b.c(2, 5, -2, 3, 2, 3, '#1f2a24'); put('bush', b); }
  // bone pile
  { const b = new VB(); b.c(0, 0, -3, 8, 1.2, 1.2, BONE); b.c(1, 1.2, -2, 1.2, 1.2, 7, BONE_D); b.c(-2, 0, 1, 6, 1, 1, BONE); b.c(2, 2.2, -1, 2.4, 2.2, 2.2, BONE); b.c(1.6, 3, 1.25, 0.6, 0.6, 0.1, SOCKET); b.c(2.6, 3, 1.25, 0.6, 0.6, 0.1, SOCKET); put('bones', b); }
  // side ghost (floating)
  { const b = new VB(); const W = '#f2edff'; b.c(0, 0, -3, 8, 8, 6, W); b.c(0, 8, -2.5, 6, 2, 5, W); for (let i = 0; i < 4; i++) b.b(-4 + i * 2, -1.5 - (i % 2), -3, 2, 1.5 + (i % 2), 6, '#d8d0ef');
    b.c(-1.6, 4.6, 3.05, 1.4, 2, 0.2, '#140b1d'); b.c(1.6, 4.6, 3.05, 1.4, 2, 0.2, '#140b1d'); b.c(0, 2, 3.05, 2, 1.6, 0.2, '#140b1d'); put('ghost', b); }
  // bat
  { const b = new VB(); b.c(0, 0, -1, 2, 2, 2, '#120a18'); b.c(-3.5, 0.6, -0.8, 5, 0.6, 1.6, '#1d1028'); b.c(3.5, 0.6, -0.8, 5, 0.6, 1.6, '#1d1028'); b.c(-0.5, 1.2, 1.01, 0.4, 0.4, 0.1, '#ff5c3a', true); b.c(0.5, 1.2, 1.01, 0.4, 0.4, 0.1, '#ff5c3a', true); put('bat', b); }
  // road-side chart sign (crypto)
  { const b = new VB(); b.c(0, 0, -0.5, 1, 14, 1, IRON); b.c(0, 14, -0.6, 16, 9, 1, '#120c1c');
    const pts = [7, 6, 7.5, 5, 4, 4.5, 2.5, 3, 1.4]; pts.forEach((y, i) => b.c(-7 + i * 1.75, 14.6 + y, 0.45, 1.6, 0.8, 0.3, i < 2 ? '#2bd96b' : '#ff3b4e', true)); put('chartSign', b); }

  // ===== reference-style roadside set =====
  const WD = '#4a2e1c', WD2 = '#5e3b24', WDK = '#2e1c12';
  // wooden fence segment along z (4 m), slightly crooked pickets
  { const b = new VB(); const r = crand(5);
    for (let z = -20; z <= 20; z += 10) b.c(0, 0, z - 0.8, 1.6, 11 + r() * 2, 1.6, WDK);
    b.c(0, 3.5, -20, 0.8, 1.2, 40, WD); b.c(0, 8, -20, 0.8, 1.2, 40, WD2);
    for (let z = -18; z < 20; z += 3.2) { const h = 8 + r() * 3; b.c(0, 1, z, 0.7, h, 2.2, r() < 0.5 ? WD : WD2); b.c(0, 1 + h, z + 0.5, 0.7, 0.8, 1.2, WD2); }
    put('fenceW', b); }
  // wooden lantern post with a hanging lantern (glows)
  { const b = new VB();
    b.c(0, 0, -0.9, 1.8, 30, 1.8, WDK); b.c(0, 0, -1.6, 3.2, 2, 3.2, '#3a3046');
    b.c(2.4, 28, -0.6, 6, 1.2, 1.2, WDK); b.c(1.4, 26.6, -0.4, 0.8, 1.6, 0.8, WDK);
    b.c(4.6, 25, -0.2, 0.3, 3, 0.3, '#1b1820');
    b.c(4.6, 19.6, -1.4, 3.2, 0.8, 3.2, '#1b1820'); b.c(4.6, 24.2, -1.2, 2.6, 0.9, 2.6, '#1b1820'); b.c(4.6, 25, -0.6, 1.4, 0.6, 1.4, '#1b1820');
    for (const [dx, dz] of [[-1.4, -1.4], [1.1, -1.4], [-1.4, 1.1], [1.1, 1.1]]) b.b(4.6 + dx, 20.4, dz, 0.3, 3.8, 0.3, '#1b1820');
    b.c(4.6, 20.4, -1.1, 2.4, 3.8, 2.2, '#ffb347', true); b.c(4.6, 21.2, -0.4, 0.9, 1.6, 0.9, '#fff2b0', true);
    put('lampW', b); }
  // red candle cluster with flames
  { const b = new VB(); const r = crand(11);
    for (let i = 0; i < 5; i++) { const x = (r() - 0.5) * 5, z = (r() - 0.5) * 5, h = 2 + r() * 4.5, w = 1 + r() * 0.6;
      b.c(x, 0, z - w / 2, w, h, w, i % 2 ? '#c21a2e' : '#a8122a'); b.c(x + w * 0.3, h - 1.6, z + w / 2 - 0.05, 0.35, 1.6, 0.2, '#e8394c');
      b.c(x, h, z - 0.15, 0.3, 0.5, 0.3, '#2a1205'); b.c(x, h + 0.4, z - 0.3, 0.6, 1.2, 0.6, '#ffd34d', true); b.c(x, h + 1.5, z - 0.15, 0.3, 0.4, 0.3, '#fff2b0', true); }
    put('candles', b); }
  // pixel font (3x5) for signs and graves
  const FONT = { T: ['111', '010', '010', '010', '010'], H: ['101', '101', '111', '101', '101'], E: ['111', '100', '110', '100', '111'], A: ['010', '101', '111', '101', '101'],
    U: ['101', '101', '101', '101', '111'], N: ['101', '111', '111', '111', '101'], R: ['110', '101', '110', '101', '101'], C: ['011', '100', '100', '100', '011'],
    S: ['011', '100', '010', '001', '110'], I: ['111', '010', '010', '010', '111'], P: ['110', '101', '110', '100', '100'], ' ': ['000', '000', '000', '000', '000'] };
  // text faces -z (towards the runner); letters run towards -x (screen right)
  const text = (b, str, x0, y0, z, px, color, g) => {
    [...str].forEach((ch, i) => (FONT[ch] || FONT[' ']).forEach((row, ry) => [...row].forEach((bit, cx) => {
      if (bit === '1') b.b(x0 - (i * 4 + cx) * px - px, y0 + (4 - ry) * px, z, px, px, 0.3, color, g);
    })));
  };
  const sign = (label, dir) => {
    const b = new VB();
    b.c(0, 0, -0.8, 1.6, 22, 1.6, WDK);
    const w = label.length * 4 * 0.9 + 6;
    b.c(0, 12, -0.6, w, 8, 1.2, WD); b.c(0, 12.4, -0.75, w - 0.8, 7.2, 0.2, WD2);
    for (const yy of [13.6, 16.4]) b.c(0, yy, -0.8, w - 0.4, 0.3, 0.1, WDK);
    b.c(-w / 2 + 0.6, 12, -0.85, 0.6, 8, 0.2, WDK);
    text(b, label, (label.length * 4 * 0.9) / 2 + (dir > 0 ? 1.6 : -1.6), 16.1, -1.0, 0.9, '#d77bff', true);
    // arrow
    const ax = dir > 0 ? -(label.length * 4 * 0.9) / 2 - 0.4 : (label.length * 4 * 0.9) / 2 + 0.4;
    b.c(ax - dir * 1.3, 13.3, -1.0, 3.2, 0.8, 0.3, '#d77bff', true);
    b.c(ax - dir * 2.6, 12.7, -1.0, 0.8, 2, 0.3, '#d77bff', true);
    return b;
  };
  put('signHaunt', sign('THE HAUNT', 1));
  put('signTrench', sign('TRENCHES', -1));
  // RIP grave with a crown
  { const b = new VB(); b.c(0, 0, -2, 10, 1, 5, '#3d3850');
    b.c(0, 1, -1.2, 8.6, 10, 2.4, '#6d6680'); b.c(0, 11, -1, 6.6, 1.2, 2, '#6d6680'); b.c(0, 12.2, -0.8, 4, 0.8, 1.6, '#6d6680');
    text(b, 'RIP', 4.6, 3, -1.45, 0.75, '#3b324f', false);
    b.c(0, 8.4, -1.45, 3.6, 0.8, 0.3, '#ffc44d', true); for (const x of [-1.5, 0, 1.5]) b.c(x, 9.2, -1.45, 0.7, 0.9, 0.3, '#ffc44d', true);
    b.c(3.6, 1, 1.1, 1.4, 2, 1.4, '#3d6b2a');
    put('rip', b); }
  // cracked rune stone
  { const b = new VB(); b.c(0, 0, -3, 7, 8, 6, '#5d5873'); b.c(0.4, 8, -2.6, 6, 1.6, 5, '#6d6680'); b.c(-1, 9.6, -1.6, 3, 1, 3, '#6d6680');
    b.c(-1, 1.5, -3.15, 0.5, 5.5, 0.3, '#c45cff', true); b.c(0.4, 4.5, -3.15, 2.8, 0.5, 0.3, '#c45cff', true); b.c(1.6, 2, -3.15, 0.5, 2.8, 0.3, '#c45cff', true);
    b.c(-3.65, 3, -1, 0.3, 4, 0.5, '#c45cff', true);
    put('rune', b); }
  // barrel
  { const b = new VB(); b.c(0, 0, -2.6, 5.2, 7, 5.2, '#5a3820'); b.c(0, 0.6, -2.9, 5.8, 5.8, 5.8, '#6b4428');
    for (const y of [1, 5.6]) b.c(0, y, -3, 6, 0.6, 6, '#2c2a33'); b.c(0, 7, -2.4, 4.8, 0.4, 4.8, '#3a2618'); put('barrel', b); }
  // big carved pumpkin
  { const b = new VB(); b.c(0, 0, -4.5, 11, 7.5, 9, '#e2650c'); b.c(0, 0.6, -5, 8, 6.4, 10, '#ff7a1a'); b.c(0, 0.6, -4, 12.4, 6, 8, '#f06d10');
    b.c(0, 7.5, -0.8, 1.4, 2, 1.4, '#3d7a24'); b.c(1, 9, -0.6, 2, 0.6, 0.8, '#3d7a24');
    b.c(-2.4, 4, -5.15, 2.2, 1.6, 0.3, '#ffd34d', true); b.c(2.4, 4, -5.15, 2.2, 1.6, 0.3, '#ffd34d', true);
    b.c(0, 1.5, -5.15, 6.4, 1.3, 0.3, '#ffd34d', true); b.c(-1.6, 2.8, -5.15, 1, 0.6, 0.3, '#ffd34d', true); b.c(1.6, 2.8, -5.15, 1, 0.6, 0.3, '#ffd34d', true);
    put('pumpkinL', b); }
  // cute floating ghost (bright)
  { const b = new VB(); const W = '#bdb5d6';
    b.c(0, 2, -3, 8, 7, 6, W, true); b.c(0, 9, -2.6, 6.6, 1.4, 5.2, W, true); b.c(0, 10.4, -1.8, 4.4, 0.8, 3.6, W, true);
    for (let i = 0; i < 4; i++) b.b(-4 + i * 2, 0.4 + (i % 2), -3, 2, 1.8 - (i % 2), 6, '#c9c0e0', true);
    b.c(-4.4, 5, -1, 1, 2.4, 2, W, true); b.c(4.4, 5, -1, 1, 2.4, 2, W, true);
    b.c(-1.5, 6, -3.15, 1.2, 1.6, 0.3, '#1a1022', true); b.c(1.5, 6, -3.15, 1.2, 1.6, 0.3, '#1a1022', true);
    b.c(-2.8, 4.6, -3.15, 1.2, 0.6, 0.3, '#ffb3d1', true); b.c(2.8, 4.6, -3.15, 1.2, 0.6, 0.3, '#ffb3d1', true);
    b.c(0, 4, -3.15, 1.4, 0.7, 0.3, '#1a1022', true);
    put('ghostC', b); }
  // gothic graveyard gate over the road (open, spans about ±6.6 m); pumpkin face on top
  { const b = new VB(); const S = '#4a4260', S2 = '#3a3350', I = '#1b1724';
    for (const s of [-1, 1]) {
      b.c(s * 62, 0, -4, 10, 46, 8, S); b.c(s * 62, 46, -4.6, 12, 3, 9.2, S2); b.c(s * 62, 49, -3, 7, 6, 6, S); b.c(s * 62, 55, -1.6, 3.6, 4, 3.2, S2);
      lanternBox(b, s * 62, 38, -5.2);
      // swung-open iron doors along the road side
      for (let z = 0; z < 26; z += 3) b.c(s * 56, 4, z, 0.6, 32 + (z % 6 ? 0 : 4), 0.6, I);
      b.c(s * 56, 6, 0, 0.8, 1, 27, I); b.c(s * 56, 26, 0, 0.8, 1, 27, I);
    }
    for (let i = 0; i < 31; i++) { const x = -57 + i * 3.8; const t = x / 60; const y = 46 + 16 * (1 - t * t); b.c(x, y, -3, 4.2, 4, 6, i % 2 ? S : S2); }
    for (let x = -50; x <= 50; x += 5) b.c(x, 48, -0.6, 0.7, 10 * (1 - (x / 60) ** 2) + 4, 0.7, I);
    b.c(0, 64, -5, 13, 11, 10, '#ff7a1a'); b.c(0, 64.6, -5.5, 10, 9.6, 11, '#e2650c'); b.c(0, 75, -1.5, 1.6, 2.6, 1.6, '#3d7a24');
    b.c(-3, 70, -5.75, 2.8, 2.2, 0.3, '#ffd34d', true); b.c(3, 70, -5.75, 2.8, 2.2, 0.3, '#ffd34d', true); b.c(0, 66, -5.75, 7.6, 1.6, 0.3, '#ffd34d', true);
    for (const x of [-2.6, 0, 2.6]) b.c(x, 67.6, -5.75, 1, 0.8, 0.3, '#ffd34d', true);
    put('gate', b); }
  return out;
}

/* Big horizon castle (single mesh, far away) */
export function buildCastle() {
  const b = new VB(); const S = '#1f1834', S2 = '#271f42', R = '#140f24';
  b.c(0, 0, -20, 160, 50, 40, S);
  for (const [x, h, w] of [[-70, 110, 22], [-30, 140, 26], [10, 175, 30], [50, 125, 22], [78, 95, 18]]) {
    b.c(x, 0, -w / 2, w, h, w, S2);
    for (let i = 0; i < 5; i++) b.c(x, h + i * 6, -w / 2 + i * 2, w - i * 4.6, 6, w - i * 4.6, R);
    b.c(x, h + 30, -1, 2, 14, 2, R);
    for (let y = 30; y < h - 10; y += 22) b.c(x, y, w / 2 + 0.05, 4, 7, 0.5, y % 44 ? '#ffb347' : '#b04cff', true);
  }
  for (let x = -76; x < 80; x += 8) b.c(x, 50, -18, 5, 6, 36, S2);
  b.c(10, 8, 20.05, 22, 30, 0.5, '#0c0816'); b.c(10, 12, 20.2, 16, 4, 0.4, '#ff8a1f', true);
  return b.mesh(0.5);
}

/* Floating rock island with a tiny haunted castle (sky decoration, scale 1 = metres) */
export function buildIsland(seed) {
  const b = new VB(); const r = crand(seed * 13);
  for (let i = 0; i < 9; i++) { const w = 34 - i * 3.6; b.c((r() - 0.5) * 3, -i * 2.4, -w / 2, w, 2.4, w * 0.8, i % 2 ? '#2a2140' : '#332848'); }
  b.c(0, 0, -15, 34, 1.2, 28, '#2f3a2a');
  b.c(0, 1.2, -5, 12, 12, 10, '#2b2242'); b.c(-7, 1.2, -4, 5, 20, 5, '#2f2648'); b.c(7, 1.2, -4, 5, 16, 5, '#2f2648');
  for (let i = 0; i < 4; i++) { b.c(-7, 21 + i * 2, -3.5 + i * 0.6, 6 - i * 1.4, 2, 6 - i * 1.4, '#1c1530'); b.c(7, 17 + i * 2, -3.5 + i * 0.6, 6 - i * 1.4, 2, 6 - i * 1.4, '#1c1530'); }
  for (const [x, y] of [[-7, 14], [7, 10], [-2, 6], [2, 6], [0, 9]]) b.c(x, y, 5.05, 1.4, 2, 0.3, r() < 0.7 ? '#ffb347' : '#b04cff', true);
  b.c(12, 1.2, -2, 2, 6, 2, '#2a1c22'); b.c(12, 7, -1, 4, 4, 4, '#ff7a1a');
  return b.mesh(1);
}

/* Distant forest/hill silhouette ring piece */
export function buildHills(seed) {
  const b = new VB(); const r = crand(seed);
  for (let x = -100; x < 100; x += 4) {
    const h = 6 + r() * 10 + Math.sin(x * 0.05) * 4;
    b.c(x, 0, -4, 4.2, h, 8, '#140d24');
    if (r() < 0.45) { const ph = 8 + r() * 10; for (let i = 0; i < 4; i++) b.c(x + 1, h + i * ph / 4, -2, 6 - i * 1.4, ph / 4, 4, '#100a1d'); }
  }
  return b.mesh(1);
}

export { materials };
