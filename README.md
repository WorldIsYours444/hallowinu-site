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
Cloudflare Worker (static assets), gekoppeld aan deze repo. Elke push naar `main` = automatisch live.
Deploy command: `npx wrangler deploy --assets=./dist --name=hallowinu-site --compatibility-date=2026-10-01`

## Launch-dag
Vul `dist/launch-config.js` in:
```js
window.HALLOWINU_LAUNCH = {contract:"<adres>", dexscreenerUrl:"https://dexscreener.com/solana/<pair>", buyUrl:"<officiële buy-link>"};
```
Leeg = "coming soon"-modus. Ingevuld = CA + copy-knop, status LIVE, Buy-knoppen linken door, live chart.
Verhoog daarna het `?v=` nummer in `index.html` zodat browsers de nieuwe versie laden.
