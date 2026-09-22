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
  SCHOOL_DAYS_DEFAULT,
  normalizeSchoolDays,
  schoolDateKeys,
  schoolPositions,
  hiddenSubjects,
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
  remainingLessons,
  normalizeColor,
  subjectColors,
  subjectsInPlan,
  spreadSubjectColor,
  lessonsByDate,
  widgetRowBudget,
  widgetDayPlan,
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

/* ── Welche Tage ein Schultag sind ────────────────────────────────────────── */

test('normalizeSchoolDays laesst nur echte Wochentage durch', () => {
  // Der Wert kommt aus dem Browserspeicher: er kann fehlen, von Hand verstellt
  // oder aus einer aelteren Fassung sein. Nichts davon darf die Ansicht
  // anhalten.
  assert.deepEqual(normalizeSchoolDays([5, 1, 3]), [1, 3, 5], 'aufsteigend, nicht in Eingabereihenfolge');
  assert.deepEqual(normalizeSchoolDays(['2', '4']), [2, 4], 'Zeichenketten aus dem Speicher zaehlen');
  assert.deepEqual(normalizeSchoolDays([1, 1, 2]), [1, 2], 'Doppelte fallen heraus');
  assert.deepEqual(normalizeSchoolDays([0, 8, 1.5, null, 'x', 3]), [3], 'was kein Wochentag ist, faellt heraus');
  // Nichts uebrig heisst Voreinstellung, nicht "keine Woche": ein Plan ohne
  // Spalten sieht aus wie ein Fehler statt wie eine Wahl.
  assert.deepEqual(normalizeSchoolDays([]), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeSchoolDays(null), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeSchoolDays('1,2'), [1, 2, 3, 4, 5], 'keine Liste, keine Wahl');
  assert.deepEqual(normalizeSchoolDays([7, 6]), [6, 7], 'das Wochenende ist waehlbar');
  // Und die Voreinstellung selbst ist unveraenderlich - der Aufrufer bekommt
  // eine Kopie und kann sie nicht fuer alle anderen umschreiben.
  assert.deepEqual([...SCHOOL_DAYS_DEFAULT], [1, 2, 3, 4, 5]);
  assert.notEqual(normalizeSchoolDays([]), SCHOOL_DAYS_DEFAULT);
});

