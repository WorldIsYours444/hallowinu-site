/* HALLOWINU ARCADE — client (presentation only; the server is authoritative for everything). */
(() => {
  const root = document.querySelector('[data-arcade]');
  if (!root) return;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="px-icon" shape-rendering="crispEdges" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const idem = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  const GAME_NAMES = { 'trick-or-treat': 'Trick or Treat', 'pumpkin-hunt': 'Pumpkin Hunt', 'daily-spin': 'Daily Spin', quiz: 'HALLOWINU Quiz' };

  const S = { offset: 0, season: null, games: {}, player: null, scope: 'season', busy: false };
  const serverNow = () => Date.now() + S.offset;

  /* ---------- SOL formatting from integer lamports (no float math on amounts) ---------- */
  function sol(lamports, decimals = 3) {
    let l = BigInt(lamports || 0); const neg = l < 0n; if (neg) l = -l;
    const whole = l / 1000000000n, frac = (l % 1000000000n).toString().padStart(9, '0').slice(0, decimals);
    return (neg ? '-' : '') + whole.toLocaleString('en-US') + (decimals ? '.' + frac : '');
  }
  function clockText(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = v => String(v).padStart(2, '0');
    return (d ? d + 'D ' : '') + `${p(h)}:${p(m)}:${p(x)}`;
  }

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (method !== 'GET') { opts.headers['content-type'] = 'application/json'; opts.headers['x-hw-client'] = '1'; opts.body = JSON.stringify(body || {}); }
    let res;
    try { res = await fetch(path, opts); } catch { return { ok: false, error: 'NETWORK' }; }
    let data; try { data = await res.json(); } catch { data = { ok: false, error: res.status >= 500 ? 'INTERNAL' : 'NETWORK' }; }
    if (data.serverNow) S.offset = data.serverNow - Date.now();
    data.status = res.status;
    return data;
  }
  function errorText(r) {
    const left = t => (t ? ` COME BACK IN ${clockText(t - serverNow())}.` : '');
    switch (r.error) {
      case 'NETWORK': return ['THE GHOSTS ATE THE CONNECTION.', 'TRY AGAIN.'];
      case 'NO_SESSION': return ['YOUR SESSION FADED INTO THE FOG.', 'RE-ENTER THE ARCADE TO CONTINUE.'];
      case 'DAILY_LIMIT': return ['NO PLAYS LEFT TODAY.', 'RESETS AT 00:00 UTC.' + left(r.resetsAt)];
      case 'COOLDOWN': return ['NO SPINS LEFT.', left(r.nextAt).trim() || 'COME BACK LATER.'];
      case 'RATE_LIMITED': return ['EASY THERE, SPEEDY SPIRIT.', 'TRY AGAIN IN A MOMENT.'];
      case 'GAME_DISABLED': return ['THIS CABINET IS CLOSED FOR REPAIRS.', 'TRY ANOTHER GAME.'];
      case 'ARCADE_OFFLINE': return ['THE ARCADE IS STILL WAKING UP.', 'CHECK BACK SOON.'];
      case 'NO_QUESTIONS': return ['YOU EMPTIED THE CRYPT.', 'NEW QUESTIONS ARE COMING.'];
      case 'BANNED': return ['THE GATE STAYS SHUT.', 'THIS PLAYER CANNOT ENTER THE ARCADE.'];
      default: return ['SOMETHING SPOOKY HAPPENED.', r.message ? String(r.message).toUpperCase() : 'TRY AGAIN.'];
    }
  }

  /* ---------- sound (synthesized, no assets, no autoplay) ---------- */
  let soundOn = store.get('hw-sound') !== 'off', actx = null;
  const soundBtn = $('[data-sound]', root);
  function syncSoundBtn() { soundBtn.setAttribute('aria-pressed', String(soundOn)); soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off'); }
  soundBtn.addEventListener('click', () => { soundOn = !soundOn; store.set('hw-sound', soundOn ? 'on' : 'off'); syncSoundBtn(); sfx('click'); });
  syncSoundBtn();
  function tone(freq, start, dur, type = 'square', vol = .05) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, actx.currentTime + start);
    g.gain.setValueAtTime(vol, actx.currentTime + start); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + start + dur);
    o.connect(g).connect(actx.destination); o.start(actx.currentTime + start); o.stop(actx.currentTime + start + dur + .02);
  }
  function sfx(name) {
    if (!soundOn) return;
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const seq = {
      click: [[660, 0, .05]], hit: [[520, 0, .06], [880, .05, .08]], rare: [[600, 0, .06], [900, .06, .06], [1200, .12, .1]],
      golden: [[784, 0, .08], [988, .08, .08], [1319, .16, .08], [1568, .24, .18]], miss: [[180, 0, .12, 'sawtooth', .03]],
      tick: [[1200, 0, .02, 'square', .025]], win: [[523, 0, .1], [659, .1, .1], [784, .2, .18]],
      lose: [[330, 0, .14, 'triangle'], [247, .14, .22, 'triangle']], jackpot: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .1], [1319, .4, .3]],
      achieve: [[880, 0, .08], [1175, .08, .08], [1760, .16, .22, 'triangle']], level: [[392, 0, .1], [523, .1, .1], [659, .2, .1], [784, .3, .25]],
    }[name];
    seq && seq.forEach(([f, s, d, t, v]) => tone(f, s, d, t, v));
  }

  /* ---------- toasts ---------- */
  const toasts = $('[data-toasts]');
  function toast(title, text, ico = 'trophy', purple = false) {
    const el = document.createElement('div');
    el.className = 'ax-toast' + (purple ? ' p' : '');
    el.innerHTML = `<span class="ico">${icon(ico)}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
    toasts.append(el); setTimeout(() => el.remove(), 4300);
  }
  function celebrate(r) {
    (r.achievementsUnlocked || []).forEach((a, i) => setTimeout(() => { toast('ACHIEVEMENT UNLOCKED', a.name, a.icon || 'trophy'); sfx('achieve'); }, 600 + i * 900));
    if (r.levelUp) setTimeout(() => { toast('LEVEL UP!', `You reached level ${r.levelUp}`, 'crown', true); sfx('level'); }, 300);
  }

  /* ---------- state + rendering ---------- */
  async function refresh() {
    const r = await api('GET', '/api/arcade');
    if (!r.ok) { renderOffline(r); return r; }
    S.season = r.season; S.player = r.player;
    S.games = Object.fromEntries(r.games.map(g => [g.id, g]));
    renderSeason(); renderPlayer(); renderGames();
    return r;
  }
  function renderOffline(r) {
    $('[data-season-phase]', root).innerHTML = '<span class="dot"></span>Offline';
    $('[data-season-name]', root).textContent = 'ARCADE OFFLINE';
    $('[data-pool-sub]', root).textContent = errorText(r).join(' ');
  }

  let shownPool = null;
  function renderSeason() {
    const s = S.season; if (!s) { $('[data-season-name]', root).textContent = 'NO ACTIVE SEASON'; return; }
    const labels = { ACTIVE: 'Season live', UPCOMING: 'Starts soon', ENDED: 'Season ended', FINALIZING: 'Finalizing results', FINALIZED: 'Season finalized' };
    $('[data-season-phase]', root).innerHTML = `<span class="dot ${s.phase === 'ACTIVE' ? 'blink' : ''}"></span>${labels[s.phase] || s.phase}`;
    $('[data-season-name]', root).textContent = s.name;
    const poolL = s.pool ? s.pool.totalLamports : '0';
    const target = Number(BigInt(poolL) / 1000000n) / 1000; // display only
    const el = $('[data-pool]', root);
    if (shownPool == null || reduce) el.textContent = sol(poolL);
    else if (shownPool !== target) countUp(el, shownPool, target, poolL);
    shownPool = target;
    const sub = $('[data-pool-sub]', root);
    if (BigInt(poolL) === 0n) sub.textContent = 'Awaiting verified funding';
    else sub.textContent = BigInt(s.pool.makerLamports) > 0n ? `Includes ◎ ${sol(s.pool.makerLamports)} verified maker rewards` : 'Funded by HALLOWINU maker rewards';
    if (s.pool && s.pool.frozen) sub.textContent = 'Pool frozen for final payouts';
    // "pool increased" banner: only for real, verified maker-reward records
    const lm = s.pool && s.pool.latestMaker;
    if (!lm && store.get('hw-seen-maker') == null) store.set('hw-seen-maker', '0');
    if (lm) {
      const seen = store.get('hw-seen-maker');
      if (seen && seen !== String(lm.id)) {
        const b = $('[data-pool-bump]', root); b.hidden = false; b.textContent = `+ ◎ ${sol(lm.amountLamports)} MAKER REWARDS · POOL INCREASED`;
        setTimeout(() => { b.hidden = true; }, 9000);
      }
      store.set('hw-seen-maker', String(lm.id));
    }
    tick();
  }
  function countUp(el, from, to, finalLamports) {
    const t0 = performance.now(), dur = 1200;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur), v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = k < 1 ? v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : sol(finalLamports);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function renderPlayer() {
    const p = S.player;
    $('[data-enter]', root).hidden = !!p;
    $('[data-card]', root).hidden = !p;
    if (!p) return;
    $('[data-name]', root).textContent = p.displayName;
    $('[data-pid]', root).textContent = p.shortId;
    $('[data-level]', root).textContent = p.level;
    $('[data-title]', root).textContent = p.title;
    $('[data-xp]', root).textContent = fmt(p.xp);
    $('[data-xpnext]', root).textContent = p.nextLevelXp == null ? 'MAX' : fmt(p.xpToNext);
    const span = p.nextLevelXp == null ? 1 : (p.xp - p.levelXp) / (p.nextLevelXp - p.levelXp);
    $('[data-xpbar]', root).style.width = `calc((100% - 4px) * ${Math.max(0, Math.min(1, span)).toFixed(3)})`;
    const st = { seasonPoints: fmt(p.seasonPoints), totalPoints: fmt(p.totalPoints), seasonRank: p.seasonRank ? '#' + fmt(p.seasonRank) : '—', allTimeRank: p.allTimeRank ? '#' + fmt(p.allTimeRank) : '—', gamesPlayed: fmt(p.gamesPlayed), streak: `${p.currentStreak} / ${p.bestStreak}` };
    for (const [k, v] of Object.entries(st)) $(`[data-stat="${k}"]`, root).textContent = v;
    $('[data-elig]', root).innerHTML = p.payoutEligibility === 'VERIFIED'
      ? '<span class="tag is-green">Prize eligibility: verified</span>'
      : '<span class="tag is-dim">Prize eligibility: not verified</span><button class="ax-link" type="button" data-open="eligibility">Why?</button>';
  }

  function renderGames() {
    for (const card of $$('[data-game]', root)) {
      const g = S.games[card.dataset.game]; if (!g) continue;
      const tag = $('[data-limit]', card), btn = $('[data-play]', card);
      card.classList.toggle('is-locked', !g.enabled);
      if (!g.enabled) { tag.textContent = 'Closed'; btn.disabled = true; continue; }
      btn.disabled = false;
      if (!S.player) { tag.textContent = g.limit.type === 'daily' ? `${g.limit.limit} / day` : '1 / 24h'; continue; }
      if (g.limit.type === 'daily') tag.textContent = `${g.limit.remaining} / ${g.limit.limit} left`;
      else tag.dataset.next = g.limit.nextAt || '';
    }
    tick();
  }

  function tick() {
    const t = serverNow();
    const s = S.season;
    if (s) {
      const lbl = $('[data-season-countdown-label]', root), cd = $('[data-season-countdown]', root);
      if (s.phase === 'UPCOMING') { lbl.textContent = 'STARTS IN'; cd.textContent = clockText(s.startsAt - t); }
      else if (s.phase === 'ACTIVE') { lbl.textContent = 'ENDS IN'; cd.textContent = clockText(s.endsAt - t); }
      else { lbl.textContent = 'ENDED'; cd.textContent = new Date(s.endsAt).toISOString().slice(0, 10); }
    }
    const spin = $('[data-game="daily-spin"] [data-limit]', root);
    if (spin && S.player && S.games['daily-spin']?.enabled) {
      const n = Number(spin.dataset.next || 0);
      spin.textContent = n && n > t ? `Next ${clockText(n - t)}` : 'Ready!';
    }
    const ns = $('[data-spin-next]');
    if (ns) { const n = Number(ns.dataset.at || 0); ns.textContent = n > t ? `NEXT SPIN ${clockText(n - t)}` : 'READY TO SPIN'; }
  }
  setInterval(tick, 1000);

  /* ---------- enter / session ---------- */
  async function enter() {
    const btn = $('[data-enter-btn]', root); btn.disabled = true;
    const r = await api('POST', '/api/session');
    btn.disabled = false;
    if (!r.ok) { toast(...errorText(r), 'skull', true); return false; }
    store.set('hw-entered', '1'); sfx('win');
    await refresh(); loadBoard();
    return true;
  }
  $('[data-enter-btn]', root).addEventListener('click', enter);

  /* ---------- leaderboard ---------- */
  async function loadBoard() {
    const rowsEl = $('[data-rows]', root), meEl = $('[data-me]', root);
    const r = await api('GET', `/api/leaderboard?scope=${S.scope}`);
    $('[data-prize-col]', root).hidden = S.scope !== 'season';
    if (!r.ok) { rowsEl.innerHTML = `<tr><td colspan="4" class="ax-empty">${esc(errorText(r).join(' '))}</td></tr>`; return; }
    if (!r.rows.length) rowsEl.innerHTML = `<tr><td colspan="4" class="ax-empty">No scores yet. The graveyard is quiet… be the first.</td></tr>`;
    else rowsEl.innerHTML = r.rows.map(x => {
      const prize = S.scope === 'season'
        ? `<td class="r pz">${x.prize ? `◎ ${esc(sol(x.prize.lamports))}<small>${esc(x.prize.status === 'ESTIMATED' ? 'EST.' : x.prize.status)}</small>` : '<span style="color:var(--muted)">—</span>'}</td>` : '';
      return `<tr class="${x.me ? 'me ' : ''}${x.rank <= 10 ? 'top ' : ''}${x.rank === 1 ? 'top1' : ''}"><td class="rk">#${x.rank}</td><td class="nm">${esc(x.name)}</td><td class="r pts">${fmt(x.points)}</td>${prize}</tr>`;
    }).join('');
    if (r.me) { meEl.hidden = false; meEl.textContent = `YOUR RANK #${fmt(r.me.rank)} · ${fmt(r.me.points)} PTS`; } else meEl.hidden = true;
  }
  $$('[data-scope]', root).forEach(b => b.addEventListener('click', () => {
    S.scope = b.dataset.scope; $$('[data-scope]', root).forEach(x => x.setAttribute('aria-selected', String(x === b))); sfx('click'); loadBoard();
  }));

  /* ---------- modals ---------- */
  const gameModal = $('[data-game-modal]'), screen = $('[data-screen]', gameModal);
  const infoModal = $('[data-info-modal]'), info = $('[data-info]', infoModal);
  let cleanup = null;
  function closeGame() { if (cleanup) { cleanup(); cleanup = null; } if (gameModal.open) gameModal.close(); refresh().then(loadBoard); }
  $$('[data-close]').forEach(b => b.addEventListener('click', () => { const d = b.closest('dialog'); d === gameModal ? closeGame() : d.close(); }));
  gameModal.addEventListener('cancel', e => { e.preventDefault(); closeGame(); });
  for (const d of [gameModal, infoModal]) d.addEventListener('click', e => { if (e.target === d) (d === gameModal ? closeGame() : d.close()); });

  function showError(r, retry) {
    const [a, b] = errorText(r);
    screen.innerHTML = `<div class="ax-err"><span class="ico" style="width:64px;height:64px">${icon('skull')}</span><h4 class="ax-big o">${esc(a)}</h4><p>${esc(b)}</p><div class="ax-row">${retry ? '<button class="btn btn-primary" data-retry>Try again</button>' : ''}<button class="btn btn-purple" data-back>Back to arcade</button></div></div>`;
    $('[data-retry]', screen)?.addEventListener('click', retry);
    $('[data-back]', screen).addEventListener('click', closeGame);
    if (r.error === 'NO_SESSION') { S.player = null; renderPlayer(); }
    sfx('lose');
  }

  async function openGame(id) {
    sfx('click');
    if (!S.player) { const ok = await enter(); if (!ok) return; }
    $('[data-game-title]', gameModal).textContent = GAME_NAMES[id];
    screen.innerHTML = '';
    if (!gameModal.open) gameModal.showModal();
    ({ 'trick-or-treat': gameTOT, 'pumpkin-hunt': gameHunt, 'daily-spin': gameSpin, quiz: gameQuiz })[id]();
  }
  root.addEventListener('click', e => {
    const p = e.target.closest('[data-play]'); if (p) return openGame(p.dataset.play);
    const o = e.target.closest('[data-open]'); if (o) return openInfo(o.dataset.open);
    if (e.target.closest('[data-rename]')) return openInfo('rename');
  });

  function burst(container, color) {
    if (reduce) return;
    const b = document.createElement('div'); b.className = 'burst';
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14, d = 60 + Math.random() * 50;
      const s = document.createElement('i'); s.style.setProperty('--x', `${Math.cos(a) * d}px`); s.style.setProperty('--y', `${Math.sin(a) * d}px`); s.style.setProperty('--c', color || (i % 2 ? '#ffc44d' : '#c45cff'));
      b.append(s);
    }
    container.append(b); setTimeout(() => b.remove(), 900);
  }
  function pointsBlock(pts) { return `<div class="ax-pts ${pts ? '' : 'zero'}">+${fmt(pts)} PTS</div>`; }

  /* =========================================================
     GAME 1 — TRICK OR TREAT
     ========================================================= */
  function gameTOT() {
    const g = S.games['trick-or-treat'];
    const left = g?.limit?.remaining ?? 0;
    screen.innerHTML = `<div class="ax-center">
      <p>Choose a door. The crypt decides what's behind it — <b>after</b> you choose.</p>
      <span class="tag">${left} of ${g.limit.limit} plays left today</span>
      <div class="tot-doors">
        <button class="btn btn-orange tot-door" data-pick="trick"><span class="ico">${icon('pumpkin')}</span>TRICK</button>
        <button class="btn btn-purple tot-door" data-pick="treat"><span class="ico">${icon('candy')}</span>TREAT</button>
      </div>
      <p class="ax-hint">TREAT = steady rewards · TRICK = riskier, bigger jackpot · odds in Prizes &amp; rules</p>
    </div>`;
    $$('[data-pick]', screen).forEach(b => b.addEventListener('click', async () => {
      const choice = b.dataset.pick;
      $$('[data-pick]', screen).forEach(x => (x.disabled = true));
      b.classList.add('tot-deciding'); sfx('click');
      const key = idem();
      const [r] = await Promise.all([api('POST', '/api/games/trick-or-treat/play', { choice, idem: key }), new Promise(res => setTimeout(res, reduce ? 0 : 900))]);
      if (!r.ok) return showError(r, gameTOT);
      const cls = r.jackpot ? 'g' : r.points ? (choice === 'trick' ? 'o' : 'p') : 'o';
      screen.innerHTML = `<div class="ax-center tot-result">
        <span class="ico" style="width:96px;height:96px">${icon(r.points ? (choice === 'trick' ? 'pumpkin' : 'candy') : 'skull')}</span>
        <h4 class="ax-big ${cls}">${esc(r.label)}</h4>${pointsBlock(r.points)}
        <span class="tag ${r.remaining ? '' : 'is-dim'}">${r.remaining} play${r.remaining === 1 ? '' : 's'} left today</span>
        <div class="ax-row">${r.remaining > 0 ? '<button class="btn btn-primary" data-again>Play again</button>' : ''}<button class="btn btn-purple" data-back>Back to arcade</button></div>
      </div>`;
      burst($('.tot-result', screen), r.jackpot ? '#ffd75e' : null);
      sfx(r.jackpot ? 'jackpot' : r.points ? 'win' : 'lose');
      celebrate(r);
      S.games['trick-or-treat'].limit.remaining = r.remaining;
      $('[data-again]', screen)?.addEventListener('click', gameTOT);
      $('[data-back]', screen).addEventListener('click', closeGame);
    }));
  }

  /* =========================================================
     GAME 2 — PUMPKIN HUNT
     ========================================================= */
  function gameHunt() {
    const g = S.games['pumpkin-hunt'];
    const pts = g.rules.points;
    screen.innerHTML = `<div class="ax-center">
      <p>Pumpkins pop up all over the graveyard for <b>${g.rules.durationMs / 1000} seconds</b>. Smash them before they vanish. Ghosts, graves and bats are decoys.</p>
      <div class="hunt-legend">
        <span><span class="ico">${icon('pumpkin')}</span>NORMAL +${pts.normal}</span>
        <span><span class="ico rare">${icon('pumpkin')}</span>RARE +${pts.rare}</span>
        <span><span class="ico gold">${icon('pumpkin')}</span>GOLDEN +${pts.golden}</span>
      </div>
      <p class="ax-hint">Hit pumpkins quickly in a row for COMBO bonuses.</p>
      <span class="tag">${g.limit.remaining} of ${g.limit.limit} hunts left today</span>
      <button class="btn btn-primary" data-start>${icon('pumpkin')}Start the hunt</button>
    </div>`;
    $('[data-start]', screen).addEventListener('click', startHunt);
  }
  async function startHunt() {
    screen.innerHTML = '<div class="ax-center"><p class="ax-loading">SUMMONING PUMPKINS…</p></div>';
    const r = await api('POST', '/api/games/pumpkin-hunt/start', { idem: idem() });
    if (!r.ok) return showError(r, gameHunt);
    const DECOY_ICON = { ghost: 'ghost', bat: 'skull', candy: 'candy', lantern: 'moon' };
    screen.innerHTML = `<div>
      <div class="hunt-hud"><span>SCORE <b data-score>0</b></span><span class="hunt-combo" data-combo></span><span class="hunt-time"><i data-time></i></span><span><b data-left>${Math.ceil(r.durationMs / 1000)}</b>s</span></div>
      <div class="hunt-board" data-board><span class="hunt-moon"></span>
        ${r.decoys.map(d => d.kind === 'grave' || d.kind === 'tree' ? `<span class="decoy ${d.kind}" style="left:${d.x}%;top:${d.y}%"></span>` : `<span class="decoy" style="left:${d.x}%;top:${d.y}%;animation-delay:-${(d.x % 5)}s">${icon(DECOY_ICON[d.kind] || 'ghost')}</span>`).join('')}
        <div class="hunt-overlay" data-overlay>3</div>
      </div>
      <p class="ax-hint" style="text-align:center;margin-top:10px">Tap the pumpkins · everything is verified by the server</p>
    </div>`;
    const board = $('[data-board]', screen), overlay = $('[data-overlay]', screen);
    const localStart = performance.now() + Math.max(0, r.startsInMs);
    const targets = r.targets.map(t => ({ ...t, el: null, state: 'pending' }));
    let score = 0, combo = 0, lastHit = -1e9, raf = 0, done = false, lastCount = 4;
    const pending = new Set();

    function pop(x, y, text, cls) { const p = document.createElement('span'); p.className = `pop ${cls || ''}`; p.style.left = x + '%'; p.style.top = y + '%'; p.textContent = text; board.append(p); setTimeout(() => p.remove(), 950); }
    function setCombo() { $('[data-combo]', screen).textContent = combo >= 3 ? `COMBO x${combo}` : ''; }

    async function claim(t) {
      if (t.state !== 'live' || done) return;
      t.state = 'claimed'; t.el.classList.add('hit');
      const now = performance.now();
      combo = now - lastHit <= 1600 ? combo + 1 : 1; lastHit = now; setCombo();
      pop(t.x, t.y, t.type === 'golden' ? 'GOLDEN! +' + r.points.golden : `+${r.points[t.type]}`, t.type);
      sfx(t.type === 'golden' ? 'golden' : t.type === 'rare' ? 'rare' : 'hit');
      const req = api('POST', '/api/games/pumpkin-hunt/claim', { sessionId: r.sessionId, targetId: t.id });
      pending.add(req);
      const res = await req; pending.delete(req);
      if (res.ok && res.accepted) { score += res.points; $('[data-score]', screen).textContent = score; }
      else { pop(t.x, t.y + 6, 'MISS', 'miss'); }
    }
    board.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.target');
      if (btn) { e.preventDefault(); claim(targets.find(t => t.id === btn.dataset.id)); return; }
      if (e.target.closest('.decoy')) { combo = 0; setCombo(); const rect = board.getBoundingClientRect(); pop((e.clientX - rect.left) / rect.width * 100, (e.clientY - rect.top) / rect.height * 100, 'BOO!', 'miss'); sfx('miss'); }
    });

    function frame() {
      const el = performance.now() - localStart;
      if (el < 0) { const c = Math.ceil(-el / 1000); if (c !== lastCount) { lastCount = c; overlay.textContent = c; sfx('tick'); } raf = requestAnimationFrame(frame); return; }
      if (!overlay.hidden) { overlay.hidden = true; sfx('click'); }
      for (const t of targets) {
        if (t.state === 'pending' && el >= t.spawnMs) {
          t.state = 'live';
          const b = document.createElement('button'); b.type = 'button'; b.className = `target ${t.type}`; b.dataset.id = t.id;
          b.setAttribute('aria-label', `${t.type} pumpkin`); b.style.left = t.x + '%'; b.style.top = t.y + '%'; b.innerHTML = icon('pumpkin');
          board.append(b); t.el = b;
        } else if (t.state === 'live' && el >= t.spawnMs + t.lifeMs) {
          t.state = 'gone'; t.el.classList.add('fading'); const e2 = t.el; setTimeout(() => e2.remove(), 260);
        }
      }
      const left = Math.max(0, r.durationMs - el);
      $('[data-time]', screen).style.transform = `scaleX(${left / r.durationMs})`;
      $('[data-left]', screen).textContent = Math.ceil(left / 1000);
      if (left <= 0) return end();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    async function end() {
      if (done) return; done = true; cancelAnimationFrame(raf);
      overlay.hidden = false; overlay.style.fontSize = 'clamp(36px,7vw,72px)'; overlay.textContent = "TIME'S UP!"; sfx('tick');
      await Promise.allSettled([...pending]);
      // wait until server-side session time is over (it uses server time)
      const wait = Math.max(0, r.expiresAt - serverNow() + 150);
      await new Promise(res => setTimeout(res, wait));
      const f = await api('POST', '/api/games/pumpkin-hunt/finish', { sessionId: r.sessionId });
      if (!f.ok) return showError(f, gameHunt);
      S.games['pumpkin-hunt'].limit.remaining = Math.max(0, (S.games['pumpkin-hunt'].limit.remaining || 1) - (f.replay ? 0 : 1));
      screen.innerHTML = `<div class="ax-center tot-result">
        <h4 class="ax-big ${f.golden ? 'g' : 'o'}">${f.golden ? 'GOLDEN HUNT!' : f.found ? 'HUNT COMPLETE' : 'NOTHING BUT BONES'}</h4>
        ${pointsBlock(f.points)}
        <div class="hunt-legend"><span>FOUND ${f.found}</span><span>GOLDEN ${f.golden}</span><span>RARE ${f.rare}</span><span>BEST COMBO x${f.bestCombo}</span><span>COMBO BONUS +${f.bonus}</span></div>
        <div class="ax-row">${S.games['pumpkin-hunt'].limit.remaining > 0 ? '<button class="btn btn-primary" data-again>Hunt again</button>' : ''}<button class="btn btn-purple" data-back>Back to arcade</button></div>
      </div>`;
      burst($('.tot-result', screen), f.golden ? '#ffd75e' : null);
      sfx(f.points ? (f.golden ? 'jackpot' : 'win') : 'lose');
      celebrate(f);
      $('[data-again]', screen)?.addEventListener('click', gameHunt);
      $('[data-back]', screen).addEventListener('click', closeGame);
    }
    cleanup = () => { cancelAnimationFrame(raf); if (!done) { done = true; api('POST', '/api/games/pumpkin-hunt/finish', { sessionId: r.sessionId }).then(f => f.ok && celebrate(f)); } };
  }

  /* =========================================================
     GAME 3 — DAILY SPIN
     ========================================================= */
  function wheelSvg(segs) {
    const n = segs.length, R = 100, cols = ['#ff7a1a', '#2a0f4d', '#a43bff', '#1b0c33'];
    let out = '';
    segs.forEach((s, i) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const x0 = R + R * Math.cos(a0), y0 = R + R * Math.sin(a0), x1 = R + R * Math.cos(a1), y1 = R + R * Math.sin(a1);
      const fill = s.id === 'jackpot' ? '#ffc44d' : cols[i % 4];
      out += `<path d="M${R},${R} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}" stroke="#0b0516" stroke-width="2"/>`;
      const am = (a0 + a1) / 2, tx = R + R * .66 * Math.cos(am), ty = R + R * .66 * Math.sin(am);
      const rot = (am * 180) / Math.PI + 90;
      const dark = fill === '#ffc44d' || fill === '#ff7a1a';
      out += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-family="Press Start, monospace" font-size="${s.label.length > 5 ? 7 : 10}" fill="${dark ? '#1f0800' : '#f6efff'}">${esc(s.label)}</text>`;
    });
    return `<svg class="spin-wheel" data-wheel viewBox="0 0 200 200" aria-hidden="true">${out}<circle cx="100" cy="100" r="98" fill="none" stroke="#ffc44d" stroke-width="3"/></svg>`;
  }
  function gameSpin() {
    const g = S.games['daily-spin'], segs = g.wheel;
    const ready = !g.limit.nextAt || g.limit.nextAt <= serverNow();
    screen.innerHTML = `<div class="ax-center">
      <div class="spin-wrap"><span class="spin-pointer"></span>${wheelSvg(segs)}<span class="spin-hub"><img src="img/head.webp" alt=""></span></div>
      <p class="spin-next" data-spin-next data-at="${g.limit.nextAt || ''}"></p>
      <button class="btn btn-primary" data-spin ${ready ? '' : 'disabled'}>${icon('chest')}Spin the wheel</button>
      <p class="ax-hint">The result is decided by the server the moment you spin. The wheel just shows it.</p>
      <div class="spin-odds" data-odds></div>
    </div>`;
    tick();
    let rotation = 0;
    $('[data-spin]', screen).addEventListener('click', async e => {
      const btn = e.currentTarget; btn.disabled = true; sfx('click');
      const r = await api('POST', '/api/games/daily-spin/spin', { idem: idem() });
      if (!r.ok) return showError(r, gameSpin);
      const n = segs.length, seg = 360 / n;
      const target = 360 * 6 + (360 - (r.segmentIndex * seg + seg / 2));
      rotation = target;
      const wheel = $('[data-wheel]', screen);
      wheel.style.transform = `rotate(${rotation}deg)`;
      let ticks = 0; const tickTimer = reduce ? 0 : setInterval(() => { sfx('tick'); if (++ticks > 24) clearInterval(tickTimer); }, 150);
      await new Promise(res => setTimeout(res, reduce ? 50 : 4700));
      clearInterval(tickTimer);
      S.games['daily-spin'].limit.nextAt = r.nextAt;
      const card = document.createElement('div'); card.className = 'ax-center tot-result';
      card.innerHTML = `<h4 class="ax-big ${r.segmentId === 'jackpot' ? 'g' : r.rare ? 'p' : 'o'}">${r.segmentId === 'jackpot' ? 'JACKPOT!' : r.rare ? 'LUCKY GHOST!' : 'TREAT!'}</h4>${pointsBlock(r.points)}<div class="ax-row"><button class="btn btn-purple" data-back>Back to arcade</button></div>`;
      $('[data-spin]', screen).replaceWith(card);
      const sn = $('[data-spin-next]', screen); sn.dataset.at = r.nextAt; tick();
      burst(card, r.rare ? '#ffd75e' : null); sfx(r.segmentId === 'jackpot' ? 'jackpot' : 'win'); celebrate(r);
      $('[data-back]', card).addEventListener('click', closeGame);
    });
    // transparent odds straight from the server config
    $('[data-odds]', screen).innerHTML = segs.map(s => `<span><b>${esc(s.label)}</b>${s.weight}%</span>`).join('');
  }

  /* =========================================================
     GAME 4 — QUIZ
     ========================================================= */
  async function gameQuiz() {
    screen.innerHTML = '<div class="ax-center"><p class="ax-loading">OPENING THE CRYPT…</p></div>';
    const q = await api('POST', '/api/games/quiz/next');
    if (!q.ok) return showError(q, gameQuiz);
    const rules = S.games.quiz.rules;
    const pts = rules.rewards[q.difficulty];
    screen.innerHTML = `<div class="quiz">
      <div class="quiz-top">
        <span class="tag is-purple">${esc(q.category)}</span>
        <span class="tag">${esc(q.difficulty.toUpperCase())}${q.rewarded ? ` · +${pts} PTS` : ''}</span>
        <span class="tag ${q.rewarded ? '' : 'is-dim'}">${q.rewarded ? `${q.remaining ?? '?'} rewarded left today` : 'PRACTICE · no points'}</span>
      </div>
      <div class="quiz-timer"><i data-qt></i></div>
      <h4 class="quiz-q">${esc(q.question)}</h4>
      <div class="quiz-answers">${q.answers.map((a, i) => `<button class="btn btn-purple quiz-a" data-a="${i}"><span class="k">${'ABCD'[i]}</span>${esc(a)}</button>`).join('')}</div>
      <div data-qres></div>
    </div>`;
    const end = Date.now() + (q.expiresAt - q.serverNow);
    let raf = 0, answered = false;
    (function t() { const left = Math.max(0, end - Date.now()); const bar = $('[data-qt]', screen); if (!bar) return; bar.style.transform = `scaleX(${left / rules.answerTimeMs})`; if (left > 0 && !answered) raf = requestAnimationFrame(t); })();
    cleanup = () => cancelAnimationFrame(raf);
    $$('[data-a]', screen).forEach(b => b.addEventListener('click', async () => {
      if (answered) return; answered = true; cancelAnimationFrame(raf);
      $$('[data-a]', screen).forEach(x => (x.disabled = true)); sfx('click');
      const choice = Number(b.dataset.a);
      const r = await api('POST', '/api/games/quiz/answer', { attemptId: q.attemptId, choice });
      if (!r.ok) return showError(r, gameQuiz);
      $(`[data-a="${r.correctIndex}"]`, screen)?.classList.add('correct');
      if (!r.correct) b.classList.add('wrong');
      const head = r.expired ? "TIME'S UP!" : r.correct ? (r.bonus ? `STREAK x${r.streak}!` : 'CORRECT!') : 'WRONG!';
      $('[data-qres]', screen).innerHTML = `<div class="quiz-result">
        <div><h4 class="ax-big ${r.correct ? 'p' : 'o'}" style="font-size:34px">${head}</h4>${r.bonus ? `<span class="tag is-green">Streak bonus +${r.bonus}</span>` : ''}${r.practice ? '<span class="tag is-dim">Practice question</span>' : ''}</div>
        ${r.practice ? '' : pointsBlock(r.points)}
        <div class="ax-row"><button class="btn btn-primary" data-next>Next question</button><button class="btn btn-purple" data-back>Back</button></div>
      </div>`;
      sfx(r.correct ? (r.bonus ? 'jackpot' : 'win') : 'lose');
      celebrate(r);
      $('[data-next]', screen).addEventListener('click', gameQuiz);
      $('[data-back]', screen).addEventListener('click', closeGame);
    }));
  }

  /* ---------- info dialogs ---------- */
  async function openInfo(kind) {
    sfx('click');
    const title = $('[data-info-title]', infoModal);
    if (kind === 'profile') {
      if (!S.player) return;
      title.textContent = 'Player file';
      info.innerHTML = '<p class="ax-loading">LOADING…</p>';
      infoModal.showModal();
      const r = await api('GET', '/api/me');
      if (!r.ok) { info.innerHTML = `<p>${esc(errorText(r).join(' '))}</p>`; return; }
      const p = r.player;
      info.innerHTML = `<div class="info">
        <p><b style="color:var(--ghost)">${esc(p.displayName)}</b> · ID ${esc(p.shortId)} · Level ${p.level} ${esc(p.title)} · ${fmt(p.wins)} wins / ${fmt(p.losses)} losses</p>
        <h4>ACHIEVEMENTS · ${p.achievements.filter(a => a.unlockedAt).length}/${p.achievements.length}</h4>
        <ul class="ach-grid">${p.achievements.map(a => `<li class="ach ${a.unlockedAt ? 'got' : 'locked'}"><span class="ico">${icon(a.icon)}</span><b>${esc(a.name)}</b><small>${esc(a.description)}</small></li>`).join('')}</ul>
        <h4>RECENT GAMES</h4>
        ${p.history.length ? `<ul class="hist">${p.history.map(h => `<li><span>${esc(h.reason)}<br><small style="color:var(--muted)">${new Date(h.at).toLocaleString()}</small></span><b class="${h.points ? '' : 'zero'}">+${fmt(h.points)}</b></li>`).join('')}</ul>` : '<p>No games yet. Pick a cabinet!</p>'}
      </div>`;
      return;
    }
    if (kind === 'rename') {
      title.textContent = 'Rename player';
      info.innerHTML = `<form class="rename" data-rename-form><label for="ax-name">Display name (3–18 characters)</label><input id="ax-name" maxlength="18" minlength="3" required value="${esc(S.player?.displayName || '')}" autocomplete="off"><p class="ax-fine" data-rename-msg>Letters, numbers, spaces, - _ and . · one change per hour</p><button class="btn btn-primary" type="submit">Save name</button></form>`;
      infoModal.showModal();
      $('[data-rename-form]', info).addEventListener('submit', async e => {
        e.preventDefault();
        const r = await api('PATCH', '/api/me', { displayName: $('#ax-name', info).value });
        if (!r.ok) { $('[data-rename-msg]', info).textContent = r.message || 'Could not rename.'; return; }
        infoModal.close(); S.player = { ...S.player, ...r.player }; renderPlayer(); loadBoard(); sfx('win');
      });
      return;
    }
    if (kind === 'eligibility') {
      title.textContent = 'Prize eligibility';
      info.innerHTML = `<div class="info"><p>Anyone can play and climb the leaderboard. To receive an actual SOL prize, a winner needs a <b>verified persistent identity</b> and a <b>verified Solana payout wallet</b> (public address only — we will never ask for a seed phrase or private key).</p>
        <p>Right now your player lives in a secure cookie on this device. Identity verification (via the HALLOWINU Telegram) is coming in the next phase. Until then your prize eligibility shows as <b>NOT VERIFIED</b>.</p>
        <p>Never share your seed phrase. The HALLOWINU team will never DM you first.</p></div>`;
      infoModal.showModal(); return;
    }
    if (kind === 'prizes') {
      title.textContent = 'Prizes & rules';
      info.innerHTML = '<p class="ax-loading">LOADING…</p>';
      infoModal.showModal();
      const r = await api('GET', '/api/season');
      if (!r.ok || !r.current) { info.innerHTML = `<p>${esc(r.ok ? 'No season configured yet.' : errorText(r).join(' '))}</p>`; return; }
      const c = r.current, pool = c.pool;
      const fmtD = ts => new Date(ts).toUTCString().replace(':00 GMT', ' UTC');
      const tot = S.games['trick-or-treat']?.odds;
      info.innerHTML = `<div class="info">
        <p><b style="color:var(--ghost)">${esc(c.name)}</b><br>${fmtD(c.startsAt)} → ${fmtD(c.endsAt)}</p>
        <h4>PRIZE POOL</h4>
        <dl class="pool-break">
          <div><dt>Current pool</dt><dd>◎ ${sol(pool.totalLamports)}</dd></div>
          <div><dt>Starting pool</dt><dd>◎ ${sol(pool.initialLamports)}</dd></div>
          <div><dt>Maker rewards added</dt><dd>◎ ${sol(pool.makerLamports)}</dd></div>
        </dl>
        <p class="ax-fine">Only funding verified by the team (or on-chain) counts. ${BigInt(pool.totalLamports) === 0n ? 'The initial season funding is awaiting verification.' : ''}</p>
        ${c.funding?.length ? `<ul class="hist">${c.funding.map(f => `<li><span>${esc(f.source.replace('_', ' '))}${f.txSignature ? ` · <a href="https://solscan.io/tx/${encodeURIComponent(f.txSignature)}" target="_blank" rel="noopener noreferrer" style="color:var(--neon-soft)">tx</a>` : ''}<br><small style="color:var(--muted)">verified ${new Date(f.verifiedAt).toLocaleDateString()}</small></span><b>◎ ${sol(f.lamports)}</b></li>`).join('')}</ul>` : ''}
        <h4>TOP 10 · ESTIMATED PRIZES</h4>
        <table class="dist"><thead><tr><th>Rank</th><th class="r">Share</th><th class="r">Est. prize</th></tr></thead><tbody>
        ${c.estPrizes.map(p => `<tr><td>#${p.rank}</td><td class="r">${(p.bps / 100).toFixed(p.bps % 100 ? 1 : 0)}%</td><td class="r sol">◎ ${sol(p.lamports)}</td></tr>`).join('')}
        </tbody></table>
        <h4>RULES</h4>
        <ul>
          <li>Free to play — no purchase, token or wallet needed to play.</li>
          <li>Every game awards Arcade Points. Season points count only while the season is live; lifetime points never reset.</li>
          <li>Daily limits reset at 00:00 UTC: Trick or Treat 3×, Pumpkin Hunt 2×, Quiz 5 rewarded questions. Daily Spin: once every 24 hours.</li>
          <li>The Top 10 season players share the verified prize pool by the percentages above. Ties are broken by who reached the score first.</li>
          <li>Prize amounts are estimates until the season ends; the pool can grow with verified maker rewards.</li>
          <li>At season end the standings and pool are frozen, checked for cheating, and payouts are approved manually. Cheating, bots or multi-accounting lead to disqualification; lower ranks then move up.</li>
          <li>Payouts require a verified identity and Solana payout wallet. Arcade Points have no cash value. Not available where prohibited by law.</li>
        </ul>
        ${tot ? `<h4>TRICK OR TREAT ODDS</h4><p>TREAT: ${tot.treat.map(o => `${o.weight}% → ${o.points}`).join(' · ')}<br>TRICK: ${tot.trick.map(o => `${o.weight}% → ${o.points}`).join(' · ')}</p>` : ''}
        ${r.previous.length ? `<h4>PREVIOUS SEASONS</h4>${r.previous.map(s => `<p><b style="color:var(--ghost)">${esc(s.name)}</b> · pool ◎ ${sol(s.poolLamports)} · ${esc(s.status)}</p><ul class="hist">${s.winners.map(w => `<li><span>#${w.rank} ${esc(w.name)} · ${fmt(w.points)} pts</span><b>◎ ${esc(w.sol)} <small style="color:var(--muted)">${esc(w.status)}</small></b></li>`).join('')}</ul>`).join('')}` : ''}
      </div>`;
    }
  }

  /* ---------- boot ---------- */
  refresh().then(loadBoard);
  let poll = setInterval(() => { if (!document.hidden && !gameModal.open) refresh().then(() => S.scope && loadBoard()); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !gameModal.open) refresh(); });
})();
