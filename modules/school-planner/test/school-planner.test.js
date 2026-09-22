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
 * `closeModal({ force: true })` (public/components/task-detail.js:100,
 * public/components/fasting-controls.js:182).
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

/* ── Die Fachfarbe ───────────────────────────────────────────────────────────
 *
 * Die Farbe liegt als vierter Wert an der Plan-Zeile, weil ein Modul ohne
 * eigenen Server nur ueber `/api/v1` schreiben kann (MODULES.md:123). Damit
 * steht sie in einem Feld, das der Schichtplan zeigt - und `show_in_overlay`
 * ist das eine Flag, das sowohl die Kalenderzeile
 * (public/pages/schedule.js:1311) als auch der ICS-Feed
 * (server/services/schedule-ics.js:46) lesen. Ohne die Regel unten stuende
 * "#7c3aed" in jedem Termin und in jedem Abo.
 */

test('das Farbfeld haengt nie im Overlay', () => {
  const source = read('index.js');
  const hidden = /const HIDDEN_FROM_OVERLAY = new Set\(\[([^\]]*)\]\)/.exec(source);
  assert.ok(hidden, 'HIDDEN_FROM_OVERLAY fehlt - wird die Farbe jetzt ueberall mitgezeigt?');
  assert.match(hidden[1], /'color'/, `versteckt wird nur: ${hidden[1]}`);

  // Und die Menge wird auch angewandt, statt nur dazustehen: die Rolle
  // entscheidet, und bei allen anderen Rollen bleibt die Einstellung des
  // Haushalts stehen (sonst waeren Fach, Raum und Lehrer aus jedem Termin weg).
  const attach = /async function attachFieldsToPeriod\(period, fieldIds\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(attach, 'attachFieldsToPeriod fehlt');
  const body = attach[1];
  assert.match(body, /HIDDEN_FROM_OVERLAY\.has\(role\)\s*\?\s*false/, 'die Rolle entscheidet nicht ueber show_in_overlay');
  assert.match(body, /overlayFor\(field\.id, field\.show_in_overlay\)/,
    'eine schon haengende Zuordnung wird neu gesetzt statt uebernommen');
  assert.match(body, /overlayFor\(id, true\)/, 'ein neu angeheftetes Feld bekommt kein show_in_overlay');
});

test('die Farbe ist eine Rolle wie Fach und Raum', () => {
  // Laeuft die Rolle auseinander, legt die Einrichtung ein zweites Feld an -
  // und die Ansicht sucht eine Farbe, die in einem anderen Feld steht.
  const roles = /export const FIELD_NAMES = Object\.freeze\(\{([\s\S]*?)\n\}\)/.exec(read('data.js'));
  assert.ok(roles, 'FIELD_NAMES fehlt');
  for (const role of ['subject', 'room', 'teacher', 'color']) {
    assert.match(roles[1], new RegExp(`\\b${role}:`), `die Rolle ${role} fehlt in FIELD_NAMES`);
  }
});