test('schoolDateKeys haelt die Ordnung der Haushaltswoche', () => {
  // Montag, 2026-01-05. Ohne Wahl bleibt es bei Montag bis Freitag.
  assert.deepEqual(schoolDateKeys(MONDAY, 1), [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  ]);
  // Mit Samstag dazu kommt er ANS ENDE, nicht an den Anfang: die Woche des
  // Haushalts bleibt die Ordnung, gefiltert wird nur.
  assert.deepEqual(schoolDateKeys(MONDAY, 1, [1, 2, 3, 4, 5, 6]).at(-1), '2026-01-10');
  // Ein Haushalt, dessen Woche am Sonntag beginnt, bekommt Sonntag zuerst: die
  // Woche um Montag, den 05.01., faengt am Sonntag, dem 04.01. an - und die
  // Auswahl steht in DIESER Ordnung, nicht in der des ISO-Wochentags.
  assert.deepEqual(schoolDateKeys(MONDAY, 0), [
    '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  ]);
  assert.deepEqual(schoolDateKeys(MONDAY, 0, [1, 7]), ['2026-01-04', '2026-01-05']);
  // Eine Auswahl ohne Reihenfolge in der Eingabe aendert nichts an der Ausgabe.
  assert.deepEqual(schoolDateKeys(MONDAY, 1, [5, 3, 1]), ['2026-01-05', '2026-01-07', '2026-01-09']);
  // Ein kaputtes Datum bleibt leer und wird nicht zur Voreinstellungswoche.
  assert.deepEqual(schoolDateKeys('kein Datum', 1), []);
});

test('schoolPositions rechnet aus dem Anker, nicht aus dem Index', () => {
  // Das Bearbeiten-Raster ist das Muster: Spalte 3 ist "drei Tage nach dem
  // Anker". Ist der Anker ein Samstag, faellt der Samstag auf Position 0 - und
  // die versteckte Spalte ist dann nicht die sechste.
  assert.deepEqual(schoolPositions(MONDAY), [0, 1, 2, 3, 4]);
  const saturday = '2026-01-10';
  assert.deepEqual(isoWeekday(saturday), 6);
  assert.deepEqual(schoolPositions(saturday), [2, 3, 4, 5, 6], 'Sonntag und Montag stehen am Rand');
  assert.deepEqual(schoolPositions(saturday, [6, 7]), [0, 1]);
  // Ohne brauchbare Wahl bleibt es bei der Voreinstellung - und die Positionen
  // sind immer echt.
  assert.deepEqual(schoolPositions(MONDAY, []), [0, 1, 2, 3, 4]);
});

test('hiddenSubjects sagt, was auf einem versteckten Tag stehen bleibt', () => {
  // Der Plan des gemeldeten Falls: Montag bis Freitag traegt Stunden, der
  // Samstag auch - und der Samstag ist ausgeblendet.
  const days = [
    { position: 0, field_values: { 1: 'Mathematik' } },
    { position: 5, field_values: { 1: 'Sport' } },
    { position: 5, field_values: { 1: 'Musik' } },
    { position: 6, field_values: { 1: ' ' } },
    { position: 6, field_values: {} },
  ];
  const hidden = hiddenSubjects(days, MONDAY, [1, 2, 3, 4, 5], { subjectFieldId: 1 });
  assert.deepEqual([...hidden.keys()], [6], 'nur der Samstag, und nur einmal');
  assert.deepEqual(hidden.get(6), ['Sport', 'Musik']);
  // Ohne versteckte Tage gibt es nichts zu sagen - und ohne Fach-Feld auch
  // nicht, weil dann nichts nachzuweisen ist.
  assert.equal(hiddenSubjects(days, MONDAY, [1, 2, 3, 4, 5, 6, 7], { subjectFieldId: 1 }).size, 0);
  assert.equal(hiddenSubjects(days, MONDAY, [1, 2, 3, 4, 5], {}).size, 0);
  // Ein laengerer Zyklus ist erlaubt (A/B-Wochen): Position 12 ist derselbe
  // Samstag wie Position 5 und wird genauso gezaehlt - ein Deckel bei 6 wuerde
  // genau die Stunden verschweigen, fuer die es diesen Hinweis gibt.
  const longCycle = hiddenSubjects([{ position: 12, field_values: { 1: 'Sport' } }], MONDAY, [1, 2, 3, 4, 5], { subjectFieldId: 1 });
  assert.deepEqual(longCycle.get(6), ['Sport'], 'die zweite Woche eines 14er-Zyklus faellt unter den Tisch');
  // Was keine Position ist, wird nicht auf einen Wochentag geraten.
  assert.equal(hiddenSubjects([{ position: -1, field_values: { 1: 'Sport' } }], MONDAY, [1, 2, 3, 4, 5], { subjectFieldId: 1 }).size, 0);
  assert.equal(hiddenSubjects([{ position: 'x', field_values: { 1: 'Sport' } }], MONDAY, [1, 2, 3, 4, 5], { subjectFieldId: 1 }).size, 0);
  assert.equal(hiddenSubjects(days, 'kein Datum', [1, 2, 3, 4, 5], { subjectFieldId: 1 }).size, 0);
});

/* ── Die Farbe gehoert dem Fach, nicht der Zeile ──────────────────────────── */

/* Der gemeldete Fehler: Musik am Montag rot gemacht, Musik am Donnerstag danach
 * neu getippt - die neue Stunde kam in der gerechneten Farbe. Die Zeile, an der
 * die Farbe haengt, wusste nichts von der zweiten, und die Ansicht fragte nur
 * diese eine Zeile. Die Farbe wird jetzt aus ALLEN bekannten Zeilen je Fach
 * aufgeloest. */

test('subjectColors nimmt die erste gespeicherte Farbe je Fach', () => {
  const rows = [
    { field_values: { 1: 'Musik', 2: '#7c3aed' } },
    { field_values: { 1: 'Mathematik', 2: '#0369A1' } },
    { field_values: { 1: 'musik ' } },
    { field_values: { 1: 'Sport' } },
    { field_values: { 1: 'Musik', 2: '#000000' } },
    { field_values: { 1: 'Kunst', 2: 'blau' } },
    { field_values: {} },
    null,
  ];
  const colors = subjectColors(rows, { subjectFieldId: 1, colorFieldId: 2 });
  assert.equal(colors.get('musik'), '#7c3aed', 'Gross/Klein und Leerzeichen entscheiden nicht mit');
  assert.equal(colors.get('mathematik'), '#0369a1');
  assert.equal(colors.has('sport'), false, 'ohne Farbe kein Eintrag - der Rueckfall bleibt der Aufrufer');
  assert.equal(colors.has('kunst'), false, 'ein unbrauchbarer Wert zaehlt nicht als Farbe');
  assert.equal(colors.size, 2);
  // Ohne eine der beiden Ids gibt es nichts aufzuloesen, statt alles zu faerben.
  assert.equal(subjectColors(rows, { subjectFieldId: 1 }).size, 0);
  assert.equal(subjectColors(rows, {}).size, 0);
  assert.equal(subjectColors(null, { subjectFieldId: 1, colorFieldId: 2 }).size, 0);
});

test('eine spaeter getippte Stunde erbt die Farbe ihres Fachs', () => {
  // Genau der gemeldete Fall: Montag Musik in Rot, Donnerstag Musik ohne
  // eigenen Wert. Beide Tage muessen rot sein.
  const entries = [
    { date_key: '2026-01-05', shift_type: { id: 7, name: '3. Stunde', start_time: '10:00' }, field_values: { 1: 'Musik', 2: '#7c3aed' }, source: 'pattern' },
    { date_key: '2026-01-08', shift_type: { id: 7, name: '3. Stunde', start_time: '10:00' }, field_values: { 1: 'Musik' }, source: 'pattern' },
  ];
  const byDate = lessonsByDate(entries, ['2026-01-05', '2026-01-08'], { subject: 1, color: 2 });
  assert.equal(byDate.get('2026-01-05')[0].color, '#7c3aed');
  assert.equal(byDate.get('2026-01-08')[0].color, '#7c3aed', 'die zweite Stunde desselben Fachs');
  // Ein Fach ohne irgendwo gespeicherte Farbe bleibt bei der gerechneten - die
  // Erbschaft darf nicht in eine einzige Farbe fuer alles ausarten.
  const other = lessonsByDate(
    [{ date_key: '2026-01-05', shift_type: { id: 7, start_time: '10:00' }, field_values: { 1: 'Sport' }, source: 'pattern' }],
    ['2026-01-05'],
    { subject: 1, color: 2 },
  );
  assert.equal(other.get('2026-01-05')[0].color, subjectColor('Sport'));
});

test('die eigene Zeile schlaegt die Farbe des Fachs', () => {
  // Eine Vertretungsstunde darf anders aussehen als ihr Fach - sonst koennte
  // man eine Abweichung nicht als solche faerben.
  const entries = [
    { date_key: '2026-01-05', shift_type: { id: 7, start_time: '10:00' }, field_values: { 1: 'Musik', 2: '#7c3aed' }, source: 'pattern' },
    { date_key: '2026-01-08', shift_type: { id: 7, start_time: '10:00' }, field_values: { 1: 'Musik', 2: '#dc2626' }, source: 'pattern' },
  ];
  const byDate = lessonsByDate(entries, ['2026-01-05', '2026-01-08'], { subject: 1, color: 2 });
  assert.equal(byDate.get('2026-01-05')[0].color, '#7c3aed');
  assert.equal(byDate.get('2026-01-08')[0].color, '#dc2626');
});

test('ohne Vorrat sucht der Rueckfall unter den Zeilen, die der Aufruf sieht', () => {
  // Der Rueckfall fragt ALLE Zeilen, die ihm gereicht wurden - auch die
  // ausserhalb des gefragten Zeitraums. Fuer die Kachel ist das genau richtig:
  // sie holt ihre Tage in einem Zug und findet so die Farbe eines Fachs, das an
  // einem ihrer Tage noch ohne eigenen Wert steht.
  const entries = [
    { date_key: '2026-01-05', shift_type: { id: 7, start_time: '10:00' }, field_values: { 1: 'Musik', 2: '#7c3aed' }, source: 'pattern' },
    { date_key: '2026-01-06', shift_type: { id: 7, start_time: '10:00' }, field_values: { 1: 'Musik' }, source: 'pattern' },
  ];
  const byDate = lessonsByDate(entries, ['2026-01-06'], { subject: 1, color: 2 });
  assert.equal(byDate.get('2026-01-06')[0].color, '#7c3aed', 'der Montag steht mit im Rueckfall');
  // Und was der Aufruf gar nicht sieht, kann er nicht wissen. Dafuer gibt es den
  // Vorrat: die Seite kennt das ganze Muster, die Kachel nur ihre Antwort.
  const only = lessonsByDate([entries[1]], ['2026-01-06'], { subject: 1, color: 2 });
  assert.equal(only.get('2026-01-06')[0].color, subjectColor('Musik'),
    'ohne die Montagszeile bleibt es bei der gerechneten Farbe');
  const palette = subjectColors(entries, { subjectFieldId: 1, colorFieldId: 2 });
  const withPalette = lessonsByDate([entries[1]], ['2026-01-06'], { subject: 1, color: 2 }, palette);
  assert.equal(withPalette.get('2026-01-06')[0].color, '#7c3aed',
    'mit dem Vorrat der Seite findet sie die Farbe trotzdem');
});

test('lessonsByDate ordnet nach Tag, laesst freie Tage weg und fuellt jeden Schluessel', () => {
  const entries = [
    { date_key: '2026-01-05', shift_type: { id: 8, start_time: '10:00' }, field_values: { 1: 'Sport' }, source: 'pattern' },
    { date_key: '2026-01-05', shift_type: { id: 7, start_time: '08:00' }, field_values: { 1: 'Mathematik' }, source: 'pattern' },
    { date_key: '2026-01-05', shift_type: { id: 9, start_time: null }, field_values: { 1: 'frei' }, source: 'override', is_free: true },
    { date_key: '2026-01-06', shift_type: { id: 7, start_time: '08:00' }, field_values: { 1: 'Mathematik' }, source: 'pattern' },
    { date_key: '2026-02-01', shift_type: { id: 7, start_time: '08:00' }, field_values: { 1: 'Mathematik' }, source: 'pattern' },
  ];
  const byDate = lessonsByDate(entries, ['2026-01-05', '2026-01-06', '2026-01-07'], { subject: 1 });
  assert.deepEqual([...byDate.keys()], ['2026-01-05', '2026-01-06', '2026-01-07'],
    'auch ein Tag ohne Unterricht hat einen Schluessel');
  assert.deepEqual(byDate.get('2026-01-05').map((lesson) => lesson.subject), ['Mathematik', 'Sport']);
  assert.equal(byDate.get('2026-01-05').length, 2, 'der freie Tag ist keine Stunde');
  assert.deepEqual(byDate.get('2026-01-07'), []);
  assert.equal(byDate.size, 3, 'was ausserhalb des Zeitraums liegt, kommt nicht mit');
});

/* ── Wie viel von einem Schultag auf die Kachel passt ─────────────────────── */

/* Der gemeldete Fehler: ein Tag mit acht Stunden zeigte fuenf, mit Pausen fehlten
 * drei - und weil `.widget` abschneidet, sah die Liste trotzdem vollstaendig aus.
 * Die Tests hier halten die Zusage fest, die das behebt: was nicht gezeigt wird,
 * wird GEZAEHLT. Der Deckel selbst ist eine Schaetzung aus dem Raster und darf
 * sich aendern; diese Regel nicht. */

/** Ein Tag, wie ihn die Kachel uebergibt - die Stundenzahl ist alles, was zaehlt. */
const widgetDay = (key, count) => ({
  key,
  lessons: Array.from({ length: count }, (unused, index) => ({
    startTime: '08:00',
    endTime: '08:45',
    subject: `Fach ${index + 1}`,
  })),
});

/** Der Plan fuer eine Liste von Stundenzahlen, in Tagen ab `2026-01-05`. */
const planOf = (size, counts) => widgetDayPlan(
  size,
  counts.map((count, index) => widgetDay(`2026-01-0${5 + index}`, count)),
);

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

test('widgetRowBudget zieht je Tag eine Tageszeile ab', () => {
  // Zwei Tage sind zwei Ueberschriften. Wer sie nicht abzieht, plant eine Zeile
  // ein, die es nicht gibt - und `.widget` schneidet sie ab, statt sie zu melden.
  assert.equal(widgetRowBudget('2x4').full, 12, 'ein Tag: 500px / 40px');
  assert.equal(widgetRowBudget('2x4', { sections: 2 }).full, 11, 'zwei Tage: 476px / 40px');
  assert.equal(widgetRowBudget('2x3').compact, 14);
  assert.equal(widgetRowBudget('2x3', { sections: 2 }).compact, 13);
  // Und der Deckel des Kerns gilt dann nicht mehr: zwei Tage sind etwas, das der
  // Kern nicht kennt, und seine Zeilen sind nicht auf zwei Ueberschriften
  // gerechnet. Die Untergrenze ist dort eine Zeile je Abschnitt.
  assert.equal(widgetRowBudget('2x2', { sections: 2 }).full, 4, '172px / 40px statt der fuenf des Kerns');
  assert.ok(widgetRowBudget('2x2', { sections: 2 }).full >= 2, 'sonst verschwindet der zweite Tag still');
});

test('ein ganzer Schultag passt auf die Kachel', () => {
  // Der gemeldete Fall: acht Stunden auf einem 2x2-Feld. Vorher standen fuenf
  // da, die letzten drei fehlten lautlos.
  const plan = planOf('2x2', [8]);
  assert.equal(plan.days[0].cap, 8, 'acht Stunden muessen alle dastehen');
  assert.equal(plan.days[0].more, 0);
  assert.equal(plan.dense, true, 'dafuer schreibt die Kachel einzeilig');

  // Mit Pausen wird der Tag laenger als jede zweizeilige Kachel. Auf 2x2 bleibt
  // es eng - dann wird gezaehlt statt abgeschnitten -, auf 2x3 steht er ganz.
  assert.equal(planOf('2x2', [11]).days[0].more > 0, true, 'was nicht passt, wird gezaehlt');
  assert.equal(planOf('2x3', [11]).days[0].cap, 11);
  assert.equal(planOf('2x3', [11]).days[0].more, 0);
});

test('ein kurzer Tag behaelt Raum und Lehrer', () => {
  // Einzeilig ist die Notloesung fuer einen langen Tag, keine neue Anzeige: wer
  // in den Deckel passt, behaelt die zweite Zeile mit Raum und Lehrer.
  for (const size of ['2x2', '2x3', '2x4']) {
    const budget = widgetRowBudget(size).full;
    const plan = planOf(size, [budget]);
    assert.equal(plan.dense, false, `${size}: ${budget} Stunden passen zweizeilig`);
    assert.equal(plan.days[0].cap, budget);
    assert.equal(plan.days[0].more, 0);
    // Eine Stunde mehr kippt in die einzeilige Fassung - und gewinnt dabei
    // Zeilen. Ohne diesen Gewinn waere der Wechsel ein Verlust und der Raum um
    // sonst weg.
    const next = planOf(size, [budget + 1]);
    assert.equal(next.dense, true);
    assert.ok(next.days[0].cap > plan.days[0].cap, `${size}: einzeilig muss mehr Zeilen ergeben`);
    assert.equal(next.days[0].more, 0);
  }
});

test('was nicht auf der Kachel steht, wird gezaehlt', () => {
  // Die Regel, die den Fehler ausmacht: es gibt keinen Fall, in dem eine Stunde
  // weder dasteht noch genannt wird. Geprueft ueber jede Groesse und jede
  // Tageslaenge - der Deckel ist eine Schaetzung, diese Regel nicht.
  for (const size of ['1x1', '2x1', '1x2', '2x2', '2x3', '2x4', '4x4']) {
    const { full, compact } = widgetRowBudget(size);
    const budget = Math.max(full, compact);
    for (let count = 0; count <= budget + 3; count += 1) {
      for (const plan of [planOf(size, [count]), planOf(size, [count, count])]) {
        for (const day of plan.days) {
          assert.equal(day.cap + day.more, count, `${size} mit ${count} Stunden verliert eine`);
          assert.ok(day.cap <= budget, `${size}: mehr Zeilen als Platz`);
          assert.equal(day.more > 0, day.cap < count, `${size}: die Mehr-Zahl passt nicht zum Rest`);
        }
      }
    }
  }
  // Ein Tag ohne Stunden und eine kaputte Zahl sind kein Sonderfall.
  for (const count of [0, undefined, null, -3, 'acht']) {
    assert.deepEqual(widgetDayPlan('2x2', [widgetDay(MONDAY, count)]), { dense: false, days: [] }, `"${String(count)}"`);
  }
  assert.deepEqual(widgetDayPlan('2x2', null), { dense: false, days: [] });
});

test('eine flache Kachel behaelt ihre Zeilen und zaehlt trotzdem', () => {
  // Auf einem Feld mit einer Rasterzeile ist der Deckel die Zusage des Kerns (3
  // Zeilen). Er wird nicht gekuerzt: dort ist ohnehin kaum eine Zeile sichtbar,
  // und eine Zeile weniger waere ein Verlust ohne Gewinn. Gezaehlt wird
  // trotzdem - verschwiegen wird nichts.
  const plan = planOf('2x1', [7]);
  assert.equal(plan.dense, false);
  assert.equal(plan.days[0].cap, 3, 'die drei Zeilen des Kerns bleiben');
  assert.equal(plan.days[0].more, 4);
});

test('die einzeilige Fassung nur, wenn sie Zeilen gewinnt', () => {
  // Ein flaches Feld hat so wenig Hoehe, dass die einzeilige Zeile rechnerisch
  // nicht mehr Platz schafft als die zweizeilige Zusage des Kerns. Dort bleibt
  // die Anzeige wie bisher: sonst verloere man ueberall den Raum und gewaenne
  // nichts.
  for (const size of ['1x1', '2x1', '3x1', '4x1']) {
    const { full, compact } = widgetRowBudget(size);
    assert.ok(compact <= full, `${size} darf nicht dichter rechnen als zweizeilig`);
    assert.equal(planOf(size, [full + 4]).dense, false);
  }
  // Eine Groessenangabe, die der Kern nicht kennt, faellt auf dieselbe flache
  // Vorgabe zurueck wie `listRowCap()`: `String(size ?? '1x1')`.
  for (const broken of [undefined, null, '', 'kaputt', '2', 'x', 2]) {
    assert.deepEqual(widgetRowBudget(broken), widgetRowBudget('1x1'), `"${String(broken)}"`);
  }
});

/* ── Zwei Tage auf einer Kachel ───────────────────────────────────────────── */

test('der zweite Tag nimmt, was der erste uebrig laesst', () => {
  // Das 2x3-Feld traegt dicht 13 Zeilen. Ein Tag mit acht Stunden fuellt es
  // zweizeilig schon fast allein - dicht steht er ganz da und laesst fuenf
  // Zeilen fuer den naechsten. Genau dafuer wird dicht geschrieben.
  const plan = planOf('2x3', [8, 6]);
  assert.equal(plan.dense, true, 'ohne die einzeilige Fassung passt der zweite Tag nicht');
  assert.equal(plan.days[0].cap, 8, 'der laufende Tag steht ganz da');
  assert.equal(plan.days[1].cap, 5, 'der Rest gehoert dem naechsten Tag');
  assert.equal(plan.days[1].more, 1);
});

test('jeder Tag mit Stunden behaelt mindestens eine Zeile', () => {
  // Ohne diese Reservierung frasse ein voller Tag den naechsten restlos: acht
  // Stunden gegen acht Zeilen hiesse, dass morgen gar nicht vorkommt, obwohl
  // Platz fuer eine Zeile war. Geprueft auf jeder Hoehe, die zwei Tage traegt.
  for (const size of ['2x2', '3x2', '2x3', '2x4']) {
    for (const counts of [[8, 1], [8, 6], [12, 12], [1, 8]]) {
      const plan = planOf(size, counts);
      assert.equal(plan.days.length, 2, `${size} mit ${counts.join('/')} verliert einen Tag`);
      for (const day of plan.days) assert.ok(day.cap >= 1, `${size} mit ${counts.join('/')}: ein Tag ohne Zeile`);
    }
  }
});

test('auf einer flachen Kachel bleibt es bei einem Tag', () => {
  // Eine Rasterzeile ist die ganze Kachel. Sie in zwei Abschnitte zu teilen
  // nimmt beiden die Tageszeile und zeigt am Ende weniger als vorher - dort
  // bleibt es beim laufenden Tag und bei den drei Zeilen des Kerns.
  const plan = planOf('2x1', [7, 7]);
  assert.equal(plan.days.length, 1, 'zwei Tage auf einer Zeile Hoehe sind keine zwei Tage');
  assert.equal(plan.days[0].cap, 3);
});

test('ein Tag ohne Stunden ist kein Abschnitt', () => {
  // Der laufende Tag, an dem nichts mehr ansteht, und der Samstag fallen hier
  // heraus - ohne Zutun des Aufrufers. Deshalb braucht die Kachel keinen
  // Umschalter: abends bleibt der naechste Tag uebrig, und der bekommt die
  // ganze Kachel.
  const plan = planOf('2x3', [0, 6]);
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].key, '2026-01-06', 'der leere Tag steht trotzdem in der Liste');
  assert.equal(plan.days[0].cap, 6);
  // Und er kostet auch keine Zeile: der volle Tag bekommt genau den Platz, den
  // er allein bekaeme. Wuerde die leere Ueberschrift mitgezaehlt, verloere die
  // Kachel eine Stunde an einen Tag, den sie nicht zeigt.
  const withEmpty = planOf('2x3', [0, 11]).days[0];
  const alone = planOf('2x3', [11]).days[0];
  assert.equal(withEmpty.cap, alone.cap, 'der leere Tag verkuerzt die Kachel');
  assert.equal(withEmpty.more, alone.more);
});

