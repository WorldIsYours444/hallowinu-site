/* Local dev/e2e server: static ./dist + Worker API backed by a SQLite file (D1 shim).
   Usage: node tools/dev-server.mjs [port] [dbfile]
   Env: ADMIN_TOKEN (default dev token), POOL_WALLET (optional) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Shim } from '../test/d1-shim.mjs';
import worker from '../worker/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8788);
const dbFile = process.argv[3] || ':memory:';
const fresh = dbFile === ':memory:' || !fs.existsSync(dbFile);
const DB = new D1Shim(dbFile);
if (fresh) DB.migrate(path.join(root, 'migrations'));
const env = { DB, ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'dev-admin-token-please-change-0000', POOL_WALLET: process.env.POOL_WALLET || '', IP_SALT: 'dev' };
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_CHAT_ID', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_OFFICIAL_USER_ID']) if (process.env[k]) env[k] = process.env[k];
/* DEV ONLY: DEV_FAKE_X=1 simulates the X API (no network, no cost) for local E2E tests.
   Targets: 19-digit ids. Replies: <target id>0<n>, authored by the fake connected user 4242.
   X posts: 18-digit ids starting with 8 (text post) or 9 (meme with a photo), by 4242.
   TikTok oEmbed: any tiktok.com/@handle/video/<id> exists, creator = handle, caption mentions #hallowinu. */
if (process.env.DEV_FAKE_X) {
  Object.assign(env, { X_BEARER_TOKEN: 'dev', X_CLIENT_ID: 'dev', X_CLIENT_SECRET: 'dev' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    const j = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://www.tiktok.com/oembed')) {
      const mm = decodeURIComponent(url).match(/@([\w.]+)\/video\/(\d+)/);
      return mm ? j({ type: 'video', author_unique_id: mm[1].toLowerCase(), title: 'ghost dog dance #hallowinu', embed_product_id: mm[2] }) : j({}, 400);
    }
    if (!url.startsWith('https://api.x.com/')) return realFetch(u, init);
    if (url.endsWith('/2/oauth2/token')) return j({ access_token: 'dev' });
    if (url.endsWith('/2/oauth2/revoke')) return j({});
    if (url.endsWith('/2/users/me')) return j({ data: { id: '4242', username: 'devghost' } });
    const m = url.match(/\/2\/tweets\/(\d+)/);
    if (m) {
      const id = m[1];
      if (id.length === 19) return j({ data: { id, author_id: '777', conversation_id: id, created_at: new Date(Date.now() - 3600_000).toISOString(), text: 'Solana memecoin season — which $SOL meme are you holding?' }, includes: { users: [{ id: '777', username: 'solanaKOL' }] } });
      if (id.length === 18 && (id[0] === '8' || id[0] === '9')) {
        const meme = id[0] === '9';
        return j({ data: { id, author_id: '4242', conversation_id: id, created_at: new Date().toISOString(), text: meme ? '$HALLOWINU 👻' : `The ghost dog $HALLOWINU is haunting Solana tonight ${id.slice(-4)}`, ...(meme ? { attachments: { media_keys: ['3_' + id] } } : {}) },
          includes: meme ? { media: [{ media_key: '3_' + id, type: 'photo' }] } : {} });
      }
      const parent = id.slice(0, 19), n = id.slice(20);
      if (id.length > 20 && id[19] === '0') return j({ data: { id, author_id: '4242', conversation_id: parent, created_at: new Date().toISOString(), text: `@solanaKOL the ghost dog is haunting this timeline ${n}`, referenced_tweets: [{ type: 'replied_to', id: parent }] } });
      return j({ errors: [{ title: 'Not Found Error' }] });
    }
    return j({ title: 'unknown' }, 404);
  };
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
    const r = await worker.fetch(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let file = path.join(root, 'dist', decodeURIComponent(url.pathname));
  if (file.endsWith('/')) file += 'index.html';
  else if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';   // like Cloudflare: /arcade -> arcade.html
  if (!file.startsWith(path.join(root, 'dist')) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`HALLOWINU dev server on http://localhost:${port} (db: ${dbFile})`));
