/**
 * Modul: Stundenplan - der eigene Ton
 * Zweck: Die eine Stelle, an der dieses Modul seine Farbe als Zeichenkette
 *        fuehrt. Die Kachel braucht sie, weil sie auf dem Dashboard steht und
 *        dort kein Modul-Stylesheet gilt.
 *
 * Abhaengigkeiten: keine. Diese Datei importiert nichts, damit sowohl
 *        `widgets/tomorrow.js` als auch `test/school-planner.test.js` (unter
 *        `node --test`) sie laden koennen.
 *
 * ── Warum hier ein Hexwert steht, obwohl es ein Modul-Token gibt ────────────
 *
 * Yuvomis Modulseiten tragen ihren Ton als CSS-Token `--module-<id>`, und der
 * Kopf erbt ihn. Fuer DRITTANBIETER-MODULE GIBT ES DIESES TOKEN NICHT: die
 * Tabelle in `public/styles/tokens.css` listet die eingebauten Module, und ein
 * Modul, das der Betreiber spaeter in seinen Ordner legt, kann dort nicht
 * stehen. Die Shell traegt den Akzent eines Fremdmoduls stattdessen als
 * aufgeloesten Wert in `--active-module-accent` auf `document.documentElement`
 * (public/router.js, `applyModuleAccentForRoute`) - das ist die Route der
 * GERADE GEZEIGTEN Seite. Auf dem Dashboard ist das das Dashboard.
 *
 * Die Kachel sitzt also an der Mischstelle und hat keinen geerbten Ton. Wuerde
 * sie den App-Akzent nehmen, waere sie die einzige Kachel ohne Herkunft; die
 * Herkunfts-Regel des Hauses (public/pages/dashboard.js, Block 2) verlangt das
 * Siegel gerade dort.
 *
 * `module.json` fuehrt denselben Wert unter `accent` - eine JSON-Datei kann
 * keine JavaScript-Datei importieren, und der Server braucht ihn dort fuer
 * Menue, Statusbar und die Modul-Liste der Einstellungen. ZWEI HAELFTEN EINER
 * TATSACHE, deshalb ist die Uebereinstimmung geprueft und nicht behauptet:
 * `test/school-planner.test.js` liest beide Dateien und vergleicht sie.
 */
export const MODULE_ACCENT = '#4F46E5';
