/**
 * Modul: Stundenplan - Tests der reinen Funktionen
 * Zweck: Sichert die drei Stellen ab, an denen ein Fehler still falsch aussieht
 *        statt laut zu scheitern: die Zyklus-Rechnung (muss mit dem Server
 *        uebereinstimmen, sonst steht die Stunde am falschen Wochentag), die
 *        Datums-Arithmetik ueber die Sommerzeit (sonst verschiebt sich der Plan
 *        zweimal im Jahr) und die Zeilen-/Spalten-Bildung des Rasters.
 *
 * Ausfuehren: node --test modules/school-planner/test/timetable.test.js
 *
 * Bewusst NICHT in der Suite-Kette von package.json: dieses Modul liegt unter
 * `modules/`, ist damit gitignored (`.gitignore`: `modules/*`) und wird als
 * Ordner ausgeliefert. Ein `test:`-Script auf eine Datei zu setzen, die im
 * Upstream-Checkout nicht existiert, wuerde `npm test` dort rot machen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cyclePosition,
  daysBetweenDateKeys,
  parseDateKey,
  addDays,
  toDateKey,
  isoWeekday,
  isWeekend,
  weekDateKeys,
  subjectColor,
  SUBJECT_COLORS,
  relativeLuminance,
  readableTextOn,
  minutesOfTime,
  formatTimeRange,
  lessonFromEntry,
  lessonFromPatternDay,
  sortLessons,
  buildWeekGrid,
  nextDateWithLessons,
  nextLesson,
  normalizeColor,
  subjectsInPlan,
  spreadSubjectColor,
  widgetRowBudget,
  widgetRowPlan,
} from '../timetable.js';

// 2026-01-05 ist ein Montag, 2026-09-21 ebenfalls - beide als Anker geeignet.
const MONDAY = '2026-01-05';

test('cyclePosition stimmt mit der Server-Rechnung ueberein', () => {
  // Der Server rechnet ((days % length) + length) % length; der Anker selbst
  // ist Position 0, der Tag davor ist die letzte Position.
  assert.equal(cyclePosition(MONDAY, 7, MONDAY), 0);
  assert.equal(cyclePosition(MONDAY, 7, '2026-01-06'), 1);
  assert.equal(cyclePosition(MONDAY, 7, '2026-01-11'), 6);
  assert.equal(cyclePosition(MONDAY, 7, '2026-01-12'), 0, 'die naechste Woche beginnt wieder bei 0');
  // Rueckwaerts: negativer Abstand darf nicht negativ bleiben.
  assert.equal(cyclePosition(MONDAY, 7, '2026-01-04'), 6);
  assert.equal(cyclePosition(MONDAY, 7, '2026-01-01'), 3);
  // 14-Tage-Rhythmus (A/B-Woche).
  assert.equal(cyclePosition(MONDAY, 14, '2026-01-12'), 7);
  assert.equal(cyclePosition(MONDAY, 14, '2026-01-19'), 0);
  // Unbrauchbare Eingaben ergeben null statt einer stillen 0.
  assert.equal(cyclePosition(MONDAY, 0, MONDAY), null);
  assert.equal(cyclePosition('kein Datum', 7, MONDAY), null);
});

test('Datums-Schluessel rechnen ueber die Sommerzeit hinweg exakt', () => {
  // Die Umstellung in Europa liegt 2026 auf dem 29.03. und dem 25.10. Ein
  // lokaler Date-Umweg verliert bzw. gewinnt dort eine Stunde.
  assert.equal(daysBetweenDateKeys('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetweenDateKeys('2026-10-24', '2026-10-26'), 2);
  assert.equal(daysBetweenDateKeys('2026-03-29', '2026-03-29'), 0);
  assert.equal(daysBetweenDateKeys('2026-01-05', '2026-01-04'), -1);
  // Ein ganzes Schuljahr am Stueck.
  assert.equal(daysBetweenDateKeys('2026-01-05', '2026-07-05'), 181);
});

test('parseDateKey weist erfundene Daten ab und addDays rollt korrekt', () => {
  assert.equal(parseDateKey('2026-02-30'), null, 'den 30. Februar gibt es nicht');
  assert.equal(parseDateKey('2026-13-01'), null);
  assert.equal(parseDateKey('05.01.2026'), null);
  assert.equal(parseDateKey(''), null);
  assert.equal(parseDateKey(null), null);
  assert.notEqual(parseDateKey('2024-02-29'), null, '2024 ist ein Schaltjahr');

  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('kein Datum', 1), null);
});

test('Wochentag und Woche', () => {
  assert.equal(isoWeekday(MONDAY), 1);
  assert.equal(isoWeekday('2026-01-11'), 7, 'Sonntag ist 7, nicht 0');
  assert.equal(isWeekend('2026-01-10'), true);
  assert.equal(isWeekend('2026-01-11'), true);
  assert.equal(isWeekend(MONDAY), false);

  assert.deepEqual(weekDateKeys('2026-01-07', 1), [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11',
  ]);
  // Ein Sonntag gehoert bei Wochenbeginn Montag ans ENDE der Woche, nicht an den Anfang.
  assert.deepEqual(weekDateKeys('2026-01-11', 1), [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11',
  ]);
  // Wochenbeginn Sonntag - 0 ist die Konvention des Hauses (Date#getDay()),
  // NICHT der ISO-Wochentag. Ein `||`-Default haette hier still auf Montag
  // zurueckgeschaltet, weil 0 falsy ist.
  assert.deepEqual(weekDateKeys('2026-01-07', 0), [
    '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10',
  ]);
  assert.deepEqual(weekDateKeys('2026-01-04', 0)[0], '2026-01-04', 'der Sonntag beginnt seine eigene Woche');
  assert.deepEqual(weekDateKeys('2026-01-05', 6), [
    '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  ], 'Wochenbeginn Samstag');
  assert.deepEqual(weekDateKeys('2026-01-07', 99), weekDateKeys('2026-01-07', 1), 'unbrauchbarer Wert faellt auf Montag');
  assert.deepEqual(weekDateKeys('kein Datum', 1), []);
});

test('Facherfarben sind stabil und aus der Palette', () => {
  assert.equal(subjectColor('Mathematik'), subjectColor('Mathematik'));
  assert.equal(subjectColor('  Mathematik  '), subjectColor('Mathematik'), 'Leerraum aendert nichts');
  assert.equal(subjectColor('MATHEMATIK'), subjectColor('Mathematik'), 'Gross-/Kleinschreibung aendert nichts');
  assert.ok(SUBJECT_COLORS.includes(subjectColor('Mathematik')));
  assert.ok(SUBJECT_COLORS.includes(subjectColor('')));

  // Der Hash muss streuen: mit einer Zeichensumme landen benachbarte Namen
  // reihenweise auf derselben Farbe.
  const names = ['Mathematik', 'Deutsch', 'Englisch', 'Biologie', 'Physik', 'Chemie', 'Sport', 'Musik'];
  const distinct = new Set(names.map(subjectColor));
  assert.ok(distinct.size >= 5, `nur ${distinct.size} verschiedene Farben fuer 8 Faecher: ${[...distinct].join(', ')}`);
});

test('Schriftfarbe auf einem Block', () => {
  assert.equal(readableTextOn('#FFFFFF'), '#111827');
  assert.equal(readableTextOn('#000000'), '#FFFFFF');
  assert.equal(readableTextOn('#2563EB'), '#FFFFFF', 'das Blau traegt weisse Schrift');
  assert.equal(relativeLuminance('kein Hex'), 0);
});

test('Uhrzeiten lesen und schreiben', () => {
  assert.equal(minutesOfTime('08:45'), 525);
  assert.equal(minutesOfTime('08:45:00'), 525, 'Sekunden duerfen dranhaengen');
  assert.equal(minutesOfTime('8:05'), 485);
  assert.equal(minutesOfTime('00:00'), 0);
  assert.equal(minutesOfTime('24:00'), null);
  assert.equal(minutesOfTime('08:75'), null);
  assert.equal(minutesOfTime(''), null);
  assert.equal(minutesOfTime(null), null);

  assert.equal(formatTimeRange('08:00', '08:45'), '08:00-08:45');
  assert.equal(formatTimeRange('08:00', null), '08:00');
  assert.equal(formatTimeRange(null, null), '');
});

const FIELD_IDS = { subject: 1, room: 2, teacher: 3 };

test('lessonFromEntry uebersetzt Feld-Ids in Rollen', () => {
  const lesson = lessonFromEntry({
    date_key: '2026-01-05',
    source: 'pattern',
    shift_type_id: 11,
    is_free: false,
    note: 'Klassenarbeit',
    shift_type: { id: 11, name: '1. Stunde', short_code: 'P1', start_time: '08:00', end_time: '08:45', icon: 'book-open' },
    field_values: { 1: 'Mathematik', 2: 'B204', 3: 'Frau Klein' },
  }, FIELD_IDS);

  assert.equal(lesson.subject, 'Mathematik');
  assert.equal(lesson.room, 'B204');
  assert.equal(lesson.teacher, 'Frau Klein');
  assert.equal(lesson.startTime, '08:00');
  assert.equal(lesson.note, 'Klassenarbeit');
  assert.equal(lesson.isFree, false);
  assert.equal(lesson.color, subjectColor('Mathematik'));
});

test('lessonFromEntry faellt auf die Stunde zurueck, wenn kein Fach gesetzt ist', () => {
  const lesson = lessonFromEntry({
    date_key: '2026-01-05',
    shift_type: { id: 11, name: '1. Stunde', start_time: '08:00', end_time: '08:45' },
    field_values: {},
  }, FIELD_IDS);
  assert.equal(lesson.subject, '1. Stunde');
  assert.equal(lesson.room, '');
});

test('lessonFromEntry vertraegt fehlende Felder und freie Tage', () => {
  assert.equal(lessonFromEntry(null, FIELD_IDS), null);
  const free = lessonFromEntry({ date_key: '2026-01-05', is_free: true, shift_type: null, field_values: {} }, FIELD_IDS);
  assert.equal(free.isFree, true);
  assert.equal(free.subject, '');
  // Ohne bekannte Feld-Ids bleibt das Fach leer statt "undefined" zu zeigen.
  const bare = lessonFromEntry({
    date_key: '2026-01-05',
    shift_type: { id: 1, name: '', start_time: null, end_time: null },
    field_values: { 1: 'Mathematik' },
  }, {});
  assert.equal(bare.subject, '');
  assert.equal(bare.room, '');
});

test('lessonFromPatternDay liest eine Plan-Zeile', () => {
  const typeById = new Map([[11, { id: 11, name: '3. Stunde', start_time: '09:55', end_time: '10:40' }]]);
  const lesson = lessonFromPatternDay(
    { shift_type_id: 11, field_values: { 1: 'Physik', 2: 'C101' } },
    typeById,
    FIELD_IDS,
  );
  assert.equal(lesson.subject, 'Physik');
  assert.equal(lesson.room, 'C101');
  assert.equal(lesson.startTime, '09:55');
  // Position 0 des Plans ist der Montag; das ist hier nicht Teil der Zeile.
  assert.equal(lesson.dateKey, undefined);
});

test('sortLessons ordnet nach Uhrzeit und schiebt Zeitloses ans Ende', () => {
  const sorted = sortLessons([
    { subject: 'Sport', startTime: '11:35' },
    { subject: 'Ganztag', startTime: '' },
    { subject: 'Mathematik', startTime: '08:00' },
    { subject: 'Deutsch', startTime: '09:55' },
  ]);
  assert.deepEqual(sorted.map((l) => l.subject), ['Mathematik', 'Deutsch', 'Sport', 'Ganztag']);
  assert.deepEqual(sortLessons(null), []);
});

test('buildWeekGrid bildet Zeilen aus Uhrzeiten und Spalten aus Tagen', () => {
  const monday = '2026-01-05';
  const tuesday = '2026-01-06';
  const lessonsByDate = new Map([
    [monday, [
      { subject: 'Deutsch', startTime: '09:55', endTime: '10:40' },
      { subject: 'Mathematik', startTime: '08:00', endTime: '08:45' },
    ]],
    [tuesday, [
      { subject: 'Englisch', startTime: '08:00', endTime: '08:45' },
    ]],
  ]);

  const grid = buildWeekGrid(lessonsByDate, [monday, tuesday]);
  assert.equal(grid.length, 2, 'zwei Uhrzeiten ergeben zwei Zeilen');
  assert.equal(grid[0].startTime, '08:00', 'die frueheste Stunde steht oben');
  assert.equal(grid[1].startTime, '09:55');
  // Zeile 1 hat beide Tage belegt, Zeile 2 nur den Montag.
  assert.deepEqual(grid[0].cells.get(monday).map((l) => l.subject), ['Mathematik']);
  assert.deepEqual(grid[0].cells.get(tuesday).map((l) => l.subject), ['Englisch']);
  assert.equal(grid[1].cells.has(tuesday), false, 'ein freier Tag ist keine leere Zelle');
});

test('buildWeekGrid legt gleiche Uhrzeiten in eine Zeile', () => {
  const monday = '2026-01-05';
  const grid = buildWeekGrid(new Map([[monday, [
    { subject: 'Katholische Religion', startTime: '08:00', endTime: '08:45' },
    { subject: 'Evangelische Religion', startTime: '08:00', endTime: '08:45' },
  ]]]), [monday]);
  assert.equal(grid.length, 1, 'zwei Faecher zur selben Zeit sind eine Zeile, nicht zwei');
  assert.deepEqual(grid[0].cells.get(monday).map((l) => l.subject), ['Evangelische Religion', 'Katholische Religion']);
});

test('buildWeekGrid mit leerem Plan', () => {
  assert.deepEqual(buildWeekGrid(new Map(), ['2026-01-05']), []);
  assert.deepEqual(buildWeekGrid(null, []), []);
});

test('nextDateWithLessons ueberspringt freie Tage', () => {
  const schoolDays = new Set(['2026-01-05', '2026-01-08']);
  const has = (key) => schoolDays.has(key);
  assert.equal(nextDateWithLessons('2026-01-05', has), '2026-01-05', 'heute zaehlt mit');
  assert.equal(nextDateWithLessons('2026-01-06', has), '2026-01-08', 'der 6. und 7. sind frei');
  assert.equal(nextDateWithLessons('2026-01-09', has), null, 'nach dem letzten Schultag gibt es nichts mehr');
  assert.equal(nextDateWithLessons('2026-01-09', has, { maxDays: 2 }), null);
  assert.equal(nextDateWithLessons(null, has), null);
});

test('nextLesson findet die naechste anstehende Stunde', () => {
  const lessons = [
    { subject: 'Mathematik', startTime: '08:00' },
    { subject: 'Deutsch', startTime: '09:55' },
    { subject: 'Sport', startTime: '11:35' },
  ];
  assert.equal(nextLesson(lessons, 0).subject, 'Mathematik');
  assert.equal(nextLesson(lessons, 480).subject, 'Mathematik', 'genau zum Beginn zaehlt sie noch');
  assert.equal(nextLesson(lessons, 481).subject, 'Deutsch');
  assert.equal(nextLesson(lessons, 999), null, 'nach der letzten Stunde gibt es keine naechste');
  assert.equal(nextLesson([], 0), null);
});

/* ── Die gewaehlte Fachfarbe ────────────────────────────────────────────────
 *
 * Die Farbe liegt als Wert an der Plan-Zeile und wird im Schichtplan als
 * gewoehnliches Textfeld angezeigt - dort kann jeder hineinschreiben, was er
 * will. Diese vier Tests halten die Kette, die daraus wieder eine Farbe macht:
 * pruefen, je Fach einmal auflisten, auf alle Zeilen des Fachs schreiben, und
 * beim Lesen auf die gerechnete zurueckfallen.
 */

