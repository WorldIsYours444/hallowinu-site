/* HALLOWINU shared Phantom wallet sign-in (non-custodial: connect + sign a message; never a transaction).
   Used by THE HAUNT page. Exposes window.HW_WALLET. */
(() => {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function phantom() {
    const p = window.phantom && window.phantom.solana;
    if (p && p.isPhantom) return p;
    if (window.solana && window.solana.isPhantom) return window.solana;
    return null;
  }
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  async function post(path, body) {
    let res;
    try { res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-hw-client': '1' }, body: JSON.stringify(body || {}) }); }
    catch { return { ok: false, error: 'NETWORK', message: 'Connection problem. Try again.' }; }
    try { return await res.json(); } catch { return { ok: false, error: 'NETWORK', message: 'Connection problem. Try again.' }; }
  }
  /* Connect Phantom → nonce → signMessage → verify. Returns the server response ({ ok, access, player, … }). */
  async function signIn() {
    const p = phantom();
    if (!p) return { ok: false, error: 'NO_PHANTOM', message: 'Phantom was not found in this browser.' };
    let wallet;
    try { wallet = (await p.connect()).publicKey.toString(); }
    catch (e) { return { ok: false, error: 'CANCELLED', message: e && e.code === 4001 ? 'Connection cancelled in Phantom.' : 'Phantom could not connect.' }; }
    const n = await post('/api/auth/nonce', { wallet });
    if (!n.ok) return n;
    let signature;
    try { const out = await p.signMessage(new TextEncoder().encode(n.message), 'utf8'); signature = b64(out.signature || out); }
    catch (e) {
      const cancelled = e && (e.code === 4001 || /reject|cancel|denied/i.test(String(e.message || '')));
      return { ok: false, error: 'CANCELLED', message: cancelled ? 'Signature cancelled. Approve the message in Phantom to sign in.' : String((e && e.message) || 'Phantom could not sign.').slice(0, 140) };
    }
    return post('/api/auth/verify', { wallet, nonce: n.nonce, signature });
  }
  async function logout(disconnect) {
    await post('/api/auth/logout');
    if (disconnect) { try { await phantom()?.disconnect(); } catch {} }
  }
  const browseUrl = path => `https://phantom.app/ul/browse/${encodeURIComponent(location.origin + path)}?ref=${encodeURIComponent(location.origin)}`;
  window.HW_WALLET = Object.freeze({ phantom, signIn, logout, isMobile, browseUrl });
})();
