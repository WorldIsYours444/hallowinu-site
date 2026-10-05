/* End-to-end browser test against the local dev server (node tools/dev-server.mjs 8788 <db>).
   Uses a mock Phantom provider backed by a REAL ed25519 key in Node, so the server verifies real signatures.
   Run: NODE_PATH=$(npm root -g) node test/e2e.mjs [baseUrl] */
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url);
const { chromium } = require('playwright');
import { webcrypto as crypto } from 'node:crypto';
import { base58Encode } from '../worker/lib/auth.js';

const BASE = process.argv[2] || 'http://localhost:8788';
const out = (...a) => console.log(...a);
const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); out('  ✖', msg); } else out('  ✔', msg); };

async function wallet() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = base58Encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  return { pub, sign: async bytes => [...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new Uint8Array(bytes)))] };
}

async function withPhantom(context, w, { reject = false } = {}) {
  await context.exposeBinding('__phantomSign', async (_src, bytes) => w.sign(bytes));
  await context.addInitScript(({ pub, reject }) => {
    const listeners = {};
    const provider = {
      isPhantom: true, publicKey: null,
      async connect() { this.publicKey = { toString: () => pub }; return { publicKey: this.publicKey }; },
      async disconnect() { this.publicKey = null; (listeners.disconnect || []).forEach(f => f()); },
      async signMessage(msg) {
        window.__signedMessages = (window.__signedMessages || []).concat([new TextDecoder().decode(msg)]);
        if (reject) { const e = new Error('User rejected'); e.code = 4001; throw e; }
        return { signature: new Uint8Array(await window.__phantomSign([...msg])), publicKey: this.publicKey };
      },
      // must never be called by the site
      signTransaction() { window.__txRequested = true; throw new Error('no'); },
      signAndSendTransaction() { window.__txRequested = true; throw new Error('no'); },
      on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); },
    };
    window.phantom = { solana: provider };
  }, { pub: w.pub, reject });
}

const browser = await chromium.launch();
const errors = [];
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500 || (r.status() === 404 && !r.url().includes('favicon'))) errors.push(`${label}: ${r.status()} ${r.url()}`); });
}

/* ---------- 1. new player journey ---------- */
out('NEW PLAYER JOURNEY');
const w1 = await wallet();
const NAME = 'GHOST' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await withPhantom(ctx, w1);
let page = await ctx.newPage(); watch(page, 'new');
await page.goto(BASE + '/arcade'); await page.waitForSelector('[data-connect]');
check(await page.locator('.ob-steps li').count() === 5, 'onboarding shows 5 steps');
// play before sign-in -> prompt, no modal
await page.click('[data-play="trick-or-treat"]');
check(!(await page.locator('[data-game-modal][open]').count()), 'games locked before sign-in');
await page.click('[data-connect]');
await page.waitForSelector('#ax-newname', { timeout: 10000 });
const msgs = await page.evaluate(() => window.__signedMessages);
check(msgs && /HALLOWINU ARCADE - SIGN IN/.test(msgs[0]) && /NOT a transaction/.test(msgs[0]), 'human-readable sign-in message');
check(!(await page.evaluate(() => window.__txRequested)), 'no transaction requested');
check(await page.locator('.ob-steps li.ok').count() === 2, 'wallet connected + verified checked');
check(await page.locator('.ob-steps li.soon').count() === 2, 'X/Telegram shown as SOON (never faked) when not configured');
check(!(await page.locator('[data-verify]').count()), 'no verify buttons while socials are not live');
await page.fill('#ax-newname', 'admin');
await page.click('[data-name-form] button[type=submit]');
await page.waitForSelector('[data-name-msg].bad');
check(/reserved/i.test(await page.textContent('[data-name-msg]')), 'reserved name rejected in UI');
await page.fill('#ax-newname', NAME);
await page.click('[data-name-form] button[type=submit]');
await page.waitForSelector('[data-enter-arcade]');
check(await page.locator('.ob-steps li.ok').count() === 3, 'name step checked');
await page.click('[data-enter-arcade]');
await page.waitForSelector('[data-card]:not([hidden])');
check((await page.textContent('[data-name]')) === NAME, 'player card shows name');
check((await page.textContent('[data-wallet]')).includes(w1.pub.slice(0, 4)), 'shortened wallet in own card');