test('normalizeColor laesst nur Farben durch und normalisiert sie', () => {
  // Was durchkommt, landet in `--lesson-color`. Ein ungepruefter Wert wirft die
  // Deklaration weg - der Block waere durchsichtig.
  assert.equal(normalizeColor('#7C3AED'), '#7c3aed', 'Grossschreibung wird zur Normalform');
  assert.equal(normalizeColor('  #7c3aed  '), '#7c3aed', 'Rand wird abgeschnitten');
  assert.equal(normalizeColor('7c3aed'), '#7c3aed', 'das # ist optional');
  assert.equal(normalizeColor('#abc'), '#aabbcc', 'Kurzform wie in CSS');
  assert.equal(normalizeColor('#ABC'), '#aabbcc');
  for (const bad of ['', '   ', 'blau', 'red', '#12345', '#1234567', 'rgb(1,2,3)', 'var(--x)', null, undefined, 42, {}]) {
    assert.equal(normalizeColor(bad), '', `"${String(bad)}" darf keine Farbe sein`);
  }
});

test('eine gewaehlte Farbe gewinnt gegen die gerechnete', () => {
  const fieldIds = { subject: 1, color: 2 };
  const typeById = new Map([[7, { id: 7, name: '1. Stunde', start_time: '08:00', end_time: '08:45' }]]);
  const row = { position: 0, shift_type_id: 7, field_values: { 1: 'Mathematik', 2: '#7c3aed' } };
  assert.equal(lessonFromPatternDay(row, typeById, fieldIds).color, '#7c3aed');
  // Ohne eigene Wahl bleibt es bei der gerechneten - und die ist stabil.
  const plain = { position: 0, shift_type_id: 7, field_values: { 1: 'Mathematik' } };
  assert.equal(lessonFromPatternDay(plain, typeById, fieldIds).color, subjectColor('Mathematik'));
  // Ein Wert, den jemand im Schichtplan hineingetippt hat, faellt auf dieselbe
  // zurueck, statt als kaputte Deklaration durchzukommen.
  const junk = { position: 0, shift_type_id: 7, field_values: { 1: 'Mathematik', 2: 'blau' } };
  assert.equal(lessonFromPatternDay(junk, typeById, fieldIds).color, subjectColor('Mathematik'));
  // Und ohne die Rolle im Haushalt (Feld umbenannt) ebenfalls.
  assert.equal(lessonFromPatternDay(row, typeById, { subject: 1 }).color, subjectColor('Mathematik'));
});

