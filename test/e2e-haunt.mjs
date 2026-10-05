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
    check(/HAUNTER/.test(await page.textContent('[data-board]')), 'rank preview shows player name');
    check(/YOUR RANK TODAY/.test(await page.textContent('[data-myrank]')), 'rank preview shows my rank');
    check(await page.locator('.hn-board table').count() === 0 && await page.locator('a[href="/leaderboard"]:has-text("View full leaderboard")').count() === 1, 'no full board on /haunt; link to /leaderboard');
    check(/X REPLY/.test(await page.textContent('[data-mine]')), 'history shows submission type');
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
/* ---------- second player: TikTok (no X needed) → in review; type selector ---------- */
{
  console.log('TIKTOK FLOW');
  const kp2 = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub2 = base58Encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp2.publicKey)));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeBinding('__s', async (_s, bytes) => [...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp2.privateKey, new Uint8Array(bytes)))]);
  await ctx.addInitScript(p => { window.phantom = { solana: { isPhantom: true, async connect() { return { publicKey: { toString: () => p } }; }, async signMessage(m) { return { signature: new Uint8Array(await window.__s([...m])) }; }, on() {}, async disconnect() {} } }; }, pub2);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/haunt'); await page.waitForSelector('[data-connect]'); await page.click('[data-connect]');
  await page.waitForSelector('text=CHOOSE YOUR PLAYER NAME');
  await page.evaluate(() => fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-hw-client': '1' }, body: JSON.stringify({ displayName: 'TIKGHOST' + Math.floor(Math.random() * 1e4) }) }));
  await page.reload(); await page.waitForSelector('text=CONNECT YOUR X ACCOUNT');
  check(await page.locator('[data-type]').count() === 4, 'four submission types in one terminal');
  check(/\+20 XP/.test(await page.textContent('[data-type-meta="TIKTOK_POST"]')), 'type reward comes from server rules');
  check(await page.locator('#hn-url').isDisabled(), 'X reply locked without X account');
  await page.click('[data-type="TIKTOK_POST"]');
  check(await page.locator('[data-picked]').isHidden(), 'no Haunt picker for TikTok');
  check(!(await page.locator('#hn-url').isDisabled()), 'TikTok works without X');
  await page.fill('#hn-url', 'https://x.com/someone/status/1234567890');
  await page.click('[data-claim]');
  check(/WRONG PLATFORM/.test(await page.textContent('[data-result]')), 'wrong platform caught in the browser');
  await page.fill('#hn-url', `https://www.tiktok.com/@tikghost/video/73${Date.now()}`);
  await page.click('[data-claim]');
  await page.waitForSelector('.hn-result.wait', { timeout: 10000 });
  check(/IN REVIEW/.test(await page.textContent('[data-result]')), 'TikTok → in review (never auto-approved)');
  await page.waitForTimeout(400);
  check(/TIKTOK/.test(await page.textContent('[data-mine]')) && /in review/.test(await page.textContent('[data-mine]')), 'history shows TikTok in review');
  check((await page.textContent('[data-s="xp"]')) === '0', 'no XP before review');
  await ctx.close();
}

/* ---------- new pages + nav ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  for (const path of ['/', '/arcade', '/haunt', '/leaderboard', '/token']) {
    await page.goto(BASE + path);
    const labels = (await page.locator('.nav-links a').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    check(JSON.stringify(labels) === JSON.stringify(['About', 'Arcade', 'The HauntNEW (new)', 'Leaderboard', 'Token', 'Community']), `${path}: nav order ${JSON.stringify(labels)}`);
    check(await page.locator('.nav-links .nav-new, .mobile-menu .nav-new').count() === 2 && await page.locator('a[href="/haunt"] .nav-new').count() >= 2, `${path}: NEW only on The Haunt`);
  }
  await page.goto(BASE + '/#live-chart'); await page.waitForURL(/\/token/);
  check(true, 'legacy #live-chart redirects to /token');
  check(await page.locator('#live-chart .term-chart').count() === 1, '/token has the terminal + chart');
  await page.goto(BASE + '/');
  check(await page.locator('.term-chart').count() === 0 && await page.locator('.explore-card').count() === 4, 'home: no duplicate chart, 4 teaser cards');
  await page.goto(BASE + '/leaderboard'); await page.waitForSelector('.lb-row:not(.lb-head), .lb-empty');
  await page.waitForTimeout(500);
  check(await page.locator('.lb-podium .pd').count() >= 1, 'leaderboard podium rendered');
  check(/HAUNTER/.test(await page.textContent('[data-list]')), 'leaderboard lists real players');
  check(/AWAITING REWARD SOURCE/.test(await page.textContent('[data-pool]')), 'pool shows AWAITING REWARD SOURCE (no fake value)');
  await page.click('[data-board="arcade"]'); await page.waitForTimeout(500);
  check(/Season/.test(await page.textContent('[data-ranges]')), 'arcade tab: season/all ranges');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/leaderboard-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 }); await page.click('[data-board="haunt"]'); await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, 'leaderboard mobile: no horizontal overflow (cards)');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/leaderboard-360.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log('ERRORS:', errors.length ? errors : 'none');
if (fails.length || errors.length) { console.log(`FAILED ${fails.length}`); process.exit(1); }
console.log('ALL HAUNT E2E CHECKS PASSED');
