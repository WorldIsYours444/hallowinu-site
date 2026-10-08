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

/* Builds a chibi upright voxel Inu. Returns { root, parts }. Pivots: hip (0,0.4,0). */
export function buildInu(id) {
  const P = PAL[id] || PAL['shiba-inu'];
  const robot = id === 'artificial-inu', hero = id === 'super-inu', hallow = id === 'hallow-inu';
  const NEON = '#2ef2ff', VIOLET = '#a855f7';

  // ---- legs (pivot at hip, extend down) ----
  const leg = side => {
    const b = new VB();
    const suit = hero ? '#233a8a' : robot ? '#3c4254' : P.fur;
    b.c(0, -4, -1, 2, 3.2, 2, suit);
    b.c(0, -4.6, -1.1, 2.3, 1, 2.8, hero ? '#f2b632' : robot ? '#2a2f3d' : P.paw);   // paw / boot
    if (robot) b.c(0, -2.2, 1.01, 1.2, 0.6, 0.1, VIOLET, true);
    if (hero) b.c(0, -1.8, -1.05, 2.1, 0.5, 2.1, '#f2b632');
    return part(b, side * 1.4, 0.46, 0);
  };
  // ---- torso ----
  const tb = new VB();
  const body = hero ? '#233a8a' : robot ? '#5b6378' : P.fur;
  tb.c(0, 0, -1.7, 5, 4.6, 3.4, body);
  tb.c(0, 0.4, 1.7, 3.2, 3.4, 0.25, hero ? '#2c48a8' : robot ? '#3c4254' : P.cream);          // belly / chest plate
  if (hero) { tb.c(0, 1.7, 1.95, 1.6, 1.8, 0.2, '#f2b632', true); tb.c(0, 0, -1.75, 5.1, 0.6, 3.5, '#f2b632'); }   // emblem + belt
  if (robot) { tb.c(0, 1.6, 1.95, 1.4, 1.4, 0.2, NEON, true); tb.c(0, 1, -2.4, 3, 3, 0.8, '#3c4254'); tb.c(-0.9, 1.4, -2.5, 0.6, 2, 0.2, '#3b82f6', true); tb.c(0.9, 1.4, -2.5, 0.6, 2, 0.2, '#3b82f6', true); }
  if (hallow) tb.c(0, 2, 1.95, 1.4, 1.4, 0.2, '#ff8a1f', true);
  if (id === 'shiba-inu') { tb.c(0, 4.1, -1.8, 5.2, 0.6, 3.6, '#d62f3a'); tb.c(0, 3.3, 1.85, 0.8, 0.8, 0.3, '#ffc44d', true); }
  const torso = part(tb, 0, 0.46, 0);

  // ---- arms (pivot at shoulder) ----
  const arm = side => {
    const b = new VB();
    b.c(0, -3.4, -0.8, 1.6, 3.4, 1.6, hero ? '#233a8a' : robot ? '#3c4254' : P.fur);
    b.c(0, -3.9, -0.9, 1.8, 1, 1.8, hero ? '#f2b632' : robot ? '#2a2f3d' : P.paw);
    if (robot) b.c(side * 0.81, -2, -0.3, 0.1, 1, 0.6, NEON, true);
    return part(b, side * 3.2, 0.46 + 0.42, 0);
  };

  // ---- head (pivot at neck) ----
  const hb = new VB();
  const fur = P.fur, cream = P.cream;
  hb.c(0, 0, -3, 7, 6, 6, fur);
  hb.c(0, 0, 2.6, 6.4, 2.6, 0.6, cream);                 // lower face / cheeks
  hb.c(0, 0.5, 3, 3.4, 2.2, 1.8, cream);                 // snout
  hb.c(0, 2.1, 4.6, 1.3, 0.9, 0.4, '#1a0f0a');           // nose
  hb.c(0, 0.4, 4.7, 1.6, 0.35, 0.2, '#5a1d14');          // mouth
  if (!robot) {
    for (const s of [-1, 1]) {
      hb.c(s * 1.7, 3, 3, 1.1, 1.3, 0.25, '#120a08');      // eyes
      hb.c(s * 1.7 - 0.25, 3.8, 3.2, 0.4, 0.4, 0.1, '#ffffff');
      hb.c(s * 2.4, 4.3, 2.85, 1.2, 0.35, 0.2, P.furDark);  // brows
      hb.c(s * 2.5, 6, -1.2, 2.2, 1.2, 2, fur);             // ears
      hb.c(s * 2.6, 7.2, -0.9, 1.5, 1, 1.4, fur);
      hb.c(s * 2.7, 8.2, -0.6, 0.8, 0.9, 0.8, fur);
      hb.c(s * 2.5, 6.2, 0.81, 1.2, 1.6, 0.1, cream);       // inner ear
    }
  }
  if (robot) {
    hb.c(0, 2.6, 2.95, 6.6, 1.5, 0.3, '#1b1f2a');
    hb.c(-1.7, 2.9, 3.2, 1.8, 0.9, 0.2, NEON, true);
    hb.c(1.7, 2.9, 3.2, 1.8, 0.9, 0.2, NEON, true);
    hb.c(0, 5.9, -2.5, 6.2, 0.4, 5, '#3c4254');
    for (const s of [-1, 1]) {
      hb.c(s * 2.5, 6, -1.2, 2.2, 1.4, 2, '#3c4254'); hb.c(s * 2.6, 7.4, -0.9, 1.4, 1, 1.4, '#5b6378');
      hb.c(s * 2.7, 8.4, -0.6, 0.7, 0.7, 0.7, VIOLET, true);
      hb.c(s * 3.55, 1.5, -1, 0.2, 2.5, 2.5, '#2a2f3d'); hb.c(s * 3.6, 2.3, -0.2, 0.15, 0.8, 0.8, '#3b82f6', true);
    }
    hb.c(0.8, 6, 0, 0.4, 2.4, 0.4, '#2a2f3d'); hb.c(0.8, 8.4, 0, 0.8, 0.8, 0.8, NEON, true);   // antenna
    hb.c(0, 0.5, -3.05, 4, 4, 0.2, '#3c4254'); hb.c(0, 2, -3.1, 2, 1, 0.1, VIOLET, true);
  }
  if (hero) {
    hb.c(0, 2.6, 2.9, 6.8, 1.6, 0.3, '#14224f');            // domino mask
    for (const s of [-1, 1]) { hb.c(s * 1.7, 2.9, 3.15, 1.3, 1, 0.15, '#ffffff'); hb.c(s * 1.6, 3.0, 3.25, 0.6, 0.6, 0.1, '#14224f'); }
  }
  if (hallow) {
    // ghost-sheet hood (open face), skull spots on top
    const W = '#f4f0fb', S = '#d9d1ea';
    hb.c(0, 5.6, -3.4, 7.8, 1.1, 6.6, W);
    hb.c(-3.9, 0.2, -3.4, 0.6, 5.6, 6.4, W); hb.c(3.9, 0.2, -3.4, 0.6, 5.6, 6.4, W);
    hb.c(0, -0.2, -3.6, 7.8, 6.1, 0.6, W);
    hb.c(0, 4.9, 2.6, 7.6, 0.8, 0.9, W);
    for (const s of [-1, 1]) { hb.c(s * 4.1, -1.3, -3.2, 0.8, 1.6, 5, S); hb.c(s * 3.7, -2.1, -2.2, 0.8, 1, 3, W); }
    for (let i = -3; i <= 3; i += 1.5) hb.c(i, -1.6 - (Math.abs(i) % 3 ? 0.6 : 0), -3.9, 1.4, 1.6, 0.5, i % 3 ? S : W);   // ragged drape
    hb.c(-1.5, 2.6, -4.0, 1.8, 2, 0.3, '#191022'); hb.c(1.5, 2.6, -4.0, 1.8, 2, 0.3, '#191022'); hb.c(0, 1.2, -4.0, 1, 0.9, 0.3, '#191022');   // spooky face on the back
    hb.c(-1.6, 6.65, 0.2, 1.6, 0.15, 1.5, '#191022'); hb.c(1.6, 6.65, 0.2, 1.6, 0.15, 1.5, '#191022'); hb.c(0, 6.65, -1.6, 0.9, 0.15, 0.9, '#191022');
    for (const s of [-1, 1]) { hb.c(s * 2.5, 6.6, -1.2, 2.2, 1.2, 2, fur); hb.c(s * 2.6, 7.7, -0.9, 1.5, 1, 1.4, fur); hb.c(s * 2.7, 8.6, -0.6, 0.8, 0.9, 0.8, fur); }
  }
  const head = part(hb, 0, 0.46 + 0.45, 0);

  // ---- tail (pivot at lower back) ----
  const tl = new VB();
  if (robot) { tl.c(0, 0, -1.6, 1.2, 1.2, 1.6, '#3c4254'); tl.c(0, 0.8, -2.6, 1, 1, 1.2, '#5b6378'); tl.c(0, 1.6, -3, 0.9, 0.9, 0.9, NEON, true); }
  else { tl.c(0, 0, -1.6, 1.8, 1.6, 1.8, fur); tl.c(0, 1.2, -2.5, 1.6, 1.8, 1.4, fur); tl.c(0, 2.6, -2.3, 1.5, 1.2, 1.4, cream); tl.c(0, 3.3, -1.6, 1.2, 0.9, 1, cream); }
  const tail = part(tl, 0, 0.46 + 0.15, -0.17);

  // ---- cape (pivot at shoulders, hangs down the back) ----
  let cape = null;
  if (hallow || hero) {
    const cb = new VB();
    const main = hallow ? '#2a1640' : '#c4162b', lining = hallow ? '#5b2a86' : '#f2b632';
    cb.c(0, -7, -0.6, 7.6, 7, 0.6, main);
    cb.c(0, -7, -0.05, 7.4, 7, 0.1, lining);
    cb.c(-3.9, -6.6, -0.5, 0.6, 6, 0.5, lining); cb.c(3.9, -6.6, -0.5, 0.6, 6, 0.5, lining);
    for (let i = -3.5; i <= 2.5; i += 2) cb.b(i, -8, -0.6, 1, 1, 0.6, main);   // jagged hem
    cb.c(0, -0.2, -0.7, 6.6, 0.6, 0.8, lining);
    if (hallow) {   // glowing jack-o'-lantern emblem on the back (visible from the camera)
      cb.c(0, -5.6, -0.75, 3.6, 3, 0.15, '#ff8a1f', true);
      cb.c(0, -2.6, -0.75, 0.6, 0.6, 0.15, '#4caf50');
      cb.c(-0.9, -3.9, -0.85, 0.8, 0.7, 0.12, '#2a1640'); cb.c(0.9, -3.9, -0.85, 0.8, 0.7, 0.12, '#2a1640');
      cb.c(0, -5.0, -0.85, 2.2, 0.5, 0.12, '#2a1640');
    } else {
      cb.c(0, -5, -0.75, 2, 2.6, 0.15, '#f2b632', true);
    }
    cape = part(cb, 0, 0.46 + 0.42, -0.17);
  }
  let extra = null;
  if (robot) {   // floating holo ring
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

export function buildSkeleton() {
  const skullB = new VB();
  skullB.c(0, 0, -2.4, 5, 4.6, 4.8, BONE);
  skullB.c(0, -1.2, -1.8, 3.8, 1.3, 3.8, BONE_D);                     // jaw
  for (let i = -1.5; i <= 1.5; i += 1) skullB.c(i, -0.4, 2.2, 0.6, 0.6, 0.3, '#ffffff');   // teeth
  for (const s of [-1, 1]) { skullB.c(s * 1.2, 2, 2.3, 1.5, 1.5, 0.3, SOCKET); skullB.c(s * 1.2, 2.3, 2.45, 0.6, 0.6, 0.2, SPOOK, true); }
  skullB.c(0, 1.2, 2.35, 0.6, 0.7, 0.2, SOCKET);
  // floppy witch-hat-ish crooked top hat (funny)
  skullB.c(0, 4.4, -2.6, 6, 0.5, 5.2, '#2a1640'); skullB.c(0, 4.9, -1.6, 3.4, 2.6, 3.2, '#2a1640'); skullB.c(0, 5, -1.65, 3.5, 0.6, 3.3, '#ff7a1a');
  const head = at(G(skullB.mesh(0.1, { shadow: true })), 0, 1.45, 0);
  const tb = new VB();
  tb.c(0, 0, -0.5, 1, 6, 1, BONE_D);                                   // spine
  for (let r = 0; r < 4; r++) { tb.c(0, 2 + r * 1.05, -1.3, 4.6 - r * 0.3, 0.55, 0.4, BONE); tb.c(0, 2 + r * 1.05, 1.0, 4.6 - r * 0.3, 0.55, 0.4, BONE); tb.c(-2.2 + r * 0.15, 2 + r * 1.05, -1.3, 0.5, 0.55, 2.7, BONE); tb.c(2.2 - r * 0.15, 2 + r * 1.05, -1.3, 0.5, 0.55, 2.7, BONE); }
  tb.c(0, 6.2, -0.5, 5, 0.7, 1, BONE);                                 // collarbone
  tb.c(0, -0.6, -0.9, 4, 1.2, 1.8, BONE);                              // pelvis
  tb.c(0, 5, 0.9, 5.4, 1, 0.6, '#5b2a86'); tb.c(1.8, 3.4, 1.1, 1.2, 2.2, 0.5, '#5b2a86');   // tattered scarf
  const torso = at(G(tb.mesh(0.1, { shadow: true })), 0, 0.9, 0);
  const limb = (len, w, lantern) => {
    const b = new VB();
    b.c(0, -len / 2, -w / 2, w, len / 2, w, BONE); b.c(0, -len / 2 - 0.4, -w / 2 - 0.1, w + 0.4, 0.6, w + 0.2, BONE_D);
    b.c(0, -len, -w / 2, w * 0.9, len / 2 - 0.2, w * 0.9, BONE); b.c(0, -len - 0.8, -0.6, 1.4, 0.8, 1.6, BONE);
    if (lantern) { b.c(0, -len - 3.4, -0.9, 1.8, 2.4, 1.8, '#2b1a10'); b.c(0, -len - 3.1, -0.7, 1.4, 1.8, 1.4, '#ffb347', true); b.c(0, -len - 1.2, -0.1, 0.2, 0.6, 0.2, '#2b1a10'); }
    return b;
  };
  const armL = at(G(limb(6, 0.8).mesh(0.1)), -2.8, 1.5, 0);
  const armR = at(G(limb(6, 0.8, true).mesh(0.1)), 2.8, 1.5, 0);
  const legL = at(G(limb(8.5, 1).mesh(0.1)), -1.1, 0.95, 0);
  const legR = at(G(limb(8.5, 1).mesh(0.1)), 1.1, 0.95, 0);
  const hip = G(torso, head, armL, armR, legL, legR);
  const root = G(hip);
  return { root, parts: { hip, torso, head, armL, armR, legL, legR } };
}

export function buildBoneDog() {
  const hb = new VB();
  hb.c(0, 0, -1.5, 3.6, 3, 3.4, BONE);
  hb.c(0, 0, 1.9, 2.2, 1.6, 2.2, BONE);                                 // snout
  hb.c(0, -0.7, 1.4, 2, 0.7, 2.4, BONE_D);                              // jaw
  for (const s of [-1, 1]) { hb.c(s * 0.9, 1.6, 1.85, 1.2, 1, 0.2, SOCKET); hb.c(s * 0.9, 1.75, 1.95, 0.6, 0.6, 0.15, '#ff5c3a', true); hb.c(s * 1.3, 3, -1, 0.9, 1.6, 1, BONE_D); }
  hb.c(0, 1.2, 4.1, 0.9, 0.6, 0.2, SOCKET);
  const head = at(G(hb.mesh(0.1, { shadow: true })), 0, 0.62, 0.55);
  const bb = new VB();
  for (let i = 0; i < 6; i++) bb.c(0, 0, -3 + i * 1.05, 0.9, 0.9, 0.8, i % 2 ? BONE : BONE_D);   // spine
  for (let r = 0; r < 3; r++) { const z = -0.6 + r * 1.1; bb.c(-1.1, -1.6, z, 0.4, 1.8, 0.5, BONE); bb.c(1.1, -1.6, z, 0.4, 1.8, 0.5, BONE); bb.c(0, -1.9, z, 2.6, 0.4, 0.5, BONE); }
  bb.c(0, -0.6, -3.4, 2.2, 1, 1.2, BONE_D);                             // hips
  const body = at(G(bb.mesh(0.1, { shadow: true })), 0, 0.55, 0);
  const legB = () => { const b = new VB(); b.c(0, -2.4, -0.3, 0.6, 2.4, 0.6, BONE); b.c(0, -2.9, -0.4, 0.8, 0.5, 1.1, BONE_D); return b; };
  const mk = (x, z) => at(G(legB().mesh(0.1)), x, 0.5, z);
  const legFL = mk(-0.7, 0.25), legFR = mk(0.7, 0.25), legBL = mk(-0.7, -0.3), legBR = mk(0.7, -0.3);
  const tb = new VB(); for (let i = 0; i < 4; i++) tb.c(0, i * 0.7, -1 - i * 0.5, 0.5, 0.6, 0.6, BONE);
  const tail = at(G(tb.mesh(0.1)), 0, 0.58, -0.32);
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
    case 'tombstone': {
      b.c(0, 0, 0, 14, 1, 7, STONE_D);
      b.c(0, 1, 1, 11, 7.5, 5, STONE); b.c(0, 8.5, 1.5, 9, 1, 4, STONE);
      b.c(0, 5, 6.05, 1.2, 3.2, 0.3, '#2b2638'); b.c(0, 6.6, 6.05, 3.4, 0.9, 0.3, '#2b2638');
      b.c(-3, 2, 6.05, 6, 0.5, 0.3, '#3b2f4f');
      b.c(4.4, 1, 0.6, 1.5, 1.5, 1.5, '#4caf50');                         // moss
      if (variant % 2) b.c(-5.5, 1, 4.5, 1.6, 1.4, 1.6, ORANGE, true);
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
    case 'lowWall': {
      for (let i = 0; i < 6; i++) for (let row = 0; row < 3; row++) {
        if (row === 2 && (i === 1 || i === 4)) continue;
        b.b(-10 + i * 3.4 + (row % 2) * 1.2, row * 2.8, 1, 3.2, 2.7, 6, r() > 0.5 ? STONE : STONE_D);
      }
      b.c(-6, 8.4, 2, 2, 1.2, 3, STONE); b.c(7, 0, -1, 3, 1.6, 2, STONE_D);
      b.c(3, 6, 6.9, 1.4, 1.4, 0.3, PURP, true);
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
function disk(b, R, fill, rim, depth = 1.2) {
  for (let y = -R; y < R; y++) {
    const yc = y + 0.5; if (R * R - yc * yc <= 0) continue;
    const half = Math.sqrt(R * R - yc * yc);
    const w = Math.round(half * 2);
    if (w <= 0) continue;
    b.c(0, y, -depth / 2, w, 1, depth, Math.abs(yc) > R - 1.3 || half < 1.5 ? rim : fill);
  }
}
export function coinGeometries(type) {
  const lit = new VB(), glow = new VB();
  if (type === 'HALLOWINU') {
    disk(glow, 4, '#ff8a1f', '#ffc44d');
    for (const s of [-1, 1]) lit.c(s * 1.3, 0.4, -0.75, 1.2, 1.2, 1.5, '#2a1205');
    lit.c(0, -1.8, -0.75, 3.2, 0.8, 1.5, '#2a1205'); lit.c(0, 3.6, -0.3, 1, 1.2, 0.6, '#3d7a24');
  } else if (type === 'USDC') {
    disk(glow, 4, '#2f7bff', '#bcd6ff');
    lit.c(0, -2.6, -0.75, 1, 5.2, 1.5, '#ffffff'); lit.c(0, 1.2, -0.75, 2.6, 0.7, 1.5, '#ffffff'); lit.c(0, -0.3, -0.75, 2.6, 0.7, 1.5, '#ffffff');
    lit.c(0, -1.8, -0.75, 2.6, 0.7, 1.5, '#ffffff'); lit.c(-1, 0.4, -0.75, 0.7, 1.2, 1.5, '#ffffff'); lit.c(1, -1.1, -0.75, 0.7, 1.2, 1.5, '#ffffff');
  } else {
    disk(lit, 4.2, '#140a24', '#9945ff');
    glow.c(0.4, 1.4, -0.8, 5, 0.9, 1.6, '#14f195'); glow.c(-0.4, -0.4, -0.8, 5, 0.9, 1.6, '#7a6bff'); glow.c(0.4, -2.2, -0.8, 5, 0.9, 1.6, '#c34bff');
    glow.c(-2.2, 1.4, -0.8, 0.6, 0.9, 1.6, '#14f195'); glow.c(2.2, -2.2, -0.8, 0.6, 0.9, 1.6, '#c34bff');
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