test('auch die aufgeloesten Eintraege tragen die gewaehlte Farbe', () => {
  // "Morgen" und die Kachel lesen `lessonFromEntry` - zeigt nur einer der beiden
  // Einstiege die gewaehlte Farbe, sieht dieselbe Stunde an zwei Stellen
  // verschieden aus.
  const entry = {
    date_key: '2026-01-05',
    shift_type: { id: 7, name: '1. Stunde', start_time: '08:00', end_time: '08:45' },
    field_values: { 1: 'Mathematik', 2: '#0369A1' },
    source: 'pattern',
  };
  assert.equal(lessonFromEntry(entry, { subject: 1, color: 2 }).color, '#0369a1');
  assert.equal(lessonFromEntry(entry, { subject: 1 }).color, subjectColor('Mathematik'));
});

test('subjectsInPlan listet jedes Fach einmal und traegt seine Farbe', () => {
  const rows = [
    { field_values: { 1: 'Mathematik', 2: '#7c3aed' } },
    { field_values: { 1: 'Sport' } },
    { field_values: { 1: 'mathematik ' } },
    { field_values: { 1: '  ' } },
    { field_values: {} },
    null,
  ];
  assert.deepEqual(subjectsInPlan(rows, { subjectFieldId: 1, colorFieldId: 2 }), [
    { subject: 'Mathematik', color: '#7c3aed' },
    { subject: 'Sport', color: '' },
  ]);
  // Die Farbe steht in der ERSTEN Zeile, die Zeile ohne Wert folgt: eine Zeile
  // ohne Wert darf die Farbe des Fachs nicht auf '' zuruecksetzen. Gross
  // geschrieben, weil der Regler des Kerns den Wert so liefern kann - die Liste
  // geht in `value` eines <input type="color">, und das will Kleinbuchstaben.
  const mixed = [
    { field_values: { 1: 'Mathematik', 2: '#0369A1' } },
    { field_values: { 1: 'Mathematik' } },
  ];
  assert.deepEqual(subjectsInPlan(mixed, { subjectFieldId: 1, colorFieldId: 2 }), [
    { subject: 'Mathematik', color: '#0369a1' },
  ]);
  // Ohne Fach-Feld gibt es keine Liste - nicht eine Liste ohne Namen.
  assert.deepEqual(subjectsInPlan(rows, {}), []);
});

