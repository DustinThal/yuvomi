/**
 * Modul: Stundenplan - Tests der Auslieferung
 * Zweck: Sichert die vier Stellen ab, an denen dieses Modul an einer ZUSAGE
 *        haengt, die es selbst nicht halten kann: die Sprache (jeder benutzte
 *        Schluessel muss in beiden Locale-Dateien stehen), der eigene Ton
 *        (theme.js gegen module.json), die Dateien, die das Manifest nennt
 *        (ein fehlender Kachel-Eintrag laesst das ganze Modul als fehlerhaft
 *        laden) und die Form der Locale-Dateien (flach und ohne Praefix, weil
 *        der Kern sie so verschachtelt).
 *
 * Ausfuehren: node --test modules/school-planner/test/school-planner.test.js
 *
 * Bewusst NICHT in der Suite-Kette von package.json - wie die Tests der reinen
 * Funktionen daneben: dieses Modul liegt unter `modules/`, ist damit gitignored
 * (`.gitignore`: `modules/*`) und wird als Ordner ausgeliefert. Ein
 * `test:`-Script auf eine Datei, die im Upstream-Checkout nicht existiert,
 * wuerde `npm test` dort rot machen.
 *
 * Die Dateien werden GELESEN und nicht importiert: `index.js` und
 * `widgets/tomorrow.js` importieren `/api.js` und `/utils/...`, also absolute
 * Browser-Pfade, die Node nicht aufloest. Ein Test, der sie dennoch laden will,
 * braucht einen Stub-Loader - und ein Stub ist eine zweite Kopie, die nur
 * auseinanderlaufen kann. Was hier geprueft wird, ist ohnehin Text: welche
 * Schluessel im Quelltext stehen, nicht was sie zur Laufzeit ergeben.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const read = (relPath) => readFileSync(path.join(ROOT, relPath), 'utf8');
const readJson = (relPath) => JSON.parse(read(relPath));

const manifest = readJson('module.json');
const LOCALES = ['de', 'en'];
const localeDicts = Object.fromEntries(LOCALES.map((loc) => [loc, readJson(`locales/${loc}.json`)]));

const SOURCES = ['index.js', 'data.js', 'widgets/tomorrow.js', 'theme.js'];

/** Die Schluessel des Moduls, die im Quelltext als `extensions.school-planner.X` stehen. */
function usedKeys() {
  const keys = new Set();
  for (const file of SOURCES) {
    const source = read(file);
    for (const match of source.matchAll(/['"`]extensions\.school-planner\.([a-zA-Z0-9._-]+)['"`]/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

/** Die Schluessel, die das Manifest ueber `labelKey` nennt - sie kommen aus der Locale-Datei, nicht aus dem Code. */
function manifestLabelKeys() {
  const keys = [];
  if (manifest.menu?.labelKey) keys.push(manifest.menu.labelKey);
  if (manifest.capabilities?.permissions?.module?.labelKey) keys.push(manifest.capabilities.permissions.module.labelKey);
  for (const widget of manifest.capabilities?.widgets ?? []) {
    if (widget.labelKey) keys.push(widget.labelKey);
  }
  for (const widget of manifest.capabilities?.permissions?.widgets ?? []) {
    if (widget.labelKey) keys.push(widget.labelKey);
  }
  return [...new Set(keys)].sort();
}

test('jeder benutzte Schluessel steht in beiden Sprachen', () => {
  // `t()` gibt den Schluessel selbst zurueck, wenn er fehlt - aus einem
  // fehlenden Eintrag wird also kein Fehler, sondern sichtbarer Text wie
  // "extensions.school-planner.tab.week" mitten in der Oberflaeche.
  const keys = [...new Set([...usedKeys(), ...manifestLabelKeys()])];
  assert.ok(keys.length > 30, `nur ${keys.length} Schluessel gefunden - liest der Test die Dateien noch?`);
  const missing = [];
  for (const key of keys) {
    for (const loc of LOCALES) {
      if (typeof localeDicts[loc][key] !== 'string') missing.push(`${loc}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `fehlende Uebersetzungen:\n  ${missing.join('\n  ')}`);
});

test('die Sprachdateien stehen vollstaendig nebeneinander', () => {
  // Eine Sprache, die spaeter einen Schluessel dazubekommt und die andere
  // nicht, faellt sonst erst in der uebersetzten Oberflaeche auf.
  const de = Object.keys(localeDicts.de).sort();
  const en = Object.keys(localeDicts.en).sort();
  assert.deepEqual(en, de, 'de.json und en.json fuehren verschiedene Schluessel');
});

test('die Sprachdateien sind flach und tragen kein extensions-Praefix', () => {
  // Der Kern verschachtelt sie selbst (`nestFlatLocaleDict`) und haengt
  // `extensions.<id>.` davor. Ein Praefix in der Datei ergaebe den Schluessel
  // doppelt, ein Punkt im Wert waere ein zweiter Verschachtelungsschritt.
  for (const loc of LOCALES) {
    for (const [key, value] of Object.entries(localeDicts[loc])) {
      assert.doesNotMatch(key, /^extensions\./, `${loc}.json: "${key}" traegt das Praefix selbst`);
      assert.equal(typeof value, 'string', `${loc}.json: "${key}" ist kein Text`);
      assert.notEqual(value.trim(), '', `${loc}.json: "${key}" ist leer`);
    }
  }
});

test('Platzhalter sind in beiden Sprachen dieselben', () => {
  // Ein Platzhalter, der nur in einer Sprache steht, bleibt in der anderen als
  // "{{name}}" stehen - t() laesst unbekannte Platzhalter absichtlich sehen.
  const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(localeDicts.de)) {
    assert.deepEqual(
      placeholders(localeDicts.en[key]),
      placeholders(localeDicts.de[key]),
      `"${key}" hat in de/en verschiedene Platzhalter`,
    );
  }
});

test('die Doppelklammer ist die Interpolation des Hauses', () => {
  // `t()` ersetzt `{{name}}`. Eine einfache Klammer `{name}` bleibt stehen.
  for (const loc of LOCALES) {
    for (const [key, value] of Object.entries(localeDicts[loc])) {
      assert.doesNotMatch(value, /(^|[^{])\{[a-zA-Z_]\w*\}/, `${loc}.json: "${key}" benutzt einfache Klammern`);
    }
  }
});

test('der eigene Ton stimmt mit dem Manifest ueberein', () => {
  // Zwei Haelften einer Tatsache: `module.json` traegt den Akzent fuer den
  // Server (Menue, Statusbar, Einstellungsliste), `theme.js` fuer die Kachel,
  // die auf dem Dashboard kein Modul-Stylesheet hat. Eine JSON-Datei kann
  // keine JavaScript-Datei importieren, also wird verglichen statt geteilt.
  const source = read('theme.js');
  const match = /export const MODULE_ACCENT = '([^']+)'/.exec(source);
  assert.ok(match, 'MODULE_ACCENT steht nicht mehr als Zeichenkette in theme.js');
  assert.equal(match[1].toLowerCase(), String(manifest.accent).toLowerCase());
});

test('die Kachel setzt den Akzent aus theme.js und nicht als eigenen Wert', () => {
  const source = read('widgets/tomorrow.js');
  assert.match(source, /import \{ MODULE_ACCENT \} from '\.\.\/theme\.js'/, 'die Kachel importiert den Ton nicht');
  assert.match(source, /--seal-accent:\$\{MODULE_ACCENT\}/, 'das Siegel traegt den Ton nicht');
  // Ein zweiter Hexwert in der Kachel waere die dritte Kopie derselben Farbe.
  const hexes = [...source.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0]);
  assert.deepEqual(hexes, [], `die Kachel fuehrt eigene Farbwerte: ${hexes.join(', ')}`);
});

test('jede vom Manifest genannte Datei existiert', () => {
  // `normalizeCapabilities` wirft, wenn ein Kachel-Eintrag fehlt ("Widget ...
  // entry file does not exist"), und das Modul laedt dann als fehlerhaft -
  // die Kachel waere nicht leer, sondern das ganze Modul nicht da.
  const referenced = [manifest.entry, manifest.style];
  for (const widget of manifest.capabilities?.widgets ?? []) referenced.push(widget.entry);
  for (const relPath of referenced) {
    assert.ok(relPath, 'das Manifest nennt eine leere Datei');
    assert.ok(existsSync(path.join(ROOT, relPath)), `${relPath} fehlt`);
  }
});

test('die Kachel exportiert renderWidget', () => {
  // Der Kern prueft genau das und ersetzt die Kachel sonst durch seine
  // Fehlerkachel (public/pages/dashboard.js, `mountExtensionWidgets`).
  const source = read('widgets/tomorrow.js');
  assert.match(source, /export async function renderWidget\(container, \{ size \} = \{\}\)/);
});

test('die Kachel laedt ihr Stylesheet ueber import.meta.url', () => {
  // Ein fest verdrahteter Pfad waere die zweite Stelle, die die Modul-Id
  // kennt. `import.meta.url` zeigt auf die Kachel selbst, der Ablageort des
  // Moduls steht damit genau einmal fest.
  const source = read('widgets/tomorrow.js');
  assert.match(source, /new URL\('\.\.\/style\.css', import\.meta\.url\)\.href/);
});

test('das Manifest bleibt im Format 1', () => {
  // `manifestVersion` ist die Version des FORMATS, nicht des Moduls. Ein
  // hoeherer Wert wird von `normalizeManifest` rundheraus abgelehnt.
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.id, 'school-planner');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.i18n?.defaultLocale, 'de');
});
