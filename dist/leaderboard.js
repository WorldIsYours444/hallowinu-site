/* HALLOWINU /leaderboard — read-only views of real server data (Haunt XP + Arcade) and the community reward pool.
   Nothing here is computed from the browser: every number comes from the API. */
(() => {
  const root = document.querySelector('[data-lb]'); if (!root) return;
  const $ = (s, el = root) => el.querySelector(s), $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const RANGES = { haunt: [['today', 'Today'], ['week', 'Week'], ['all', 'All time']], arcade: [['season', 'Season'], ['all', 'All time']] };
  const q = new URLSearchParams(location.search);
  const S = { board: q.get('board') === 'arcade' ? 'arcade' : 'haunt', range: q.get('range') || '', me: null, seq: 0 };
  if (!RANGES[S.board].some(r => r[0] === S.range)) S.range = RANGES[S.board][0][0];

  async function api(path) {
    try { const r = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }); return await r.json(); }
    catch { return { ok: false, message: 'Network error' }; }
  }

  function renderControls() {
    $$('[data-board]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.board === S.board)));
    $('[data-ranges]').innerHTML = RANGES[S.board].map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === S.range}" data-range="${k}">${l}</button>`).join('');
    $('[data-head]').innerHTML = S.board === 'haunt'
      ? '<span class="c-rk">#</span><span class="c-nm">Player</span><span class="c-st">Haunts</span><span class="c-st">Arcade</span><span class="c-xp">XP</span>'
      : `<span class="c-rk">#</span><span class="c-nm">Player</span><span class="c-st">${S.range === 'season' ? 'Prize (est.)' : ''}</span><span class="c-st"></span><span class="c-xp">Points</span>`;
    const u = new URL(location.href); u.searchParams.set('board', S.board); u.searchParams.set('range', S.range);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  const val = r => (S.board === 'haunt' ? r.xp : r.points);
  const unit = () => (S.board === 'haunt' ? 'XP' : 'PTS');
  function stats(r) {
    if (S.board === 'haunt') return `<span class="c-st s1" data-l="Haunts">${fmt(r.haunts)}</span><span class="c-st s2" data-l="Arcade">${fmt(r.arcade)}</span>`;
    const prize = r.prize ? `<b class="pz">◎ ${esc(r.prize.sol)}</b>` : (S.range === 'season' && r.eligible === false ? '<small>not prize-eligible</small>' : '');
    return `<span class="c-st s1" data-l="${S.range === 'season' ? 'Prize' : ''}">${prize}</span><span class="c-st s2"></span>`;
  }
  function row(r) {
    return `<li class="lb-row${r.me ? ' is-me' : ''}${r.rank <= 3 ? ' top' + r.rank : ''}"><span class="c-rk">${r.rank}</span>
      <span class="c-nm"><b>${esc(r.name)}</b>${r.me ? '<em>YOU</em>' : ''}${r.level ? `<small>LV ${r.level}</small>` : ''}</span>${stats(r)}
      <span class="c-xp">${fmt(val(r))} <small>${unit()}</small></span></li>`;
  }
  function podium(rows) {
    const top = rows.slice(0, 3);
    if (!top.length) return '';
    const order = [top[1], top[0], top[2]].filter(Boolean);
    return order.map(r => `<li class="pd pd-${r.rank}${r.me ? ' is-me' : ''}"><span class="pd-crown" aria-hidden="true">${r.rank === 1 ? '♛' : r.rank === 2 ? '✦' : '✧'}</span>
      <span class="pd-rank">#${r.rank}</span><b class="pd-name">${esc(r.name)}</b>${r.me ? '<em>YOU</em>' : ''}
      <span class="pd-val">${fmt(val(r))} <small>${unit()}</small></span><span class="pd-base" aria-hidden="true"></span></li>`).join('');
  }
  function renderMe(d) {
    const box = $('[data-me]');
    const mine = d.rows.find(r => r.me) || d.me;
    if (!S.me) {
      box.hidden = false;
      box.innerHTML = `<span class="me-l">YOUR POSITION</span><span class="me-t">Sign in with Phantom on <a href="/haunt">The Haunt</a> or the <a href="/arcade">Arcade</a> to see your rank here.</span>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = mine
      ? `<span class="me-l">YOUR POSITION</span><b class="me-rank">#${mine.rank}</b><span class="me-t">${esc(mine.name || S.me.displayName || '')}</span><b class="me-val">${fmt(val(mine))} ${unit()}</b>`
      : `<span class="me-l">YOUR POSITION</span><span class="me-t">Not ranked ${S.board === 'haunt' ? (S.range === 'today' ? 'today' : S.range === 'week' ? 'this week' : 'yet') : (S.range === 'season' ? 'this season' : 'yet')}. ${S.board === 'haunt' ? '<a href="/haunt">Submit a haunt</a>' : '<a href="/arcade">Play a game</a>'} to get on the board.</span>`;
  }

  async function load() {
    const seq = ++S.seq;
    renderControls();
    $('[data-list]').innerHTML = '<li class="lb-empty">Loading the graveyard…</li>';
    const d = S.board === 'haunt' ? await api(`/api/haunt/leaderboard?range=${S.range}`) : await api(`/api/leaderboard?scope=${S.range}`);
    if (seq !== S.seq) return;
    if (!d.ok) {
      $('[data-podium]').innerHTML = '';
      $('[data-list]').innerHTML = `<li class="lb-empty">${esc(d.message || 'The leaderboard is offline right now.')}</li>`;
      return;
    }
    const rows = d.rows || [];
    $('[data-podium]').innerHTML = podium(rows);
    $('[data-podium]').hidden = !rows.length;
    $('[data-list]').innerHTML = rows.length ? rows.map(row).join('')
      : `<li class="lb-empty">${S.board === 'haunt' ? 'No haunts ' + (S.range === 'today' ? 'today yet' : S.range === 'week' ? 'this week yet' : 'yet') + '. Be the first ghost on the board.' : 'No points ' + (S.range === 'season' ? 'this season' : '') + ' yet.'}</li>`;
    $('[data-note]').textContent = S.board === 'haunt'
      ? 'Haunt XP: verified X replies, posts, memes and reviewed TikToks. Separate from Arcade Points and the SOL pool. Today/Week reset at 00:00 UTC (week starts Monday).'
      : (d.season ? `${d.season.name}: Top 10 prize-eligible players share the season pool. Estimates change while the season runs.` : 'All-time Arcade Points.');
    renderMe(d);
  }

  async function loadPool() {
    const p = await api('/api/pool'), body = $('[data-pool-body]');
    if (!p.ok) { body.innerHTML = '<p class="lb-empty">Pool data is unavailable right now.</p>'; return; }
    if (p.state !== 'LIVE') {
      body.innerHTML = `<div class="pool-state"><span class="tag ${p.state === 'AWAITING_REWARD_SOURCE' ? '' : 'is-purple'}"><span class="dot blink"></span>${p.state === 'AWAITING_REWARD_SOURCE' ? 'AWAITING REWARD SOURCE' : 'WAITING FOR FIRST MAKER REWARD'}</span>
        <p>${p.state === 'AWAITING_REWARD_SOURCE' ? '$HALLOWINU has not launched yet, so no maker rewards exist. The pool fills automatically once real rewards are received on-chain.' : 'The reward source is connected. The first verified maker reward will appear here automatically.'}</p></div>`;
      return;
    }
    const t = p.totals;
    body.innerHTML = `<dl class="pool-stats">
        <div><dt>Season pool now</dt><dd>◎ ${esc(p.season ? p.season.poolSol : '0')}</dd></div>
        <div><dt>Community share received (80%)</dt><dd>◎ ${esc(t.communitySol)}</dd></div>
        <div><dt>Paid out to winners</dt><dd>◎ ${esc(t.distributedSol)}</dd></div>
        <div><dt>Verified reward events</dt><dd>${fmt(t.events)}</dd></div>
      </dl>
      ${p.recent.length ? `<ul class="pool-recent">${p.recent.slice(0, 5).map(r => `<li><span>+ ◎ ${esc(r.communitySol)} <small>${new Date(r.at).toLocaleDateString()}</small></span><a href="https://solscan.io/tx/${encodeURIComponent(r.signature)}" target="_blank" rel="noopener noreferrer">tx ›</a></li>`).join('')}</ul>` : ''}`;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-board]');
    if (b && b.dataset.board !== S.board) { S.board = b.dataset.board; S.range = RANGES[S.board][0][0]; load(); return; }
    const r = e.target.closest('[data-range]');
    if (r && r.dataset.range !== S.range) { S.range = r.dataset.range; load(); }
  });

  (async () => {
    const me = await api('/api/me');
    S.me = me && me.ok && me.player && me.player.displayName ? me.player : null;
    await Promise.all([load(), loadPool()]);
  })();
})();