test('spreadSubjectColor faerbt alle Zeilen des Fachs und keine andere', () => {
  const rows = [
    { position: 0, shift_type_id: 7, field_values: { 1: 'Mathematik' } },
    { position: 1, shift_type_id: 8, field_values: { 1: 'mathematik', 2: '#000000' } },
    { position: 2, shift_type_id: 7, field_values: { 1: 'Sport', 2: '#111111' } },
    { position: 3, shift_type_id: 7, field_values: {} },
  ];
  const out = spreadSubjectColor(rows, { subjectFieldId: 1, colorFieldId: 2, subject: 'Mathematik', color: '#7c3aed' });
  assert.equal(out[0].field_values[2], '#7c3aed', 'die Zeile ohne Wert bekommt die Farbe');
  assert.equal(out[1].field_values[2], '#7c3aed', 'Gross/Klein entscheidet nicht mit');
  assert.equal(out[2].field_values[2], '#111111', 'ein anderes Fach bleibt unberuehrt');
  assert.equal(out[3].field_values[2], undefined, 'eine Zeile ohne Fach bleibt unberuehrt');
  // Die uebergebenen Zeilen bleiben, wie sie waren: der Aufrufer holt sie aus
  // dem Zustand und schickt gleich den ganzen Satz.
  assert.equal(rows[0].field_values[2], undefined);
  assert.notEqual(out[0], rows[0]);
});

