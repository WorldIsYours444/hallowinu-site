/* Browser E2E for THE HAUNT against: DEV_FAKE_X=1 node tools/dev-server.mjs 8789 <fresh db>
   Run: NODE_PATH=$(npm root -g) node test/e2e-haunt.mjs [baseUrl] [shotsDir] */
import { createRequire } from 'node:module';
import { webcrypto as crypto } from 'node:crypto';
import { base58Encode } from '../worker/lib/auth.js';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8789';
const SHOTS = process.argv[3] || '';
const ADMIN = { authorization: 'Bearer dev-admin-token-please-change-0000', 'x-hw-client': '1', 'content-type': 'application/json', origin: BASE };
const fails = []; const check = (c, m) => { console.log(c ? '  ✔' : '  ✖', m); if (!c) fails.push(m); };

const T1 = '1811111111111111111', T2 = '1822222222222222222';
for (const [id, cat] of [[T1, 'SOLANA / MEMECOINS'], [T2, 'ONCHAIN']]) {
  const r = await (await fetch(`${BASE}/api/admin/haunt/targets`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ url: `https://x.com/solanaKOL/status/${id}`, category: cat, reward: 5, expiresInMinutes: 90 }) })).json();
  check(r.ok || r.error === 'TARGET_EXISTS', `admin created target ${id} (${r.error || 'ok'})`);
}

const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = base58Encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
const browser = await chromium.launch();
const errors = [];
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  console.log(`VIEWPORT ${w}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.exposeBinding('__s', async (_s, bytes) => [...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new Uint8Array(bytes)))]);
  await ctx.addInitScript(p => { window.phantom = { solana: { isPhantom: true, async connect() { return { publicKey: { toString: () => p } }; }, async signMessage(m) { return { signature: new Uint8Array(await window.__s([...m])) }; }, on() {}, async disconnect() {} } }; }, pub);
  // simulate X's consent screen: let our server create the PKCE state, then bounce straight back to the callback
  await ctx.route(u => u.pathname === '/api/socials/x/start', async route => {
    const res = await route.fetch({ maxRedirects: 0 });
    const loc = new URL(res.headers().location);
    const state = loc.searchParams.get('state');
    route.fulfill({ status: 302, headers: { location: state ? `${BASE}/api/socials/x/callback?state=${state}&code=devcode` : loc.href } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/status of (409|429|400)/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/haunt');
  await page.waitForSelector('[data-gate]:not([hidden])');
  if (w === 1440) {
    check(/SIGN IN WITH PHANTOM/.test(await page.textContent('[data-gate]')), 'gate step 1: sign in');
    check(await page.locator('.hn-card').count() === 2, 'two target cards visible before sign-in');
    check(await page.locator('[data-claim]').isDisabled(), 'claim disabled while locked');
    await page.click('[data-connect]');
    await page.waitForSelector('text=CHOOSE YOUR PLAYER NAME');
    check(true, 'gate step 2: name required');
    await page.evaluate(() => fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-hw-client': '1' }, body: JSON.stringify({ displayName: 'HAUNTER' + Math.floor(Math.random() * 1e4) }) }));
    await page.reload(); await page.waitForSelector('text=CONNECT YOUR X ACCOUNT');
    check(true, 'gate step 3: connect X');
    page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('    nav', f.url()); }); await page.click('a:has-text("Connect X")');
    await page.waitForURL(/\/haunt/); await page.waitForTimeout(800); console.log('    returned to', page.url()); await page.waitForSelector('[data-gate][hidden]', { state: 'attached' });
    check(/@devghost/.test(await page.textContent('[data-hud]')), 'X connected (@devghost shown in HUD)');
    // submit haunt 1
    await page.click(`[data-tid] [data-pick]`);
    await page.fill('#hn-url', 'https://example.com/nope');
    await page.click('[data-claim]');
    check(/NOT AN X POST LINK/.test(await page.textContent('[data-result]')), 'client-side URL hint');
    const tid = await page.getAttribute('.hn-card.is-picked', 'data-tid');
    const tStatus = (await page.getAttribute(`[data-tid="${tid}"] [data-open-x]`, 'href')).match(/status\/(\d+)/)[1];
    await page.fill('#hn-url', `https://x.com/devghost/status/${tStatus}01`);
    await page.click('[data-claim]');
    await page.waitForSelector('.hn-result.good', { timeout: 10000 });
    check(/APPROVED/.test(await page.textContent('[data-result]')) && /\+5 XP/.test(await page.textContent('[data-result]')), 'approved +5 XP');
    check(await page.locator('.hn-log li.ok').count() >= 10, 'verification steps shown from real server checks');
    await page.waitForTimeout(500);
    check((await page.textContent('[data-s="xp"]')) === '5', 'HUD XP updated');
    check(/COOLDOWN/.test(await page.textContent('[data-s="state"]')) && /NEXT HAUNT IN \d\d:\d\d/.test(await page.textContent('[data-s="next"]')), 'cooldown with live countdown');
    check(await page.locator('.hn-card.is-done').count() === 1, 'card marked HAUNTED');
    await page.waitForTimeout(400);
    check(/HAUNTER/.test(await page.textContent('[data-board]')), 'leaderboard shows player name');
    check(/haunted #/.test(await page.textContent('[data-feed]')), 'activity feed updated');
    // resubmitting the same reply -> idempotent
    const other = await page.getAttribute('.hn-card:not(.is-done)', 'data-tid');
    await page.click(`[data-tid="${other}"] [data-pick]`);
    check(await page.locator('[data-claim]').isDisabled(), 'claim disabled during cooldown');
    if (SHOTS) { await page.screenshot({ path: `${SHOTS}/haunt-${w}.png`, fullPage: true }); }
  } else {
    // returning on mobile: same wallet -> same account, already connected
    await page.waitForSelector('[data-connect]'); await page.click('[data-connect]');
    await page.waitForSelector('[data-gate][hidden]', { state: 'attached', timeout: 10000 });
    check((await page.textContent('[data-s="xp"]')) === '5', 'mobile: same account restored');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(overflow <= 0, 'mobile: no horizontal overflow');
    if (SHOTS) { await page.screenshot({ path: `${SHOTS}/haunt-${w}.png`, fullPage: true }); }
  }
  await ctx.close();
}
await browser.close();
console.log('ERRORS:', errors.length ? errors : 'none');
if (fails.length || errors.length) { console.log(`FAILED ${fails.length}`); process.exit(1); }
console.log('ALL HAUNT E2E CHECKS PASSED');
