/* End-to-end browser test for ESCAPE THE TRENCHES against the local dev server.
   node tools/dev-server.mjs 8788 /tmp/dev.db   then   NODE_PATH=$(npm root -g) node test/e2e-ett.mjs [baseUrl]
   Mock Phantom backed by a real ed25519 key → real server-side signature checks. */
import { createRequire } from 'node:module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url);
const { chromium } = require('playwright');
import { webcrypto as crypto } from 'node:crypto';
import { base58Encode } from '../worker/lib/auth.js';

const BASE = process.argv[2] || 'http://localhost:8788';
const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); console.log('  ✖', msg); } else console.log('  ✔', msg); };

const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pub = base58Encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.exposeBinding('__phantomSign', async (_s, bytes) => [...new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new Uint8Array(bytes)))]);
await ctx.addInitScript(pub => {
  const provider = { isPhantom: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => pub }; return { publicKey: this.publicKey }; },
    async disconnect() {}, async signMessage(msg) { return { signature: new Uint8Array(await window.__phantomSign([...msg])) }; },
    signTransaction() { window.__txRequested = true; throw new Error('no'); }, on() {} };
  window.phantom = { solana: provider };
}, pub);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

async function runUntilDeath(drive = 0) {
  await page.locator('[data-act="play"]:visible').first().click();
  await page.waitForFunction(() => window.__ETT.G.screen === 'run', null, { timeout: 15000 });
  if (drive) await page.evaluate(metres => {
    // real-time "player": presses the same buttons a human would (inputs go through the normal input path)
    const E = window.__ETT, names = ['left', 'right', 'jump', 'duck'];
    const safe = (x, t) => { const c = x.clone(); for (let i = 0; i < t && !c.dead; i++) c.step(null); return !c.dead && c.stats.stumbles === x.stats.stumbles; };
    const id = setInterval(() => {
      const s = E.G.sim; if (!s || s.dead || E.G.screen !== 'run') { clearInterval(id); return; }
      if (s.pz > metres || E.G.queue.length) return;
      if (!safe(s, 50)) { for (const ch of [[0], [1], [2], [3], [0, 2], [1, 2]]) { const c = s.clone(); c.step(ch); if (safe(c, 50)) { ch.forEach(k => E.act(names[k])); return; } } return; }
      const coin = s.coins.find(c => !c.taken && c.z > s.pz + 4 && c.z < s.pz + 25);
      if (coin && coin.lane !== s.lane) { const ch = [coin.lane < s.lane ? 0 : 1]; const c = s.clone(); c.step(ch); if (safe(c, 60)) E.act(names[ch[0]]); }
    }, 40);
  }, drive);
  // run straight down the centre lane until the first obstacle ends the run (real time)
  await page.waitForFunction(() => window.__ETT.G.screen === 'over', null, { timeout: 400000, polling: 500 });
  await page.waitForFunction(() => !/VERIFYING/.test(document.querySelector('#o-status').textContent), null, { timeout: 30000 });
}

console.log('ESCAPE THE TRENCHES — E2E');
await page.goto(BASE + '/escape-the-trenches');
await page.waitForFunction(() => window.__ETT && window.__ETT.G.screen === 'menu', null, { timeout: 60000 });
check(await page.isVisible('#s-menu'), 'standalone page loads its own main menu');
check((await page.textContent('#earn-note')).includes('guest'), 'guest notice before sign-in');
for (const t of ['PLAY', 'SELECT CHARACTER', 'LEADERBOARD', 'HOW TO PLAY', 'SETTINGS', 'FULLSCREEN', 'BACK TO HALLOWINU']) check((await page.textContent('#s-menu .menu-buttons')).includes(t), `menu button ${t}`);
check(await page.locator('#menu-strip .cc').count() === 4, 'four playable Inus');

// guest run
await runUntilDeath();
check((await page.textContent('#o-status')).includes('Guest run'), 'guest run shows not-earning status');
await page.waitForTimeout(1500);
check(+(await page.textContent('#o-dist')).replace(/\D/g, '') > 0, 'game over shows distance');
await page.click('#s-over [data-act="menu"]');

// sign in + name
await page.click('#acct-connect');
await page.waitForSelector('#name-dlg[open]', { timeout: 15000 });
await page.fill('#name-input', 'Trench' + Math.floor(Math.random() * 9999));
await page.click('#name-form [value="ok"]');
await page.waitForFunction(() => window.__ETT.G.account && window.__ETT.G.account.canPlay, null, { timeout: 15000 });
check(!(await page.evaluate(() => window.__txRequested)), 'no transaction ever requested');

// character select persists
await page.click('#s-menu [data-go="select"]');
await page.click('[data-sel="1"]'); await page.click('[data-sel="1"]');
await page.click('#s-select [data-act="choose"]');
check(await page.evaluate(() => JSON.parse(localStorage.getItem('ett.character'))) === 'artificial-inu', 'character choice saved');

// earning run 1 (steered to collect coins, then left to crash)
await runUntilDeath(150);
const st1 = await page.textContent('#o-status');
check(/VERIFIED · PENDING|nothing to redeem/.test(st1), 'run verified by server replay → pending: ' + st1.trim().slice(0, 60));
await page.waitForTimeout(1500);
const score1 = +(await page.textContent('#o-score')).replace(/\D/g, '');
check(score1 > 0, 'coins collected → score ' + score1);
check((await page.textContent('#o-char')) === 'ARTIFICIAL INU', 'stats show the character used');

// play again → automatic redemption
const before = await page.evaluate(() => fetch('/api/me').then(r => r.json()).then(d => d.player.totalPoints));
await runUntilDeath();
const after = await page.evaluate(() => fetch('/api/me').then(r => r.json()).then(d => d.player.totalPoints));
check(after - before === score1, `previous run auto-redeemed on PLAY AGAIN (+${after - before}, expected +${score1})`);
const me = await page.evaluate(() => fetch('/api/ett/me').then(r => r.json()));
check(me.history.length === 2 && me.history[1].redemption === (score1 > 0 ? 'REDEEMED' : 'NONE'), 'history shows the redeemed run');

// leaderboard screen
await page.click('#s-over [data-go="board"]');
await page.waitForSelector('#lb-body table, #lb-body p');
check(await page.isVisible('#s-board'), 'leaderboard opens inside the game');
await page.click('#lb-range [data-range="mine"]');
await page.waitForSelector('#lb-body .hist', { timeout: 10000 });
check(await page.locator('#lb-body .hist tbody tr').count() === 2, 'personal history lists both runs');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