test('spreadSubjectColor kann eine Farbe auch wieder wegnehmen', () => {
  // `''` heisst "wieder automatisch": der Server ueberspringt leere Werte, die
  // Zeile verliert ihren Farbwert, und die Ansicht rechnet wieder aus dem Namen.
  const rows = [{ field_values: { 1: 'Mathematik', 2: '#7c3aed' } }];
  const out = spreadSubjectColor(rows, { subjectFieldId: 1, colorFieldId: 2, subject: 'Mathematik', color: '' });
  assert.equal(out[0].field_values[2], '');
  // Ohne Ziel oder ohne Fach-ID passiert nichts, statt alles zu faerben.
  assert.deepEqual(spreadSubjectColor(rows, { subjectFieldId: 1, subject: '' }), rows);
  assert.deepEqual(spreadSubjectColor(rows, { subjectFieldId: 1, subject: 'Mathematik' }), rows);
  assert.deepEqual(spreadSubjectColor(null, { subjectFieldId: 1, colorFieldId: 2, subject: 'Mathematik' }), []);
});

/* ── Wie viel von einem Schultag auf die Kachel passt ─────────────────────── */

/* Der gemeldete Fehler: ein Tag mit acht Stunden zeigte fuenf, mit Pausen fehlten
 * drei - und weil `.widget` abschneidet, sah die Liste trotzdem vollstaendig aus.
 * Die Tests hier halten die Zusage fest, die das behebt: was nicht gezeigt wird,
 * wird GEZAEHLT. Der Deckel selbst ist eine Schaetzung aus dem Raster und darf
 * sich aendern; diese Regel nicht. */

