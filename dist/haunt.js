/* THE HAUNT — client. Presentation only: the server verifies every haunt on X and decides every reward. */
(() => {
  const root = document.querySelector('[data-haunt]');
  if (!root) return;
  const W = window.HW_WALLET;
  const SITE = window.HALLOWINU_SITE || { links: {} };
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="px-icon" shape-rendering="crispEdges" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const sicon = n => `<svg class="soc-ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = { offset: 0, data: null, picked: null, range: 'today', busy: false, pendingPoll: null };
  const serverNow = () => Date.now() + S.offset;

  function clock(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = v => String(v).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
  }
  const ago = ts => { const s = Math.max(0, Math.round((serverNow() - ts) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

  async function api(method, path, body) {
    const o = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (method !== 'GET') { o.headers['content-type'] = 'application/json'; o.headers['x-hw-client'] = '1'; o.body = JSON.stringify(body || {}); }
    let r; try { r = await fetch(path, o); } catch { return { ok: false, error: 'NETWORK', message: 'The ghosts ate the connection. Try again.' }; }
    let d; try { d = await r.json(); } catch { d = { ok: false, error: 'NETWORK', message: 'Connection problem. Try again.' }; }
    if (d.serverNow) S.offset = d.serverNow - Date.now();
    d.status = r.status; return d;
  }

  const toasts = $('[data-toasts]');
  function toast(title, text, ico = 'ghost', bad = false) {
    const el = document.createElement('div'); el.className = 'ax-toast' + (bad ? ' p' : '');
    el.innerHTML = `<span class="ico">${icon(ico)}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
    toasts.append(el); setTimeout(() => el.remove(), 4800);
  }

  /* ---------- load + render ---------- */
  async function load() {
    const d = await api('GET', '/api/haunt');
    if (!d.ok) { $('[data-targets]').innerHTML = `<p class="hn-empty">${esc(d.message || 'THE HAUNT is waking up. Check back soon.')}</p>`; return; }
    S.data = d;
    if (S.picked && !d.targets.some(t => t.id === S.picked)) S.picked = null;
    renderHud(); renderGate(); renderTargets(); renderPicked(); renderMine();
    const r = d.rules; const fl = $('[data-faq-limits]');
    if (fl) fl.textContent = `Up to ${r.window} rewarded haunts per ${r.windowMinutes} minutes, at least ${r.minGapMinutes} minutes apart, ${r.perDay} per day (resets 00:00 UTC), one per Haunt.`;
  }

  function renderHud() {
    const me = S.data.me, r = S.data.rules;
    const set = (k, v) => { const el = $(`[data-s="${k}"]`); if (el) el.textContent = v; };
    set('windowLabel', `${r.windowMinutes} MIN WINDOW`);
    if (!me) { ['xp', 'rank', 'haunts', 'today', 'window'].forEach(k => set(k, '—')); $('[data-s="state"]').innerHTML = '<i class="dot"></i>SIGN IN'; set('next', ''); return; }
    set('xp', fmt(me.xp)); set('rank', me.rank ? '#' + fmt(me.rank) : '—'); set('haunts', fmt(me.haunts));
    set('today', `${me.today.used} / ${me.today.limit}`); set('window', `${me.window.used} / ${me.window.limit}`);
    tick();
  }
  function stateNow() {
    const me = S.data && S.data.me; if (!me) return null;
    if (me.nextAt && me.nextAt > serverNow()) return me.state === 'DAILY_LIMIT' ? 'DAILY_LIMIT' : 'COOLDOWN';
    return 'ACTIVE';
  }
  function tick() {
    const me = S.data && S.data.me; if (!me) return;
    const st = stateNow(), el = $('[data-s="state"]'), nx = $('[data-s="next"]');
    const hud = $('[data-hud]');
    hud.dataset.state = st;
    el.innerHTML = `<i class="dot ${st === 'ACTIVE' ? 'blink' : ''}"></i>${st === 'ACTIVE' ? 'ACTIVE' : st === 'COOLDOWN' ? 'COOLDOWN' : 'DAILY LIMIT'}`;
    nx.textContent = st === 'ACTIVE' ? 'READY TO HAUNT' : `NEXT HAUNT IN ${clock(me.nextAt - serverNow())}`;
    if (st === 'ACTIVE' && me.state !== 'ACTIVE' && me.nextAt && me.nextAt <= serverNow()) { me.state = 'ACTIVE'; me.nextAt = null; renderPicked(); }
    $$('[data-exp]').forEach(e => { const at = Number(e.dataset.exp); e.textContent = at - serverNow() > 0 ? clock(at - serverNow()) : 'EXPIRED'; });
  }
  setInterval(tick, 1000);

  function renderGate() {
    const g = $('[data-gate]'), d = S.data, a = d.access || {};
    let html = '';
    if (!d.available) {
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${icon('moon')}</span><div><b>THE HAUNT OPENS SOON</b><p>X verification is being switched on. Targets, limits and the leaderboard are ready — the first Haunts drop very soon.</p></div>
        <div class="hn-gate-acts"><a class="btn btn-orange btn-sm" href="${esc(SITE.links.x)}" target="_blank" rel="noopener noreferrer">${sicon('x')}X / Twitter</a><a class="btn btn-purple btn-sm" href="${esc(SITE.links.telegram)}" target="_blank" rel="noopener noreferrer">${sicon('tg')}Telegram</a></div></div>`;
    } else if (!a.walletVerified) {
      const p = W.phantom();
      const btn = p ? `<button class="btn btn-primary btn-sm" type="button" data-connect>${icon('ghost')}Connect Phantom</button>`
        : W.isMobile ? `<a class="btn btn-primary btn-sm" href="${esc(W.browseUrl('/haunt'))}">${icon('ghost')}Open in Phantom</a>`
          : `<a class="btn btn-primary btn-sm" href="https://phantom.app/download" target="_blank" rel="noopener noreferrer">${icon('ghost')}Install Phantom</a>`;
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${icon('ghost')}</span><div><b>STEP 1 · SIGN IN WITH PHANTOM</b><p>Sign one message to prove your wallet — free, never a transaction. We never ask for your seed phrase.</p></div><div class="hn-gate-acts">${btn}</div></div>`;
    } else if (!a.profileComplete) {
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${icon('trophy')}</span><div><b>STEP 2 · CHOOSE YOUR PLAYER NAME</b><p>Finish your player card in the Arcade, then come back to haunt.</p></div><div class="hn-gate-acts"><a class="btn btn-primary btn-sm" href="/arcade">Go to the Arcade</a></div></div>`;
    } else if (!d.me.x.connected) {
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${sicon('x')}</span><div><b>STEP 3 · CONNECT YOUR X ACCOUNT</b><p>HALLOWINU needs to know which X account is yours, so nobody can claim your replies. Read-only, no posting.</p></div><div class="hn-gate-acts"><a class="btn btn-orange btn-sm" href="/api/socials/x/start?return=haunt">${sicon('x')}Connect X</a></div></div>`;
    }
    g.hidden = !html; g.innerHTML = html;
    root.classList.toggle('is-locked', !!html);
    const who = d.me && d.me.x.connected ? `<span class="hn-who">${sicon('x')}@${esc(d.me.x.username || 'connected')}</span>` : '';
    $('[data-hud]').dataset.who = d.me && d.me.x.connected ? d.me.x.username || '' : '';
    const old = $('.hn-who'); if (old) old.remove();
    if (who) $('[data-hud]').insertAdjacentHTML('beforeend', who);
  }

  function renderTargets() {
    const list = $('[data-targets]'), ts = S.data.targets;
    $('[data-target-count]').textContent = `${ts.length} OPEN`;
    if (!ts.length) { list.innerHTML = `<div class="hn-empty-card">${icon('moon')}<b>NO HAUNTS RIGHT NOW</b><p>New targets drop throughout the day. Keep this page open — it refreshes by itself.</p></div>`; return; }
    list.innerHTML = ts.map(t => {
      const done = t.mine === 'AUTO_APPROVED', queued = t.mine && !done;
      const state = done ? '<span class="tag is-green">✓ HAUNTED</span>' : queued ? '<span class="tag">VERIFYING</span>' : t.full ? '<span class="tag is-dim">FULL</span>' : '<span class="tag is-purple">OPEN</span>';
      return `<article class="hn-card ${done ? 'is-done' : ''} ${t.full ? 'is-full' : ''} ${S.picked === t.id ? 'is-picked' : ''}" data-tid="${t.id}">
        <div class="hn-card-top"><b class="hn-num">HAUNT #${t.id}</b>${state}</div>
        <div class="hn-card-who"><span class="sv-ico">${sicon('x')}</span><div><b>@${esc(t.author || 'unknown')}</b><small>${esc(t.category)}</small></div></div>
        ${t.preview ? `<p class="hn-preview">${esc(t.preview)}</p>` : ''}
        <dl class="hn-meta"><div><dt>REWARD</dt><dd class="xp">+${fmt(t.reward)} XP</dd></div><div><dt>EXPIRES</dt><dd data-exp="${t.expiresAt || ''}">${t.expiresAt ? '' : 'NO LIMIT'}</dd></div><div><dt>CLAIMS</dt><dd>${fmt(t.claims)}${t.maxClaims ? ' / ' + fmt(t.maxClaims) : ''}</dd></div></dl>
        <div class="hn-card-acts">
          <a class="btn btn-orange btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-open-x="${t.id}">${sicon('x')}Open on X</a>
          <button class="btn btn-purple btn-sm" type="button" data-pick="${t.id}" ${done || t.full ? 'disabled' : ''}>${done ? 'Done' : 'I replied →'}</button>
        </div>
      </article>`;
    }).join('');
    tick();
  }

  function renderPicked() {
    const box = $('[data-picked]'), t = S.data && S.data.targets.find(x => x.id === S.picked);
    const st = stateNow();
    const btn = $('[data-claim]'), input = $('#hn-url');
    const locked = !S.data || !S.data.available || !S.data.me || !S.data.me.x.connected;
    input.disabled = locked; btn.disabled = locked || S.busy || !t || st !== 'ACTIVE';
    if (!t) { box.innerHTML = '<span class="tag is-dim">NO HAUNT SELECTED</span><small>Pick a Haunt with “I replied →”.</small>'; return; }
    box.innerHTML = `<span class="tag">HAUNT #${t.id}</span><small>@${esc(t.author || '')} · +${fmt(t.reward)} XP</small><button class="ax-link" type="button" data-unpick>change</button>`;
    if (st !== 'ACTIVE' && S.data.me) box.insertAdjacentHTML('beforeend', `<small class="hn-wait">${st === 'DAILY_LIMIT' ? 'Daily limit reached' : 'Cooldown active'} — see status above.</small>`);
  }

  function renderMine() {
    const box = $('[data-mine-box]'), ul = $('[data-mine]'), me = S.data.me;
    if (!me || !me.submissions.length) { box.hidden = true; return; }
    box.hidden = false;
    ul.innerHTML = me.submissions.map(s => `<li class="${s.status === 'AUTO_APPROVED' ? 'ok' : s.status === 'AUTO_REJECTED' || s.status === 'INVALIDATED' ? 'bad' : 'wait'}">
      <span>${s.status === 'AUTO_APPROVED' ? '👻' : s.status === 'AUTO_REJECTED' || s.status === 'INVALIDATED' ? '✕' : '…'} HAUNT #${s.targetId}<small>${esc(s.status === 'AUTO_APPROVED' ? 'approved' : s.message || s.status.replace('_', ' ').toLowerCase())}</small></span>
      <b>${s.points ? '+' + fmt(s.points) + ' XP' : ''}</b></li>`).join('');
  }

  /* ---------- submit terminal ---------- */
  const log = $('[data-log]'), result = $('[data-result]');
  const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
  function line(text, cls = '') { const li = document.createElement('li'); li.className = cls; li.textContent = text; log.append(li); return li; }

  async function submit(e) {
    e.preventDefault();
    if (S.busy) return;
    const url = $('#hn-url').value.trim();
    if (!S.picked) { toast('PICK A HAUNT', 'Choose the Haunt you replied to first.', 'ghost', true); return; }
    if (!/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/.+\/status(es)?\/\d+/i.test(url)) { result.hidden = false; result.className = 'hn-result bad'; result.innerHTML = '<b>THAT IS NOT AN X POST LINK</b><p>On X: tap Share on your reply → Copy link.</p>'; return; }
    S.busy = true; renderPicked(); log.innerHTML = ''; result.hidden = true;
    const head = line('VERIFYING ON X', 'run');
    const req = api('POST', '/api/haunt/submit', { url, targetId: S.picked });
    let dots = 0; const anim = setInterval(() => { head.textContent = 'VERIFYING ON X' + '.'.repeat(++dots % 4); }, 300);
    const r = await req; clearInterval(anim);
    head.textContent = 'VERIFYING ON X…'; head.className = 'done';
    if (!r.ok) {
      line(r.message ? r.message.toUpperCase() : 'SOMETHING WENT WRONG', 'fail');
      if (r.error === 'COOLDOWN' || r.error === 'DAILY_LIMIT') { S.data.me.state = r.error; S.data.me.nextAt = r.nextAt; tick(); }
      showResult('bad', r.error === 'COOLDOWN' ? 'COOLDOWN' : r.error === 'DAILY_LIMIT' ? 'DAILY LIMIT REACHED' : 'NOT CLAIMED', r.message || 'Try again.');
    } else {
      const s = r.submission;
      for (const c of s.checks) { await wait(140); line(`${c.label.toUpperCase()}…`, c.ok ? 'ok' : 'fail'); }
      await wait(200);
      if (s.status === 'AUTO_APPROVED') { showResult('good', 'APPROVED 👻', `+${fmt(s.points)} XP · HAUNT #${s.targetId}`); $('#hn-url').value = ''; S.picked = null; burst(); }
      else if (s.status === 'AUTO_REJECTED') showResult('bad', 'REJECTED', s.message || s.reason);
      else { showResult('wait', 'QUEUED FOR VERIFICATION', s.message || 'We will check it automatically.'); pollPending(s.id); }
      if (r.duplicateOf) line('ALREADY SUBMITTED — SHOWING THE EXISTING RESULT', 'done');
    }
    S.busy = false;
    await load(); loadBoard(); loadFeed();
  }
  function showResult(kind, title, text) { result.hidden = false; result.className = `hn-result ${kind}`; result.innerHTML = `<b>${esc(title)}</b><p>${esc(text)}</p>`; }
  function burst() {
    if (reduce) return;
    const b = document.createElement('div'); b.className = 'burst';
    for (let i = 0; i < 14; i++) { const a = Math.PI * 2 * i / 14, d = 60 + Math.random() * 40, s = document.createElement('i'); s.style.setProperty('--x', `${Math.cos(a) * d}px`); s.style.setProperty('--y', `${Math.sin(a) * d}px`); s.style.setProperty('--c', i % 2 ? '#ffc44d' : '#c45cff'); b.append(s); }
    result.append(b); setTimeout(() => b.remove(), 900);
  }
  function pollPending(id) {
    clearInterval(S.pendingPoll);
    S.pendingPoll = setInterval(async () => {
      const r = await api('GET', `/api/haunt/submissions/${id}`);
      if (!r.ok) return;
      const s = r.submission;
      if (s.status === 'AUTO_APPROVED') { clearInterval(S.pendingPoll); toast('HAUNT APPROVED', `+${s.points} XP · HAUNT #${s.targetId}`); load(); loadBoard(); }
      else if (s.status === 'AUTO_REJECTED' || s.status === 'MANUAL_REVIEW') { clearInterval(S.pendingPoll); toast(s.status === 'MANUAL_REVIEW' ? 'SENT TO REVIEW' : 'HAUNT REJECTED', s.message || '', 'skull', true); load(); }
    }, 30000);
  }

  /* ---------- leaderboard + feed ---------- */
  async function loadBoard() {
    const r = await api('GET', `/api/haunt/leaderboard?range=${S.range}`), tb = $('[data-board]');
    if (!r.ok) { tb.innerHTML = `<tr><td colspan="4" class="ax-empty">${esc(r.message || 'Could not load.')}</td></tr>`; return; }
    tb.innerHTML = r.rows.length ? r.rows.map(x => `<tr class="${x.me ? 'me ' : ''}${x.rank <= 3 ? 'top' : ''}"><td class="rk">#${x.rank}</td><td class="nm">${esc(x.name)}</td><td class="r">${fmt(x.haunts)}</td><td class="r pts">${fmt(x.xp)}</td></tr>`).join('')
      : `<tr><td colspan="4" class="ax-empty">No haunts ${S.range === 'today' ? 'today' : S.range === 'week' ? 'this week' : 'yet'}. Be the first ghost on the board.</td></tr>`;
  }
  async function loadFeed() {
    const r = await api('GET', '/api/haunt/activity'), ul = $('[data-feed]');
    if (!r.ok) return;
    ul.innerHTML = r.items.length ? r.items.map(i => `<li class="ok"><span>👻 <b>${esc(i.name)}</b> haunted #${i.targetId}<small>${ago(i.at)}</small></span><b>+${fmt(i.xp)} XP</b></li>`).join('') : '<li class="hn-empty">Quiet in the graveyard… for now.</li>';
  }

  /* ---------- events ---------- */
  $('[data-form]').addEventListener('submit', submit);
  root.addEventListener('click', async e => {
    const t = e.target;
    const pick = t.closest('[data-pick]');
    if (pick) { S.picked = Number(pick.dataset.pick); renderTargets(); renderPicked(); $('[data-submit]').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => $('#hn-url').focus({ preventScroll: true }), 350); return; }
    const ox = t.closest('[data-open-x]'); if (ox) { S.picked = Number(ox.dataset.openX); renderTargets(); renderPicked(); return; }
    if (t.closest('[data-unpick]')) { S.picked = null; renderTargets(); renderPicked(); return; }
    const rg = t.closest('[data-range]');
    if (rg) { S.range = rg.dataset.range; $$('[data-range]').forEach(b => b.setAttribute('aria-selected', String(b === rg))); loadBoard(); return; }
    if (t.closest('[data-connect]')) {
      const btn = t.closest('[data-connect]'); btn.disabled = true; btn.textContent = 'CHECK PHANTOM…';
      const r = await W.signIn();
      if (!r.ok) toast('NOT SIGNED IN', r.message || 'Try again.', 'skull', true);
      else toast(r.created ? 'WALLET VERIFIED' : 'WELCOME BACK', r.player ? `Signed in as ${r.player.displayName}.` : 'Choose your player name next.');
      await load(); loadBoard();
    }
  });
  (function handleReturn() {
    const q = new URLSearchParams(location.search);
    if (q.get('social') !== 'x') return;
    const st = q.get('status');
    const map = { connected: ['X CONNECTED', 'Your X account is linked. Happy haunting!', false], verified: ['X CONNECTED', 'Your X account is linked.', false], identity_in_use: ['ACCOUNT ALREADY LINKED', 'This X account belongs to another player.', true], denied: ['X LOGIN CANCELLED', 'Connecting X needs your permission.', true], session: ['SIGN IN FIRST', 'Sign in with Phantom, then connect X.', true], x_not_configured: ['X SOON', 'X connection is not switched on yet.', true] };
    const [a, b, bad] = map[st] || ['X NOT CONNECTED', 'Something went wrong. Try again.', true];
    setTimeout(() => toast(a, b, bad ? 'skull' : 'ghost', bad), 500);
    history.replaceState(null, '', location.pathname);
  })();

  load().then(() => { loadBoard(); loadFeed(); });
  setInterval(() => { if (!document.hidden && !S.busy && !root.contains(document.activeElement)) load(); }, 60000);
  setInterval(() => { if (!document.hidden) loadFeed(); }, 30000);
})();
