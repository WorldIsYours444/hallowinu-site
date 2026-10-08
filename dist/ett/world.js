/* Escape The Trenches — Three.js renderer (presentation only; gameplay lives in sim.js). */
import * as THREE from './vendor/three.bundle.js';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from './vendor/three.bundle.js';
import { ETT } from './config.js';
import { obstacleWorldZ } from './sim.js';
import { VB, materials, crand } from './voxel.js';
import { buildInu, buildSkeleton, buildBoneDog, buildObstacle, coinGeometries, propGeometries, buildCastle, buildHills, buildIsland } from './models.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Biomes: the haunted world changes as you run. */
export const BIOMES = [
  { id: 'forest', name: 'HAUNTED FOREST', fog: '#26103e', hemi: '#7a4cc2', ground: '#120c1a', tint: '#2a1440' },
  { id: 'graveyard', name: 'GRAVEYARD OF REKT', fog: '#1f1240', hemi: '#6b5ad0', ground: '#10121a', tint: '#1d1636' },
  { id: 'village', name: 'HALLOW VILLAGE', fog: '#2c1036', hemi: '#a35acf', ground: '#160d14', tint: '#3a1630' },
  { id: 'bridge', name: 'GOTHIC BRIDGES', fog: '#1b1442', hemi: '#5b62d8', ground: '#0e0d1c', tint: '#18143a' },
  { id: 'trenches', name: 'THE CRYPTO TRENCHES', fog: '#320c26', hemi: '#c04a7a', ground: '#170a10', tint: '#3a0f22' },
];
export const BIOME_LEN = 850;
export const biomeAt = z => Math.floor(Math.max(0, z) / BIOME_LEN) % BIOMES.length;

