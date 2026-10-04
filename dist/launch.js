/* Launch wiring: driven entirely by launch-config.js.
   Empty config = everything stays "COMING SOON" (no fake data). */
(() => {
  const config = window.HALLOWINU_LAUNCH || {};
  const contract = String(config.contract || '').trim();
  const buyUrl = safeUrl(config.buyUrl);
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');

  function safeUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
  }

  // "Chart" buttons scroll to the token terminal
  document.querySelectorAll('[data-chart-scroll]').forEach(b => b.addEventListener('click', () => {
    document.querySelector('#live-chart')?.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth' });
  }));

  // Buy buttons: real link when configured, otherwise the "coming soon" dialog
  document.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
    if (buyUrl) window.open(buyUrl, '_blank', 'noopener,noreferrer');
    else window.HALLOWINU_openLaunch?.();
  }));
  if (buyUrl) document.querySelectorAll('[data-buy] .soon, [data-buy-soon]').forEach(s => s.remove());

  if (!contract) return;

  // Contract address + copy
  document.querySelectorAll('.ca').forEach(box => {
    const value = box.querySelector('.ca-value'), copy = box.querySelector('.ca-copy'), feedback = box.querySelector('.ca-feedback');
    if (value) { value.textContent = contract; value.title = contract; }
    if (!copy) return;
    copy.hidden = false;
    let reset;
    copy.addEventListener('click', async () => {
      try {
        try { await navigator.clipboard.writeText(contract); } catch {
          const input = document.createElement('textarea'); input.value = contract; input.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
          document.body.append(input); input.select(); input.setSelectionRange(0, contract.length);
          const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('Copy unavailable');
        }
        copy.textContent = 'Copied!'; if (feedback) feedback.textContent = 'Contract address copied.';
      } catch { copy.textContent = 'Retry'; if (feedback) feedback.textContent = 'Copy unavailable. Select the full contract address to copy manually.'; }
      clearTimeout(reset); reset = setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    });
  });
  const status = document.querySelector('[data-status]');
  if (status) status.textContent = 'LIVE';
  document.querySelectorAll('.tag').forEach(t => { if (/pre-launch/i.test(t.textContent)) t.lastChild.textContent = 'Live'; });

  // DexScreener chart. An empty or invalid URL leaves a clean state and creates no iframe.
  (function showChart(value) {
    const holder = document.querySelector('.chart-frame'); if (!holder) return;
    const state = holder.querySelector('.chart-state');
    let url;
    try {
      url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'dexscreener.com' || !/^\/solana\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return;
    } catch { return; }
    state.textContent = 'LOADING CHART…';
    const frame = document.createElement('iframe');
    frame.title = 'HALLOWINU live DexScreener chart'; frame.allow = 'clipboard-write'; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.hidden = true;
    url.search = '?embed=1&theme=dark&trades=0&info=0'; frame.src = url.href;
    const fail = () => { clearTimeout(timeout); state.textContent = 'CHART UNAVAILABLE — TRY AGAIN LATER'; frame.remove(); };
    const timeout = setTimeout(fail, 20000);
    frame.addEventListener('load', () => { clearTimeout(timeout); state.hidden = true; holder.querySelector('.chart-ghost')?.remove(); frame.hidden = false; });
    frame.addEventListener('error', fail);
    holder.append(frame);
  })(config.dexscreenerUrl);
})();
