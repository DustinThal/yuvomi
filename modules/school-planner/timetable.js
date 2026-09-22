/**
 * Modul: Stundenplan - reine Rechenfunktionen
 * Zweck: Alles, was sich ohne DOM und ohne Netz entscheiden laesst: der
 *        Zyklus-Schluessel einer Woche, die Farbe eines Fachs, das Sortieren
 *        und Zusammensetzen eines Tages. `index.js` und `widgets/tomorrow.js`
 *        holen hier ihre Entscheidungen; `test/timetable.test.js` prueft sie
 *        ohne Browser.
 *
 *        Diese Datei importiert NICHTS aus `/api.js`, `/utils/` oder dem DOM -
 *        das ist die Bedingung dafuer, dass `node --test` sie laden kann
 *        (`/utils/...` sind absolute Browser-Pfade, die in Node nicht
 *        aufloesen).
 *
 * Abhaengigkeiten: keine.
 */

/**
 * Der Zyklus-Schluessel, den der Server fuer dasselbe Datum rechnet.
 *
 * MUSS mit `cyclePosition()` in `server/services/schedule.js` uebereinstimmen -
 * der Server loest den Plan auf (`resolveEntries()`), diese Datei zeigt ihn nur
 * an. Laeuft die Rechnung auseinander, zeigt das Raster eine Stunde auf dem
 * falschen Wochentag. Die Anker-Arithmetik ist deshalb hier bewusst eine
 * Abschrift und keine Erfindung: erst Tage zwischen zwei Datums-Schluesseln,
 * dann Modulo mit Vorzeichen-Korrektur (JavaScripts `%` liefert fuer negative
 * Werte ein negatives Ergebnis, der Server korrigiert das genauso).
 */
export function cyclePosition(anchorDateKey, cycleLength, dateKey) {
  const days = daysBetweenDateKeys(anchorDateKey, dateKey);
  const length = Number(cycleLength);
  if (days === null || !Number.isInteger(length) || length < 1) return null;
  return ((days % length) + length) % length;
}

/**
 * Ganze Tage zwischen zwei `YYYY-MM-DD`-Schluesseln - negativ, wenn `b` vor `a`
 * liegt, `null` bei unbrauchbarer Eingabe.
 *
 * Ueber `Date.UTC` statt ueber lokale Mitternacht: ein Datums-Schluessel ist
 * eine Kalenderaussage, kein Zeitpunkt. Zwei lokale Daten koennen je nach
 * Sommerzeit-Umstellung 23 oder 25 Stunden auseinanderliegen, ihre Schluessel
 * aber genau einen Tag - mit lokaler Arithmetik verschiebt sich der Plan zweimal
 * im Jahr um einen Tag.
 */
export function daysBetweenDateKeys(a, b) {
  const from = parseDateKey(a);
  const to = parseDateKey(b);
  if (!from || !to) return null;
  return Math.round((to - from) / 86400000);
}

/** `YYYY-MM-DD` als UTC-Mitternacht, oder `null`. */
export function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''));
  if (!match) return null;
  const [, year, month, day] = match;
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(stamp);
  // `Date.UTC` rollt den 32. Januar zum 1. Februar weiter; ein solcher
  // Schluessel ist kein Datum, sondern ein Tippfehler.
  if (date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)) return null;
  return stamp;
}

/** Datums-Schluessel `days` Tage nach `dateKey`. */
export function addDays(dateKey, days) {
  const stamp = parseDateKey(dateKey);
  if (stamp === null) return null;
  return toDateKey(stamp + Number(days) * 86400000);
}

