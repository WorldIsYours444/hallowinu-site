/* HALLOWINU — ESCAPE THE TRENCHES — game controller (UI, input, run lifecycle, server sync). */
import * as THREE from './vendor/three.bundle.js';
import { ETT } from './config.js';
import { Sim, INPUT, encodeInputs } from './sim.js';
import { World, BIOMES, biomeAt } from './world.js';
import { Audio } from './audio.js';
import { CHARACTERS, buildInu } from './models.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const root = $('#ett');
const TICK = 1 / ETT.tickRate;
const CHAR_IDS = CHARACTERS.map(c => c.id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const MESSAGES = ['RUGGED BY A GRAVESTONE.', 'BRO MISSED THE EXIT.', 'THE TRENCHES WIN AGAIN.', 'THE SKELETON HAS DIAMOND HANDS.', "YOU JUST GOT BONE'D.",
  'LIQUIDATED BY A PUMPKIN.', 'PAPER PAWS, SKELETON CLAWS.', 'NGMI… THIS TIME.', 'BONE DOG SAYS: WAGMI. YOU: NGMI.', 'CAUGHT IN A BEAR CANDLE.'];
const BAD = { MISMATCH: 'the run could not be reproduced', TOO_FAST: 'uploaded faster than real time', INPUT_RATE: 'inhuman input rate', BAD_INPUTS: 'corrupt input log', EXPIRED: 'uploaded too late', RULES_CHANGED: 'game rules were updated', BAD_TICKS: 'invalid length', TOO_MANY_INPUTS: 'too many inputs', NOT_FINISHED: 'never finished' };

/* ---------------- settings ---------------- */
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (isTouch && Math.min(screen.width, screen.height) < 820);
const DEFAULTS = { music: 55, sfx: 80, muted: false, quality: 'auto', perf: isMobile, buttons: 'on', keys: { left: null, right: null, jump: null, duck: null } };
const S = Object.assign({}, DEFAULTS, store.get('ett.settings', {}));
S.keys = Object.assign({}, DEFAULTS.keys, S.keys || {});
const saveSettings = () => store.set('ett.settings', S);
const DEFAULT_KEYS = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['Space', 'ArrowUp', 'KeyW'], duck: ['ArrowDown', 'KeyS'] };
const ACTION_INPUT = { left: INPUT.LEFT, right: INPUT.RIGHT, jump: INPUT.JUMP, duck: INPUT.DUCK };
const KEY_LABEL = k => ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'SPACE' }[k] || (k || '').replace(/^Key|^Digit/, ''));

/* ---------------- state ---------------- */
const G = {
  screen: 'loading', back: [], char: CHAR_IDS.includes(store.get('ett.character')) ? store.get('ett.character') : CHAR_IDS[0],
  sim: null, prev: { pz: 0, px: 0, y: 0 }, acc: 0, paused: false, queue: [], inputs: [],
  run: null, account: null, me: null, starting: false, selIdx: 0, selFrom: 'menu', biome: -1, stepT: 0, fps: [], qualityChecked: 0,
};
let world, audio;

/* ---------------- networking ---------------- */
async function api(method, path, body) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(path, { method, credentials: 'same-origin', signal: ctl.signal,
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-hw-client': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, ...data, ok: res.ok && data.ok !== false };
  } catch { return { ok: false, error: 'NETWORK', status: 0 }; }
  finally { clearTimeout(to); }
}
const rid = () => 'k' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36)).join('').slice(0, 24);

/* Uploads that could not reach the server yet (closed tab, offline) are kept on this device. */
const UPLOADS = 'ett.uploads.v1';
const pendingUploads = () => store.get(UPLOADS, []);
function saveUpload(p) { const l = pendingUploads().filter(x => x.runId !== p.runId); l.push(p); store.set(UPLOADS, l.slice(-20)); }
function dropUpload(runId) { store.set(UPLOADS, pendingUploads().filter(x => x.runId !== runId)); }
async function uploadRun(p) {
  const r = await api('POST', '/api/ett/finish', p);
  if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429)) dropUpload(p.runId);
  return r;
}
async function flushUploads() { for (const p of pendingUploads()) await uploadRun(p); }

async function refreshMe() {
  const r = await api('GET', '/api/ett/me');
  if (r.ok) { G.me = r; G.account = r.access; }
  else if (!G.me) G.me = { access: { state: 'OFFLINE', canPlay: false } };
  renderAccount();
  return r;
}

