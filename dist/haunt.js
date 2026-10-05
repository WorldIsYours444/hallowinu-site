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
  const S = { offset: 0, data: null, picked: null, type: 'X_REPLY', busy: false, pendingPoll: null };
  const APPROVED = ['AUTO_APPROVED', 'MANUAL_APPROVED'], REJECTED = ['AUTO_REJECTED', 'MANUAL_REJECTED', 'INVALIDATED'];
  const TYPE_UI = {
    X_REPLY: { platform: 'X', help: 'Completed the raid? Pick the Haunt, then paste the link of <b>your</b> X reply.', ph: 'https://x.com/you/status/…', label: 'Your X reply URL', re: /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/.+\/status(es)?\/\d+/i, bad: 'On X: tap Share on your reply → Copy link.' },
    X_POST: { platform: 'X', help: 'Post about $HALLOWINU on X in your own words — mention <b>HALLOWINU</b>, <b>$HALLOWINU</b> or <b>@HIonchains</b> — then paste the link.', ph: 'https://x.com/you/status/…', label: 'Your X post URL', re: /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/.+\/status(es)?\/\d+/i, bad: 'On X: tap Share on your post → Copy link.' },
    X_MEME: { platform: 'X', help: 'Post a HALLOWINU meme or generated image on X (image, GIF or video + mention HALLOWINU), then paste the link.', ph: 'https://x.com/you/status/…', label: 'Your X meme post URL', re: /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/.+\/status(es)?\/\d+/i, bad: 'On X: tap Share on your meme post → Copy link.' },
    TIKTOK_POST: { platform: 'TIKTOK', help: 'Post a HALLOWINU TikTok with <b>#hallowinu</b> in the caption, then paste the full link. The team confirms it is your account before the XP is added.', ph: 'https://www.tiktok.com/@you/video/…', label: 'Your TikTok video URL', re: /^https?:\/\/((www|m)\.)?tiktok\.com\/@[\w.]+\/(video|photo)\/\d+/i, bad: 'Open TikTok → Share → Copy link, open it once and paste the full tiktok.com/@you/video/… link.' },
  };
  const typeLabel = t => (S.data && S.data.rules.types && S.data.rules.types[t] ? S.data.rules.types[t].label : t.replace('_', ' '));
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
    renderHud(); renderGate(); renderTargets(); renderTypes(); renderPicked(); renderMine();
    const r = d.rules; const fl = $('[data-faq-limits]');
    const T = r.types || {};
    if (fl) fl.textContent = `Up to ${r.window} rewarded haunts per ${r.windowMinutes} minutes, at least ${r.minGapMinutes} minutes apart, ${r.perDay} per day in total (resets 00:00 UTC), one per Haunt.` + (T.X_POST ? ` Per type per day: X reply ${T.X_REPLY.perDay}, X post ${T.X_POST.perDay}, X meme ${T.X_MEME.perDay}, TikTok ${T.TIKTOK_POST.perDay}.` : '');
    const fr = $('[data-faq-rewards]');
    if (fr && T.X_POST) fr.textContent = `X reply: the Haunt's reward · X post: ${T.X_POST.reward} XP · X meme: ${T.X_MEME.reward} XP · TikTok: ${T.TIKTOK_POST.reward} XP (after review). The server decides every reward — the browser never can.`;
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
    if (!d.available && a.profileComplete) {
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${icon('moon')}</span><div><b>X HAUNTS OPEN SOON</b><p>X verification is being switched on. TikTok haunts already work — pick TIKTOK in the terminal.</p></div>
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
      html = `<div class="hn-gate-row"><span class="hn-gate-ico">${sicon('x')}</span><div><b>STEP 3 · CONNECT YOUR X ACCOUNT</b><p>Needed for X replies, posts and memes, so nobody can claim your posts. Read-only, no posting. TikTok haunts work without X.</p></div><div class="hn-gate-acts"><a class="btn btn-orange btn-sm" href="/api/socials/x/start?return=haunt">${sicon('x')}Connect X</a></div></div>`;
    }
    g.hidden = !html; g.innerHTML = html;
    root.classList.toggle('is-locked', !!html && !(d.me && a.profileComplete));
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
      const done = APPROVED.includes(t.mine), queued = t.mine && !done;
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

  function typeLocked(type) {
    const d = S.data; if (!d || !d.me) return true;
    return TYPE_UI[type].platform === 'X' && (!d.available || !d.me.x.connected);
  }
  function renderTypes() {
    const d = S.data, T = d && d.rules.types; if (!T) return;
    $$('[data-type]').forEach(b => {
      const k = b.dataset.type, me = d.me && d.me.types && d.me.types[k];
      b.setAttribute('aria-checked', String(k === S.type));
      b.classList.toggle('is-off', typeLocked(k));
      const meta = $(`[data-type-meta="${k}"]`);
      if (meta) meta.textContent = `${T[k].reward ? '+' + T[k].reward + ' XP' : 'Haunt XP'} · ${me ? me.used + '/' + me.limit : T[k].perDay + '/day'}`;
    });
    const u = TYPE_UI[S.type];
    $('[data-type-help]').innerHTML = u.help;
    $('#hn-url').placeholder = u.ph; $('[data-url-label]').textContent = u.label;
  }
  function renderPicked() {
    const box = $('[data-picked]'), t = S.data && S.data.targets.find(x => x.id === S.picked);
    const st = stateNow(), reply = S.type === 'X_REPLY';
    const btn = $('[data-claim]'), input = $('#hn-url');
    const locked = !S.data || typeLocked(S.type);
    const meT = S.data && S.data.me && S.data.me.types && S.data.me.types[S.type];
    const typeFull = meT && meT.used >= meT.limit;
    input.disabled = locked; btn.disabled = locked || S.busy || (reply && !t) || st !== 'ACTIVE' || typeFull;
    box.hidden = !reply && !typeFull && st === 'ACTIVE';
    if (!reply) {
      box.innerHTML = typeFull ? `<span class="tag is-dim">${esc(typeLabel(S.type))} LIMIT REACHED</span><small>Try another type or come back after 00:00 UTC.</small>`
        : st !== 'ACTIVE' && S.data && S.data.me ? `<small class="hn-wait">${st === 'DAILY_LIMIT' ? 'Daily limit reached' : 'Cooldown active'} — see status above.</small>` : '';
      return;
    }
    if (!t) { box.innerHTML = '<span class="tag is-dim">NO HAUNT SELECTED</span><small>Pick a Haunt with “I replied →”.</small>'; return; }
    box.innerHTML = `<span class="tag">HAUNT #${t.id}</span><small>@${esc(t.author || '')} · +${fmt(t.reward)} XP</small><button class="ax-link" type="button" data-unpick>change</button>`;
    if (st !== 'ACTIVE' && S.data.me) box.insertAdjacentHTML('beforeend', `<small class="hn-wait">${st === 'DAILY_LIMIT' ? 'Daily limit reached' : 'Cooldown active'} — see status above.</small>`);
  }

  function renderMine() {
    const box = $('[data-mine-box]'), ul = $('[data-mine]'), me = S.data.me;
    if (!me || !me.submissions.length) { box.hidden = true; return; }
    box.hidden = false;
    ul.innerHTML = me.submissions.map(s => {
      const ok = APPROVED.includes(s.status), bad = REJECTED.includes(s.status), review = s.status === 'MANUAL_REVIEW';
      const what = s.type === 'X_REPLY' || !s.type ? `HAUNT #${s.targetId}` : esc(s.typeLabel || typeLabel(s.type));
      const note = ok ? (s.status === 'MANUAL_APPROVED' ? 'approved by the team' : 'approved') : review ? 'in review' : s.message || s.status.replace(/_/g, ' ').toLowerCase();
      return `<li class="${ok ? 'ok' : bad ? 'bad' : 'wait'}"><span><i class="hn-type t-${esc((s.type || 'X_REPLY').toLowerCase())}">${esc(s.typeLabel || typeLabel(s.type || 'X_REPLY'))}</i> ${ok ? '👻' : bad ? '✕' : '…'} ${what}<small>${esc(note)}</small></span>
      <b>${s.points ? '+' + fmt(s.points) + ' XP' : ''}</b></li>`;
    }).join('');
  }

  /* ---------- submit terminal ---------- */
  const log = $('[data-log]'), result = $('[data-result]');
  const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
  function line(text, cls = '') { const li = document.createElement('li'); li.className = cls; li.textContent = text; log.append(li); return li; }

  async function submit(e) {
    e.preventDefault();
    if (S.busy) return;
    const url = $('#hn-url').value.trim(), type = S.type, u = TYPE_UI[type];
    if (type === 'X_REPLY' && !S.picked) { toast('PICK A HAUNT', 'Choose the Haunt you replied to first.', 'ghost', true); return; }
    if (!u.re.test(url)) {
      const other = Object.entries(TYPE_UI).find(([k, v]) => v.platform !== u.platform && v.re.test(url));
      result.hidden = false; result.className = 'hn-result bad';
      result.innerHTML = other ? `<b>WRONG PLATFORM</b><p>That is a ${other[1].platform === 'X' ? 'X' : 'TikTok'} link. Pick ${other[1].platform === 'X' ? 'an X type' : 'TIKTOK'} above, or paste your ${u.platform === 'X' ? 'X' : 'TikTok'} link.</p>`
        : `<b>THAT IS NOT ${u.platform === 'X' ? 'AN X POST' : 'A TIKTOK VIDEO'} LINK</b><p>${esc(u.bad)}</p>`;
      return;
    }
    S.busy = true; renderPicked(); log.innerHTML = ''; result.hidden = true;
    const where = u.platform === 'X' ? 'ON X' : 'ON TIKTOK';
    const head = line('VERIFYING ' + where, 'run');
    const req = api('POST', '/api/haunt/submit', type === 'X_REPLY' ? { type, url, targetId: S.picked } : { type, url });
    let dots = 0; const anim = setInterval(() => { head.textContent = 'VERIFYING ' + where + '.'.repeat(++dots % 4); }, 300);
    const r = await req; clearInterval(anim);
    head.textContent = 'VERIFYING ' + where + '…'; head.className = 'done';
    if (!r.ok) {
      line(r.message ? r.message.toUpperCase() : 'SOMETHING WENT WRONG', 'fail');
      if (r.error === 'COOLDOWN' || r.error === 'DAILY_LIMIT') { S.data.me.state = r.error; S.data.me.nextAt = r.nextAt; tick(); }
      showResult('bad', r.error === 'COOLDOWN' ? 'COOLDOWN' : r.error === 'DAILY_LIMIT' ? 'DAILY LIMIT REACHED' : r.error === 'TYPE_DAILY_LIMIT' ? 'TYPE LIMIT REACHED' : r.error === 'WRONG_PLATFORM' ? 'WRONG PLATFORM' : 'NOT CLAIMED', r.message || 'Try again.');
    } else {
      const s = r.submission;
      for (const c of s.checks) { await wait(140); line(`${c.label.toUpperCase()}…`, c.ok ? 'ok' : c.ok === null ? 'run' : 'fail'); }
      await wait(200);
      const what = s.type === 'X_REPLY' ? `HAUNT #${s.targetId}` : (s.typeLabel || typeLabel(s.type));
      if (APPROVED.includes(s.status)) { showResult('good', 'APPROVED 👻', `+${fmt(s.points)} XP · ${what}`); $('#hn-url').value = ''; S.picked = null; burst(); }
      else if (REJECTED.includes(s.status)) showResult('bad', 'REJECTED', s.message || s.reason);
      else if (s.status === 'MANUAL_REVIEW') { showResult('wait', 'IN REVIEW 🔍', s.message || 'The team checks it and adds the XP.'); $('#hn-url').value = ''; }
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
      if (APPROVED.includes(s.status)) { clearInterval(S.pendingPoll); toast('HAUNT APPROVED', `+${s.points} XP · ${s.type === 'X_REPLY' ? 'HAUNT #' + s.targetId : s.typeLabel}`); load(); loadBoard(); }
      else if (REJECTED.includes(s.status) || s.status === 'MANUAL_REVIEW') { clearInterval(S.pendingPoll); toast(s.status === 'MANUAL_REVIEW' ? 'SENT TO REVIEW' : 'HAUNT REJECTED', s.message || '', 'skull', true); load(); }
    }, 30000);
  }

  /* ---------- leaderboard + feed ---------- */
  /* compact rank preview — the full board lives on /leaderboard */
  async function loadBoard() {
    const r = await api('GET', '/api/haunt/leaderboard?range=today&size=3'), ol = $('[data-board]'), mine = $('[data-myrank]');
    if (!r.ok) { ol.innerHTML = `<li class="hn-empty">${esc(r.message || 'Could not load.')}</li>`; return; }
    ol.innerHTML = r.rows.length ? r.rows.map(x => `<li class="${x.me ? 'me ' : ''}top${x.rank}"><span class="rk">#${x.rank}</span><b>${esc(x.name)}</b>${x.me ? '<em>YOU</em>' : ''}<span class="xp">${fmt(x.xp)} XP</span></li>`).join('')
      : '<li class="hn-empty">No haunts today yet. Be the first ghost on the board.</li>';
    const me = S.data && S.data.me, row = r.rows.find(x => x.me) || r.me;
    mine.innerHTML = !me ? '<span>Sign in to see your rank.</span>'
      : row ? `<span>YOUR RANK TODAY</span><b>#${fmt(row.rank)}</b><small>${fmt(row.xp)} XP</small>${me.rank ? `<span class="hn-all">ALL TIME #${fmt(me.rank)}</span>` : ''}`
        : `<span>Not ranked today yet.</span>${me.rank ? `<span class="hn-all">ALL TIME #${fmt(me.rank)}</span>` : ''}`;
  }
  async function loadFeed() {
    const r = await api('GET', '/api/haunt/activity'), ul = $('[data-feed]');
    if (!r.ok) return;
    const verb = i => ({ X_POST: 'posted on X', X_MEME: 'dropped a meme', TIKTOK_POST: 'posted a TikTok' })[i.type] || `haunted #${i.targetId}`;
    ul.innerHTML = r.items.length ? r.items.map(i => `<li class="ok"><span><i class="hn-type t-${esc((i.type || 'X_REPLY').toLowerCase())}">${esc(i.typeLabel || 'X REPLY')}</i> <b>${esc(i.name)}</b> ${verb(i)}<small>${ago(i.at)}</small></span><b>+${fmt(i.xp)} XP</b></li>`).join('') : '<li class="hn-empty">Quiet in the graveyard… for now.</li>';
  }

  /* ---------- events ---------- */
  $('[data-form]').addEventListener('submit', submit);
  root.addEventListener('click', async e => {
    const t = e.target;
    const ty = t.closest('[data-type]');
    if (ty) { S.type = ty.dataset.type; result.hidden = true; renderTypes(); renderPicked(); return; }
    const pick = t.closest('[data-pick]');
    if (pick) { S.type = 'X_REPLY'; renderTypes(); S.picked = Number(pick.dataset.pick); renderTargets(); renderPicked(); $('[data-submit]').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => $('#hn-url').focus({ preventScroll: true }), 350); return; }
    const ox = t.closest('[data-open-x]'); if (ox) { S.picked = Number(ox.dataset.openX); renderTargets(); renderPicked(); return; }
    if (t.closest('[data-unpick]')) { S.picked = null; renderTargets(); renderPicked(); return; }
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
