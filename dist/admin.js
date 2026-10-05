/* HALLOWINU Arcade admin console. Every call carries the Bearer token; the server audits all writes. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  let token = ss.get('hw-admin') || '';
  const msg = (t, ok) => { const m = $('#msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'bad'); m.scrollIntoView({ block: 'nearest' }); };
  const sol = l => { let x = BigInt(l || 0); const n = x < 0n; if (n) x = -x; return (n ? '-' : '') + (x / 1000000000n) + '.' + (x % 1000000000n).toString().padStart(9, '0').replace(/0{1,6}$/, ''); };
  const dt = ts => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
  const utc = v => (v ? Date.parse(v + ':00Z') : undefined);

  async function call(method, path, body) {
    const r = await fetch('/api/admin/' + path, { method, headers: { authorization: 'Bearer ' + token, 'x-hw-client': '1', 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let d; try { d = await r.json(); } catch { d = { ok: false, message: 'Bad response' }; }
    if (!d.ok) throw new Error(`${d.error || r.status}: ${d.message || ''}${d.blockers ? ' ' + JSON.stringify(d.blockers) : ''}`);
    return d;
  }
  async function act(fn, okText) { try { await fn(); msg(okText || 'Done.', true); await load(); } catch (e) { msg(e.message); } }

  async function load() {
    const d = await call('GET', 'overview');
    $('#app').hidden = false;
    $('#stats').innerHTML = `<span>PLAYERS <b>${d.counts.players}</b></span><span>PLAYS <b>${d.counts.plays}</b></span><span>POINTS AWARDED <b>${d.counts.points}</b></span>`;
    $('#socialsCfg').textContent = `Social verification — X: ${d.socials.x.available ? 'ON' : 'OFF (set X_CLIENT_ID + X_CLIENT_SECRET)'} · Telegram: ${d.socials.telegram.available ? 'ON (@' + d.socials.telegram.botUsername + ')' : 'OFF (set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_CHAT_ID)'}`;
    $('#wallet').textContent = d.poolWallet ? `On-chain verification wallet: ${d.poolWallet}` : 'POOL_WALLET not configured — only manual verification is available.';
    $('#seasons').innerHTML = '<tr><th>Id</th><th>Name</th><th>Start</th><th>End</th><th>Status</th><th>Announced</th><th>Frozen pool</th><th></th></tr>' + d.seasons.map(s => `<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td>${dt(s.starts_at)}</td><td>${dt(s.ends_at)}</td><td>${esc(s.status === 'FINALIZING' ? 'UNDER REVIEW' : s.status)}</td><td>${s.announced_lamports != null ? '◎ ' + sol(s.announced_lamports) : '—'}</td><td>${s.frozen_pool_lamports != null ? '◎ ' + sol(s.frozen_pool_lamports) : '—'}</td>
      <td class="acts"><button class="btn btn-orange btn-sm" data-fin="${esc(s.id)}">Finalize</button><button class="btn btn-purple btn-sm" data-rec="${esc(s.id)}">Recompute</button><button class="btn btn-primary btn-sm" data-app="${esc(s.id)}">Approve payouts</button></td></tr>`).join('');
    $('#funding').innerHTML = '<tr><th>Id</th><th>Season</th><th>Amount</th><th>Source</th><th>Status</th><th>Tx</th><th>Notes</th><th></th></tr>' + d.funding.map(f => `<tr><td>${f.id}</td><td>${esc(f.season_id)}</td><td>◎ ${sol(f.amount_lamports)}</td><td>${esc(f.source)}</td><td>${esc(f.status)}${f.verification_method ? ' · ' + esc(f.verification_method) : ''}</td><td class="mono">${f.tx_signature ? `<a href="https://solscan.io/tx/${encodeURIComponent(f.tx_signature)}" target="_blank" rel="noopener noreferrer">${esc(f.tx_signature.slice(0, 12))}…</a>` : '—'}</td><td>${esc(f.notes || '')}</td>
      <td class="acts">${f.status === 'PENDING' ? `<button class="btn btn-primary btn-sm" data-von="${f.id}">Verify on-chain</button><button class="btn btn-orange btn-sm" data-vman="${f.id}">Verify manually</button><button class="btn btn-purple btn-sm" data-rej="${f.id}">Reject</button>` : ''}</td></tr>`).join('');
    $('#ents').innerHTML = d.entitlements.length ? d.entitlements.map(g => `<p><b>${esc(g.seasonId)}</b></p><table><tr><th>Rank</th><th>Player</th><th>Amount</th><th>Status</th><th>Eligible</th><th>Payout tx</th><th></th></tr>${g.entitlements.map(e => `<tr><td>${e.status === 'DISQUALIFIED' ? '—' : '#' + e.rank}</td><td>${esc(e.display_name)}<br><code>${esc(e.player_id)}</code></td><td>◎ ${sol(e.amount_lamports)}</td><td>${esc(e.status)}</td><td>${e.payout_verified ? 'yes' : 'NO'}</td><td class="mono">${esc(e.payout_tx || '—')}</td><td>${e.status === 'APPROVED' ? `<button class="btn btn-primary btn-sm" data-paid="${e.id}">Mark paid</button>` : ''}</td></tr>`).join('')}</table>`).join('') : '<p class="ax-fine">No entitlements yet (created when a season is finalized).</p>';
    $('#settings').innerHTML = Object.entries(d.overridable).map(([k, type]) => {
      const cur = d.settings.find(s => s.key === k);
      const val = cur ? JSON.parse(cur.value_json) : '';
      return type === 'boolean'
        ? `<label>${esc(k)}<select data-set="${esc(k)}" data-type="boolean"><option value="">(config default)</option><option value="true" ${val === true ? 'selected' : ''}>enabled</option><option value="false" ${val === false ? 'selected' : ''}>disabled</option></select></label>`
        : `<label>${esc(k)}<input data-set="${esc(k)}" data-type="int" type="number" min="0" max="1000" placeholder="config default" value="${val === '' ? '' : esc(val)}"></label>`;
    }).join('');
    $('#audit').innerHTML = '<tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr>' + d.audit.map(a => `<tr><td>${dt(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.target || '')}</td><td class="mono">${esc((a.details_json || '').slice(0, 300))}</td></tr>`).join('');
    const q = await call('GET', 'quiz');
    $('#quiz').innerHTML = '<tr><th>Id</th><th>Category</th><th>Diff</th><th>Question</th><th>Correct</th><th>Active</th></tr>' + q.questions.map(x => `<tr><td>${x.id}</td><td>${esc(x.category)}</td><td>${esc(x.difficulty)}</td><td>${esc(x.question)}</td><td>${esc(JSON.parse(x.answers_json)[x.correct_index])}</td><td><button class="btn btn-sm ${x.active ? 'btn-purple' : 'btn-orange'}" data-qt="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'on' : 'off'}</button></td></tr>`).join('');
  }

  $('#auth').addEventListener('submit', async e => { e.preventDefault(); token = $('#token').value.trim(); ss.set('hw-admin', token); try { await load(); msg('Authenticated.', true); } catch (err) { msg(err.message); } });
  if (token) load().catch(e => msg(e.message));

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.fin && confirmText(`Finalize ${d.fin}? This freezes standings and the pool.`)) act(() => call('POST', `seasons/${d.fin}/finalize`), 'Season finalized.');
    if (d.rec) act(() => call('POST', `seasons/${d.rec}/recompute`), 'Entitlements recomputed.');
    if (d.app && confirmText(`Approve payouts for ${d.app}?`)) act(() => call('POST', `seasons/${d.app}/approve`), 'Payouts approved.');
    if (d.von) act(() => call('POST', `funding/${d.von}/verify`, { method: 'onchain' }), 'Verified on-chain.');
    if (d.vman) { const c = prompt('Type exactly: I VERIFIED THIS FUNDING'); if (c) act(() => call('POST', `funding/${d.vman}/verify`, { method: 'manual', confirm: c }), 'Verified manually.'); }
    if (d.rej) { const r = prompt('Reason for rejection?'); if (r) act(() => call('POST', `funding/${d.rej}/reject`, { reason: r }), 'Rejected.'); }
    if (d.paid) { const sig = prompt('Payout transaction signature:'); if (sig) act(() => call('POST', `entitlements/${d.paid}/paid`, { txSignature: sig }), 'Marked paid.'); }
    if (d.qt) act(() => call('PATCH', `quiz/${d.qt}`, { active: d.on === '1' }), 'Question updated.');
  });
  function confirmText(t) { return window.confirm(t); }
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-set]'); if (!el || el.value === '') return;
    const value = el.dataset.type === 'boolean' ? el.value === 'true' : Number(el.value);
    act(() => call('PUT', 'settings', { key: el.dataset.set, value }), 'Setting saved.');
  });
  const form = (id, fn) => $(id).addEventListener('submit', e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); fn(f, e.target); });
  form('#fundNew', f => act(() => call('POST', 'funding', { seasonId: f.seasonId, amountSol: f.amountSol, source: f.source, txSignature: f.txSignature || undefined, notes: f.notes || undefined }), 'Funding recorded as PENDING.'));
  form('#seasonEdit', f => act(() => call('PATCH', `seasons/${f.id}`, { name: f.name || undefined, startsAt: utc(f.startsAt), endsAt: utc(f.endsAt), announcedSol: f.announcedSol === '' ? undefined : f.announcedSol }), 'Season saved.'));
  form('#seasonNew', f => act(() => call('POST', 'seasons', { id: f.id, name: f.name, startsAt: utc(f.startsAt), endsAt: utc(f.endsAt) }), 'Season created.'));
  form('#dq', f => act(() => call('POST', `seasons/${f.season}/disqualify`, { playerId: f.playerId, reason: f.reason, evidence: f.evidence }), 'Player disqualified.'));
  form('#verify', f => { const c = prompt('Type exactly: I VERIFIED THIS PLAYER'); if (c) act(() => call('POST', `players/${f.playerId}/verify-payout`, { evidence: f.evidence, confirm: c }), 'Player marked prize-eligible.'); });
  form('#qnew', (f, el) => act(async () => { await call('POST', 'quiz', { question: f.question, answers: [f.a0, f.a1, f.a2, f.a3], correctIndex: 0, difficulty: f.difficulty, category: f.category }); el.reset(); }, 'Question added (answers are shuffled for players).'));
  form('#psearch', async f => {
    try { const d = await call('GET', 'players?q=' + encodeURIComponent(f.q || ''));
      $('#players').innerHTML = '<tr><th>Id</th><th>Name</th><th>Points</th><th>Wallet</th><th>X</th><th>Telegram</th><th>Status</th><th>Eligible</th><th></th></tr>' + d.players.map(p => `<tr><td class="mono">${esc(p.id)}${p.kind === 'legacy' ? '<br><small>legacy test</small>' : ''}</td><td>${esc(p.display_name)}</td><td>${p.total_points}</td><td class="mono">${esc(p.wallet || '—')}</td><td>${esc(p.x || '—')}</td><td>${esc(p.telegram || '—')}</td><td>${esc(p.status)}</td><td>${p.payout_verified ? 'yes' : 'no'}</td><td><button class="btn btn-orange btn-sm" data-ban="${esc(p.id)}" data-banned="${p.status === 'banned' ? 0 : 1}">${p.status === 'banned' ? 'Unban' : 'Ban'}</button></td></tr>`).join('');
    } catch (e) { msg(e.message); }
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-ban]'); if (!b) return; const r = prompt('Reason?'); if (r) act(() => call('POST', `players/${b.dataset.ban}/ban`, { banned: b.dataset.banned === '1', reason: r }), 'Player updated.'); });
})();