test('widgetRowBudget haelt die Zeilen des Kerns als Untergrenze', () => {
  // `listRowCap()` in public/pages/dashboard.js: 3 Zeilen flach, 5 Zeilen hoch.
  // Die beiden Zahlen sind die bestehende Zusage des Kerns an seine eigenen
  // Listen; die Kachel unterschreitet sie nicht, auch wo ihre hoeheren Zeilen
  // rechnerisch weniger zuliessen.
  assert.equal(widgetRowBudget('1x1').full, 3);
  assert.equal(widgetRowBudget('2x1').full, 3);
  assert.equal(widgetRowBudget('1x2').full, 5);
  assert.equal(widgetRowBudget('2x2').full, 5);
});

test('widgetRowBudget waechst mit der Hoehe und nicht mit der Breite', () => {
  // Aufsteigende Hoehe, absteigende Breite: die Zeilenzahl kommt aus dem
  // Zeilen-Span, nicht aus der Spaltenzahl.
  const sizes = ['4x1', '1x2', '2x3', '1x4'];
  const full = sizes.map((size) => widgetRowBudget(size).full);
  const compact = sizes.map((size) => widgetRowBudget(size).compact);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(full[index] > full[index - 1], `${sizes[index]} muss mehr tragen als ${sizes[index - 1]}`);
    assert.ok(compact[index] > compact[index - 1], `${sizes[index]} dichter als ${sizes[index - 1]}`);
  }
  // Eine breitere Kachel macht die Zeile laenger, nicht zahlreicher.
  assert.deepEqual(widgetRowBudget('2x2'), widgetRowBudget('4x2'));
  assert.deepEqual(widgetRowBudget('1x3'), widgetRowBudget('3x3'));
  assert.deepEqual(widgetRowBudget('1x2'), widgetRowBudget('2x2'));
});