/* ---------------- screens ---------------- */
function show(name, { push = false } = {}) {
  if (push && G.screen !== name) G.back.push(G.screen);
  G.screen = name;
  root.dataset.screen = name;
  for (const el of $$('.screen')) el.hidden = el.id !== 's-' + name;
  const running = name === 'run' || name === 'pause' || (name === 'select' && G.selFrom === 'pause') || (name === 'settings' && G.back.includes('pause'));
  $('#hud').hidden = !(name === 'run' || name === 'pause');
  $('#controls').hidden = !(name === 'run' && S.buttons !== 'off');
  if (name === 'menu') { world.setMode('menu'); audio.music(true, -1); $('#menu-char-name').textContent = charOf(G.char).name; }
  if (name === 'select') { if (G.selFrom !== 'pause') world.setMode('select'); renderSelect(); }
  if (name === 'board') loadBoard();
  if (name === 'settings') renderSettings();
  if (!running && name !== 'over') root.classList.remove('is-danger');
  checkRotate();
  const first = $(`#s-${name} .mbtn.primary, #s-${name} button`);
  if (first && !isTouch) setTimeout(() => first.focus({ preventScroll: true }), 30);
}
function goBack() {
  const prev = G.back.pop() || 'menu';
  if (prev === 'pause') { show('pause'); return; }
  if (prev === 'over') { show('over'); return; }
  show(prev);
}
const charOf = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

/* ---------------- toasts / messages ---------------- */
function toast(text, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3700);
}
function hudMsg(text, bad = false) {
  const el = $('#h-msg'); el.textContent = text; el.className = 'hud-msg' + (bad ? ' bad' : '');
  void el.offsetWidth; el.classList.add('show');
}

/* ---------------- account ---------------- */
function renderAccount() {
  const acc = G.account || { state: 'WALLET_NOT_CONNECTED' };
  const me = G.me || {};
  const box = $('#acct'); box.hidden = false;
  const btn = $('#acct-connect');
  const name = me.profile ? me.profile.displayName : null;
  $('#acct-name').textContent = acc.state === 'OFFLINE' ? 'OFFLINE' : name || (acc.state === 'PROFILE_REQUIRED' ? 'NAME NEEDED' : 'GUEST');
  $('#acct-pts').textContent = me.profile ? `${me.profile.totalPoints.toLocaleString()} PTS` : '';
  btn.hidden = !!(acc.canPlay || acc.state === 'OFFLINE');
  btn.textContent = acc.state === 'PROFILE_REQUIRED' ? 'SET NAME' : 'CONNECT PHANTOM';
  const note = $('#earn-note');
  if (acc.state === 'OFFLINE') note.innerHTML = 'Server unreachable — you can still play practice runs.';
  else if (!acc.canPlay) note.innerHTML = 'Playing as <b>guest</b>: unlimited runs, but no points. <b>Connect Phantom</b> to earn HALLOWINU points with every coin.';
  else {
    const b = me.balance || {};
    const r = me.rules || {};
    note.innerHTML = `Signed in as <b>${esc(name)}</b> · ${b.pendingPoints ? `<b>${b.pendingPoints}</b> pts pending (redeemed when you start your next run) · ` : ''}today <b>${b.redeemedToday || 0}</b>/${b.dailyCap ?? r.dailyCap ?? '—'} pts credited` + (r.rewardsEnabled === false ? ' · <b>rewards paused</b>' : '');
  }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function connect() {
  audio.unlock();
  const acc = G.account || {};
  if (acc.state === 'PROFILE_REQUIRED') return askName();
  if (!window.HW_WALLET) return toast('Wallet module missing.', 'warn');
  if (!window.HW_WALLET.phantom()) {
    if (window.HW_WALLET.isMobile) { location.href = window.HW_WALLET.browseUrl('/escape-the-trenches'); return; }
    toast('Phantom not found — install the Phantom extension to earn points.', 'warn'); return;
  }
  const r = await window.HW_WALLET.signIn();
  if (!r.ok) { toast(r.message || 'Sign-in failed.', 'warn'); return; }
  await refreshMe();
  if (G.account && G.account.state === 'PROFILE_REQUIRED') askName();
  else toast('Wallet connected — your runs now earn points!', 'good');
}
function askName() {
  const dlg = $('#name-dlg'); $('#name-err').textContent = '';
  dlg.showModal();
  $('#name-form').onsubmit = async e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    const r = await api('PATCH', '/api/me', { displayName: $('#name-input').value });
    if (!r.ok) { $('#name-err').textContent = r.message || 'Name not accepted.'; return; }
    dlg.close(); await refreshMe(); toast('Name saved — let’s run!', 'good');
  };
}

