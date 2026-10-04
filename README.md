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