test('widgetRowBudget rechnet aus dem Raster', () => {
  // Die Rechnung an einem Beispiel, damit sie nachvollziehbar bleibt und nicht
  // nur mit sich selbst uebereinstimmt. Ein 2x3-Feld ist drei Rasterzeilen hoch:
  // 3 * 132px plus zweimal der Abstand von 20px = 436px. Davon gehen Kopf und
  // Innenabstand (64px) und die Tageszeile (24px) ab, bleiben 348px. Eine
  // zweizeilige Stunde braucht 40px, eine einzeilige 24px.
  assert.equal(widgetRowBudget('2x3').full, 8, '348px / 40px');
  assert.equal(widgetRowBudget('2x3').compact, 14, '348px / 24px');
});

test('ein ganzer Schultag passt auf die Kachel', () => {
  // Der gemeldete Fall: acht Stunden auf einem 2x2-Feld. Vorher standen fuenf
  // da, die letzten drei fehlten lautlos.
  const day = widgetRowPlan('2x2', 8);
  assert.equal(day.cap, 8, 'acht Stunden muessen alle dastehen');
  assert.equal(day.more, 0);
  assert.equal(day.dense, true, 'dafuer schreibt die Kachel einzeilig');

  // Mit Pausen wird der Tag laenger als jede zweizeilige Kachel. Auf 2x2 bleibt
  // es eng - dann wird gezaehlt statt abgeschnitten -, auf 2x3 steht er ganz.
  assert.equal(widgetRowPlan('2x2', 11).more > 0, true, 'was nicht passt, wird gezaehlt');
  assert.equal(widgetRowPlan('2x3', 11).cap, 11);
  assert.equal(widgetRowPlan('2x3', 11).more, 0);
});

test('ein kurzer Tag behaelt Raum und Lehrer', () => {
  // Einzeilig ist die Notloesung fuer einen langen Tag, keine neue Anzeige: wer
  // in den Deckel passt, behaelt die zweite Zeile mit Raum und Lehrer.
  for (const size of ['2x2', '2x3', '2x4']) {
    const budget = widgetRowBudget(size).full;
    const plan = widgetRowPlan(size, budget);
    assert.equal(plan.dense, false, `${size}: ${budget} Stunden passen zweizeilig`);
    assert.equal(plan.cap, budget);
    assert.equal(plan.more, 0);
    // Eine Stunde mehr kippt in die einzeilige Fassung - und gewinnt dabei
    // Zeilen. Ohne diesen Gewinn waere der Wechsel ein Verlust und der Raum um
    //sonst weg.
    const next = widgetRowPlan(size, budget + 1);
    assert.equal(next.dense, true);
    assert.ok(next.cap > plan.cap, `${size}: einzeilig muss mehr Zeilen ergeben`);
    assert.equal(next.more, 0);
  }
});

