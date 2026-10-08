/* Voxel geometry builder: boxes → one merged BufferGeometry with baked per-face shading + vertex colours.
   One part = at most two draw calls (lit voxels + glowing voxels). */
import * as THREE from './vendor/three.bundle.js';

const FACES = [
  // normal, 4 corners (unit cube 0..1), shade
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0 },   // top
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5 },  // bottom
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.86 },  // front (+z)
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.7 },  // back
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.78 },  // right
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.72 }, // left
];
const tmp = new THREE.Color();

/* boxes: [x0,y0,z0, x1,y1,z1, color] in voxel units; scale converts to metres. */
export function boxesToGeometry(boxes, scale = 0.1, { shade = true, jitter = 0 } = {}) {
  const n = boxes.length;
  const pos = new Float32Array(n * 24 * 3), nor = new Float32Array(n * 24 * 3), col = new Float32Array(n * 24 * 3);
  const idx = new Uint32Array(n * 36);
  let v = 0, i = 0;
  for (const b of boxes) {
    const [x0, y0, z0, x1, y1, z1, color] = b;
    tmp.set(color);
    const j = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    for (const f of FACES) {
      const s = (shade ? f.s : 1) * j;
      for (const c of f.c) {
        pos[v * 3] = (c[0] ? x1 : x0) * scale; pos[v * 3 + 1] = (c[1] ? y1 : y0) * scale; pos[v * 3 + 2] = (c[2] ? z1 : z0) * scale;
        nor[v * 3] = f.n[0]; nor[v * 3 + 1] = f.n[1]; nor[v * 3 + 2] = f.n[2];
        col[v * 3] = tmp.r * s; col[v * 3 + 1] = tmp.g * s; col[v * 3 + 2] = tmp.b * s;
        v++;
      }
      const base = v - 4;
      idx[i++] = base; idx[i++] = base + 1; idx[i++] = base + 2; idx[i++] = base; idx[i++] = base + 2; idx[i++] = base + 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export const MATS = {};
export function materials() {
  if (MATS.lit) return MATS;
  MATS.lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  MATS.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  MATS.ghost = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, toneMapped: false });
  return MATS;
}

/* A voxel "builder" with helpers; produces a THREE.Group with lit + glow meshes. */
export class VB {
  constructor() { this.lit = []; this.glow = []; }
  /* box in voxel units from (x,y,z) with size (w,h,d) */
  b(x, y, z, w, h, d, color, glow = false) { (glow ? this.glow : this.lit).push([x, y, z, x + w, y + h, z + d, color]); return this; }
  /* centred on x */
  c(x, y, z, w, h, d, color, glow = false) { return this.b(x - w / 2, y, z, w, h, d, color, glow); }
  mesh(scale = 0.1, opts = {}) {
    const M = materials();
    const grp = new THREE.Group();
    if (this.lit.length) { const m = new THREE.Mesh(boxesToGeometry(this.lit, scale, opts), opts.material || M.lit); m.castShadow = !!opts.shadow; grp.add(m); }
    if (this.glow.length) grp.add(new THREE.Mesh(boxesToGeometry(this.glow, scale, { shade: false }), opts.glowMaterial || M.glow));
    return grp;
  }
  geometries(scale = 0.1, opts = {}) {
    return { lit: this.lit.length ? boxesToGeometry(this.lit, scale, opts) : null, glow: this.glow.length ? boxesToGeometry(this.glow, scale, { shade: false }) : null };
  }
}

/* Tiny deterministic RNG for cosmetic variety (scenery tiles). */
export function crand(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
