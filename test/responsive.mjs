/* Responsive QA: horizontal overflow, clipped text, socials pairing, dead links at 8 widths.
   Run: NODE_PATH=$(npm root -g) node test/responsive.mjs [baseUrl] [shotsDir] */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH.split(':')[0] + '/' : import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8788';
const SHOTS = process.argv[3] || '';
const WIDTHS = [1920, 1440, 1280, 1024, 768, 430, 390, 375];
const browser = await chromium.launch();
let problems = 0;
const PATHS = ['/', '/arcade', '/haunt', '/leaderboard', '/token'];
for (const path of PATHS) for (const w of WIDTHS) {
  const mobile = w <= 430;
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  // reveal everything
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const out = { hscroll: document.documentElement.scrollWidth - window.innerWidth, clipped: [], outside: [] };
    const vis = el => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0 && !el.closest('[hidden],dialog:not([open]),.sr,.mobile-menu:not(.open),noscript'); };
    for (const el of document.querySelectorAll('main *, header *, footer *')) {
      if (!vis(el) || el.closest('svg') || el.matches('svg,img,canvas,iframe,.fx,.sky,.hero-stage *,.embers,.runner,.ground *,.chart-ghost,.burst *')) continue;
      const s = getComputedStyle(el);
      const textual = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (textual && (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2))
        out.clipped.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}"`);
      const b = el.getBoundingClientRect();
      if (textual && (b.right > window.innerWidth + 1 || b.left < -1) && !el.closest('.ax-table-wrap,.marquee,.hero-frame')) out.outside.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}" (${Math.round(b.left)}..${Math.round(b.right)})`);
    }
    // socials pairing per component
    const groups = new Map();
    for (const a of document.querySelectorAll('a[href*="x.com/hionchains" i], a[href*="t.me/"]')) {
      const g = a.closest('.socials,.menu-actions,.cta-row,.official-links,.portals,.foot-col,.modal-actions') || a.parentElement;
      const e = groups.get(g) || { x: 0, tg: 0 }; a.href.includes('t.me/') ? e.tg++ : e.x++; groups.set(g, e);
    }
    out.unpaired = [...groups.entries()].filter(([, v]) => v.x !== v.tg).map(([g]) => g.className);
    out.deadButtons = [...document.querySelectorAll('a[href]')].filter(a => vis(a) && (a.getAttribute('href') === '#' || a.getAttribute('href') === '')).length;
    return out;
  });
  const bad = r.hscroll > 0 || r.clipped.length || r.outside.length || r.unpaired.length || r.deadButtons || errs.length;
  if (bad) problems++;
  console.log(`${path} ${w}px  hscroll:${r.hscroll}  clipped:${r.clipped.length}  outside:${r.outside.length}  unpairedSocials:${r.unpaired.length}  deadLinks:${r.deadButtons}  jsErrors:${errs.length}`);
  for (const k of ['clipped', 'outside', 'unpaired']) r[k].slice(0, 6).forEach(x => console.log(`   ${k}: ${x}`));
  errs.slice(0, 3).forEach(e => console.log('   err:', e));
  if (SHOTS && path === '/') {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const sel of ['.hud', '.hero-hud', '#arcade', '#roadmap', '#explore', '#community', '.footer']) {
      const el = page.locator(sel).first();
      await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
      await el.screenshot({ path: `${SHOTS}/${w}-${sel.replace(/[^a-z-]/g, '')}.png` }).catch(() => {});
    }
    if (mobile) { await page.click('.menu-toggle'); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${w}-menu.png` }); }
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} width(s) with problems` : '\nALL WIDTHS CLEAN');
process.exit(problems ? 1 : 0);