// Trick or Treat
await page.click('[data-play="trick-or-treat"]');
await page.click('[data-pick="treat"]');
await page.waitForSelector('.tot-result', { timeout: 8000 });
check(/PTS/.test(await page.textContent('.tot-result')), 'trick or treat result');
await page.click('[data-back]');
// Daily spin
await page.click('[data-play="daily-spin"]');
await page.click('[data-spin]');
await page.waitForSelector('.tot-result', { timeout: 10000 });
check(/NEXT SPIN \d/.test(await page.textContent('[data-spin-next]')), 'server countdown after spin');
await page.click('[data-back]');
// Quiz
await page.click('[data-play="quiz"]');
await page.waitForSelector('[data-a]');
await page.click('[data-a="0"]');
await page.waitForSelector('.quiz-result');
check(true, 'quiz answered');
await page.click('.quiz-result [data-back]');
// Pumpkin hunt (short: start then close -> server settles)
await page.click('[data-play="pumpkin-hunt"]');
await page.click('[data-start]');
await page.waitForSelector('.hunt-board');
await page.waitForTimeout(4200);
const t = page.locator('.hunt-board .target').first();
if (await t.count()) await t.dispatchEvent('pointerdown');
await page.waitForTimeout(500);
await page.click('[data-game-modal] [data-close]');
await page.waitForTimeout(800);
const lb = await page.textContent('[data-rows]');
check(lb.includes(NAME), 'leaderboard shows player name');
check(!lb.includes(w1.pub), 'leaderboard does not expose wallet');
check(/NOT ELIGIBLE/.test(lb), 'ineligible player gets no prize estimate');
const pts1 = await page.textContent('[data-stat="totalPoints"]');

// manipulated request: client tries to set points
const manip = await page.evaluate(async () => (await fetch('/api/games/trick-or-treat/play', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hw-client': '1' }, body: JSON.stringify({ choice: 'treat', idem: 'manip-' + Date.now(), points: 99999 }) })).json());
check(!manip.ok || manip.points < 1000, 'client cannot set its own points');
// logout -> games locked
await page.click('[data-card] [data-logout]');
await page.waitForSelector('[data-connect]');
const after = await page.evaluate(async () => (await fetch('/api/games/trick-or-treat/play', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hw-client': '1' }, body: JSON.stringify({ choice: 'treat', idem: 'post-logout-1' }) })).status);
check(after === 401, 'logout ends server session');

/* ---------- 2. returning player on a new device ---------- */
out('RETURNING PLAYER');
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await withPhantom(ctx2, w1);
const p2 = await ctx2.newPage(); watch(p2, 'return');
await p2.goto(BASE + '/arcade'); await p2.click('[data-connect]');
await p2.waitForSelector('[data-card]:not([hidden])', { timeout: 10000 });
check((await p2.textContent('[data-name]')) === NAME, 'same account restored');
check((await p2.textContent('[data-stat="totalPoints"]')) === pts1 || Number((await p2.textContent('[data-stat="totalPoints"]')).replace(/,/g, '')) >= Number(pts1.replace(/,/g, '')), 'points persisted');
check(/Next \d/.test(await p2.textContent('[data-game="daily-spin"] [data-limit]')), 'spin cooldown follows the account');

/* ---------- 3. signature rejected ---------- */
out('SIGNATURE REJECTED');
const ctx3 = await browser.newContext();
await withPhantom(ctx3, await wallet(), { reject: true });
const p3 = await ctx3.newPage(); watch(p3, 'reject');
await p3.goto(BASE + '/arcade'); await p3.click('[data-connect]');
await p3.waitForSelector('[data-sign]');
check(await p3.locator('[data-card][hidden]').count() === 1, 'no access without signature');

/* ---------- 4. no Phantom (desktop + mobile) ---------- */
out('NO PHANTOM');
const p4 = await (await browser.newContext()).newPage(); watch(p4, 'nophantom');
await p4.goto(BASE + '/arcade'); await p4.waitForSelector('text=Install Phantom');
check(true, 'desktop: install link');
const p5 = await (await browser.newContext({ ...{ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } })).newPage(); watch(p5, 'mobile');
await p5.goto(BASE + '/arcade'); await p5.waitForSelector('text=Open in Phantom');
check((await p5.getAttribute('a:has-text("Open in Phantom")', 'href')).startsWith('https://phantom.app/ul/browse/'), 'mobile: Phantom deep link');

await browser.close();
// Two intentional negative requests produce browser console noise: the reserved name (400) and the post-logout play (401).
const expected = ['new: Failed to load resource: the server responded with a status of 400 (Bad Request)', 'new: Failed to load resource: the server responded with a status of 401 (Unauthorized)'];
const relevant = errors.filter(e => !/favicon/.test(e)).filter(e => { const i = expected.indexOf(e); if (i >= 0) { expected.splice(i, 1); return false; } return true; });
out('\nCONSOLE/NETWORK ERRORS:', relevant.length ? relevant : 'none');
// expected 401 after logout is a fetch, not console error
if (fails.length || relevant.length) { out(`\nFAILED: ${fails.length} checks, ${relevant.length} errors`); process.exit(1); }
out('\nALL E2E CHECKS PASSED');