/** UTC-Stempel als `YYYY-MM-DD`. */
export function toDateKey(stamp) {
  const date = new Date(stamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** ISO-Wochentag: 1 = Montag bis 7 = Sonntag. */
export function isoWeekday(dateKey) {
  const stamp = parseDateKey(dateKey);
  if (stamp === null) return null;
  const day = new Date(stamp).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Samstag oder Sonntag? */
export function isWeekend(dateKey) {
  const day = isoWeekday(dateKey);
  return day === 6 || day === 7;
}

/**
 * Die sieben Tage der Woche, in der `dateKey` liegt.
 *
 * `weekStartsOn` folgt der Konvention des Hauses und damit der von JavaScripts
 * `Date#getDay()`: 0 = Sonntag, 1 = Montag. Das ist keine Geschmacksfrage -
 * `startOfLocalWeekKey()` in `/utils/date.js` rechnet genauso, und
 * `WEEK_START_INDEX` bildet die Haushalts-Einstellung auf genau diese Zahlen ab
 * (`{ monday: 1, sunday: 0, saturday: 6 }`). Wer hier ISO-Wochentage
 * hineinreicht, bekommt fuer Sonntag stillschweigend die Montagswoche.
 */
export function weekDateKeys(dateKey, weekStartsOn = 1) {
  const stamp = parseDateKey(dateKey);
  if (stamp === null) return [];
  const day = new Date(stamp).getUTCDay();
  const requested = Number(weekStartsOn);
  const start = Number.isInteger(requested) && requested >= 0 && requested <= 6 ? requested : 1;
  // Abstand zum Wochenanfang, immer 0..6 - damit landet ein Sonntag bei
  // Wochenbeginn Montag auf dem letzten Platz und nicht auf dem ersten.
  const offset = ((day - start) % 7 + 7) % 7;
  const first = addDays(dateKey, -offset);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/**
 * Farben fuer Faecher.
 *
 * Ein Fach hat keine eigene Spalte im Datenmodell - die Schichtart traegt die
 * Farbe, und hier ist die Schichtart die *Stunde* (08:00-08:45), nicht das Fach.
 * Waere die Schichtart das Fach, koennte dasselbe Fach am Montag in der ersten
 * und am Dienstag in der dritten Stunde nicht stehen: eine Schichtart hat genau
 * eine Uhrzeit.
 *
 * Diese Liste ist deshalb der RUECKFALL, nicht mehr die Antwort: eine gewaehlte
 * Farbe liegt als Wert an der Plan-Zeile (Rolle `color`, siehe `FIELD_NAMES`)
 * und gewinnt. Ohne sie rechnet diese Datei die Farbe deterministisch aus dem
 * Namen - "Mathe" ist dann auf jedem Geraet und in jeder Sitzung dieselbe Farbe,
 * ohne dass irgendwo eine Zuordnung gespeichert werden muesste. Das ist der
 * Zustand, den ein Haushalt ohne gewaehlte Farben sieht, und der Grund, warum
 * ein neues Fach sofort eine brauchbare Farbe hat statt einer grauen.
 *
 * Toene sind mittlere Saettigung: sie muessen vor hellem wie dunklem Grund
 * lesbar sein und als Block mit weisser bzw. dunkler Schrift funktionieren
 * (die Schriftfarbe entscheidet `readableTextOn()`).
 */
export const SUBJECT_COLORS = Object.freeze([
  '#2563EB', // Blau
  '#B91C1C', // Rot
  '#047857', // Gruen
  '#B45309', // Bernstein
  '#7C3AED', // Violett
  '#0E7490', // Petrol
  '#BE185D', // Magenta
  '#4D7C0F', // Oliv
  '#C2410C', // Orange
  '#1D4ED8', // Indigo
  '#0F766E', // Teal
  '#A21CAF', // Purpur
  '#854D0E', // Braun
  '#4338CA', // Ultramarin
]);

/**
 * Stabile Farbe fuer einen Fachnamen.
 *
 * FNV-1a, 32 Bit: klein, deterministisch und ohne Abhaengigkeit. Ein einfacher
 * Zeichensummen-Hash reicht nicht - "Mathe" und "Ethik" bekommen damit
 * benachbarte Werte und bei 14 Farben oft dieselbe.
 */
export function subjectColor(subject) {
  const text = String(subject ?? '').trim().toLocaleLowerCase();
  if (!text) return SUBJECT_COLORS[0];
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

/**
 * Eine gespeicherte Farbe in ihre Normalform bringen: `#rrggbb`, oder `''`.
 *
 * Das Feld, in dem eine gewaehlte Farbe liegt, ist im Schichtplan ein
 * gewoehnliches Textfeld - dort kann jeder "blau" hineinschreiben. Ein
 * ungepruefter Wert landet in `--lesson-color`, und der Browser wirft die
 * Deklaration dann weg: der Block waere durchsichtig. Geprueft wird deshalb
 * beim LESEN und nicht beim Schreiben - es gibt zwei Schreiber (diese Seite und
 * der Schichtplan) und nur einen Leser.
 *
 * Die Normalform ist Kleinschreibung, weil das native `<input type="color">`
 * genau die liefert; die Palette oben steht in Grossbuchstaben. Ohne eine
 * gemeinsame Form waere "ist das die automatische Farbe?" nicht vergleichbar.
 * `#abc` wird wie in CSS zu `#aabbcc` ergaenzt.
 */
export function normalizeColor(value) {
  const match = /^#?(?:([0-9a-fA-F]{6})|([0-9a-fA-F]{3}))$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const digits = match[1] ?? [...match[2]].map((char) => char + char).join('');
  return `#${digits.toLowerCase()}`;
}

/**
 * Die Faecher des Plans mit ihrer gespeicherten Farbe - die Grundlage des
 * Farben-Panels.
 *
 * Reihenfolge des ersten Vorkommens; `color` ist `''`, solange niemand eine
 * gewaehlt hat, und das Panel zeigt dann die aus dem Namen gerechnete. Verglichen
 * wird ohne Gross/Klein und ohne Rand, damit "mathe" und "Mathe " nicht als zwei
 * Faecher mit zwei Farben enden - derselbe Vergleich entscheidet in
 * `spreadSubjectColor()` beim Schreiben, sonst faerbte ein Griff etwas anderes,
 * als die Liste anzeigt.
 *
 * Die erste gefundene Farbe gewinnt. Alle Zeilen desselben Fachs tragen
 * dieselbe, aber eine kann sie noch nicht haben - ein gerade erst getipptes
 * Fach steht schon im Plan, bevor jemand seine Farbe gesetzt hat -, und dann
 * entscheidet die naechste Zeile.
 */
export function subjectsInPlan(rows, { subjectFieldId, colorFieldId } = {}) {
  if (subjectFieldId == null) return [];
  const found = new Map();
  for (const row of rows ?? []) {
    const values = row?.field_values ?? {};
    const subject = String(values[subjectFieldId] ?? values[String(subjectFieldId)] ?? '').trim();
    if (!subject) continue;
    const key = subject.toLocaleLowerCase();
    const color = colorFieldId == null
      ? ''
      : normalizeColor(values[colorFieldId] ?? values[String(colorFieldId)]);
    const entry = found.get(key);
    if (!entry) found.set(key, { subject, color });
    else if (!entry.color && color) entry.color = color;
  }
  return [...found.values()];
}

/**
 * Eine gewaehlte Fachfarbe auf alle Zeilen desselben Fachs schreiben.
 *
 * Die Farbe liegt an der Zeile, gemeint ist aber das Fach: bekaeme nur die
 * getippte Zelle sie, haette Mathe am Montag eine andere Farbe als am Dienstag.
 * Ein Griff im Farben-Panel schreibt deshalb alle Zeilen mit diesem Fach um -
 * und weil das Speichern ohnehin den vollstaendigen Satz schickt (`saveDays`),
 * kostet das keinen zweiten Aufruf.
 *
 * `color: ''` heisst "wieder automatisch": der Server ueberspringt leere Werte,
 * die Zeile verliert ihren Farbwert, und das Lesen faellt auf die aus dem Namen
 * gerechnete Farbe zurueck.
 *
 * Gibt neue Zeilen zurueck und laesst die uebergebenen unberuehrt.
 */
export function spreadSubjectColor(rows, { subjectFieldId, colorFieldId, subject, color = '' } = {}) {
  const list = rows ?? [];
  if (subjectFieldId == null || colorFieldId == null) return list;
  const wanted = String(subject ?? '').trim().toLocaleLowerCase();
  if (!wanted) return list;
  return list.map((row) => {
    const values = row?.field_values ?? {};
    const name = String(values[subjectFieldId] ?? values[String(subjectFieldId)] ?? '').trim();
    if (name.toLocaleLowerCase() !== wanted) return row;
    return { ...row, field_values: { ...values, [colorFieldId]: color } };
  });
}

/** Relative Helligkeit nach WCAG, 0 (schwarz) bis 1 (weiss). */
export function relativeLuminance(hex) {
  const value = String(hex ?? '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return 0;
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Schriftfarbe auf einem Block dieser Farbe. */
export function readableTextOn(hex) {
  return relativeLuminance(hex) > 0.45 ? '#111827' : '#FFFFFF';
}

/** `"08:45"` als Minuten seit Mitternacht, oder `null`. */
export function minutesOfTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Zwei Uhrzeiten als `"08:00-08:45"`, oder nur was da ist. */
export function formatTimeRange(startTime, endTime) {
  const start = String(startTime ?? '').trim();
  const end = String(endTime ?? '').trim();
  if (start && end) return `${start}-${end}`;
  return start || end || '';
}

/**
 * Die Farbe einer Stunde: die gewaehlte, sonst die gerechnete.
 *
 * Beide Einstiege benutzen sie, damit "Morgen" und "Woche" nie verschiedene
 * Farben fuer dieselbe Stunde zeigen - die Kachel liest `lesson.color` aus
 * genau diesen beiden Funktionen.
 */
function lessonColor(values, fieldIds, subject) {
  const fieldId = fieldIds?.color;
  if (fieldId != null) {
    const stored = normalizeColor(values?.[fieldId] ?? values?.[String(fieldId)]);
    if (stored) return stored;
  }
  return subjectColor(subject);
}

/**
 * Eine Stunde aus einem aufgeloesten Eintrag (`GET /schedule/entries`).
 *
 * Der Server liefert bereits alles, was eine Stunde ausmacht: Datum, die
 * eingebettete Schichtart mit ihren Zeiten und die Feldwerte. Diese Funktion
 * uebersetzt nur die Namen der Felder in die Rollen, die der Stundenplan kennt.
 */
export function lessonFromEntry(entry, fieldIds = {}) {
  if (!entry) return null;
  const type = entry.shift_type ?? null;
  const values = entry.field_values ?? {};
  const pick = (role) => {
    const fieldId = fieldIds[role];
    if (fieldId == null) return '';
    const value = values[fieldId] ?? values[String(fieldId)];
    return value == null ? '' : String(value);
  };
  const periodName = type?.name ? String(type.name) : '';
  const subject = pick('subject') || periodName;
  return {
    dateKey: entry.date_key ?? '',
    periodId: type?.id ?? entry.shift_type_id ?? null,
    periodName,
    shortCode: type?.short_code ? String(type.short_code) : '',
    icon: type?.icon ? String(type.icon) : '',
    startTime: type?.start_time ?? '',
    endTime: type?.end_time ?? '',
    subject,
    room: pick('room'),
    teacher: pick('teacher'),
    note: entry.note ? String(entry.note) : '',
    isFree: entry.is_free === true || entry.is_free === 1,
    source: entry.source ?? 'pattern',
    color: lessonColor(values, fieldIds, subject),
  };
}

/** Eine Stunde aus einer Zeile von `GET /schedule/patterns/{id}/days`. */
export function lessonFromPatternDay(row, typeById, fieldIds = {}) {
  const type = typeById?.get?.(row?.shift_type_id) ?? typeById?.[row?.shift_type_id] ?? null;
  const values = row?.field_values ?? {};
  const pick = (role) => {
    const fieldId = fieldIds[role];
    if (fieldId == null) return '';
    const value = values[fieldId] ?? values[String(fieldId)];
    return value == null ? '' : String(value);
  };
  const periodName = type?.name ? String(type.name) : '';
  const subject = pick('subject');
  return {
    periodId: row?.shift_type_id ?? null,
    periodName,
    shortCode: type?.short_code ? String(type.short_code) : '',
    icon: type?.icon ? String(type.icon) : '',
    startTime: type?.start_time ?? '',
    endTime: type?.end_time ?? '',
    subject: subject || periodName,
    room: pick('room'),
    teacher: pick('teacher'),
    note: '',
    isFree: row?.shift_type_id == null,
    source: 'pattern',
    color: lessonColor(values, fieldIds, subject || periodName),
  };
}

/**
 * Stunden in die Reihenfolge des Schultags bringen.
 *
 * Die Reihenfolge im Datensatz ist keine Aussage: `schedule_pattern_days` hat
 * seit Migration 188 bewusst kein `UNIQUE(position)` mehr, und die API
 * verspricht keine Sortierung. Sortiert wird nach Uhrzeit, dann nach
 * Fachnamen - eine Stunde ohne Uhrzeit landet am Ende, nicht am Anfang.
 */
export function sortLessons(lessons) {
  return [...(lessons ?? [])].sort((a, b) => {
    const aStart = minutesOfTime(a?.startTime);
    const bStart = minutesOfTime(b?.startTime);
    if (aStart === null && bStart === null) return compareSubject(a, b);
    if (aStart === null) return 1;
    if (bStart === null) return -1;
    if (aStart !== bStart) return aStart - bStart;
    return compareSubject(a, b);
  });
}

function compareSubject(a, b) {
  return String(a?.subject ?? '').localeCompare(String(b?.subject ?? ''), undefined, { sensitivity: 'base' });
}

/**
 * Das Wochenraster: Zeilen sind Stunden (nach Uhrzeit), Spalten sind Wochentage.
 *
 * Die Zeilen kommen aus den *vorhandenen* Stunden und nicht aus einer festen
 * Liste 1..8 - eine Schule ohne Nachmittagsunterricht bekommt sonst sechs leere
 * Zeilen, und eine mit Blockunterricht verliert die neunte Stunde. Zwei
 * Schichtarten mit derselben Uhrzeit werden zu einer Zeile.
 */
export function buildWeekGrid(lessonsByDate, dateKeys) {
  const rows = new Map();
  for (const dateKey of dateKeys ?? []) {
    for (const lesson of lessonsByDate?.get?.(dateKey) ?? []) {
      const key = `${lesson.startTime ?? ''}|${lesson.endTime ?? ''}`;
      if (!rows.has(key)) {
        rows.set(key, { key, startTime: lesson.startTime ?? '', endTime: lesson.endTime ?? '', cells: new Map() });
      }
      const row = rows.get(key);
      const cell = row.cells.get(dateKey) ?? [];
      cell.push(lesson);
      row.cells.set(dateKey, cell);
    }
  }
  const ordered = [...rows.values()].sort((a, b) => {
    const aStart = minutesOfTime(a.startTime);
    const bStart = minutesOfTime(b.startTime);
    if (aStart === null && bStart === null) return 0;
    if (aStart === null) return 1;
    if (bStart === null) return -1;
    return aStart - bStart;
  });
  for (const row of ordered) {
    for (const [dateKey, cell] of row.cells) row.cells.set(dateKey, sortLessons(cell));
  }
  return ordered;
}

/**
 * Der naechste Tag mit Unterricht, beginnend bei `fromKey` (einschliesslich).
 *
 * Gebraucht fuer den Fall, der in der Praxis der haeufigste ist: Freitagabend.
 * "Morgen" ist dann Samstag und leer - die Antwort "kein Unterricht" ist zwar
 * richtig, aber nutzlos, wenn drei Tage spaeter wieder Schule ist. `maxDays`
 * begrenzt die Suche, damit ein leerer Plan nicht endlos sucht.
 */
export function nextDateWithLessons(fromKey, hasLessons, { maxDays = 14 } = {}) {
  let cursor = fromKey;
  for (let step = 0; step <= maxDays; step += 1) {
    if (cursor === null) return null;
    if (hasLessons(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

/** Die Stunde, die als naechste beginnt - relativ zu `now` (Minuten seit Mitternacht). */
export function nextLesson(lessons, nowMinutes) {
  const sorted = sortLessons(lessons);
  return sorted.find((lesson) => {
    const start = minutesOfTime(lesson.startTime);
    return start !== null && start >= nowMinutes;
  }) ?? null;
}

/** Eine Stunde als Textzeile: "1. Stunde - Mathematik (B204)". */
export function lessonSummary(lesson) {
  const parts = [];
  const head = lesson?.subject || lesson?.periodName || '';
  if (head) parts.push(head);
  const meta = [lesson?.room, lesson?.teacher].filter(Boolean).join(', ');
  if (meta) parts.push(`(${meta})`);
  return parts.join(' ');
}

/* ── Wie viel Platz die Kachel hat ────────────────────────────────────────── */

/** `grid-auto-rows` in public/styles/dashboard.css - eine Rasterzeile. */
const GRID_ROW_PX = 132;
/** `--space-5` - der Abstand zwischen zwei Rasterzeilen. */
const GRID_GAP_PX = 20;
/** Kopf und Innenabstand der Kachel (dashboard.css `.widget__header`, `.widget__body`). */
const WIDGET_CHROME_PX = 64;
/** Die Tageszeile ueber der Liste plus ihr Abstand. */
const DAY_LINE_PX = 24;
/** Eine zweizeilige Stunde (Fach, darunter Raum) samt Abstand zur naechsten. */
const ROW_FULL_PX = 40;
/** Eine einzeilige Stunde samt Abstand zur naechsten. */
const ROW_DENSE_PX = 24;
/** Was der Kern seinen eigenen Listen zubilligt: `listRowCap()` in dashboard.js. */
const CORE_ROWS_SHORT = 3;
const CORE_ROWS_TALL = 5;

/**
 * Wie viele Stunden die Dashboard-Kachel traegt - und wie viele, wenn sie dicht
 * schreibt.
 *
 * Der Deckel war eine Abschrift von `listRowCap()` aus public/pages/dashboard.js
 * und damit zu grob: der Kern kennt nur zwei Faelle (3 Zeilen flach, 5 Zeilen
 * hoch), weil seine Listenzeilen alle gleich hoch sind. Eine Stunde ist aber
 * zwei Zeilen hoch - Fach, darunter Raum -, ein Schultag hat acht Stunden und
 * mehr, sobald Pausen mit im Plan stehen, und so sass der Deckel mitten im Tag.
 * `.widget` hat `overflow: hidden`: was nicht passt, verschwindet lautlos.
 *
 * Gerechnet wird deshalb aus dem Raster selbst. Eine Rasterzeile ist 132px hoch
 * (`grid-auto-rows: minmax(132px, auto)`), zwischen zwei Zeilen liegen 20px
 * (`--space-5`), und von der Kachel gehen Kopf, Innenabstand und die Tageszeile
 * ab. Der Rest wird durch die Hoehe einer Zeile geteilt - einmal durch die
 * zweizeilige (40px), einmal durch die einzeilige (24px), die dann entsteht,
 * wenn die Kachel dicht schreibt.
 *
 * Zwei Regeln halten das Ergebnis brauchbar:
 *
 * - **Der Kern ist die Untergrenze.** `full` faellt nie unter `listRowCap()`,
 *   damit eine flache Kachel nicht weniger zeigt als bisher. Auf einem Feld mit
 *   einer Rasterzeile ist der Platz rechnerisch knapp, aber der Deckel des Kerns
 *   ist dort die bestehende Zusage und nicht meine, sie zu kuerzen. Fuer
 *   `compact` gilt sie nicht: einzeilige Zeilen sind nur dann besser, wenn es
 *   dadurch MEHR werden, und das entscheidet `widgetRowPlan()`.
 * - **Lieber eine Zeile zu wenig als eine, die abgeschnitten wird.** Die
 *   Rasterzeilen wachsen mit ihrem Inhalt (`minmax(132px, auto)`), gemessen wird
 *   erst im Browser, und eine Zeilenzahl, die vom Messzeitpunkt abhaengt,
 *   springt beim Laden. Die Rechnung ist deshalb eine Schaetzung, die absichtlich
 *   rundet.
 */
export function widgetRowBudget(size) {
  const rows = Number(String(size ?? '1x1').split('x')[1]) || 1;
  const core = rows >= 2 ? CORE_ROWS_TALL : CORE_ROWS_SHORT;
  const listPx = rows * GRID_ROW_PX + (rows - 1) * GRID_GAP_PX - WIDGET_CHROME_PX - DAY_LINE_PX;
  return {
    full: Math.max(core, Math.floor(listPx / ROW_FULL_PX)),
    compact: Math.floor(listPx / ROW_DENSE_PX),
  };
}

/**
 * Was die Kachel von einem Tag zeigt: wie viele Zeilen, und in welcher Fassung.
 *
 * Die zweite Haelfte der Entscheidung, und die einzige Stelle, an der sie
 * getroffen wird - der Aufrufer zeichnet nur noch. Drei Regeln:
 *
 * - **Dicht nur, wenn es mehr Zeilen gibt.** Auf einem Feld mit einer
 *   Rasterzeile ist der Platz so knapp, dass die einzeilige Fassung rechnerisch
 *   kuerzer waere als die zweizeilige Zusage des Kerns. Dann bleibt es bei der
 *   alten Anzeige, statt fuer eine gewonnene Zeile den Raum ueberall zu
 *   verlieren.
 * - **Die Zeile "3 weitere" braucht selbst Platz.** Passt der Tag auch dicht
 *   nicht, wird eine Zeile des Deckels fuer sie freigehalten: ohne diesen Abzug
 *   schoebe die Mehr-Zeile die letzte Stunde aus der Kachel, und weil `.widget`
 *   abschneidet, lautlos. Freigehalten wird nur, wo der Deckel aus dem Raster
 *   kommt - auf einem flachen Feld ist er die Zusage des Kerns (3 Zeilen), und
 *   die wird nicht gekuerzt, auch wenn dort ohnehin kaum eine Zeile sichtbar
 *   ist. Die Mehr-Zeile steht dort trotzdem: verschwiegen wird nichts.
 * - **Nie mehr Zeilen als Stunden.** `cap` ist der Deckel, nicht die Anzeige -
 *   ein Tag mit vier Stunden bekommt vier Zeilen, auch wenn fuenf passen.
 *
 * `more` ist die Zahl, die die Mehr-Zeile nennt, und `0`, wenn alles dasteht.
 */
export function widgetRowPlan(size, lessonCount) {
  const { full, compact } = widgetRowBudget(size);
  const count = Math.max(0, Number(lessonCount) || 0);
  const dense = count > full && compact > full;
  const budget = dense ? compact : full;
  const overflow = count > budget;
  const cap = overflow && dense ? Math.max(1, budget - 1) : Math.min(count, budget);
  return { dense, cap, more: count - cap };
}