test('abends steht nur noch der naechste Tag auf der Kachel', () => {
  // Die Uhr entscheidet, was heute noch dazugehoert - und sie entscheidet es
  // ueber das ENDE der Stunde. Eine Stunde, die gerade laeuft, ist nicht vorbei.
  const lessons = [
    { startTime: '08:00', endTime: '08:45', subject: 'Mathematik' },
    { startTime: '09:45', endTime: '10:30', subject: 'Deutsch' },
    { startTime: '11:00', endTime: '11:45', subject: 'Sport' },
  ];
  assert.equal(remainingLessons(lessons, 8 * 60).length, 3, 'um acht steht der ganze Tag da');
  assert.equal(remainingLessons(lessons, 9 * 60).length, 2, 'die erste ist vorbei');
  const running = remainingLessons(lessons, 10 * 60 + 10);
  assert.equal(running.length, 2);
  assert.equal(running[0].subject, 'Deutsch', 'eine laufende Stunde faellt nicht heraus');
  // Die Grenze selbst: wer um 08:45 auf die Kachel sieht, hat die Stunde hinter
  // sich - gezaehlt wird bis zum Ende, und das Ende ist vorbei.
  assert.equal(remainingLessons(lessons, 8 * 60 + 45).length, 2, 'die gerade beendete Stunde bleibt stehen');
  assert.deepEqual(remainingLessons(lessons, 12 * 60), [], 'nach der letzten bleibt nichts');
  // Eine Stunde ohne Ende ist keine vergangene Stunde, und ohne Uhr bleibt der
  // ganze Tag stehen: lieber zu viel als ein leeres Brett aus Versehen. Geprueft
  // mit einem Wert, der NICHT als Mitternacht durchgeht - `null` waere 0 und
  // damit ohnehin vor jeder Stunde.
  const timeless = [{ startTime: '08:00', subject: 'Vertretung' }];
  assert.equal(remainingLessons(timeless, 20 * 60).length, 1);
  assert.equal(remainingLessons(lessons, undefined).length, 3, 'ohne Uhr faellt der Tag aus');
  assert.equal(remainingLessons(lessons, 'halb acht').length, 3);
  assert.equal(remainingLessons(lessons, null).length, 3);
  assert.deepEqual(remainingLessons(null, 600), []);
});