test('was nicht auf die Kachel passt, wird gezaehlt', () => {
  // Die Regel, die den Fehler ausmacht: es gibt keinen Fall, in dem eine Stunde
  // weder dasteht noch genannt wird. Geprueft ueber jede Groesse und jede
  // Tageslaenge - der Deckel ist eine Schaetzung, diese Regel nicht.
  for (const size of ['1x1', '2x1', '1x2', '2x2', '2x3', '2x4', '4x4']) {
    const { full, compact } = widgetRowBudget(size);
    const budget = Math.max(full, compact);
    for (let count = 0; count <= budget + 3; count += 1) {
      const plan = widgetRowPlan(size, count);
      assert.equal(plan.cap + plan.more, count, `${size} mit ${count} Stunden verliert eine`);
      assert.ok(plan.cap <= budget, `${size}: mehr Zeilen als Platz`);
      assert.equal(plan.more > 0, plan.cap < count, `${size}: die Mehr-Zeile passt nicht zum Rest`);
      // Und die Mehr-Zeile bekommt ihren eigenen Platz: wo dicht geschrieben
      // wird, zeigt die Kachel so viele Zeilen, dass eine Zeile des Deckels fuer
      // sie frei bleibt. Ohne diesen Abzug schoebe sie die letzte Stunde aus der
      // Kachel.
      if (plan.more > 0 && plan.dense) {
        const used = widgetRowBudget(size).compact;
        assert.ok(plan.cap < used, `${size} mit ${count}: die Mehr-Zeile verdraengt eine Stunde`);
      }
    }
  }
  // Ein Tag ohne Stunden und eine kaputte Zahl sind kein Sonderfall.
  for (const count of [0, undefined, null, -3, 'acht']) {
    assert.deepEqual(widgetRowPlan('2x2', count), { dense: false, cap: 0, more: 0 }, `"${String(count)}"`);
  }
});

test('eine flache Kachel behaelt ihre Zeilen und zaehlt trotzdem', () => {
  // Auf einem Feld mit einer Rasterzeile ist der Deckel die Zusage des Kerns (3
  // Zeilen). Er wird nicht gekuerzt, auch nicht fuer die Mehr-Zeile: dort ist
  // ohnehin kaum eine Zeile sichtbar, und eine Zeile weniger waere ein Verlust
  // ohne Gewinn. Gezaehlt wird trotzdem - verschwiegen wird nichts.
  const plan = widgetRowPlan('2x1', 7);
  assert.equal(plan.dense, false);
  assert.equal(plan.cap, 3, 'die drei Zeilen des Kerns bleiben');
  assert.equal(plan.more, 4);
});

test('die einzeilige Fassung nur, wenn sie Zeilen gewinnt', () => {
  // Ein flaches Feld hat so wenig Hoehe, dass die einzeilige Zeile rechnerisch
  // nicht mehr Platz schafft als die zweizeilige Zusage des Kerns. Dort bleibt
  // die Anzeige wie bisher: sonst verloere man ueberall den Raum und gewaenne
  // nichts.
  for (const size of ['1x1', '2x1', '3x1', '4x1']) {
    const { full, compact } = widgetRowBudget(size);
    assert.ok(compact <= full, `${size} darf nicht dichter rechnen als zweizeilig`);
    assert.equal(widgetRowPlan(size, full + 4).dense, false);
  }
  // Eine Groessenangabe, die der Kern nicht kennt, faellt auf dieselbe flache
  // Vorgabe zurueck wie `listRowCap()`: `String(size ?? '1x1')`.
  for (const broken of [undefined, null, '', 'kaputt', '2', 'x', 2]) {
    assert.deepEqual(widgetRowBudget(broken), widgetRowBudget('1x1'), `"${String(broken)}"`);
  }
});
