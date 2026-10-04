/* HALLOWINU — interactions & atmosphere */
(() => {
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileQ = matchMedia('(max-width:700px)');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };

  /* ---------- motion state ---------- */
  let paused = reduce.matches || store.get('hw-motion') === 'off';
  const motionBtn = $('[data-motion]');
  const listeners = new Set();
  function applyMotion() {
    root.classList.toggle('motion-paused', paused);
    if (motionBtn) {
      motionBtn.textContent = paused ? 'PLAY ANIMATIONS' : 'PAUSE ANIMATIONS';
      motionBtn.setAttribute('aria-pressed', String(!paused));
    }
    listeners.forEach(fn => fn(paused));
  }
  motionBtn?.addEventListener('click', () => { paused = !paused; store.set('hw-motion', paused ? 'off' : 'on'); applyMotion(); });
  reduce.addEventListener?.('change', e => { paused = e.matches; applyMotion(); });
  const onMotion = fn => { listeners.add(fn); fn(paused); };

  /* ---------- nav ---------- */
  const hud = $('#hud');
  const onScroll = () => hud.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const toggle = $('.menu-toggle'), menu = $('#mobile-menu');
  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.classList.toggle('is-open', open);
    if (open) hud.classList.add('is-scrolled'); else onScroll();
  }
  toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  menu?.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('is-open')) { setMenu(false); toggle.focus(); } });
  matchMedia('(min-width:1021px)').addEventListener?.('change', e => { if (e.matches) setMenu(false); });

  // active section highlight
  const navLinks = $$('.nav-links a');
  const sections = [$('#top'), ...navLinks.map(a => $(a.getAttribute('href')))].filter(Boolean);
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        navLinks.forEach(a => a.getAttribute('href') === '#' + en.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(s => spy.observe(s));
  }

  /* ---------- reveal on scroll ---------- */
  const revealEls = $$('.reveal, .quest-bar');
  if ('IntersectionObserver' in window && !reduce.matches) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach(el => io.observe(el));
  } else revealEls.forEach(el => el.classList.add('is-in'));

  /* ---------- press feedback (from the original site) ---------- */
  const timers = new WeakMap();
  function flash(e) {
    const c = e.target.closest?.('.btn, .portal');
    if (!c || c.disabled) return;
    clearTimeout(timers.get(c)); c.classList.remove('is-pressed'); void c.offsetWidth; c.classList.add('is-pressed');
    timers.set(c, setTimeout(() => c.classList.remove('is-pressed'), 450));
  }
  document.addEventListener('pointerdown', flash, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') flash(e); });

  /* ---------- launch modal ---------- */
  const modal = $('#launch-modal');
  window.HALLOWINU_openLaunch = () => { if (modal?.showModal) modal.showModal(); };
  modal?.addEventListener('click', e => {
    if (e.target !== modal) return;
    const r = modal.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close();
  });

  /* ---------- sky: stars ---------- */
  const sky = $('[data-stars]');
  if (sky) {
    const frag = document.createDocumentFragment();
    const n = mobileQ.matches ? 26 : 54;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'star' + (Math.random() < .12 ? ' big' : '');
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.pow(Math.random(), 1.4) * 100).toFixed(2) + '%';
      s.style.setProperty('--d', (2.5 + Math.random() * 4).toFixed(2) + 's');
      s.style.setProperty('--delay', (-Math.random() * 6).toFixed(2) + 's');
      frag.append(s);
    }
    sky.append(frag);
  }

  /* ---------- hero: embers + parallax ---------- */
  const embers = $('[data-embers]');
  if (embers && !reduce.matches) {
    const n = mobileQ.matches ? 8 : 16;
    for (let i = 0; i < n; i++) {
      const e = document.createElement('span');
      e.className = 'ember' + (i % 3 === 0 ? ' p' : '');
      e.style.left = (Math.random() * 100).toFixed(1) + '%';
      e.style.setProperty('--t', (8 + Math.random() * 9).toFixed(1) + 's');
      e.style.setProperty('--delay', (-Math.random() * 16).toFixed(1) + 's');
      e.style.setProperty('--dx', ((Math.random() - .5) * 80).toFixed(0) + 'px');
      if (Math.random() < .4) { e.style.width = e.style.height = '3px'; }
      embers.append(e);
    }
  }
  const stage = $('[data-stage]'), hero = $('[data-hero]');
  if (stage && hero && matchMedia('(pointer:fine)').matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, sy = 0;
    hero.closest('.hero').addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - .5) * 2;
      ty = ((e.clientY - r.top) / r.height - .5) * 2;
      loop();
    });
    addEventListener('scroll', () => { sy = Math.min(scrollY, 900); loop(); }, { passive: true });
    function loop() { if (!raf) raf = requestAnimationFrame(step); }
    function step() {
      raf = 0;
      if (paused || mobileQ.matches) { stage.style.transform = ''; return; }
      cx += (tx - cx) * .08; cy += (ty - cy) * .08;
      stage.style.transform = `translate3d(${(-cx * 10).toFixed(2)}px,${(-cy * 6 + sy * .12).toFixed(2)}px,0) scale(1.035)`;
      if (embers) embers.style.transform = `translate3d(${(-cx * 22).toFixed(2)}px,${(-cy * 12).toFixed(2)}px,0)`;
      if (Math.abs(tx - cx) > .002 || Math.abs(ty - cy) > .002) loop();
    }
  }

  /* ---------- sprites ---------- */
  function loadImage(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
  function ticker(fn) {
    let raf = 0, prev = null, running = false;
    function tick(now) { raf = 0; if (!running) return; const dt = prev == null ? 0 : Math.min((now - prev) / 1000, .1); prev = now; fn(dt); raf = requestAnimationFrame(tick); }
    return {
      set(on) { on = on && !document.hidden; if (on === running) return; running = on; prev = null; if (on) raf = requestAnimationFrame(tick); else cancelAnimationFrame(raf); }
    };
  }

  // Talking portrait + typed dialogue (reuses the original talk sprite and slogans)
  const talk = $('[data-talk]'), say = $('[data-say]');
  const lines = ['No tricks. Just treats & bags.', 'The pack is here. Let’s get spooky!', 'Ghost dog. Big Halloween energy.', 'One pack. One spooky season. LFG!', 'Contract address? Coming soon. Stay haunted.'];
  if (talk && say) {
    const ctx = talk.getContext('2d'); ctx.imageSmoothingEnabled = false;
    loadImage('img/shiba-talk.webp').then(img => {
      if (!img) return;
      const fw = img.naturalWidth / 2, fh = img.naturalHeight / 2;
      const draw = f => { ctx.clearRect(0, 0, 160, 160); ctx.drawImage(img, (f % 2) * fw, Math.floor(f / 2) * fh, fw, fh, 0, 4, 160, 160); };
      draw(0);
      let line = 0, chars = say.textContent.length, t = 0, hold = 3.2, mouth = 0, typing = false;
      const seq = [1, 2, 1, 0, 2, 3, 1, 2];
      const tk = ticker(dt => {
        t += dt;
        if (!typing) {
          if (t > hold) { typing = true; t = 0; line = (line + 1) % lines.length; chars = 0; }
          return;
        }
        const target = Math.min(lines[line].length, Math.floor(t * 26));
        if (target !== chars) { chars = target; say.textContent = lines[line].slice(0, chars); }
        mouth += dt; draw(seq[Math.floor(mouth * 9) % seq.length]);
        if (chars >= lines[line].length) { typing = false; t = 0; hold = 3.4; draw(0); }
      });
      const visible = { on: true };
      if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible.on = en.isIntersecting; tk.set(visible.on && !paused); }).observe(talk);
      onMotion(p => { tk.set(!p && visible.on); if (p) { draw(0); say.textContent = lines[0]; } });
      document.addEventListener('visibilitychange', () => tk.set(!paused && visible.on));
    });
  }

  // Bats over the hero world (reuses the original bat sprites)
  if (stage) {
    loadImage('img/bat-sprites.webp').then(sprite => {
      if (!sprite) return;
      const fw = sprite.naturalWidth / 2, fh = sprite.naturalHeight / 2;
      const anchors = [[334, 340], [300, 342], [340, 263], [315, 285]].map(([x, y]) => [x / 627, y / 627]);
      const bats = Array.from({ length: 4 }, (_, i) => {
        const c = document.createElement('canvas'); c.width = c.height = 96; c.className = 'pixel-bat'; c.hidden = true; c.setAttribute('aria-hidden', 'true');
        stage.append(c);
        const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
        return { c, x, next: 1.5 + i * 4 + Math.random() * 3, route: null, size: .022 + Math.random() * .014, seed: Math.random() * 6 };
      });
      let time = 0;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function launch(b) {
        const dir = Math.random() < .5 ? 1 : -1; let h = .12 + Math.random() * .3;
        const pts = Array.from({ length: 7 }, (_, i) => { h = clamp(h + (Math.random() - .5) * .3, .06, .5); const p = i / 6; const x = -.08 + p * 1.16; return { x: dir === 1 ? x : 1 - x, y: h }; });
        b.route = { start: time, dur: 11 + Math.random() * 8, dir, pts };
      }
      const tk = ticker(dt => {
        time += dt;
        const max = mobileQ.matches ? 2 : 3;
        let active = bats.filter(b => b.route).length;
        const w = stage.clientWidth;
        for (const b of bats) {
          if (!b.route && time >= b.next && active < max) { launch(b); active++; }
          if (!b.route) { b.c.hidden = true; continue; }
          const age = time - b.route.start, p = age / b.route.dur;
          if (p >= 1) { b.route = null; b.next = time + 8 + Math.random() * 20; b.c.hidden = true; continue; }
          const n = p * 6, i = Math.min(5, Math.floor(n)), u = n - i, e = u * u * (3 - 2 * u), a = b.route.pts[i], q = b.route.pts[i + 1];
          const x = a.x + (q.x - a.x) * u, y = a.y + (q.y - a.y) * e + Math.sin(age * 1.6 + b.seed) * .01;
          const ang = clamp((q.y - a.y) * e * 60 * b.route.dir, -20, 20), f = Math.floor(time * 8 + b.seed) % 4;
          const size = Math.max(16, b.size * w);
          b.c.hidden = false;
          b.c.style.width = size + 'px'; b.c.style.left = (x * 100) + '%'; b.c.style.top = (y * 100) + '%';
          b.c.style.transform = `translate(-50%,-50%) rotate(${ang}deg) scaleX(${b.route.dir})`;
          b.x.clearRect(0, 0, 96, 96);
          const [ax, ay] = anchors[f];
          b.x.drawImage(sprite, (f % 2) * fw, Math.floor(f / 2) * fh, fw, fh, 48 - ax * 96, 48 - ay * 96, 96, 96);
        }
      });
      let vis = true;
      if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { vis = en.isIntersecting; tk.set(vis && !paused); }).observe(stage);
      onMotion(p => { tk.set(!p && vis); if (p) bats.forEach(b => b.c.hidden = true); });
      document.addEventListener('visibilitychange', () => tk.set(!paused && vis));
    });
  }

  // Footer runner: the ghost dog gallops in, sits, says hi, gallops off (original gallop sprite)
  const runner = $('[data-runner]');
  if (runner) {
    const ctx = runner.getContext('2d'); ctx.imageSmoothingEnabled = false;
    loadImage('img/shiba-gallop.webp').then(img => {
      if (!img) return;
      const fw = img.naturalWidth / 4, fh = img.naturalHeight / 2;
      let t = 0;
      function pose(s) {
        const c = s % 30;
        if (c < 4.2) return { x: 104 - 54 * c / 4.2, f: Math.floor(c * 10) % 4, run: true };
        if (c < 4.8) return { x: 50, f: 4 };
        if (c < 8.8) return { x: 50, f: (c - 4.8) % 2.4 > 2.1 ? 7 : 6 };
        if (c < 9.4) return { x: 50, f: 5 };
        if (c < 13.6) return { x: 50 - 58 * (c - 9.4) / 4.2, f: Math.floor(c * 10) % 4, run: true };
        return null;
      }
      const tk = ticker(dt => {
        t += dt; const p = pose(t);
        runner.hidden = !p; if (!p) return;
        runner.style.left = `calc(${p.x}% - 48px)`;
        runner.style.transform = `translateY(${p.run ? -[0, 2, 5, 1][p.f] : 0}px)`;
        ctx.clearRect(0, 0, 128, 128);
        ctx.drawImage(img, (p.f % 4) * fw, Math.floor(p.f / 4) * fh, fw, fh, 0, p.f >= 4 ? 9 : 0, 128, 128);
      });
      let vis = false;
      if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { vis = en.isIntersecting; tk.set(vis && !paused); }).observe(runner.parentElement);
      onMotion(p => tk.set(!p && vis));
      document.addEventListener('visibilitychange', () => tk.set(!paused && vis));
    });
  }

  /* ---------- trick or treat preview (pure fun, no rewards) ---------- */
  const tot = $('[data-tot]');
  if (tot) {
    const out = $('[data-tot-result]', tot);
    const res = {
      trick: ['TRICK! The pumpkin winked at you. Rude.', 'TRICK! A bat stole your sock. Classic.', 'TRICK! The ghost dog hid behind you. Boo!', 'TRICK! You walked into a cobweb. Spooky.'],
      treat: ['TREAT! The ghost dog wags his tail at you.', 'TREAT! A warm lantern lights your way home.', 'TREAT! +1 spooky vibe. (Not redeemable.)', 'TREAT! The pack welcomes you. Say gm in TG.']
    };
    let last = '';
    tot.addEventListener('click', e => {
      const b = e.target.closest('[data-tot-pick]'); if (!b) return;
      const kind = b.dataset.totPick, list = res[kind];
      let pick; do { pick = list[Math.floor(Math.random() * list.length)]; } while (pick === last && list.length > 1);
      last = pick; out.textContent = pick; out.classList.toggle('is-treat', kind === 'treat');
    });
  }

  applyMotion();
})();