/* ---------------- character UI ---------------- */
let THUMBS = {};
function makeThumbs() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight('#b89cff', '#2a1640', 1.6));
    const d = new THREE.DirectionalLight('#ffc48a', 2.2); d.position.set(2, 3, 4); sc.add(d);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(1.6, 1.5, 3.3); cam.lookAt(0, 0.8, 0);
    for (const ch of CHARACTERS) {
      const m = buildInu(ch.id); m.root.rotation.y = 0.35; sc.add(m.root);
      r.render(sc, cam); THUMBS[ch.id] = c.toDataURL('image/png'); sc.remove(m.root);
    }
    r.dispose(); r.forceContextLoss && r.forceContextLoss();
  } catch { THUMBS = {}; }
}
function renderStrip(el, onPick) {
  el.innerHTML = CHARACTERS.map(c => `<button type="button" class="cc" role="radio" data-id="${c.id}" style="--accent:${c.accent}" aria-checked="${c.id === G.char}">
    ${THUMBS[c.id] ? `<img src="${THUMBS[c.id]}" alt="">` : ''}<span>${c.name}</span></button>`).join('');
  el.onclick = e => { const b = e.target.closest('.cc'); if (b) { audio.sfx('click'); onPick(b.dataset.id); } };
}
function setChar(id, persist = true) {
  G.char = id; world.setCharacter(id);
  if (persist) store.set('ett.character', id);
  for (const b of $$('.cc')) b.setAttribute('aria-checked', String(b.dataset.id === id));
  $('#menu-char-name').textContent = charOf(id).name;
}
function renderSelect() {
  G.selIdx = Math.max(0, CHAR_IDS.indexOf(G.char));
  updateSel();
  const choose = $('#s-select [data-act="choose"]');
  choose.textContent = G.selFrom === 'over' ? 'SELECT & PLAY' : G.selFrom === 'pause' ? 'SELECT & RESUME' : 'SELECT';
}
function updateSel() {
  const c = CHARACTERS[G.selIdx];
  $('#sel-name').textContent = c.name; $('#sel-name').style.color = c.accent;
  $('#sel-tag').textContent = c.tag; $('#sel-blurb').textContent = c.blurb;
  setChar(c.id, false);
}

/* ---------------- settings UI ---------------- */
function applySettings() {
  audio.setVolumes({ music: S.music / 100, sfx: S.sfx / 100, muted: S.muted });
  root.classList.toggle('is-muted', S.muted);
  const q = S.quality === 'auto' ? (S.perf || isMobile ? 'low' : 'medium') : S.quality;
  if (world && world.qualityName !== q) world.setQuality(q);
  $('#controls').hidden = !(G.screen === 'run' && S.buttons !== 'off');
}
function renderSettings() {
  $('#set-music').value = S.music; $('#set-sfx').value = S.sfx; $('#set-mute').checked = S.muted;
  $('#set-quality').value = S.quality; $('#set-perf').checked = S.perf; $('#set-buttons').value = S.buttons;
  $('#remap').innerHTML = Object.keys(DEFAULT_KEYS).map(a => `<div class="rm"><span class="act">${a.toUpperCase()}</span>
    <span>${DEFAULT_KEYS[a].map(KEY_LABEL).join(' / ')}${S.keys[a] ? ' + <b>' + esc(KEY_LABEL(S.keys[a])) + '</b>' : ''}</span>
    <button type="button" data-remap="${a}">${S.keys[a] ? 'CHANGE' : '+ KEY'}</button>${S.keys[a] ? `<button type="button" data-clear="${a}">✕</button>` : ''}</div>`).join('');
}
let listening = null;
function bindSettings() {
  const on = (id, ev, f) => $(id).addEventListener(ev, f);
  on('#set-music', 'input', e => { S.music = +e.target.value; saveSettings(); applySettings(); });
  on('#set-sfx', 'input', e => { S.sfx = +e.target.value; saveSettings(); applySettings(); audio.sfx('coin1'); });
  on('#set-mute', 'change', e => { S.muted = e.target.checked; saveSettings(); applySettings(); });
  on('#set-quality', 'change', e => { S.quality = e.target.value; saveSettings(); applySettings(); });
  on('#set-perf', 'change', e => { S.perf = e.target.checked; saveSettings(); applySettings(); });
  on('#set-buttons', 'change', e => { S.buttons = e.target.value; saveSettings(); applySettings(); });
  $('#remap').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.clear) { S.keys[b.dataset.clear] = null; saveSettings(); renderSettings(); return; }
    listening = b.dataset.remap; b.textContent = 'PRESS A KEY…'; b.classList.add('listening');
  });
}

/* ---------------- fullscreen ---------------- */
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen() {
  audio.unlock();
  const el = document.documentElement;
  if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) {
    try { const p = req.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(pseudoFullscreen); }
    catch { pseudoFullscreen(); }
  } else pseudoFullscreen();
}
function pseudoFullscreen() {
  root.classList.toggle('pseudo-fs');
  window.scrollTo(0, 1);
  toast(/iPhone|iPod/.test(navigator.userAgent) ? 'iPhone has no fullscreen button for web games — tip: Share → Add to Home Screen for true fullscreen.' : 'Fullscreen is blocked here — playing in full-window mode.', 'warn');
  updateFsLabels();
}
function updateFsLabels() {
  const on = !!fsEl() || root.classList.contains('pseudo-fs');
  for (const l of $$('.fs-label')) l.textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  setTimeout(() => world && world.resize(), 120);
}