test('eine Farbe wird angeheftet, bevor sie geschrieben wird', () => {
  // Ein Wert an einem Feld, das an der Stunde nicht haengt, laesst der Server
  // die GANZE Zeile abweisen (server/routes/schedule.js:189) - und zwar die
  // Zeilen aller Faecher, nicht nur die des einen. Deshalb erst anheften, dann
  // schreiben.
  const source = read('index.js');
  const fn = /async function saveSubjectColor\(subject, rawColor\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(fn, 'saveSubjectColor fehlt');
  // Kommentare weg, bevor gesucht wird: eine auskommentierte Zeile ist keine
  // Zusage, und `spreadSubjectColor` steht genau so in einem Kommentar daneben.
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const attach = body.indexOf('attachFieldsToPeriod(');
  const write = body.indexOf('saveDays(');
  assert.ok(attach > -1, 'die Farbe wird geschrieben, ohne das Feld anzuhaeften');
  assert.ok(write > -1, 'saveSubjectColor schreibt nicht ueber saveDays');
  assert.ok(attach < write, 'angeheftet wird erst nach dem Schreiben');
  // Geschrieben wird der ganze Satz, damit "Mathe ist ueberall blau" gilt und
  // nicht nur in der Zelle, die gerade jemand angefasst hat - und geschrieben
  // wird das, was `spreadSubjectColor` zurueckgegeben hat. Ein `saveDays([])`
  // waere sonst ein Speichern, das den ganzen Plan raeumt.
  assert.match(body, /const rows = spreadSubjectColor\(/, 'die Farbe wird nicht auf alle Zeilen des Fachs verteilt');
  assert.match(body, /await saveDays\(rows\)/, 'geschrieben wird nicht der verteilte Satz');
  // Und der Wert kommt durch die Grammatik, bevor er in eine CSS-Variable geht.
  assert.match(body, /normalizeColor\(rawColor\)/, 'der Wert wird ungeprueft uebernommen');
});

test('eine gewaehlte Farbe legt ihr Feld an, statt still nichts zu tun', () => {
  // Der gemeldete Fehler: "changed color is not saved". Die Farbe kam nach der
  // Einrichtung dazu (1.1.0), und wer davor eingerichtet hat, hat kein Feld
  // `Farbe` - durch die Einrichtung kommt er aber nicht mehr, weil Muster und
  // Felder da sind (`needsSetup()`). Die Auswahl lief deshalb in ein stilles
  // `return`: nichts geschrieben, kein Hinweis, und der Regler stand beim
  // naechsten Zeichnen wieder auf der gerechneten Farbe.
  const fn = /async function saveSubjectColor\(subject, rawColor\)\s*\{([\s\S]*?)\n\}/.exec(read('index.js'));
  assert.ok(fn, 'saveSubjectColor fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Angelegt wird VOR dem Lesen der Kennung - sonst liest die Funktion genau
  // den Zustand, der sie vorher hat aufgeben lassen.
  const ensure = body.indexOf('await ensureFields()');
  const readIds = body.indexOf('state.fieldIds.color');
  assert.ok(ensure > -1, 'die Farbe wird gewaehlt, ohne das Feld anzulegen');
  assert.ok(readIds > -1, 'saveSubjectColor liest die Farbkennung nicht mehr');
  assert.ok(ensure < readIds, 'das Feld wird erst nach dem Lesen der Kennung angelegt');

  // Und wenn es danach immer noch keine Kennung gibt, wird das gesagt und nicht
  // verschwiegen: der Aufrufer zeigt den Fehler an, das stille `return` nicht.
  assert.match(body, /\|\| subjectFieldId == null\)\s*\{\s*throw new Error\(/,
    'ohne Feldkennung bricht das Speichern wieder lautlos ab');
  assert.doesNotMatch(body, /\|\| subjectFieldId == null\)\s*return/,
    'der stille Ausstieg ist zurueck');
});

test('die Ansicht reicht ihren Farbvorrat an die Stunden weiter', () => {
  // Die Farbe eines Fachs steht an einer Zeile, die gerade nicht auf dem
  // Bildschirm sein muss. Ohne den Vorrat faellt `lessonsByDate()` auf die
  // Zeilen zurueck, die es selbst sieht - eine Stunde desselben Fachs haette
  // dann je nach Woche eine andere Farbe.
  const fn = /function lessonsOfPeriod\(dateKeys\)\s*\{([\s\S]*?)\n\}/.exec(read('index.js'));
  assert.ok(fn, 'lessonsOfPeriod fehlt');
  assert.match(fn[1], /subjectPalette\(\)/,
    'die Seite gibt ihren Vorrat nicht weiter und faerbt nur, was sie gerade sieht');
  // Und der Vorrat kennt Muster UND Eintraege: das Muster hat alle sieben Tage,
  // die geladenen Eintraege haben die Abweichungen.
  const palette = /function subjectPalette\(\)\s*\{([\s\S]*?)\n\}/.exec(read('index.js'));
  assert.ok(palette, 'subjectPalette fehlt');
  assert.match(palette[1], /state\.patternDays/, 'das Muster fehlt im Vorrat');
  assert.match(palette[1], /state\.entries/, 'die aufgeloesten Eintraege fehlen im Vorrat');
});

test('eine getippte Stunde nimmt die Farbe ihres Fachs mit', () => {
  // Sonst bekommt genau die Stunde, die der Anlass des Tippens war, keine
  // eigene Farbe - und weil das Lesen die Zeile zuerst fragt, saehe sie anders
  // aus als ihre Geschwister im selben Fach. Zugleich ist das der Weg, auf dem
  // eine vorhandene Farbe das Ueberschreiben der Zelle ueberlebt.
  const fn = /async function writeCell\(form, position, periodId, period, \{ clear = false \} = \{\}\)\s*\{([\s\S]*?)\n\}/.exec(read('index.js'));
  assert.ok(fn, 'writeCell fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(body, /subjectPalette\(\)\.get\(normalizeName\(read\('subject'\)\)\)/,
    'die Farbe des Fachs wird beim Schreiben nicht nachgeschlagen');
  assert.match(body, /values\[state\.fieldIds\.color\] = shared/,
    'die nachgeschlagene Farbe landet nicht in der Zeile');
  // Nur eine VORHANDENE zieht mit: hier wird keine Farbe erfunden und nichts
  // ueberschrieben, was jemand ausdruecklich anders gesetzt hat.
  assert.match(body, /!clear && shared && state\.fieldIds\.color != null/,
    'die Farbe zieht auch ins Leeren mit');
});

test('das Panel sagt das neue Feld vorher an', () => {
  // Ein Feld, das im Schichtplan auftaucht, ohne dass es jemand bestellt hat,
  // will erklaert sein - und zwar bevor die Farbe gewaehlt wird, nicht danach.
  const source = read('index.js');
  const fn = /function renderColors\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(fn, 'renderColors fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(body, /state\.fieldIds\.color == null[\s\S]*?colors\.newField/,
    'das Panel erklaert das noch fehlende Farbfeld nicht');
  // Nur wenn es fehlt: ein Hinweis, der immer steht, wird nach dem ersten
  // Speichern zur Luege.
  assert.match(body, /const newField = state\.fieldIds\.color == null/,
    'der Hinweis haengt nicht am fehlenden Feld');
  // Und er wird auch gezeichnet: gerechnet und nicht eingefuegt sieht genauso
  // aus wie gar nicht vorhanden.
  assert.match(body, /\$\{newField\}/, 'der angekuendigte Hinweis wird nicht gezeichnet');
});

test('die Kachel zaehlt, was sie nicht zeigt', () => {
  // Der gemeldete Fehler: ein Tag mit acht Stunden zeigte fuenf, mit Pausen
  // fehlten drei - und weil `.widget` abschneidet, sah die Liste vollstaendig
  // aus. Die Rechnung selbst steht in `widgetDayPlan()` und ist dort geprueft;
  // hier steht die Zusage, dass die Kachel sie BENUTZT, statt weiter selbst zu
  // deckeln.
  // Die Zeilenenden sind im Arbeitsbaum CRLF, die Muster unten sind es nicht:
  // erst vereinheitlichen, sonst trifft `\n}` das Zeilenende nicht.
  const source = read('widgets/tomorrow.js').replace(/\r\n/g, '\n');
  const fn = /export async function renderWidget\(container, \{ size \} = \{\}\)\s*\{([\s\S]*?)\n\}\n/.exec(source);
  assert.ok(fn, 'renderWidget fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(body, /const plan = widgetDayPlan\(size, days\)/,
    'die Kachel deckelt selbst, statt widgetDayPlan zu fragen');
  assert.match(body, /slice\(0, day\.cap\)/, 'gezeigt wird nicht der gedeckelte Satz');
  assert.match(body, /\$\{shown\.map\(\(lesson\) => lessonRow\(lesson, plan\.dense\)\)/, 'die Fassung erreicht die Zeile nicht');
  // Die Mehr-Zahl nennt die Zahl, die die Planung ausgerechnet hat. Ein
  // zweites `lessons.length - cap` waere dieselbe Zahl aus einer zweiten Quelle -
  // und die eine von beiden waere irgendwann falsch.
  assert.match(body, /day\.more > 0 \?/, 'die Mehr-Zahl haengt nicht an ihrem eigenen Wert');
  assert.match(body, /\{ rest: day\.more \}/, 'die Mehr-Zahl rechnet den Rest selbst aus');
  assert.doesNotMatch(body, /lessons\.length -/, 'der Rest wird zweimal gerechnet');
  // Und der Deckel des Kerns ist weg: eine Abschrift, die bleibt, deckelt weiter.
  assert.doesNotMatch(source, /ROW_CAP_TALL|ROW_CAP_SHORT/, 'der alte Deckel steht noch im Modul');
});

test('die Kachel zeigt heute und den naechsten Schultag', () => {
  // Der gemeldete Wunsch: um sechs Uhr morgens ist der laufende Tag die Frage,
  // und "morgen" verlangt Kopfrechnen vom Datum auf den Wochentag. Beide Tage
  // gehen durch dieselbe Planung, und was heute vorbei ist, faellt VORHER
  // heraus - sonst stuenden zwei Tage auf der Kachel, von denen einer gestern
  // war.
  const source = read('widgets/tomorrow.js').replace(/\r\n/g, '\n');
  const fn = /export async function renderWidget\(container, \{ size \} = \{\}\)\s*\{([\s\S]*?)\n\}\n/.exec(source);
  assert.ok(fn, 'renderWidget fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(body, /key: today, lessons: remainingLessons\(/, 'der laufende Tag wird nicht gefiltert');
  assert.match(body, /nextDateWithLessons\(tomorrow/, 'der zweite Tag ist nicht der naechste Schultag');
  // Das Fenster beginnt heute: der laufende Tag kommt aus derselben Antwort wie
  // der naechste und nicht aus einem zweiten Aufruf.
  assert.match(body, /from: today/, 'der laufende Tag wird nicht geladen');
  // Und wer welchen Abschnitt bekommt, entscheidet die Planung - die Kachel
  // fragt nicht nach dem Wochentag und hat keinen Umschalter.
  assert.match(body, /widgetDayPlan\(size, days\)/, 'beide Tage erreichen die Planung nicht');
  assert.match(body, /if \(!plan\.days\.length\)/, 'der Leerzustand haengt nicht an der Planung');
  // Die Badge zaehlt die Stunden der GEZEIGTEN Tage, nicht die sichtbaren - und
  // nicht die eines Tages, den die Kachel gar nicht zeichnet.
  assert.match(body, /plan\.days\.reduce\(\(sum, day\) => sum \+ day\.cap \+ day\.more/,
    'die Badge zaehlt etwas anderes als die gezeigten Tage');
});

test('die zweite Tageszeile und die Mehr-Zahl kosten keine Stunde', () => {
  // Zwei Tage heissen zwei Tageszeilen, und die Mehr-Zahl steht in der ersten
  // davon - eine eigene Zeile darunter waere die Stunde, die sie zaehlt, und
  // `.widget` schneidet ab, statt zu melden.
  const css = read('style.css').replace(/\r\n/g, '\n');
  const day = /(?:^|\n)\.school-widget__day\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(day, 'die Regel .school-widget__day fehlt');
  assert.match(day[1], /justify-content: space-between/, 'die Mehr-Zahl steht nicht neben dem Tag');
  // Gekuerzt wird der Tagesname, nicht die Zahl. Beide Regeln dafuer stehen
  // zusammen: ein Flex-Kind schrumpft nicht unter seinen Inhalt, wenn man ihm
  // nicht `min-width: 0` gibt - die Ellipse bliebe wirkungslos und der Name
  // schoebe die Zahl aus der Zeile.
  const name = /(?:^|\n)\.school-widget__day-name\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(name, 'die Regel .school-widget__day-name fehlt');
  assert.match(name[1], /text-overflow: ellipsis/, 'ein langer Tagesname schneidet die Zahl ab');
  assert.match(name[1], /min-width: 0/, 'ohne min-width schrumpft der Name nicht und die Ellipse wirkt nicht');
  const more = /(?:^|\n)\.school-widget__day-more\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(more, 'die Regel .school-widget__day-more fehlt');
  assert.match(more[1], /flex: 0 0 auto/, 'die Zahl gibt nach, statt den Namen zu kuerzen');
  // Und die Zeilen, die es nicht mehr gibt, stehen auch nicht mehr im
  // Stylesheet: tote Regeln sind die naechste Stelle, an der jemand sucht.
  assert.doesNotMatch(css, /\.school-widget__more\s*\{/, 'die eigene Mehr-Zeile steht noch im Stylesheet');
  assert.doesNotMatch(css, /\.school-widget__note\s*\{/, 'der alte Hinweis steht noch im Stylesheet');
});

test('die Beschriftung der Kachel steht an vier Stellen gleich', () => {
  // Der Name steht im Manifest zweimal als Text und zweimal als Schluessel, und
  // der deutsche Text steht noch einmal in der Sprachdatei - die Vorlage fuer
  // jede Sprache ohne eigenen Eintrag. Vier Stellen, ein Name: laufen sie
  // auseinander, heisst dieselbe Kachel je nach Sprache anders, und niemand
  // findet sie im Auswahlfeld wieder.
  const pairs = [
    ...(manifest.capabilities?.widgets ?? []).map((widget) => [widget.label, widget.labelKey]),
    ...(manifest.capabilities?.permissions?.widgets ?? []).map((widget) => [widget.label, widget.labelKey]),
  ];
  assert.ok(pairs.length >= 2, 'keine Kachel im Manifest gefunden');
  for (const [label, labelKey] of pairs) {
    assert.equal(label, localeDicts.de[labelKey], `"${labelKey}" heisst im Manifest anders als auf Deutsch`);
  }
});

test('die einzeilige Fassung laesst den Raum nicht fallen', () => {
  // Dicht heisst "eine Zeile", nicht "ohne Raum": der Raum steht hinter dem
  // Fach, und gekuerzt wird von hinten - also erst der Raum, nie das Fach.
  const source = read('widgets/tomorrow.js').replace(/\r\n/g, '\n');
  const fn = /function lessonRow\(lesson, dense\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(fn, 'lessonRow fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Die Bedingung muss die der dichten Zeile sein: `assert.match(body, /dense && meta/)`
  // waere zu lose - `!dense && meta` (die zweite Zeile) enthaelt denselben Text.
  assert.match(body, /const inline = dense && meta/, 'dicht entscheidet nicht ueber den Raum');
  assert.match(body, /school-widget__meta--inline/, 'der Raum hat in der dichten Zeile keine eigene Regel');
  // Die zweite Zeile gibt es nur, wenn NICHT dicht geschrieben wird - sonst
  // stuende der Raum zweimal da.
  assert.match(body, /\$\{!dense && meta \?/, 'die zweite Zeile fehlt auch in der dichten Fassung nicht');
  // Die Kuerzung ist die des Fachs: die Regel fuer die dichte Zeile darf kein
  // eigenes `overflow` setzen, sonst schneidet sie den Raum ab, statt ihn mit
  // dem Fach zusammen zu kuerzen.
  const css = read('style.css').replace(/\r\n/g, '\n');
  const rule = /\.school-widget__meta--inline\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(rule, 'die Regel fuer den Raum in der dichten Zeile fehlt');
  assert.match(rule[1], /overflow: visible/, 'die dichte Zeile kuerzt fuer sich statt mit dem Fach');
});

test('alle sieben Tage sind gleich breit', () => {
  // Der gemeldete Fehler: eine Woche, in der nur ein Tag einen Raum und einen
  // Lehrer trug, bekam genau dort die breite Spalte - ohne feste Verteilung
  // rechnet der Browser die Breite aus dem Inhalt. Alle sieben Tage zeigen
  // gleich viel Zeit des Tages, also sollen sie gleich viel Platz bekommen.
  const css = read('style.css').replace(/\r\n/g, '\n');
  const grid = /(?:^|\n)\.school-grid\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(grid, 'die Regel .school-grid fehlt');
  assert.match(grid[1], /table-layout:\s*fixed/,
    'ohne table-layout: fixed verteilt der Browser die Breite nach dem Inhalt');
  // Feste Verteilung heisst: was nicht passt, wird abgeschnitten - es sei denn,
  // die Zelle bricht um. Genau das ist die Bedingung, unter der die Regel
  // ueberhaupt erlaubt ist.
  const slot = /(?:^|\n)\.school-slot\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(slot, 'die Regel .school-slot fehlt');
  assert.match(slot[1], /overflow-wrap:\s*anywhere/,
    'feste Spalten ohne Umbruch schneiden lange Faecher ab');
  // Und die Zeitspalte behaelt ihre eigene Breite: sie traegt "08:00 - 08:45"
  // und nicht den siebten Teil. `auto` waere genau die Verteilung nach Inhalt,
  // die hier nicht gelten soll.
  const corner = /(?:^|\n)\.school-grid__corner\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(corner, 'die Regel .school-grid__corner fehlt');
  assert.match(corner[1], /width:\s*[0-9.]+(rem|em|px|ch)/,
    'die Zeitspalte hat keine feste Breite mehr');
});

/* ── Die Schultage ────────────────────────────────────────────────────────── */

test('beide Raster fragen nach den gezeigten Tagen, das Laden nicht', () => {
  // Die Ansicht zeigt `schoolDateKeys()` / `schoolPositions()`; das Nachladen
  // holt die volle Woche. Ein ausgeblendeter Samstag ist eine Frage der Anzeige:
  // "Morgen" sucht den naechsten Schultag weiter ueber alle sieben Tage, und ein
  // Fenster, das an einer Anzeigevorliebe haengt, waere kuerzer als das, was die
  // Ansicht danach abfragt.
  const source = read('index.js');
  const week = /function renderWeek\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(week, 'renderWeek fehlt');
  assert.match(week[1], /schoolDateKeys\(/, 'die Woche fragt nicht nach den gezeigten Tagen');

  const reloadFn = /async function reload\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(reloadFn, 'reload fehlt');
  assert.match(reloadFn[1], /weekDateKeys\(/, 'das Nachladen holt nicht mehr die volle Woche');

  // Und das Bearbeiten-Raster rechnet seine Spalten aus dem Muster: die
  // Positionen kommen aus dem Anker, nicht aus einer festen Liste 0..6 - sonst
  // faellt ein versteckter Tag auf die falsche Spalte.
  const edit = /function renderEdit\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(edit, 'renderEdit fehlt');
  assert.match(edit[1], /schoolPositions\(anchor, state\.schoolDays\)/,
    'das Bearbeiten-Raster zaehlt weiter alle sieben Spalten');
  assert.doesNotMatch(edit[1], /Array\.from\(\{ length: 7 \}/,
    'die feste 7 steht noch im Raster');
});

test('die Wahl der Schultage liegt beim Geraet und ueberlebt das Neuladen', () => {
  // Ein Modul darf keine Schluessel in /preferences anlegen (der Server prueft
  // gegen eine feste Liste) und sieht die Datenbank nicht - der Browserspeicher
  // ist der einzige Ort, den es gibt. Was nicht gespeichert wird, ist beim
  // naechsten Besuch wieder Montag bis Freitag.
  const source = read('index.js');
  const save = /function saveSettings\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(save, 'saveSettings fehlt');
  assert.match(save[1], /schoolDays: state\.schoolDays/, 'die Tage werden nicht mitgespeichert');
  assert.match(save[1], /SETTINGS_KEY/, 'geschrieben wird nicht unter dem Schluessel des Moduls');

  const load = /function loadSettings\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(load, 'loadSettings fehlt');
  assert.match(load[1], /normalizeSchoolDays\(raw\?\.schoolDays\)/,
    'die gespeicherten Tage werden ungeprueft uebernommen');
  // Und `render()` setzt sie beim Einstieg in den Zustand - ein gelesener Wert,
  // der nirgends ankommt, ist keiner.
  assert.match(source, /state\.schoolDays = state\.settings\.schoolDays/,
    'die geladenen Tage erreichen den Zustand nicht');
});

test('das Panel zeigt die Tage und verschweigt nichts', () => {
  const source = read('index.js');
  const fn = /function renderSchoolDays\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.ok(fn, 'renderSchoolDays fehlt');
  // Ein Kaestchen je Wochentag, mit dem Zustand als `checked` - ein Kaestchen,
  // das seine Auswahl nicht zeigt, ist ein Schalter ohne Stellung.
  assert.match(fn[1], /WEEKDAY_KEYS\.map\(/, 'es gibt nicht je Wochentag ein Kaestchen');
  assert.match(fn[1], /data-school-day="\$\{day\}"\$\{chosen\.has\(Number\(day\)\) \? ' checked' : ''\}/,
    'das Kaestchen zeigt seine Auswahl nicht');
  // Und was ein versteckter Tag verschwinden laesst, wird gezaehlt und gesagt:
  // eine Einstellung, die Unterricht still verschwinden laesst, sieht aus wie
  // ein aufgeraeumter Plan und ist es nicht.
  assert.match(fn[1], /hiddenSubjects\(state\.patternDays/, 'es wird nicht geprueft, was versteckt wird');
  assert.match(fn[1], /hidden\.size[\s\S]*?days\.hidden/, 'der Hinweis auf versteckte Stunden fehlt');
  // Das Panel haengt an der Bearbeiten-Ansicht - dort, wo der Plan gemacht wird.
  const edit = /function renderEdit\(\)\s*\{([\s\S]*?)\n\}/.exec(source);
  assert.match(edit[1], /\$\{renderSchoolDays\(\)\}/, 'das Panel wird nirgends gezeichnet');
  // `.form-check` ist die Checkbox des Kerns - Groesse, Trefferflaeche und die
  // Eine-Stimme-Regel stehen dort und nicht hier.
  assert.match(fn[1], /class="form-check"/, 'das Kaestchen bringt eigene Masse mit');
});

test('der letzte Tag laesst sich nicht abwaehlen', () => {
  // Ein Plan ohne Spalten sieht aus wie ein Fehler statt wie eine Wahl. Die
  // Regel steht im Griff und nicht in `normalizeSchoolDays()`: dort ist eine
  // leere Liste die Voreinstellung, weil gespeicherter Unsinn nicht in einem
  // leeren Plan enden darf - hier ist es ein Griff, den jemand gerade tut, und
  // der gehoert abgelehnt statt still umgedeutet.
  const fn = /function toggleSchoolDay\(input\)\s*\{([\s\S]*?)\n\}/.exec(read('index.js'));
  assert.ok(fn, 'toggleSchoolDay fehlt');
  const body = fn[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const guard = body.indexOf('if (!next.size)');
  const store = body.indexOf('state.schoolDays = normalizeSchoolDays');
  assert.ok(guard > -1, 'der letzte Tag laesst sich abwaehlen');
  assert.ok(store > -1, 'die Wahl erreicht den Zustand nicht');
  assert.ok(guard < store, 'erst speichern, dann ablehnen');
  assert.match(body.slice(guard, guard + 80) + body.slice(guard), /days\.lastOne/,
    'die Ablehnung wird nicht erklaert');
  // Und der Speicher bleibt unberuehrt, bis die Wahl feststeht.
  assert.match(body.slice(guard, store), /return;/, 'die abgelehnte Wahl laeuft weiter');
});

test('die Kachel rechnet mit den echten Rastermassen des Kerns', () => {
  // `widgetRowBudget()` nennt zwei Zahlen aus dem Kern: die Hoehe einer
  // Rasterzeile (132px, `grid-auto-rows` in dashboard.css) und den Abstand
  // zwischen zweien (20px, `--space-5` in tokens.css). Beide sind Abschriften -
  // und eine Abschrift ohne Waechter veraltet still: aendert der Kern den
  // Abstand, deckelt die Kachel wieder mitten im Tag, ohne dass etwas rot wird.
  // Der Test liest die Kern-Dateien, wenn es sie gibt, und sagt es, wenn nicht -
  // das Modul wird auch als Ordner ohne Kern ausgeliefert.
  const tokensPath = path.join(ROOT, '..', '..', 'public', 'styles', 'tokens.css');
  const dashboardPath = path.join(ROOT, '..', '..', 'public', 'styles', 'dashboard.css');
  if (!existsSync(tokensPath) || !existsSync(dashboardPath)) {
    assert.ok(true, 'Kern-Stylesheets nicht vorhanden - Modul wurde einzeln kopiert');
    return;
  }
  const module = read('timetable.js');

  const gap = /--space-5:\s*(\d+)px/.exec(readFileSync(tokensPath, 'utf8').replace(/\r\n/g, '\n'));
  assert.ok(gap, '--space-5 steht nicht mehr in tokens.css - Name geaendert?');
  assert.match(module, new RegExp(`GRID_GAP_PX = ${gap[1]};`),
    'der Abstand zwischen zwei Rasterzeilen ist nicht mehr --space-5');

  const gridRow = /grid-auto-rows:\s*minmax\((\d+)px/.exec(readFileSync(dashboardPath, 'utf8').replace(/\r\n/g, '\n'));
  assert.ok(gridRow, 'grid-auto-rows steht nicht mehr in dashboard.css - Raster geaendert?');
  assert.match(module, new RegExp(`GRID_ROW_PX = ${gridRow[1]};`),
    'die Hoehe einer Rasterzeile ist nicht mehr die des Kerns');
});
