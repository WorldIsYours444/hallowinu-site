# hallowinu.xyz

Statische website van $HALLOWINU. Alles wat live staat zit in `dist/`.

## Structuur
- `dist/index.html` — alle secties (hero, about, dream, arcade, roadmap, token, community)
- `dist/hallowinu.css` — design system (kleuren, pixel-UI, responsive)
- `dist/hallowinu.js` — nav, animaties, sprites (praat-shiba, vleermuizen, footer-runner), Trick or Treat-preview
- `dist/launch-config.js` + `dist/launch.js` — contractadres, buy-link en DexScreener-chart
- `dist/img/` — geoptimaliseerde afbeeldingen (webp) en sprites
- `dist/fonts/` — Creepster, Press Start 2P, Barlow Condensed, Inter (woff)

## Hosting
Cloudflare Worker (static assets + Arcade API), gekoppeld aan deze repo. Elke push naar `main` = automatisch live.
Config: `wrangler.jsonc`.

## Launch-dag
Vul `dist/launch-config.js` in:
```js
window.HALLOWINU_LAUNCH = {contract:"<adres>", dexscreenerUrl:"https://dexscreener.com/solana/<pair>", buyUrl:"<officiële buy-link>"};
```
Leeg = "coming soon"-modus. Ingevuld = CA + copy-knop, status LIVE, Buy-knoppen linken door, live chart.
Verhoog daarna het `?v=` nummer in `index.html` zodat browsers de nieuwe versie laden.

## HALLOWINU Arcade
De Arcade (4 games, punten, seizoenen, prize pool) draait in dezelfde Worker met een D1-database.
Zie **docs/ARCADE.md** voor architectuur, admin-handleiding en configuratie (`worker/config.js`).
- Tests: `npm test` · Lokaal: `node tools/dev-server.mjs 8788 /tmp/dev.db`
- Admin: `/admin.html` met het `ADMIN_TOKEN` secret
- Deploy command (Workers Builds): `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`

## ESCAPE THE TRENCHES (3D runner)
Losstaande 3D voxel-runner op `/escape-the-trenches` (knop "ESCAPE THE TRENCHES" in de header, opent in een nieuw tabblad).
Niet onderdeel van de Arcade; punten gaan wel naar dezelfde ledger (server herspeelt elke run, automatische inwisseling bij de volgende run).
Zie **docs/ESCAPE_TRENCHES.md**. Spelregels/munten: `dist/ett/config.js` · beloningsregels: `worker/config.js` (`escapeTrenches`).
- E2E: `NODE_PATH=$(npm root -g) node test/e2e-ett.mjs` (met de dev server aan)

## Telegram bot API (read-only)
De officiële Telegram-bot leest de publieke leaderboards (`/api/ett/leaderboard`, `/api/leaderboard`, `/api/haunt/leaderboard`), `/api/season`, `site-config.js` en `launch-config.js`.
Optioneel: `GET /api/bot/rank?telegram_id=<id>` met header `Authorization: Bearer <BOT_API_TOKEN>` geeft naam + ranks van een speler die zélf zijn Telegram heeft gekoppeld (opt-in). Nooit wallets of interne ids.
Aanzetten: zet het Worker-secret `BOT_API_TOKEN` (min. 24 tekens) en dezelfde waarde als Railway-variabele `BOT_API_TOKEN` bij de bot. Zonder secret antwoordt het endpoint `503`.
