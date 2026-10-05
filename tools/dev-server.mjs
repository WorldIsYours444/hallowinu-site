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
  if (!file.startsWith(path.join(root, 'dist')) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`HALLOWINU dev server on http://localhost:${port} (db: ${dbFile})`));