/* ---------------- input ---------------- */
function act(action) {
  if (G.screen !== 'run' || G.paused || !G.sim || G.sim.dead) return;
  G.queue.push(ACTION_INPUT[action]);
}
function keyAction(code) {
  for (const a in DEFAULT_KEYS) if (DEFAULT_KEYS[a].includes(code) || S.keys[a] === code) return a;
  return null;
}
function bindInput() {
  window.addEventListener('keydown', e => {
    if (listening) {
      e.preventDefault();
      if (e.code !== 'Escape') { for (const a in S.keys) if (S.keys[a] === e.code) S.keys[a] = null; S.keys[listening] = e.code; saveSettings(); }
      listening = null; renderSettings(); return;
    }
    if ($('#name-dlg').open) return;
    const a = keyAction(e.code);
    if (G.screen === 'run') {
      if (a) { e.preventDefault(); if (!e.repeat) act(a); return; }
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); pause(); return; }
    } else if (a && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (G.screen === 'select' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { e.preventDefault(); stepSel(e.code === 'ArrowLeft' ? -1 : 1); return; }
      if (e.target === document.body || e.target === root) e.preventDefault();
    }
    if (e.code === 'KeyM') { S.muted = !S.muted; saveSettings(); applySettings(); }
    if (e.code === 'KeyF' && G.screen !== 'run') toggleFullscreen();
    if ((e.code === 'Escape' || e.code === 'KeyP') && G.screen === 'pause') { e.preventDefault(); resume(); return; }
    if (e.code === 'Escape' && ['how', 'settings', 'board', 'select'].includes(G.screen)) { e.preventDefault(); backFromPanel(); }
    if ((e.code === 'Enter') && G.screen === 'menu' && document.activeElement === document.body) play();
  });
  // on-screen buttons: pointerdown for instant response (mouse + touch)
  for (const b of $$('.cbtn')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); audio.unlock(); act(b.dataset.input); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120); });
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  // swipes + menu drag-rotate
  let sx = 0, sy = 0, sw = false, drag = false, lastX = 0;
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, select, .panel, .over-card, dialog')) return;
    sx = e.clientX; sy = e.clientY; sw = true; drag = G.screen === 'menu' || G.screen === 'select'; lastX = e.clientX;
  });
  root.addEventListener('pointermove', e => {
    if (drag) { world.dragYaw += (e.clientX - lastX) * 0.012; lastX = e.clientX; }
    if (!sw || G.screen !== 'run') return;
    const dx = e.clientX - sx, dy = e.clientY - sy, th = Math.max(26, Math.min(innerWidth, innerHeight) * 0.045);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    sw = false;
    if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 'right' : 'left'); else act(dy > 0 ? 'duck' : 'jump');
  });
  const end = () => { sw = false; drag = false; };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('touchmove', e => { if (!e.target.closest('.s-panel .panel, .s-over')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.screen === 'run') pause(); });
  window.addEventListener('blur', () => { if (G.screen === 'run') pause(); });
}

/* ---------------- buttons ---------------- */
function bindButtons() {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-go],[data-fullscreen],[data-sel],[data-back]');
    if (!b) return;
    audio.unlock();
    if (b.hasAttribute('data-back') && b.tagName === 'A') return;   // normal link to the website
    audio.sfx('click');
    if (b.hasAttribute('data-fullscreen')) return toggleFullscreen();
    if (b.dataset.sel) return stepSel(+b.dataset.sel);
    if (b.dataset.go) {
      if (b.dataset.go === 'select') G.selFrom = G.screen === 'over' ? 'over' : G.screen === 'pause' ? 'pause' : 'menu';
      return show(b.dataset.go, { push: true });
    }
    const a = b.dataset.act;
    if (a === 'play') return play();
    if (a === 'back') return backFromPanel();
    if (a === 'choose') return chooseChar();
    if (a === 'pause') return pause();
    if (a === 'resume') return resume();
    if (a === 'pause-char') { G.selFrom = 'pause'; return show('select', { push: true }); }
    if (a === 'quit') return quitRun();
    if (a === 'menu') { G.back = []; return show('menu'); }
  });
  $('#btn-mute').addEventListener('click', () => { audio.unlock(); S.muted = !S.muted; saveSettings(); applySettings(); });
  $('#acct-connect').addEventListener('click', connect);
  $('#rotate-hint button').addEventListener('click', () => { $('#rotate-hint').hidden = true; store.set('ett.rotateDismissed', true); });
  document.addEventListener('fullscreenchange', updateFsLabels); document.addEventListener('webkitfullscreenchange', updateFsLabels);
  window.addEventListener('resize', () => { world.resize(); checkRotate(); });
}
function backFromPanel() {
  if (G.screen === 'select' && G.selFrom === 'pause') { G.back.pop(); show('pause'); return; }
  if (G.screen === 'select') setChar(G.char = store.get('ett.character', G.char), false);
  goBack();
}
function stepSel(d) { G.selIdx = (G.selIdx + d + CHARACTERS.length) % CHARACTERS.length; audio.sfx('whoosh'); updateSel(); }
function chooseChar() {
  setChar(CHARACTERS[G.selIdx].id, true);
  toast(`${charOf(G.char).name} selected`, 'good');
  if (G.selFrom === 'pause') { G.back.pop(); show('pause'); return; }
  if (G.selFrom === 'over') { G.back = []; play(); return; }
  G.back = []; show('menu');
}
function checkRotate() {
  const portraitPhone = isMobile && innerHeight > innerWidth;
  $('#rotate-hint').hidden = !(portraitPhone && G.screen === 'run' && !store.get('ett.rotateDismissed', false));
}

