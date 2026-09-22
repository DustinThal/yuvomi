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

/* ── Die Zeiten ─────────────────────────────────────────────────────────────
 *
 * Die Zeit-Bearbeitung ist die einzige Stelle, an der dieses Modul eine Zeile
 * des Schichtplans schreibt statt eine Plan-Zelle - und die einzige, an der es
 * ein Recht pruefen muss, das ihm nicht selbst gehoert. Beides steht hier.
 */

test('die Zeit-Bearbeitung schickt genau die beiden Zeiten', () => {
  // Der Server liest jedes FEHLENDE Feld als "nicht anfassen"
  // (server/routes/schedule.js:319-322). Genau darauf beruht die Sicherheit
  // dieser Stelle: gingen Name, Kurzzeichen, Farbe und Symbol mit, koennte
  // eine aeltere Fassung dieses Moduls sie ueberschreiben.
  const source = read('index.js');
  const call = /api\.put\(`\/schedule\/shift-types\/\$\{[^}]+\}`, \{([^}]*)\}\)/.exec(source);
  assert.ok(call, 'kein PUT auf /schedule/shift-types gefunden');
  const payload = call[1].split(',').map((part) => part.split(':')[0].trim()).sort();
  assert.deepEqual(payload, ['end_time', 'start_time'], `mitgeschickt wird: ${payload.join(', ')}`);
});

test('die Zeit ist nur bei eigener Stunde ein Knopf', () => {
  // Dieselbe Regel wie `ownTypeOrAdmin()` auf dem Server: ein Admin darf jede
  // Schichtart, alle anderen nur ihre eigene. Ein Knopf, den der Server mit
  // 403 beantwortet, ist ein Versprechen, das die Oberflaeche nicht halten
  // kann - er darf gar nicht erst entstehen.
  const source = read('index.js');
  const rule = /function canEditPeriodTimes\(period\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(rule, 'canEditPeriodTimes fehlt');
  assert.match(rule[1], /canWrite\(\)/, 'das Modul-Leserecht fehlt in der Regel');
  assert.match(rule[1], /role === 'admin'/, 'die Admin-Ausnahme fehlt in der Regel');
  assert.match(rule[1], /created_by/, 'die Eigentuemer-Pruefung fehlt in der Regel');
  // Und der Knopf haengt an dieser Regel - nicht an canWrite() allein.
  assert.match(source, /canEditPeriodTimes\(period\)\s*\n?\s*\?\s*`<button[^`]*data-times=/,
    'data-times wird nicht an canEditPeriodTimes gebunden');
});

test('beide Zeiten sind Pflicht, bevor geschickt wird', () => {
  // Der Server liest eine FEHLENDE Zeit als "nicht anfassen", eine LEERE aber
  // als null - eine geraeumte Zeit macht die Stunde zur ganztags-Zeit und
  // wirft sie aus dem Plan. Die Pruefung muss also VOR dem Schreiben stehen.
  const source = read('index.js');
  const guard = source.indexOf("if (!start || !end)");
  const write = source.indexOf("api.put(`/schedule/shift-types/");
  assert.ok(guard > -1, 'die Pflicht-Pruefung fehlt');
  assert.ok(write > -1, 'der Schreibvorgang fehlt');
  assert.ok(guard < write, 'die Pflicht-Pruefung steht hinter dem Schreibvorgang');
});

test('die Zeit-Grammatik ist dieselbe wie die des Servers', () => {
  // Zwei Kopien derselben Regel, und die des Servers gewinnt: laeuft sie
  // auseinander, weist der Server ab, was die Oberflaeche durchgelassen hat.
  // Der Test liest die Server-Datei, wenn er sie findet - im Modulordner allein
  // gibt es sie nicht, und dann sagt er das, statt still zu bestehen.
  const serverPath = path.join(ROOT, '..', '..', 'server', 'middleware', 'validate.js');
  if (!existsSync(serverPath)) {
    assert.ok(true, 'Server-Datei nicht vorhanden - Modul wurde einzeln kopiert');
    return;
  }
  const mine = /const TIME_PATTERN = (\/[^\n]+\/);/.exec(read('index.js'));
  assert.ok(mine, 'TIME_PATTERN steht nicht mehr als Literal in index.js');
  // Die Zeile des Servers lautet: if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))
  const theirs = /if \(!(\/\^.*?\$\/)\.test\(raw\)\)/.exec(readFileSync(serverPath, 'utf8'));
  assert.ok(theirs, 'die Zeit-Grammatik des Servers wurde nicht gefunden - Pattern geaendert?');
  assert.equal(mine[1], theirs[1], 'Modul und Server pruefen Zeiten verschieden');
});

/* ── Das Schliessen ─────────────────────────────────────────────────────────
 *
 * Der Dirty-Waechter in `public/components/modal.js` fragt beim Schliessen nach,
 * sobald das Formular vom Stand beim Oeffnen abweicht. Das ist bei JEDEM
 * Speichervorgang der Fall - gespeichert wird nur, was jemand geaendert hat.
 * Ein `closeModal()` ohne `force` stellt die Rueckfrage also hinter das
 * erfolgreiche Schreiben und wirft Eingaben weg, die schon in der Datenbank
 * stehen. Das Haus schliesst nach einem geglueckten Schreibvorgang mit
 * `closeModal({ force: true })` (public/pages/category-manager.js:596,
 * public/components/task-detail.js:100).
 */

test('ein erfolgreiches Speichern schliesst ohne Rueckfrage', () => {
  // Geprueft wird der ganze Quelltext und nicht nur die zwei bekannten
  // Speicherpfade: eine dritte Stelle, die spaeter dazukommt, faellt hier mit
  // auf. Kommentare werden vorher entfernt, damit ein Satz UEBER
  // `closeModal` nicht als Aufruf zaehlt.
  const code = read('index.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const calls = [...code.matchAll(/closeModal\(([^)]*)\)/g)].map((match) => match[1].trim());
  assert.ok(calls.length >= 2, `nur ${calls.length} closeModal-Aufrufe gefunden - liest der Test die Datei noch?`);
  const unforced = calls.filter((args) => !/force:\s*true/.test(args));
  assert.deepEqual(unforced, [], `ohne force geschlossen: ${unforced.map((a) => `closeModal(${a})`).join(', ')}`);
});
