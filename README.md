# hallowinu.xyz

Statische website van $HALLOWINU. Alles wat live staat zit in `dist/` (HTML, CSS, JS, afbeeldingen, fonts).

## Hosting
- Cloudflare Pages, gekoppeld aan deze repo
- Build command: *(leeg)*
- Build output directory: `dist`
- Elke push naar `main` = automatisch live. Andere branches krijgen een preview-URL.

## Launch-gegevens
Contractadres en DexScreener-link staan in `dist/launch-config.js`:
```js
window.HALLOWINU_LAUNCH = {contract:"", dexscreenerUrl:""};
```
Leeg = pre-launch weergave. Na invullen verschijnen de copy-knop en de live chart.
Verhoog daarna het `?v=` nummer van `launch-config.js` in `index.html` zodat browsers de nieuwe versie laden.