/* ---------------- run lifecycle ---------------- */
async function play() {
  if (G.starting) return;
  G.starting = true;
  audio.unlock();
  for (const b of $$('[data-act="play"]')) b.disabled = true;
  try {
    let seed = null, run = null;
    const acc = G.account || {};
    if (acc.canPlay) {
      await flushUploads();
      const r = await api('POST', '/api/ett/start', { idem: rid(), character: G.char });
      if (r.ok) {
        seed = r.run.seed; run = { id: r.run.id, earning: true };
        const got = (r.redeemed || []).reduce((a, x) => a + x.awarded, 0);
        if (got > 0) { toast(`+${got} POINTS REDEEMED FROM YOUR LAST RUN`, 'good'); audio.sfx('redeem'); }
        else if ((r.redeemed || []).some(x => x.capped)) toast('Daily point cap reached — keep playing for the leaderboard!', 'warn');
        if (G.me && r.balance) { G.me.balance = r.balance; if (G.me.profile) G.me.profile.totalPoints = r.balance.totalPoints; renderAccount(); }
      } else if (r.status === 401 || r.status === 403) { await refreshMe(); toast('Session expired — reconnect Phantom to earn. Practice run started.', 'warn'); }
      else toast(r.status === 429 ? 'Slow down a little — practice run (not earning).' : 'Server unreachable — practice run (not earning). Pending points stay safe.', 'warn');
    }
    if (!seed) { seed = 'local-' + rid(); run = { id: null, earning: false }; }
    startSim(seed, run);
  } finally {
    G.starting = false;
    for (const b of $$('[data-act="play"]')) b.disabled = false;
  }
}
function startSim(seed, run) {
  G.sim = new Sim(seed); G.run = run; G.inputs = []; G.queue = []; G.acc = 0; G.paused = false; G.biome = -1; G.stepT = 0;
  G.prev = { pz: 0, px: G.sim.px, y: 0 };
  G.runStartedAt = performance.now(); G.fps = []; G.qualityChecked = 0;
  world.setCharacter(G.char);
  world.resetRun(); world.setMode('run'); world.snapCamera({ pz: 0, px: 0 });
  G.back = [];
  show('run');
  $('#h-guest').hidden = run.earning;
  audio.music(true, 0); audio.sfx('bark'); setTimeout(() => audio.sfx('rattle'), 250);
  hudMsg('RUN! THE SKELETONS ARE COMING!');
  checkRotate();
}
function pause() {
  if (G.screen !== 'run' || !G.sim || G.sim.dead) return;
  G.paused = true; audio.music(false); show('pause');
}
function resume() {
  G.paused = false; G.acc = 0; show('run'); audio.music(true, 0);
}
function quitRun() {
  if (!G.sim) return;
  G.paused = false;
  endRun(true);
}

function view(alpha) {
  const s = G.sim, p = G.prev;
  return { pz: p.pz + (s.pz - p.pz) * alpha, px: p.px + (s.px - p.px) * alpha, y: p.y + (s.y - p.y) * alpha, slide: s.slideT > 0, speed: s.speed, lane: s.lane };
}

function handleEvents() {
  const sim = G.sim;
  for (const ev of sim.events) {
    world.onEvent(ev, sim);
    switch (ev.t) {
      case 'jump': audio.sfx('jump'); break;
      case 'slide': audio.sfx('slide'); break;
      case 'lane': audio.sfx('lane'); break;
      case 'edge': audio.sfx('edge'); break;
      case 'land': audio.sfx('land'); break;
      case 'coin': {
        audio.sfx(ev.type === 'SOLANA' ? 'coin10' : ev.type === 'USDC' ? 'coin5' : 'coin1');
        const c = sim.coins.find(c => c.id === ev.id);
        if (c) world.coinCollected(ev.type, c.x, c.y, c.z);
        if (ev.type === 'SOLANA') hudMsg('+10 SOLANA!');
        else if (ev.type === 'USDC') hudMsg('+5 USDC');
        break;
      }
      case 'nearmiss': audio.sfx('nearmiss'); if (Math.random() < 0.35) hudMsg(['CLOSE CALL!', 'NICE DODGE!', 'TOO EASY'][Math.floor(Math.random() * 3)]); break;
      case 'stumble': audio.sfx('stumble'); audio.sfx('bark'); hudMsg('STUMBLED! THEY’RE RIGHT BEHIND YOU!', true); break;
      case 'dead': break;
    }
  }
  sim.events.length = 0;
}