const QUALITY = {
  low: { pr: 0.7, bloom: false, shadows: false, density: 0.45, particles: 0.4, far: 150 },
  medium: { pr: 1, bloom: true, shadows: false, density: 0.75, particles: 0.7, far: 175 },
  high: { pr: 2, bloom: true, shadows: true, density: 1, particles: 1, far: 190 },
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.clock = 0;
    this.mode = 'menu';           // menu | select | run | over
    this.qualityName = 'medium';
    this.Q = QUALITY.medium;
    materials();
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildRoad();
    this._buildProps();
    this._buildPools();
    this._buildActors();
    this._buildParticles();
    this._buildMist();
    this.composer = null;
    this.camPos = new THREE.Vector3(0, 3, -6); this.camLook = new THREE.Vector3(0, 1, 8);
    this.shake = 0; this.orbit = 0; this.dragYaw = 0;
    this.chase = { gap: 2.4, target: 2.4, x: 0, visibleT: 0 };
    this.view = { pz: 0, px: 0, y: 0, slide: false, speed: ETT.speed.start, lane: 1 };
    this.biome = 0; this._biomeMix = 0;
    this.setQuality('medium');
    this.resize();
  }

  /* ---------------- quality ---------------- */
  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'medium';
    this.Q = QUALITY[this.qualityName];
    const pr = Math.min(window.devicePixelRatio || 1, this.Q.pr === 2 ? 2 : this.Q.pr * (window.devicePixelRatio > 1.5 ? 1.25 : 1));
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = this.Q.shadows;
    this.moonLight.castShadow = this.Q.shadows;
    this.scene.fog.near = 40; this.scene.fog.far = this.Q.far + 15;
    if (this.Q.bloom && !this.composer) this._buildComposer();
    this.resize();
    this.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }
  _buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // portrait screens need a wider view so all three lanes stay visible
    this.camera.fov = w / h < 0.8 ? 74 : w / h < 1.2 ? 68 : 60;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setSize(w, h); this.composer.setPixelRatio(this.renderer.getPixelRatio()); }
    this.portrait = w / h < 0.8; this.w = w;
  }

  /* ---------------- sky / moon / stars ---------------- */
  _buildSky() {
    this.scene.fog = new THREE.Fog('#26103e', 40, 190);
    this.skyGroup = new THREE.Group(); this.scene.add(this.skyGroup);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#0b0420') }, mid: { value: new THREE.Color('#3a0f5e') }, hor: { value: new THREE.Color('#ff6a2a') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
        void main(){ float h = vP.y; float f = max(vP.z, 0.0);
          vec3 c = mix(mid, top, smoothstep(0.05, 0.6, h));
          c = mix(c, hor, (1.0 - smoothstep(-0.02, 0.22, h)) * (0.35 + 0.65 * f));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.skyMat = skyMat;
    this.skyGroup.add(new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat));
    // stars
    const n = 900, p = new Float32Array(n * 3), r = crand(9);
    for (let i = 0; i < n; i++) { const a = r() * TAU, e = 0.08 + r() * 1.3; p[i * 3] = Math.cos(a) * Math.cos(e) * 850; p[i * 3 + 1] = Math.sin(e) * 850; p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 850; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#e8d8ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.skyGroup.add(this.stars);
    // giant orange moon (+ halo), always ahead of the runner
    const moonTex = canvasTex(512, 512, (g, w) => {
      const grd = g.createRadialGradient(w * 0.42, w * 0.4, w * 0.05, w / 2, w / 2, w / 2);
      grd.addColorStop(0, '#ffe7a3'); grd.addColorStop(0.5, '#ffb84a'); grd.addColorStop(0.9, '#ff8a1f'); grd.addColorStop(1, 'rgba(255,122,26,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, TAU); g.fill();
      g.fillStyle = 'rgba(214,110,30,.35)';
      for (const [x, y, r] of [[150, 120, 34], [360, 140, 22], [120, 300, 18], [390, 330, 26], [250, 420, 16]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      // carved grin (pixel-stepped)
      g.fillStyle = 'rgba(150,40,10,.78)';
      const px = 12, tri = (cx, cy, size, dir) => { for (let row = 0; row < size; row++) { const wd = (dir > 0 ? row + 1 : size - row) * 2; g.fillRect(cx - wd * px / 2, cy + row * px, wd * px, px); } };
      tri(178, 170, 6, 1); tri(334, 170, 6, 1);
      for (let i = 0; i < 17; i++) { const x = 100 + i * 18, curve = Math.round(Math.sin((i / 16) * Math.PI) * 4); g.fillRect(x, 300 + curve * px, 18, px * 3); }
      g.clearRect(0, 0, 0, 0);
      g.fillStyle = 'rgba(255,215,120,.9)';
      for (const x of [154, 226, 298, 370]) g.fillRect(x, 300 + Math.round(Math.sin(((x - 100) / 288) * Math.PI) * 4) * px, 14, 14);
    });
    moonTex.magFilter = THREE.NearestFilter;
    const halo = canvasTex(256, 256, (g, w) => { const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grd.addColorStop(0, 'rgba(255,140,40,.65)'); grd.addColorStop(0.4, 'rgba(255,90,30,.25)'); grd.addColorStop(1, 'rgba(255,60,30,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, w); });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(230, 230), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
    this.moonHalo = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshBasicMaterial({ map: halo, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.moon.position.set(-30, 130, 700); this.moonHalo.position.set(-30, 130, 705);
    this.moon.rotation.y = Math.PI; this.moonHalo.rotation.y = Math.PI;
    this.skyGroup.add(this.moonHalo, this.moon);
    // purple cloud bands
    const cloudTex = canvasTex(512, 128, (g, w, h) => {
      const r2 = crand(4);
      for (let i = 0; i < 46; i++) { const x = r2() * w, y = h * 0.3 + r2() * h * 0.45, cw = 40 + r2() * 120, ch = 8 + r2() * 18;
        g.fillStyle = `rgba(${90 + r2() * 60},${30 + r2() * 30},${130 + r2() * 60},${0.35 + r2() * 0.35})`; g.fillRect(x - cw / 2, y, cw, ch); }
      g.fillStyle = 'rgba(255,130,60,.25)'; for (let i = 0; i < 18; i++) g.fillRect(r2() * w, h * 0.6 + r2() * 20, 30 + r2() * 60, 4);
    });
    this.clouds = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 200), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, fog: false, depthWrite: false, opacity: 0.75 - i * 0.15 }));
      m.position.set(i * 120 - 120, 80 + i * 40, 640 - i * 30); m.rotation.y = Math.PI;
      this.skyGroup.add(m); this.clouds.push(m);
    }
    // horizon castle + hill silhouettes (parallax with the camera)
    this.castle = buildCastle(); this.castle.position.set(-150, 26, 520); this.castle.rotation.y = 0.25;
    { const hb = new VB(); const r3 = crand(31);
      for (let i = 0; i < 18; i++) { const w = 120 - i * 6; hb.c((r3() - 0.5) * 8, i * 1.6, -w / 2, w, 1.7, w * 0.6, i % 3 ? '#1b1430' : '#221a3a'); }
      const hill = hb.mesh(1); hill.position.set(-150, -2, 520); hill.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.fog = false; } }); this.skyGroup.add(hill); }
    this.islands = [];
    for (const [x, y, z, sc, seed] of [[150, 120, 560, 1, 1], [-260, 150, 610, 0.8, 2], [300, 90, 470, 0.6, 3]]) {
      const isl = buildIsland(seed); isl.position.set(x, y, z); isl.scale.setScalar(sc);
      isl.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.fog = false; } });
      this.skyGroup.add(isl); this.islands.push({ m: isl, y, ph: seed });
    }
    this.castle.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.fog = false; } });
    this.skyGroup.add(this.castle);
    this.hills = [];
    for (let i = 0; i < 4; i++) { const h = buildHills(i + 3); h.position.set((i - 1.5) * 190, -2, 420 + (i % 2) * 40); h.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.fog = false; } }); this.skyGroup.add(h); this.hills.push(h); }
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight('#a884ec', '#40243a', 2.4);
    this.moonLight = new THREE.DirectionalLight('#ffbe80', 2.6);
    this.moonLight.position.set(-8, 14, 30);
    this.moonLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.moonLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -6, near: 1, far: 70 });
    this.moonLight.shadow.bias = -0.0015;
    this.fill = new THREE.DirectionalLight('#b59bff', 1.5); this.fill.position.set(4, 8, -12);
    this.scene.add(this.hemi, this.moonLight, this.moonLight.target, this.fill, this.fill.target);
    this.playerGlow = new THREE.PointLight('#ffc89a', 3.5, 2.6, 1.5); this.scene.add(this.playerGlow);
    // warm pools of light under the nearest roadside lanterns
    this.lanternLights = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ffa340', 5, 9, 1.6); l.position.set(0, -50, 0); this.scene.add(l); this.lanternLights.push(l); }
  }

  _buildGround() {
    const tex = canvasTex(256, 256, (g, w) => {
      const r = crand(21); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 900; i++) { const s = 4 + Math.floor(r() * 3) * 4; const v = 150 + r() * 105; g.fillStyle = `rgb(${v * 0.9},${v * 0.85},${v})`; g.fillRect(Math.floor(r() * 64) * 4, Math.floor(r() * 64) * 4, s, s); }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(40, 60); tex.magFilter = THREE.NearestFilter;
    this.groundMat = new THREE.MeshLambertMaterial({ color: '#2f2238', map: tex });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 600), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.05; this.ground.receiveShadow = true;
    this.groundTex = tex;
    this.scene.add(this.ground);
  }

  /* Cobblestone path (pixel texture) with chunky stone kerbs. 20 m segments recycled. */
  _buildRoad() {
    const SEG = 20;
    const tex = canvasTex(512, 1024, (g, w, h) => {
      const r = crand(12);
      g.fillStyle = '#1b1824'; g.fillRect(0, 0, w, h);                 // grout
      let y = 0;
      while (y < h) {
        const rh = 18 + Math.floor(r() * 3) * 5; let x = -Math.floor(r() * 30);
        while (x < w) {
          const sw = 24 + Math.floor(r() * 4) * 7;
          const v = 96 + r() * 52, warm = r() < 0.1;
          g.fillStyle = warm ? `rgb(${v * 1.02},${v * 0.86},${v * 0.8})` : `rgb(${v * 0.84},${v * 0.86},${v * 1.0})`;
          g.fillRect(x + 3, y + 3, sw - 6, rh - 6);
          g.fillRect(x + 5, y + 2, sw - 10, rh - 4);                      // chamfered corners
          g.fillStyle = 'rgba(255,245,255,.13)'; g.fillRect(x + 5, y + 3, sw - 10, 3);
          g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 5, y + rh - 6, sw - 10, 3);
          if (r() < 0.07) { g.fillStyle = 'rgba(70,120,60,.6)'; g.fillRect(x + 2, y + rh - 6, 10, 5); }
          x += sw;
        }
        y += rh;
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.NearestFilter; tex.repeat.set(1, 1);
    const roadMat = new THREE.MeshLambertMaterial({ map: tex });
    const roadGeo = new THREE.PlaneGeometry(7.8, SEG); roadGeo.rotateX(-Math.PI / 2); roadGeo.translate(0, 0.02, SEG / 2);   // texture: 512 px across 7.8 m
    // kerb stones + mossy verge
    const variants = [0, 1, 2].map(vi => {
      const b = new VB(); const r = crand(40 + vi);
      for (const s of [-1, 1]) {
        for (let z = 0; z < SEG * 10; z += 6 + Math.floor(r() * 3)) {
          const h = 2.4 + r() * 1.6, c = ['#8a82a0', '#7a7290', '#9a92b0', '#6d6680'][Math.floor(r() * 4)];
          b.b(s * 39 - (s > 0 ? 0 : 6.5), 0, z, 6.5, h, 5.6 + r() * 1.5, c);
          b.b(s * 39 - (s > 0 ? -0.3 : 6.2), h, z + 0.6, 6, 0.5, 4, '#a49cba');
        }
        b.b(s * 46 - (s > 0 ? 0 : 20), -0.6, 0, 20, 0.8, SEG * 10, '#2a2a2c');
        for (let z = 0; z < SEG * 10; z += 9) if (r() < 0.6) b.b(s * (47 + r() * 14) - 1, 0, z, 2 + r() * 3, 0.8 + r() * 1.2, 2 + r() * 2, r() < 0.5 ? '#2f4a2a' : '#3a2a3e');
      }
      return b.geometries(0.1);
    });
    this.roadSegs = [];
    const M = materials();
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const road = new THREE.Mesh(roadGeo, roadMat); road.receiveShadow = true; g.add(road);
      const geo = variants[i % 3];
      const m = new THREE.Mesh(geo.lit, M.lit); m.receiveShadow = true; g.add(m);
      this.scene.add(g); this.roadSegs.push(g);
    }
    this.roadTex = tex;
    this.SEG = SEG;
  }

  /* Instanced scenery with tiles of 20 m. */
  _buildProps() {
    const geos = propGeometries();
    const M = materials();
    const caps = { tree: 80, pine: 110, cross: 40, grave: 40, fenceW: 130, lampW: 60, candles: 110, rip: 70, rune: 60, barrel: 50, pumpkinL: 70, pumpkinS: 50, signHaunt: 6, signTrench: 6, ghostC: 24, gate: 3, house: 20, mausoleum: 10, arch: 6, candleRed: 24, candleGreen: 24, rock: 40, bush: 50, bones: 30, chartSign: 16 };
    this.props = {};
    for (const [name, cap] of Object.entries(caps)) {
      const g = geos[name];
      const lit = g.lit ? new THREE.InstancedMesh(g.lit, M.lit, cap) : null;
      const glow = g.glow ? new THREE.InstancedMesh(g.glow, M.glow, cap) : null;
      for (const im of [lit, glow]) if (im) { im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(im); }
      this.props[name] = { lit, glow, cap, n: 0 };
    }
    // bats (sky flock)
    const bat = geos.bat;
    this.bats = { lit: new THREE.InstancedMesh(bat.lit, M.lit, 26), glow: new THREE.InstancedMesh(bat.glow, M.glow, 26), list: [] };
    for (const im of [this.bats.lit, this.bats.glow]) { im.frustumCulled = false; this.scene.add(im); }
    const r = crand(77);
    for (let i = 0; i < 26; i++) this.bats.list.push({ a: r() * TAU, rad: 6 + r() * 22, h: 6 + r() * 14, sp: 0.4 + r() * 0.7, ph: r() * TAU, dz: 20 + r() * 90 });
    this.tiles = new Map();
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  _tile(t) {
    if (this.tiles.has(t)) return this.tiles.get(t);
    const r = crand(t * 7 + 3), z0 = t * 20, biome = biomeAt(z0), list = [];
    const add = (type, x, z, rot = 0, s = 1) => list.push({ type, x, z: z0 + z, rot, s });
    const side = () => (r() < 0.5 ? -1 : 1);
    const B = BIOMES[biome].id, dens = this.Q.density;
    // ---- the reference look: fences, lanterns, candles, graves and rune stones hugging the path ----
    for (const s of [-1, 1]) {
      for (let z = 2; z < 20; z += 4) if (r() < 0.8) add('fenceW', s * 6.4, z, 0, 1);
      add('lampW', s * 4.7, s > 0 ? 3 : 13, s > 0 ? Math.PI : 0, 1);
      const nNear = 3 + Math.floor(r() * 4 * dens);
      for (let i = 0; i < nNear; i++) {
        const q = r(), x = s * (4.5 + r() * 1.6), z = (i + r()) * (20 / nNear), tilt = -s * (0.2 + r() * 0.4);
        const type = q < 0.3 ? 'candles' : q < 0.48 ? 'rip' : q < 0.64 ? 'rune' : q < 0.78 ? 'pumpkinL' : q < 0.88 ? 'barrel' : 'candles';
        add(type, x, z, tilt, type === 'candles' ? 1 : 0.85 + r() * 0.3);
      }
      // second row behind the fence
      const nBack = Math.round((5 + r() * 4) * dens);
      for (let i = 0; i < nBack; i++) {
        const q = r(), x = s * (7.5 + r() * 9), z = r() * 20;
        const type = q < 0.24 ? 'rip' : q < 0.4 ? 'tree' : q < 0.56 ? 'pumpkinL' : q < 0.68 ? 'rune' : q < 0.84 ? 'candles' : q < 0.92 ? 'lampW' : 'cross';
        add(type, x, z, type === 'tree' ? r() * TAU : -s * r() * 0.6, 0.8 + r() * 0.5);
      }
    }
    if (t % 6 === 3) { add('signHaunt', 5.6, 6, 0.45, 1); }
    if (t % 6 === 0 && t > 0) { add('signTrench', -5.6, 12, -0.45, 1); }
    if (t % 15 === 9) add('gate', 0, 10, 0, 1);
    if (r() < 0.35) add('ghostC', side() * (5.5 + r() * 4), r() * 20, 0, 0.7 + r() * 0.4);
    // ---- far layer per biome ----
    const N = Math.round(7 * dens);
    for (let i = 0; i < N; i++) {
      const s = side(), x = s * (18 + r() * 30), z = r() * 20, rot = r() * TAU, q = r();
      let type;
      if (B === 'forest') type = q < 0.45 ? 'tree' : q < 0.85 ? 'pine' : 'bush';
      else if (B === 'graveyard') type = q < 0.35 ? 'grave' : q < 0.6 ? 'cross' : q < 0.8 ? 'tree' : 'pine';
      else if (B === 'village') type = q < 0.4 ? 'pumpkinS' : q < 0.7 ? 'tree' : 'pine';
      else if (B === 'bridge') type = q < 0.55 ? 'pine' : q < 0.8 ? 'rock' : 'tree';
      else type = q < 0.3 ? 'bones' : q < 0.55 ? 'rock' : q < 0.75 ? 'grave' : 'tree';
      add(type, x, z, rot, 0.9 + r() * 0.7);
    }
    if (B === 'graveyard' && r() < 0.4) add('mausoleum', side() * (17 + r() * 10), 10, r() < 0.5 ? Math.PI / 2 : -Math.PI / 2, 1);
    if ((B === 'village' && r() < 0.85) || r() < 0.18) { const s = side(); add('house', s * (19 + r() * 14), 10, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.8 + r() * 0.3); }
    if (B === 'bridge' && t % 3 === 0) add('arch', 0, 4, 0, 1);
    if (B === 'trenches') { add(r() < 0.6 ? 'candleRed' : 'candleGreen', side() * (14 + r() * 26), r() * 20, 0, 0.6 + r() * 0.7); if (r() < 0.5) add('chartSign', side() * 9, r() * 20, 0, 1); }
    const tile = { t, list, biome };
    this.tiles.set(t, tile);
    return tile;
  }

  _updateProps(camZ, time) {
    for (const k in this.props) this.props[k].n = 0;
    const t0 = Math.floor((camZ - 25) / 20), t1 = Math.floor((camZ + this.Q.far + 10) / 20);
    for (const key of this.tiles.keys()) if (key < t0 - 1 || key > t1 + 1) this.tiles.delete(key);
    const m4 = this._m4, q = this._q, v = this._v, s = this._s, e = this._e;
    const lights = this.Q.bloom ? this.lanternLights : []; let nl = 0;
    for (let t = t0; t <= t1; t++) {
      for (const p of this._tile(t).list) {
        const P = this.props[p.type]; if (!P || P.n >= P.cap) continue;
        let y = 0, rot = p.rot;
        if (p.type === 'ghostC') { y = 2.4 + Math.sin(time * 1.6 + p.z) * 0.45; rot = Math.PI + Math.sin(time * 0.8 + p.x) * 0.35; }
        if (p.type === 'lampW' && nl < lights.length && p.z > camZ - 4 && p.z < camZ + 40) { const l = lights[nl++]; l.position.set(p.x + (p.x < 0 ? 0.46 : -0.46), 2.1, p.z); }
        e.set(0, rot, 0); q.setFromEuler(e); v.set(p.x, y, p.z); s.set(p.s, p.s, p.s);
        m4.compose(v, q, s);
        if (P.lit) P.lit.setMatrixAt(P.n, m4);
        if (P.glow) P.glow.setMatrixAt(P.n, m4);
        P.n++;
      }
    }
    for (const k in this.props) { const P = this.props[k]; for (const im of [P.lit, P.glow]) if (im) { im.count = P.n; im.instanceMatrix.needsUpdate = true; } }
    for (let k = nl; k < this.lanternLights.length; k++) this.lanternLights[k].position.y = -50;
    // bats circling ahead
    let i = 0;
    for (const b of this.bats.list) {
      const a = b.a + time * b.sp;
      v.set(Math.cos(a) * b.rad, b.h + Math.sin(time * 2 + b.ph) * 1.2, camZ + b.dz + Math.sin(a) * 10);
      e.set(0, -a + Math.PI / 2, 0); q.setFromEuler(e);
      const flap = 0.35 + Math.abs(Math.sin(time * 14 + b.ph)) * 0.75; s.set(flap, 1, 1);
      m4.compose(v, q, s); this.bats.lit.setMatrixAt(i, m4); this.bats.glow.setMatrixAt(i, m4); i++;
    }
    this.bats.lit.instanceMatrix.needsUpdate = true; this.bats.glow.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- obstacle + coin pools ---------------- */
  _buildPools() {
    this.obsProto = {};
    this.obsPool = {};
    this.obsLive = new Map();
    for (const kind of Object.keys(ETT.obstacles)) {
      this.obsProto[kind] = [0, 1, 2, 3].map(v => buildObstacle(kind, v));
      this.obsPool[kind] = [];
    }
    const M = materials();
    this.coinIM = {};
    for (const type of ETT.coinOrder) {
      const g = coinGeometries(type);
      const cap = 90;
      const lit = g.lit ? new THREE.InstancedMesh(g.lit, M.lit, cap) : null;
      const glow = g.glow ? new THREE.InstancedMesh(g.glow, M.glow, cap) : null;
      for (const im of [lit, glow]) if (im) { im.frustumCulled = false; im.count = 0; this.scene.add(im); }
      this.coinIM[type] = { lit, glow, cap };
    }
    // halo sprites for rare coins
    const haloTex = canvasTex(64, 64, (g, w) => { const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, w); });
    this.haloTex = haloTex;
    this.coinHalos = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, opacity: 0.55, color: '#a855f7', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
      sp.scale.set(2.2, 2.2, 1); sp.visible = false; this.scene.add(sp); this.coinHalos.push(sp);
    }
    this.pops = [];   // collected-coin pop animations
    this._obsFirst = 0; this._coinFirst = 0;
  }
  _takeObs(o) {
    const pool = this.obsPool[o.kind];
    const m = pool.pop() || this.obsProto[o.kind][o.variant % 4].clone();
    m.userData.variant = o.variant;
    if (!m.parent) this.scene.add(m);
    m.visible = true;
    return m;
  }
  _releaseObs(id) {
    const e = this.obsLive.get(id); if (!e) return;
    e.mesh.visible = false; this.obsPool[e.kind].push(e.mesh); this.obsLive.delete(id);
  }
  resetRun() {
    for (const id of [...this.obsLive.keys()]) this._releaseObs(id);
    this._obsFirst = 0; this._coinFirst = 0; this.pops.length = 0;
    for (const t in this.coinIM) { const c = this.coinIM[t]; if (c.lit) c.lit.count = 0; if (c.glow) c.glow.count = 0; }
    for (const h of this.coinHalos) h.visible = false;
    this.anim = { state: 'run', t: 0, lean: 0, stumbleT: 0 };
    this.shake = 0;
  }

  _updateObstacles(sim, pz, time, dt) {
    const obs = sim.obstacles, far = pz + this.Q.far + 10;
    while (this._obsFirst < obs.length && obs[this._obsFirst].B < pz - 30) { this._releaseObs(obs[this._obsFirst].id); this._obsFirst++; }
    for (let i = this._obsFirst; i < obs.length; i++) {
      const o = obs[i];
      if (o.zm > far) break;
      const wz = obstacleWorldZ(o, pz);
      const visible = wz < far && wz + o.len > pz - 25;
      let e = this.obsLive.get(o.id);
      if (!visible) { if (e) this._releaseObs(o.id); continue; }
      if (!e) { e = { mesh: this._takeObs(o), kind: o.kind, phase: (o.id * 1.37) % TAU }; this.obsLive.set(o.id, e); }
      const m = e.mesh;
      m.position.set(ETT.laneX[o.lane], 0, wz);
      if (o.kind === 'ghost') { m.position.y = Math.sin(time * 3 + e.phase) * 0.08; m.rotation.z = Math.sin(time * 2 + e.phase) * 0.05; }
      else if (o.k) {
        m.position.y = Math.abs(Math.sin(time * 9 + e.phase)) * 0.05;
        m.rotation.z = Math.sin(time * 6 + e.phase) * 0.012;
        // supernatural smoke from moving wagons
        if (Math.random() < dt * 30 * this.Q.particles) this.emit('smoke', ETT.laneX[o.lane] + (Math.random() - 0.5) * 1.6, 2.4 + Math.random(), wz + Math.random() * o.len, 1);
      }
    }
  }

  _updateCoins(sim, pz, time) {
    const coins = sim.coins, far = pz + this.Q.far;
    while (this._coinFirst < coins.length && coins[this._coinFirst].z < pz - 8) this._coinFirst++;
    const counts = { HALLOWINU: 0, USDC: 0, SOLANA: 0 };
    const m4 = this._m4, q = this._q, v = this._v, s = this._s, e = this._e;
    let halo = 0;
    for (let i = this._coinFirst; i < coins.length; i++) {
      const c = coins[i];
      if (c.z > far) break;
      if (c.taken) continue;
      const C = this.coinIM[c.type]; const n = counts[c.type];
      if (n >= C.cap) continue;
      const spin = time * (c.type === 'SOLANA' ? 4.2 : 3) + c.z * 0.3;
      e.set(0, spin, 0); q.setFromEuler(e);
      const sc = c.type === 'HALLOWINU' ? 1.0 : 1.2;
      v.set(c.x, c.y + Math.sin(time * 4 + c.z) * 0.08, c.z); s.set(sc, sc, sc);
      m4.compose(v, q, s);
      if (C.lit) C.lit.setMatrixAt(n, m4); if (C.glow) C.glow.setMatrixAt(n, m4);
      counts[c.type]++;
      if (halo < this.coinHalos.length && c.z < pz + 70) {
        const h = this.coinHalos[halo++]; h.visible = true; h.position.set(c.x, c.y, c.z - 0.1);
        h.material.color.set(c.type === 'SOLANA' ? '#b05cff' : c.type === 'USDC' ? '#3d8bff' : '#ffb52e');
        const pulse = (c.type === 'HALLOWINU' ? 1.3 : 1.9) + Math.sin(time * 6 + c.z) * 0.2; h.scale.set(pulse, pulse, 1); h.material.opacity = c.type === 'HALLOWINU' ? 0.18 : 0.5;
      }
    }
    for (let i = halo; i < this.coinHalos.length; i++) this.coinHalos[i].visible = false;
    for (const t in counts) { const C = this.coinIM[t]; for (const im of [C.lit, C.glow]) if (im) { im.count = counts[t]; im.instanceMatrix.needsUpdate = true; } }
  }

  coinCollected(type, x, y, z) {
    const col = type === 'SOLANA' ? ['#14f195', '#9945ff', '#2ef2ff'] : type === 'USDC' ? ['#2f7bff', '#bcd6ff'] : ['#ffb347', '#ff7a1a'];
    const n = type === 'SOLANA' ? 26 : type === 'USDC' ? 16 : 8;
    for (let i = 0; i < n * this.Q.particles + 3; i++) this.emit('spark', x, y, z, 1, col[i % col.length]);
    if (type === 'SOLANA') this.flash = 0.6;
  }

  /* ---------------- actors ---------------- */
  _buildActors() {
    this.characters = {};
    this.player = new THREE.Group(); this.scene.add(this.player);
    this.setCharacter('hallow-inu');
    this.skeleton = buildSkeleton(); this.boneDog = buildBoneDog();
    this.scene.add(this.skeleton.root, this.boneDog.root);
    const blob = canvasTex(64, 64, (g, w) => { const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grd.addColorStop(0, 'rgba(0,0,0,.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, w); });
    const mk = s => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.04; this.scene.add(m); return m; };
    this.shadowP = mk(1.6); this.shadowS = mk(1.6); this.shadowD = mk(1.4);
    this.anim = { state: 'idle', t: 0, lean: 0, stumbleT: 0 };
    this.trail = [];
  }
  setCharacter(id) {
    if (!this.characters[id]) this.characters[id] = buildInu(id);
    if (this.current) this.player.remove(this.current.root);
    this.current = this.characters[id];
    this.player.add(this.current.root);
    this.characterId = id;
  }

  _poseInu(P, st, time, dt) {
    const p = P.parts, a = this.anim;
    const run = st.speed / ETT.speed.start;
    const cyc = time * (8.5 + run * 3);
    const sw = Math.sin(cyc), bob = Math.abs(Math.cos(cyc));
    let hipY = 0, lean = 0, lL = 0, lR = 0, aL = 0, aR = 0, armZ = 0, headX = 0, capeX = 0.12, tailZ = Math.sin(time * 12) * 0.4;
    const running = a.state === 'run' || a.state === 'stumble';
    if (running) { lL = sw * 0.85; lR = -sw * 0.85; aL = -Math.max(-0.3, sw) * 0.75; aR = -Math.max(-0.3, -sw) * 0.75; hipY = bob * 0.05; lean = 0.1; headX = -0.06; capeX = 0.18 + bob * 0.12; }
    if (a.state === 'idle' || a.state === 'select') { aL = Math.sin(time * 2) * 0.08; aR = -aL; hipY = Math.sin(time * 2) * 0.012; headX = Math.sin(time * 1.3) * 0.06; capeX = 0.06 + Math.sin(time * 1.7) * 0.04; tailZ = Math.sin(time * 6) * 0.6; }
    if (st.air) { lL = -1.1; lR = -0.35; aL = aR = -2.3; armZ = 0.25; lean = 0.05; capeX = 0.75; headX = -0.15; hipY = 0; }
    if (st.slide) { lean = 1.22; hipY = 0.05; lL = 0.1; lR = -0.1; aL = aR = -1.6; armZ = 0.15; headX = -0.95; capeX = -0.1; }
    if (a.state === 'crash') { const t = clamp(a.t / 0.4, 0, 1); lean = -1.35 * t; hipY = 0.05 * t; aL = aR = -2.4 * t; lL = -0.9 * t; lR = -1.3 * t; headX = 0.35 * t; capeX = -0.2; }
    if (a.state === 'victory') { hipY = Math.abs(Math.sin(a.t * 6)) * 0.45; aL = aR = -2.9; lL = lR = 0; lean = 0; headX = -0.15; capeX = 0.5; }
    p.legL.rotation.x = lL; p.legR.rotation.x = lR;
    p.armL.rotation.x = aL; p.armR.rotation.x = aR; p.armL.rotation.z = -armZ; p.armR.rotation.z = armZ;
    p.hip.position.y = hipY; p.hip.rotation.x = lean;
    p.head.rotation.x = headX;
    p.tail.rotation.z = tailZ;
    if (p.cape) p.cape.rotation.x = capeX + Math.sin(time * 16) * 0.04;
    if (p.extra) { p.extra.rotation.y = time * 2; p.extra.position.y = 0.15 + Math.sin(time * 3) * 0.05; }
  }

  _poseSkeleton(time, running, excited) {
    const p = this.skeleton.parts, c = time * 9.5, s = Math.sin(c);
    p.legL.rotation.x = running ? s * 0.6 : 0; p.legR.rotation.x = running ? -s * 0.6 : 0;
    p.armL.rotation.x = running ? -s * 0.6 : excited ? -2.7 + Math.sin(time * 12) * 0.3 : Math.sin(time * 2) * 0.1;
    p.armR.rotation.x = running ? 0.15 + s * 0.25 : excited ? -2.4 : -0.1;
    p.armL.rotation.z = excited ? -0.3 : 0;
    p.hip.position.y = running ? Math.abs(Math.cos(c)) * 0.06 : excited ? Math.abs(Math.sin(time * 9)) * 0.08 : 0;
    p.hip.rotation.x = running ? 0.08 : 0;
    p.head.rotation.z = Math.sin(time * 7) * (excited ? 0.25 : 0.08);
    p.head.rotation.x = running ? Math.sin(c * 2) * 0.05 : 0;
  }
  _poseDog(time, running, excited) {
    const p = this.boneDog.parts, c = time * 13, s = Math.sin(c);
    const a = running ? 0.45 : excited ? 0.2 : 0.04;
    // trot: diagonal pairs move together
    p.legFL.rotation.x = s * a; p.legBR.rotation.x = s * a; p.legFR.rotation.x = -s * a; p.legBL.rotation.x = -s * a;
    p.tail.rotation.y = Math.sin(time * 18) * 0.6;
    p.head.rotation.x = running ? Math.sin(c * 2) * 0.06 : Math.sin(time * 9) * 0.15;
    p.hip.position.y = running ? Math.abs(Math.sin(c)) * 0.06 : excited ? Math.abs(Math.sin(time * 9)) * 0.45 : 0;
    p.hip.rotation.x = running ? Math.sin(c) * 0.04 : 0;
  }

    /* ---------------- low rolling mist (soft sprite cards) ---------------- */
  _buildMist() {
    const tex = canvasTex(128, 64, (g, w, h) => {
      const r = crand(8);
      for (let i = 0; i < 26; i++) { const x = 20 + r() * (w - 40), y = 18 + r() * (h - 36), rad = 10 + r() * 18;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, 'rgba(225,205,255,.32)'); grd.addColorStop(1, 'rgba(225,205,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h); }
    });
    this.mist = [];
    const r = crand(66);
    for (let i = 0; i < 34; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: i > 20 ? 0.24 : 0.16, color: i % 3 ? '#cdb6ff' : '#ffc8a8' }));
      const far = i > 20;
      const sx = far ? 70 + r() * 60 : 14 + r() * 14;
      sp.scale.set(sx, sx * 0.35, 1);
      this.mist.push({ sp, x: (r() < 0.5 ? -1 : 1) * (far ? 20 + r() * 60 : 9 + r() * 14), y: far ? 2 + r() * 6 : 0.3 + r() * 0.8, dz: r() * 200, sp2: 0.3 + r() * 0.6, far });
      this.scene.add(sp);
    }
  }
  _updateMist(camZ, time) {
    const n = Math.round(this.mist.length * (0.4 + 0.6 * this.Q.density));
    this.mist.forEach((m, i) => {
      m.sp.visible = i < n;
      const z = camZ - 10 + ((m.dz - camZ * 0.0 + 1000) % 200);
      const dz = (((m.dz - camZ) % 200) + 200) % 200; m.sp.position.set(m.x + Math.sin(time * m.sp2 + i) * 2, m.y, camZ + 12 + dz);
      void z;
    });
  }

  /* ---------------- particles ---------------- */
  _buildParticles() {
    const N = 700;
    this.pN = N; this.pi = 0;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N); this.pKind = new Uint8Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tex = canvasTex(32, 32, (c, w) => { c.fillStyle = '#fff'; c.fillRect(8, 8, 16, 16); c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(4, 4, 24, 24); });
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -100;
    this._col = new THREE.Color();
    this.flash = 0;
  }
  emit(kind, x, y, z, n = 1, color) {
    for (let k = 0; k < n; k++) {
      const i = this.pi; this.pi = (this.pi + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      let vx = (Math.random() - 0.5), vy = Math.random(), vz = (Math.random() - 0.5), life = 0.6;
      if (kind === 'spark') { vx *= 7; vy = vy * 6 + 1; vz *= 7; life = 0.45 + Math.random() * 0.3; }
      else if (kind === 'smoke') { vx *= 0.8; vy = 0.6 + vy; vz = -2; life = 1.2; color = color || (Math.random() < 0.5 ? '#7d2bd1' : '#b04cff'); }
      else if (kind === 'ember') { vx *= 0.6; vy = 0.3 + vy * 0.8; vz *= 0.6; life = 2.5 + Math.random() * 2; color = color || (Math.random() < 0.6 ? '#ff9a3c' : '#c45cff'); }
      else if (kind === 'dust') { vx *= 3; vy = vy * 1.5; vz = -1 - Math.random() * 2; life = 0.5; color = color || '#6d5a7a'; }
      else if (kind === 'bone') { vx *= 6; vy = 3 + vy * 4; vz *= 6; life = 0.9; color = '#ece5cf'; }
      this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
      this.pLife[i] = life; this.pMax[i] = life; this.pKind[i] = kind === 'smoke' ? 1 : kind === 'ember' ? 2 : 0;
      this._col.set(color || '#ffffff');
      this.pCol[i * 3] = this._col.r; this.pCol[i * 3 + 1] = this._col.g; this.pCol[i * 3 + 2] = this._col.b;
    }
  }
  _updateParticles(dt, camZ) {
    const P = this.pPos, V = this.pVel;
    if (Math.random() < dt * 22 * this.Q.particles) this.emit('ember', (Math.random() - 0.5) * 30, Math.random() * 2, camZ + 5 + Math.random() * 60, 1);
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { P[i * 3 + 1] = -100; continue; }
      const k = this.pKind[i];
      if (k === 0) V[i * 3 + 1] -= 12 * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (k !== 2 && P[i * 3 + 1] < 0.05) { P[i * 3 + 1] = 0.05; V[i * 3 + 1] *= -0.3; }
      const f = this.pLife[i] / this.pMax[i];
      if (k === 1 || k === 2) { this.pCol[i * 3] *= 0.995; this.pCol[i * 3 + 1] *= 0.995; this.pCol[i * 3 + 2] *= 0.995; }
      else if (f < 0.3) { this.pCol[i * 3] *= 0.9; this.pCol[i * 3 + 1] *= 0.9; this.pCol[i * 3 + 2] *= 0.9; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- events from the sim ---------------- */
  onEvent(ev, st) {
    const a = this.anim;
    if (ev.t === 'jump') { for (let i = 0; i < 6; i++) this.emit('dust', st.px, 0.1, st.pz, 1); }
    if (ev.t === 'land') { for (let i = 0; i < 8; i++) this.emit('dust', st.px, 0.1, st.pz, 1); }
    if (ev.t === 'slide') { for (let i = 0; i < 10; i++) this.emit('dust', st.px, 0.1, st.pz + 0.4, 1, '#b04cff'); }
    if (ev.t === 'lane') a.lean = ev.dir;
    if (ev.t === 'stumble') { a.stumbleT = 0.55; this.shake = 0.45; this.chase.target = 2.8; this.chase.visibleT = 6; for (let i = 0; i < 10; i++) this.emit('spark', st.px, 1, st.pz + 0.5, 1, '#ffd34d'); }
    if (ev.t === 'nearmiss') { this.chase.target = Math.min(this.chase.target, 7); this.chase.visibleT = Math.max(this.chase.visibleT, 1.2); }
    if (ev.t === 'dead') { a.state = 'crash'; a.t = 0; this.shake = 0.8; for (let i = 0; i < 16; i++) this.emit('spark', st.px, 1, st.pz + 0.6, 1, i % 2 ? '#ff7a1a' : '#ffd34d'); }
  }

  /* ---------------- per-frame ---------------- */
  update(dt, st, sim) {
    this.clock += dt;
    if (this.mode === 'over') this.overT += dt;
    const time = this.clock, a = this.anim;
    a.t += dt;
    const v = st;
    // ----- player -----
    this.player.position.set(v.px, v.y, v.pz - (a.state === 'crash' ? 0.75 * clamp(a.t / 0.3, 0, 1) : 0));   // bounce back off the obstacle
    this.player.scale.setScalar(this.mode === 'run' || this.mode === 'over' ? 1.2 : 1);
    a.lean = damp(a.lean, 0, 8, dt);
    if (a.stumbleT > 0) a.stumbleT -= dt;
    if (this.mode === 'run' && a.state !== 'crash') a.state = a.stumbleT > 0 ? 'stumble' : 'run';
    this.player.rotation.z = a.lean * 0.22 + (a.stumbleT > 0 ? Math.sin(time * 40) * 0.12 : 0);
    this.player.rotation.y = this.mode === 'select' || this.mode === 'menu' ? this.dragYaw + (this.mode === 'select' ? time * 0.6 : Math.PI - 0.45 + Math.sin(time * 0.5) * 0.25) : -a.lean * 0.25;
    this._poseInu(this.current, { speed: v.speed, air: v.y > 0.05 && a.state !== 'crash', slide: v.slide && a.state !== 'crash' }, time, dt);
    this.shadowP.position.set(v.px, 0.04, v.pz); const sh = clamp(1 - v.y * 0.3, 0.4, 1); this.shadowP.scale.set(sh, sh, sh);
    this.playerGlow.position.set(v.px, 1.5, v.pz + (this.mode === 'run' || this.mode === 'over' ? -0.9 : 1.8));

    // ----- pursuers -----
    const ch = this.chase;
    if (this.mode === 'run') {
      ch.visibleT -= dt;
      if (ch.visibleT <= 0) ch.target = 16;
      ch.gap = damp(ch.gap, ch.target, ch.target < ch.gap ? 2.5 : 0.7, dt);
    }
    // pursuers follow the runner's own recent path (so they jump/duck where the runner did, never through obstacles)
    if (this.mode === 'run') {
      const tr = this.trail; tr.push({ z: v.pz, x: v.px, y: v.y, sl: v.slide });
      while (tr.length > 2 && tr[0].z < v.pz - 40) tr.shift();
    }
    const skZ = v.pz - ch.gap, dgZ = skZ + 0.9;
    const sk = this._trailAt(skZ, v), dg = this._trailAt(dgZ, v);
    const running = this.mode === 'run' || (this.mode === 'over' && this.overT < 1.2);
    const excited = this.mode === 'over' && this.overT >= 1.2;
    if (this.mode === 'over') {
      const t = clamp(this.overT / 1.2, 0, 1);
      this.skeleton.root.position.set(lerp(sk.x - 0.5, v.px - 0.95, t), 0, lerp(skZ, v.pz - 2.2, t));
      this.boneDog.root.position.set(lerp(dg.x + 0.6, v.px + 1.0, t), 0, lerp(dgZ, v.pz - 1.7, t));
      this.skeleton.root.rotation.y = t > 0.9 ? 0.35 : 0; this.boneDog.root.rotation.y = t > 0.9 ? -0.45 : 0;
      this.skeleton.root.scale.set(1, 1, 1); this.boneDog.root.scale.set(1, 1, 1);
    } else if (this.mode === 'menu' || this.mode === 'select') {
      this.skeleton.root.position.set(2.9, 0, v.pz + 6.5); this.skeleton.root.rotation.y = Math.PI + 0.35;
      this.boneDog.root.position.set(1.6, 0, v.pz + 5.2); this.boneDog.root.rotation.y = Math.PI + 0.2;
      this.skeleton.root.scale.set(1, 1, 1); this.boneDog.root.scale.set(1, 1, 1);
    } else {
      this.skeleton.root.position.set(sk.x - 0.55, Math.min(sk.y, 0.5), skZ); this.skeleton.root.rotation.y = 0;
      this.boneDog.root.position.set(dg.x + 0.55, Math.min(dg.y, 0.6), dgZ); this.boneDog.root.rotation.y = 0;
      this.skeleton.root.scale.set(0.7, sk.sl ? 0.4 : 0.7, 0.7); this.boneDog.root.scale.set(0.8, dg.sl ? 0.5 : 0.8, 0.8);
    }
    this._poseSkeleton(time, running, excited || this.mode === 'menu');
    this._poseDog(time, running, excited);
    this.shadowS.position.set(this.skeleton.root.position.x, 0.04, this.skeleton.root.position.z);
    this.shadowD.position.set(this.boneDog.root.position.x, 0.04, this.boneDog.root.position.z);
    const showChasers = this.mode !== 'run' || ch.gap < 3.8;
    this.skeleton.root.visible = this.boneDog.root.visible = this.shadowS.visible = this.shadowD.visible = showChasers;

    // ----- world -----
    const camZ = v.pz;
    if (sim && (this.mode === 'run' || this.mode === 'over')) { this._updateObstacles(sim, v.pz, time, dt); this._updateCoins(sim, v.pz, time); }
    else { for (const t in this.coinIM) { const c = this.coinIM[t]; if (c.lit) c.lit.count = 0; if (c.glow) c.glow.count = 0; } for (const h of this.coinHalos) h.visible = false; }
    const segStart = Math.floor((camZ - 20) / this.SEG);
    this.roadSegs.forEach((g, i) => { g.position.set(0, 0, (segStart + i) * this.SEG); });
    this._updateProps(camZ, time);
    this.ground.position.set(0, -0.05, camZ + 120);
    this.groundTex.offset.y = (camZ / 600) * 60 % 1;
    this.skyGroup.position.set(0, 0, camZ);
    this.clouds.forEach((c, i) => { c.position.x = ((time * (3 + i * 2) + i * 300) % 900) - 450; });
    for (const isl of this.islands) isl.m.position.y = isl.y + Math.sin(time * 0.4 + isl.ph) * 4;
    this._updateMist(camZ, time);
    // biome colour grading
    const bz = Math.max(0, camZ), bi = biomeAt(bz), within = (bz % BIOME_LEN) / BIOME_LEN;
    const nb = (bi + 1) % BIOMES.length, mix = within > 0.93 ? (within - 0.93) / 0.07 : 0;
    const A = BIOMES[bi], B = BIOMES[nb];
    this.scene.fog.color.set(A.fog).lerp(this._col.set(B.fog), mix);
    this.renderer.setClearColor(this.scene.fog.color);
    this.hemi.color.set(A.hemi).lerp(this._col.set(B.hemi), mix);
    this.skyMat.uniforms.mid.value.set(A.tint).lerp(this._col.set(B.tint), mix);
    this.biome = bi;
    this.moonLight.position.set(v.px - 8, 14, camZ + 30); this.moonLight.target.position.set(v.px, 0, camZ);
    this.fill.position.set(v.px + 4, 8, camZ - 12); this.fill.target.position.set(v.px, 1, camZ);
    this._updateParticles(dt, camZ);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);

    // ----- camera -----
    this._camera(dt, v, time);
    if (this.bloom) this.bloom.strength = 0.55 + this.flash;
    if (this.composer && this.Q.bloom) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }

  _camera(dt, v, time) {
    const cp = this.camPos, cl = this.camLook;
    let tx, ty, tz, lx, ly, lz, k = 6;
    if (this.mode === 'menu') {
      // behind-left of the Inu, looking down the haunted road towards the giant moon
      const sway = Math.sin(time * 0.15) * 0.4;
      tx = -1.9 + sway; ty = 1.25; tz = v.pz - 4.6; lx = 0.9 + sway * 0.5; ly = 1.55; lz = v.pz + 10; k = 3;
      if (this.portrait) { tx = -0.6; tz = v.pz - 5.6; ty = 1.4; lx = 0; ly = 1.4; }
    } else if (this.mode === 'select') {
      tx = 1.0; ty = 1.35; tz = v.pz + 3.7; lx = 1.1; ly = 0.9; lz = v.pz; k = 4;
      if (this.w < 860) { tx = 0; lx = 0; tz = v.pz + 5.2; ty = 1.6; ly = 1.25; }
    } else if (this.mode === 'over') {
      // rise up behind the runner, inside its own lane (never inside a neighbouring wagon):
      // shows the crash and the skeleton crew arriving from behind
      const t = clamp(this.overT / 1.4, 0, 1), e = t * t * (3 - 2 * t), port = this.portrait;
      const off = port ? 0 : -1.1;   // camera looks along +z, so -x moves the scene to the left of the results card
      tx = lerp(v.px * 0.8, v.px + off, e); ty = lerp(3.7, 3.4, e); tz = lerp(v.pz - 5.0, v.pz - 5.0, e);
      lx = lerp(v.px * 0.85, v.px + off * 2.4, e); ly = lerp(0.5, 0.4, e); lz = lerp(v.pz + 9, v.pz + 0.6, e); k = 4;
    } else {
      const port = this.portrait;
      tx = v.px * 0.8; ty = (port ? 4.3 : 3.7) + v.y * 0.3; tz = v.pz - (port ? 5.6 : 5.0);
      lx = v.px * 0.85; ly = 0.5 + v.y * 0.2; lz = v.pz + (port ? 8 : 9); k = 9;
      if (this.introT > 0) { this.introT -= dt; }
    }
    if (this.snap) { this.snap = false; cp.set(tx, ty, tz); cl.set(lx, ly, lz); }
    cp.x = damp(cp.x, tx, k, dt); cp.y = damp(cp.y, ty, k, dt); cp.z = this.mode === 'run' ? lerp(cp.z, tz, 1 - Math.exp(-14 * dt)) : damp(cp.z, tz, k, dt);
    if (this.mode === 'run') cp.z = Math.max(cp.z, tz - 1.5);
    cl.x = damp(cl.x, lx, k, dt); cl.y = damp(cl.y, ly, k, dt); cl.z = this.mode === 'run' ? lz : damp(cl.z, lz, k, dt);
    this.camera.position.copy(cp);
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.6); const s = this.shake * 0.25; this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s; }
    this.camera.lookAt(cl);
  }

  _trailAt(z, v) {
    const tr = this.trail;
    if (!tr.length || z >= v.pz) return { x: v.px, y: v.y, sl: v.slide };
    if (z <= tr[0].z) return { x: tr[0].x, y: tr[0].y, sl: tr[0].sl };
    let i = tr.length - 1; while (i > 0 && tr[i - 1].z > z) i--;
    const a = tr[i - 1] || tr[i], b = tr[i], k = b.z > a.z ? (z - a.z) / (b.z - a.z) : 0;
    return { x: a.x + (b.x - a.x) * k, y: Math.max(0, a.y + (b.y - a.y) * k), sl: k < 0.5 ? a.sl : b.sl };
  }

  /* snap the camera (no lerp) — used when a run starts */
  snapCamera(v) { this.camPos.set(v.px * 0.8, this.portrait ? 4.3 : 3.7, v.pz - (this.portrait ? 5.6 : 5.0)); this.camLook.set(0, 0.5, v.pz + (this.portrait ? 8 : 9)); }

  setMode(mode) {
    const prevMode = this.mode;
    this.mode = mode;
    if (mode === 'run') { this.trail = []; this.anim.state = 'run'; this.chase.gap = 2.7; this.chase.target = 2.7; this.chase.visibleT = 2.6; this.introT = 1; }
    if (mode === 'over') { this.overT = 0; }
    if ((mode === 'menu' || mode === 'select') && prevMode !== mode) this.snap = true;
    if (mode === 'menu' || mode === 'select') { this.anim.state = mode === 'select' ? 'select' : 'idle'; this.resetRun(); this.anim.state = mode === 'select' ? 'select' : 'idle'; }
  }
  victory() { this.anim.state = 'victory'; this.anim.t = 0; }
}
