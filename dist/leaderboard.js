/* HALLOWINU /leaderboard — read-only views of real server data and the community reward pool.
   Boards: Season Top 10 (shares the SOL prize pool) · The Haunt (Haunt XP) · Escape The Trenches (best run).
   Nothing here is computed from the browser: every number comes from the API. */
(() => {
  const root = document.querySelector('[data-lb]'); if (!root) return;
  const $ = (s, el = root) => el.querySelector(s), $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const pct = bps => `${(Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  const PRIZE_SLOTS = 10;
  const RANGES = {
    season: [],
    haunt: [['today', 'Today'], ['week', 'Week'], ['all', 'All time']],
    ett: [['all', 'All time'], ['week', 'Week'], ['today', 'Today']],
  };
  const q = new URLSearchParams(location.search);
  const qb = q.get('board');
  const S = { board: RANGES[qb] ? qb : 'season', range: q.get('range') || '', me: null, seq: 0 };
  if (RANGES[S.board].length && !RANGES[S.board].some(r => r[0] === S.range)) S.range = RANGES[S.board][0][0];

  async function api(path) {
    try { const r = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }); return await r.json(); }
    catch { return { ok: false, message: 'Network error' }; }
  }

  const HEAD = {
    season: '<span class="c-rk">#</span><span class="c-nm">Player</span><span class="c-st">Share</span><span class="c-st">Prize</span><span class="c-xp">Points</span>',
    haunt: '<span class="c-rk">#</span><span class="c-nm">Player</span><span class="c-st">Haunts</span><span class="c-st">Arcade</span><span class="c-xp">XP</span>',
    ett: '<span class="c-rk">#</span><span class="c-nm">Runner</span><span class="c-st">Runs</span><span class="c-st">Distance</span><span class="c-xp">Best</span>',
  };
  function renderControls() {
    $$('[data-board]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.board === S.board)));
    const ranges = RANGES[S.board];
    $('[data-range-ctl]').hidden = !ranges.length;
    $('[data-ranges]').innerHTML = ranges.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === S.range}" data-range="${k}">${l}</button>`).join('');
    $('[data-head]').innerHTML = HEAD[S.board];
    const u = new URL(location.href); u.searchParams.set('board', S.board);
    if (ranges.length) u.searchParams.set('range', S.range); else u.searchParams.delete('range');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  const val = r => (S.board === 'haunt' ? r.xp : S.board === 'ett' ? r.best : r.points);
  const unit = () => (S.board === 'haunt' ? 'XP' : 'PTS');
  function stats(r) {
    if (S.board === 'haunt') return `<span class="c-st s1" data-l="Haunts">${fmt(r.haunts)}</span><span class="c-st s2" data-l="Arcade">${fmt(r.arcade)}</span>`;
    if (S.board === 'ett') return `<span class="c-st s1" data-l="Runs">${fmt(r.runs)}</span><span class="c-st s2" data-l="Distance">${fmt(r.distance)} m</span>`;
    if (r.open) return `<span class="c-st s1" data-l="Share">${pct(r.slot.bps)}</span><span class="c-st s2" data-l="Prize"><b class="pz">◎ ${esc(r.slot.sol)}</b></span>`;
    if (r.prize) return `<span class="c-st s1" data-l="Share">${r.prize.bps != null ? pct(r.prize.bps) : ''}</span><span class="c-st s2" data-l="Prize"><b class="pz">◎ ${esc(r.prize.sol)}</b></span>`;
    return `<span class="c-st s1" data-l="Share"><small>not verified</small></span><span class="c-st s2" data-l="Prize"><small>—</small></span>`;
  }
  function row(r) {
    if (r.open) {
      return `<li class="lb-row is-open"><span class="c-rk">${r.rank}</span>
        <span class="c-nm"><b>Open spot</b><small>PRIZE #${r.slot.rank}</small></span>${stats(r)}<span class="c-xp">—</span></li>`;
    }
    const tag = S.board === 'season' && r.prize && r.prize.prizeRank ? `<small>PRIZE #${r.prize.prizeRank}</small>` : (r.level ? `<small>LV ${r.level}</small>` : '');
    return `<li class="lb-row${r.me ? ' is-me' : ''}${r.rank <= 3 ? ' top' + r.rank : ''}"><span class="c-rk">${r.rank}</span>
      <span class="c-nm"><b>${esc(r.name)}</b>${r.me ? '<em>YOU</em>' : ''}${tag}</span>${stats(r)}
      <span class="c-xp">${fmt(val(r))} <small>${unit()}</small></span></li>`;
  }
  function podium(rows) {
    const top = rows.filter(r => !r.open).slice(0, 3);
    if (!top.length) return '';
    const order = [top[1], top[0], top[2]].filter(Boolean);
    return order.map(r => `<li class="pd pd-${r.rank}${r.me ? ' is-me' : ''}"><span class="pd-crown" aria-hidden="true">${r.rank === 1 ? '♛' : r.rank === 2 ? '✦' : '✧'}</span>
      <span class="pd-rank">#${r.rank}</span><b class="pd-name">${esc(r.name)}</b>${r.me ? '<em>YOU</em>' : ''}
      <span class="pd-val">${fmt(val(r))} <small>${unit()}</small></span>${S.board === 'season' && r.prize ? `<span class="pd-prize">◎ ${esc(r.prize.sol)}</span>` : ''}<span class="pd-base" aria-hidden="true"></span></li>`).join('');
  }

  /* Season board: always 10 prize rows. Players without a prize slot (not verified) stay visible;
     prize slots nobody holds yet are shown as "Open spot" with their share and current SOL value. */
  function seasonRows(d) {
    const prizes = (d.prizes || []).slice(0, PRIZE_SLOTS);
    // walk the ranking until all prize slots are held, so unverified players never push a prize off the board
    const rows = [];
    let held = 0;
    for (const r of d.rows || []) {
      if (held >= prizes.length || rows.length >= PRIZE_SLOTS * 2) break;
      rows.push(r); if (r.prize) held++;
    }
    const used = new Set(rows.filter(r => r.prize && r.prize.prizeRank).map(r => r.prize.prizeRank));
    const free = prizes.filter(p => !used.has(p.rank));
    const out = rows.slice();
    let next = out.length ? out[out.length - 1].rank + 1 : 1;
    while (free.length) out.push({ open: true, rank: next++, slot: free.shift() });
    return out;
  }
  function renderPrize(d) {
    const box = $('[data-prize]');
    if (S.board !== 'season' || !d.season) { box.hidden = true; return; }
    const prizes = (d.prizes || []).slice(0, PRIZE_SLOTS);
    const ends = d.season.endsAt ? new Date(d.season.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
    box.hidden = false;
    box.innerHTML = `<div class="pz-top"><div class="pz-head"><span class="pz-l">${esc(d.season.name)}</span>
        <b class="pz-pool">◎ ${esc(d.season.poolSol || '0')}</b><span class="pz-sub">${d.season.finalized ? 'Final prize pool' : 'Current prize pool' + (ends ? ` · ends ${ends} (UTC)` : '')}</span></div>
        <a class="pz-link" href="#pool">How the pool fills ›</a></div>
      <ol class="pz-split" aria-label="Prize split per position">${prizes.map(p => `<li><span class="pz-r">#${p.rank}</span><span class="pz-p">${pct(p.bps)}</span><span class="pz-s">◎ ${esc(p.sol)}</span></li>`).join('')}</ol>`;
  }
  function renderMe(d) {
    const box = $('[data-me]');
    const mine = (d.rows || []).find(r => r.me) || d.me;
    const play = S.board === 'haunt' ? '<a href="/haunt">Submit a haunt</a>' : S.board === 'ett' ? '<a href="/escape-the-trenches" target="_blank" rel="noopener">Start a run</a>' : '<a href="/arcade">Play a game</a>';
    box.hidden = false;
    if (!S.me) {
      box.innerHTML = `<span class="me-l">YOUR POSITION</span><span class="me-t">Sign in with Phantom on <a href="/haunt">The Haunt</a> or the <a href="/arcade">Arcade</a> to see your rank here.</span>`;
      return;
    }
    const when = S.range === 'today' ? 'today' : S.range === 'week' ? 'this week' : S.board === 'season' ? 'this season' : 'yet';
    box.innerHTML = mine
      ? `<span class="me-l">YOUR POSITION</span><b class="me-rank">#${mine.rank}</b><span class="me-t">${esc(mine.name || S.me.displayName || '')}</span><b class="me-val">${fmt(val(mine))} ${unit()}</b>`
      : `<span class="me-l">YOUR POSITION</span><span class="me-t">Not ranked ${when}. ${play} to get on the board.</span>`;
  }
  const EMPTY = {
    season: () => 'No season points yet.',
    haunt: () => 'No haunts ' + (S.range === 'today' ? 'today yet' : S.range === 'week' ? 'this week yet' : 'yet') + '. Be the first ghost on the board.',
    ett: () => 'No runs ' + (S.range === 'today' ? 'today yet' : S.range === 'week' ? 'this week yet' : 'yet') + '. Escape the trenches first.',
  };
  const NOTE = {
    season: d => d.season ? `${d.season.name}: the Top 10 prize-eligible players (wallet + X + Telegram verified) share the pool by the percentages above. Season points = Arcade + The Haunt + Escape The Trenches. SOL values grow with the pool and are final when the season ends.` : 'No season is running right now.',
    haunt: () => 'Haunt XP: verified X replies, posts, memes and reviewed TikToks. Also counts as Season points. Today/Week reset at 00:00 UTC (week starts Monday).',
    ett: () => 'Best verified run per runner. Every run is replayed on the server before it counts. Today/Week reset at 00:00 UTC.',
  };

  async function load() {
    const seq = ++S.seq;
    renderControls();
    $('[data-list]').innerHTML = '<li class="lb-empty">Loading the graveyard…</li>';
    const d = S.board === 'haunt' ? await api(`/api/haunt/leaderboard?range=${S.range}`)
      : S.board === 'ett' ? await api(`/api/ett/leaderboard?range=${S.range}`)
      : await api('/api/leaderboard?scope=season');
    if (seq !== S.seq) return;
    if (!d.ok) {
      $('[data-podium]').innerHTML = ''; $('[data-prize]').hidden = true;
      $('[data-list]').innerHTML = `<li class="lb-empty">${esc(d.message || 'The leaderboard is offline right now.')}</li>`;
      return;
    }
    const rows = S.board === 'season' ? seasonRows(d) : (d.rows || []);
    renderPrize(d);
    $('[data-podium]').innerHTML = podium(rows);
    $('[data-podium]').hidden = !rows.some(r => !r.open);
    $('[data-list]').innerHTML = rows.length ? rows.map(row).join('') : `<li class="lb-empty">${EMPTY[S.board]()}</li>`;
    $('[data-note]').textContent = NOTE[S.board](d);
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
        <div><dt>Community share received (50%)</dt><dd>◎ ${esc(t.communitySol)}</dd></div>
        <div><dt>Paid out to winners</dt><dd>◎ ${esc(t.distributedSol)}</dd></div>
        <div><dt>Verified reward events</dt><dd>${fmt(t.events)}</dd></div>
      </dl>
      ${p.recent.length ? `<ul class="pool-recent">${p.recent.slice(0, 5).map(r => `<li><span>+ ◎ ${esc(r.communitySol)} <small>${new Date(r.at).toLocaleDateString()}</small></span><a href="https://solscan.io/tx/${encodeURIComponent(r.signature)}" target="_blank" rel="noopener noreferrer">tx ›</a></li>`).join('')}</ul>` : ''}`;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-board]');
    if (b && b.dataset.board !== S.board) { S.board = b.dataset.board; S.range = RANGES[S.board].length ? RANGES[S.board][0][0] : ''; load(); return; }
    const r = e.target.closest('[data-range]');
    if (r && r.dataset.range !== S.range) { S.range = r.dataset.range; load(); }
  });

  (async () => {
    const me = await api('/api/me');
    S.me = me && me.ok && me.player && me.player.displayName ? me.player : null;
    await Promise.all([load(), loadPool()]);
  })();
})();