function stepGame(dt) {
  const sim = G.sim;
  G.acc += dt;
  let steps = 0;
  while (G.acc >= TICK && steps < 8 && !sim.dead) {
    let q = null;
    if (G.queue.length) { q = G.queue.splice(0); for (const c of q) G.inputs.push([sim.tick, c]); }
    G.prev.pz = sim.pz; G.prev.px = sim.px; G.prev.y = sim.y;
    sim.step(q);
    handleEvents();
    G.acc -= TICK; steps++;
  }
  if (steps >= 8) G.acc = 0;
  if (sim.dead) { endRun(false); return; }
  // footsteps
  if (sim.grounded && sim.slideT <= 0) { G.stepT -= dt * sim.speed / 13; if (G.stepT <= 0) { G.stepT = 0.17; audio.sfx('step'); } }
  // biome banner
  const b = biomeAt(sim.pz);
  if (b !== G.biome) { if (G.biome !== -1) { const el = $('#h-biome'); el.textContent = BIOMES[b].name; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); } G.biome = b; }
  root.classList.toggle('is-danger', sim.stumbleT > 0);
  audio.setIntensity(Math.min(1, sim.pz / ETT.difficulty.rampMetres));
}

let hudCache = {};
function renderHud() {
  const s = G.sim; if (!s) return;
  const c = s.stats.coins;
  const vals = { '#h-score': s.points, '#h-ch': c.HALLOWINU, '#h-cu': c.USDC, '#h-cs': c.SOLANA, '#h-dist': Math.floor(s.pz), '#h-speed': `${s.speed.toFixed(1)} M/S` };
  for (const k in vals) if (hudCache[k] !== vals[k]) { $(k).textContent = vals[k]; hudCache[k] = vals[k]; }
}

/* ---------------- game over ---------------- */
async function endRun(quit) {
  const sim = G.sim, run = G.run;
  const sum = sim.summary();
  world.setMode('over');
  audio.music(false);
  audio.sfx('crash'); setTimeout(() => audio.sfx('bark'), 500); setTimeout(() => audio.sfx('rattle'), 800); setTimeout(() => audio.sfx('bark'), 1100);
  G.screen = 'over-anim'; root.dataset.screen = 'over'; $('#hud').hidden = true; $('#controls').hidden = true; $('#s-pause').hidden = true; root.classList.remove('is-danger');
  G.over = { sum, run, quit, result: null, status: run.earning ? 'uploading' : 'guest' };
  // local personal best (also used for guests)
  const lb = store.get('ett.best', { score: 0, distance: 0 });
  G.over.localNewBest = sum.score > lb.score || sum.distance > lb.distance;
  store.set('ett.best', { score: Math.max(lb.score, sum.score), distance: Math.max(lb.distance, sum.distance) });
  G.over.best = { score: Math.max(lb.score, sum.score), distance: Math.max(lb.distance, sum.distance), newBestScore: sum.score > lb.score };
  if (run.earning) {
    const payload = { runId: run.id, ticks: sum.ticks, inputs: encodeInputs(G.inputs), score: sum.score, dead: sum.dead, character: G.char };
    saveUpload(payload);
    uploadRun(payload).then(r => {
      if (r.ok) { G.over.result = r; G.over.status = 'done'; if (r.personalBest) G.over.best = r.personalBest; if (G.me && r.balance) { G.me.balance = r.balance; renderAccount(); } }
      else G.over.status = r.status >= 400 && r.status < 500 && r.status !== 429 ? 'error' : 'saved';
      if (G.screen === 'over') renderOverStatus();
    });
  }
  setTimeout(() => showOver(), quit ? 900 : 1700);
}

function showOver() {
  const { sum, quit } = G.over;
  show('over');
  $('#over-msg').textContent = quit ? 'YOU WALKED OUT OF THE TRENCHES.' : sum.reason === 'caught' ? 'CAUGHT BY THE SKELETON CREW. ' + MESSAGES[Math.floor(Math.random() * MESSAGES.length)] : MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  $('#o-char').textContent = charOf(G.char).name;
  const mmss = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  $('#o-dur').textContent = mmss(sum.durationMs);
  $('#o-speed').textContent = `${sum.maxSpeed.toFixed(1)} M/S`;
  const total = sum.coins.HALLOWINU + sum.coins.USDC + sum.coins.SOLANA;
  count('#o-score', sum.score, 1100); count('#o-dist', sum.distance, 900, ' M');
  count('#o-ch', sum.coins.HALLOWINU, 700); count('#o-cu', sum.coins.USDC, 700); count('#o-cs', sum.coins.SOLANA, 700);
  count('#o-ph', sum.points.HALLOWINU, 800); count('#o-pu', sum.points.USDC, 800); count('#o-ps', sum.points.SOLANA, 800);
  count('#o-jumps', sum.jumps, 600); count('#o-slides', sum.slides, 600); count('#o-left', sum.leftSwitches, 600); count('#o-right', sum.rightSwitches, 600); count('#o-coins', total, 700);
  renderOverStatus();
  audio.sfx('gameover');
}
function renderOverStatus() {
  const o = G.over; if (!o) return;
  const best = o.best || {};
  const newBest = o.result ? !!(o.result.personalBest && (o.result.personalBest.newBestScore || o.result.personalBest.newBestDistance)) : o.localNewBest && o.sum.score > 0;
  $('#o-best').textContent = `${(best.score ?? 0).toLocaleString()} PTS · ${(best.distance ?? 0).toLocaleString()} M`;
  const pb = $('#over-pb');
  if (newBest && pb.hidden) { pb.hidden = false; setTimeout(() => { audio.sfx('best'); world.victory(); }, 900); }
  if (!newBest) pb.hidden = true;
  const st = $('#o-status');
  let pill = '', text = '';
  if (o.status === 'guest') { pill = '<span class="pill">GUEST</span>'; text = (G.account && G.account.state === 'OFFLINE') ? 'Practice run — the server was unreachable, nothing to redeem.' : 'Guest run — <b>connect Phantom</b> to earn points from your coins.'; }
  else if (o.status === 'uploading') { pill = '<span class="pill wait">VERIFYING</span>'; text = 'The server is replaying your run…'; }
  else if (o.status === 'saved') { pill = '<span class="pill wait">SAVED</span>'; text = 'Connection problem — your run is saved on this device and will be verified &amp; redeemed when you start your next run.'; }
  else if (o.status === 'error') { pill = '<span class="pill bad">ERROR</span>'; text = 'This run could not be submitted.'; }
  else {
    const r = o.result.run;
    if (r.verification === 'REJECTED') { pill = '<span class="pill bad">REJECTED</span>'; text = `Not redeemable — ${esc(BAD[r.rejectReason] || r.rejectReason || 'verification failed')}.`; }
    else if (r.redemption === 'PENDING') { pill = '<span class="pill ok">VERIFIED · PENDING</span>'; text = `<b>${r.score}</b> points pending — redeemed automatically when you start your next run.`; }
    else if (r.redemption === 'REDEEMED') { pill = '<span class="pill done">REDEEMED</span>'; text = `${r.awardedPoints} points credited.`; }
    else { pill = '<span class="pill">VERIFIED</span>'; text = r.score > 0 ? 'Verified (rewards are paused right now).' : 'Verified — no coins this run, nothing to redeem.'; }
  }
  st.innerHTML = `${pill}<p>${text}</p>`;
}
function count(sel, to, ms, suffix = '') {
  const el = $(sel), t0 = performance.now();
  const tick = now => { const k = Math.min(1, (now - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString() + suffix; if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

/* ---------------- leaderboard ---------------- */
let LB = { range: 'all', metric: 'best' };
async function loadBoard() {
  for (const b of $$('#lb-range button')) b.classList.toggle('on', b.dataset.range === LB.range);
  for (const b of $$('#lb-metric button')) b.classList.toggle('on', b.dataset.metric === LB.metric);
  $('#lb-metric').hidden = LB.range === 'mine';
  const body = $('#lb-body'); body.innerHTML = '<p class="muted">Loading…</p>';
  if (LB.range === 'mine') {
    if (!G.account || !G.account.canPlay) { const b = store.get('ett.best', { score: 0, distance: 0 }); body.innerHTML = `<p class="muted">Connect Phantom to keep a verified run history. Best on this device: <b>${b.score}</b> pts · <b>${b.distance}</b> m.</p>`; return; }
    const r = await refreshMe();
    if (!r.ok) { body.innerHTML = '<p class="muted">Could not load your runs.</p>'; return; }
    const h = r.history || [];
    if (!h.length) { body.innerHTML = '<p class="muted">No runs yet — go escape some trenches!</p>'; return; }
    body.innerHTML = `<table class="lb hist"><thead><tr><th>WHEN</th><th>INU</th><th>STATUS</th><th style="text-align:right">SCORE</th></tr></thead><tbody>${h.map(x => {
      const st = x.verification === 'REJECTED' ? '<span class="pill bad">REJECTED</span>' : x.redemption === 'REDEEMED' ? '<span class="pill done">REDEEMED</span>' : x.redemption === 'PENDING' ? '<span class="pill ok">PENDING</span>' : x.verification === 'VALIDATED' ? '<span class="pill">VALIDATED</span>' : '<span class="pill">' + esc(x.state) + '</span>';
      return `<tr><td>${new Date(x.finishedAt || x.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(charOf(x.character).name)}</td><td>${st}</td>
        <td class="v">${x.score}<small>${x.distance} m · ${x.coins.HALLOWINU}/${x.coins.USDC}/${x.coins.SOLANA} coins${x.redemption === 'REDEEMED' ? ' · +' + x.awardedPoints : ''}</small></td></tr>`; }).join('')}</tbody></table>`;
    return;
  }
  const r = await api('GET', `/api/ett/leaderboard?range=${LB.range}&metric=${LB.metric}`);
  if (!r.ok) { body.innerHTML = '<p class="muted">Leaderboard unavailable right now.</p>'; return; }
  const col = LB.metric === 'total' ? 'total' : LB.metric === 'distance' ? 'distance' : 'best';
  const unit = col === 'distance' ? ' M' : ' PTS';
  const row = x => `<tr class="${x.me ? 'me' : ''}"><td class="r">#${x.rank}</td><td class="n">${esc(x.name)}${x.me ? ' (YOU)' : ''}</td><td class="muted">${x.runs} run${x.runs === 1 ? '' : 's'}</td><td class="v">${(x[col] || 0).toLocaleString()}${unit}</td></tr>`;
  body.innerHTML = r.rows.length ? `<table class="lb"><thead><tr><th>#</th><th>PLAYER</th><th>RUNS</th><th style="text-align:right">${LB.metric === 'total' ? 'TOTAL SCORE' : LB.metric === 'distance' ? 'DISTANCE' : 'BEST RUN'}</th></tr></thead><tbody>
    ${r.rows.map(row).join('')}${r.me ? '<tr class="gap"><td colspan="4">…</td></tr>' + row(r.me) : ''}</tbody></table>` : '<p class="muted">No verified runs in this period yet. Be the first!</p>';
}
function bindBoard() {
  $('#lb-range').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { LB.range = b.dataset.range; loadBoard(); } });
  $('#lb-metric').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { LB.metric = b.dataset.metric; loadBoard(); } });
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  let v = { pz: 0, px: 0, y: 0, slide: false, speed: ETT.speed.start, lane: 1 };
  if (G.sim && (G.screen === 'run' || G.screen === 'pause' || G.screen === 'over' || G.screen === 'over-anim' || (G.screen === 'select' && G.selFrom === 'pause') || G.back.includes('pause') || G.back.includes('over'))) {
    if (G.screen === 'run' && !G.paused && !G.sim.dead) stepGame(dt);
    v = view(G.sim.dead || G.paused || G.screen !== 'run' ? 1 : Math.min(1, G.acc / TICK));
    renderHud();
  }
  const frozen = G.paused && G.screen !== 'select';
  world.update(frozen ? 0 : dt, v, G.sim);
  // auto quality: measure the first seconds of a run
  if (S.quality === 'auto' && G.screen === 'run' && !G.paused) {
    G.fps.push(dt);
    if (G.fps.length === 150) {
      const avg = G.fps.reduce((a, b) => a + b, 0) / G.fps.length; G.fps = [];
      const q = world.qualityName;
      if (avg > 1 / 40 && q !== 'low') { world.setQuality(q === 'high' ? 'medium' : 'low'); }
      else if (avg < 1 / 58 && q === 'medium' && !isMobile && !S.perf && G.qualityChecked++ < 1) world.setQuality('high');
    }
  }
  requestAnimationFrame(frame);
}

/* ---------------- boot ---------------- */
async function boot() {
  const bar = $('#load-bar'), txt = $('#load-text');
  const prog = (p, t) => { bar.style.width = p + '%'; if (t) txt.textContent = t; };
  prog(15, 'Carving voxel pumpkins…');
  audio = new Audio();
  await new Promise(r => setTimeout(r, 30));
  try { world = new World($('#ett-canvas')); }
  catch (e) { txt.textContent = 'WebGL is not available on this device/browser. Try another browser.'; console.error(e); return; }
  prog(55, 'Waking the skeleton crew…');
  await new Promise(r => setTimeout(r, 30));
  makeThumbs();
  prog(70, 'Checking your HALLOWINU account…');
  world.setCharacter(G.char);
  applySettings();
  bindSettings(); bindInput(); bindButtons(); bindBoard();
  renderStrip($('#menu-strip'), id => setChar(id));
  renderStrip($('#sel-strip'), id => { G.selIdx = CHAR_IDS.indexOf(id); updateSel(); });
  requestAnimationFrame(frame);
  await refreshMe();
  if (G.account && G.account.canPlay && pendingUploads().length) { await flushUploads(); await refreshMe(); }
  prog(100, 'Ready.');
  root.classList.remove('is-loading');
  show('menu');
  updateFsLabels();
  const qs = new URLSearchParams(location.search);
  if (qs.get('play') === '1') play();
  window.__ETT = { G, world, play, act, endRun };   // debug/testing hook
}
boot();
