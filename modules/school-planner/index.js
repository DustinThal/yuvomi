/**
 * Modul: Stundenplan
 * Zweck: Ein echter Stundenplan statt einer Schichtvorlage. Drei Ansichten, die
 *        den Alltag tragen - "Morgen" (was faellt an, was muss mit), "Woche"
 *        (das Raster aus Faechern, Zeiten und Raeumen) und "Bearbeiten" (der
 *        wiederkehrende Plan).
 *
 * Abhaengigkeiten: /api.js, /i18n.js, /utils/*, /components/modal.js, ./timetable.js
 *
 * ── Wie dieses Modul auf Yuvomis Datenmodell passt ──────────────────────────
 *
 * Das Modul bringt KEINEN eigenen Server mit und oeffnet keine Datenbank - es
 * arbeitet ausschliesslich ueber /api/v1/schedule, das Yuvomi selbst anbietet.
 * Die Uebersetzung sieht so aus:
 *
 *   Schichtart (schedule_shift_types)      -> eine STUNDE ("1. Stunde", 08:00)
 *   Muster (schedule_patterns, Zyklus 7)   -> die WOCHENTAFEL einer Person
 *   Zyklustag (schedule_pattern_days)      -> eine Unterrichtsstunde an einem
 *                                             Wochentag (Position 0 = Ankertag)
 *   Feld (schedule_custom_fields)          -> Fach, Raum, Lehrer
 *
 * Warum die Stunde die Schichtart ist und nicht das Fach: eine Schichtart hat
 * genau EINE Uhrzeit. Waere "Mathematik" die Schichtart, koennte dasselbe Fach
 * nicht am Montag in der ersten und am Dienstag in der dritten Stunde stehen.
 * Umgekehrt geht es auf: die Stunde traegt die Zeit, das Fach haengt als
 * Feldwert an der einzelnen Zeile und darf deshalb in jeder Zeile ein anderes
 * sein. `timetable.js` faerbt dann nach Fach, nicht nach Stunde.
 *
 * Die Kehrseite, ehrlich gesagt: der Plan taucht auch im Dienstplan auf. Das
 * ist kein Unfall - der Stundenplan steht damit im Familienkalender und im
 * ICS-Abo, und genau dort will man ihn haben.
 *
 * ── Zwei Fallen der Schedule-API, die dieses Modul umgeht ───────────────────
 *
 * 1. `PUT /schedule/patterns/{id}/days` ERSETZT den ganzen Plan. Es gibt kein
 *    "eine Zeile aendern". Jedes Speichern schickt deshalb den vollstaendigen
 *    Satz - eine Zelle aendern heisst, alle anderen mitzuschicken.
 * 2. Ein Feldwert wird nur angenommen, wenn das Feld an der Schichtart auch
 *    HAENGT (`validateFieldValues()` prueft `schedule_shift_type_fields`).
 *    Ein Fach zu schreiben, ohne vorher "Fach" an die Stunde zu haengen, endet
 *    in einem 400er. `attachFieldsToPeriod()` laeuft deshalb vor jedem
 *    Schreibvorgang, nicht nur einmal beim Einrichten.
 */

import { api } from '/api.js';
import { t, getLocale } from '/i18n.js';
import { esc } from '/utils/html.js';
import { todayKey } from '/utils/date.js';
import { emptyStateHTML } from '/utils/empty-state.js';
import { openModal, closeModal } from '/components/modal.js';
import { isNavModuleReadOnly } from '/permissions.js';
import {
  renderPageHeader,
  renderPageTitle,
  renderPageBody,
  renderPageActions,
} from '/utils/page-layout.js';
import {
  FIELD_NAMES,
  SETTINGS_KEY,
  fetchCustomFields,
  fetchEntries,
  fetchHouseholdMembers,
  fetchPatternDays,
  fetchPatterns,
  fetchShiftTypes,
  fetchWeekStart,
  lessonsByDate,
  normalizeName,
  pickPattern,
  pickPupil,
  planName,
  readSettings,
  resolveFieldIds,
} from './data.js';
import {
  addDays,
  buildWeekGrid,
  formatTimeRange,
  lessonFromPatternDay,
  minutesOfTime,
  nextDateWithLessons,
  normalizeColor,
  readableTextOn,
  spreadSubjectColor,
  subjectColor,
  subjectColors,
  subjectsInPlan,
  weekDateKeys,
} from './timetable.js';

/** Wie weit voraus "Morgen" nach dem naechsten Schultag sucht, wenn morgen frei ist. */
const LOOKAHEAD_DAYS = 21;

/**
 * Die Uhrzeiten, die beim Einrichten vorgeschlagen werden.
 *
 * Vorgabe, keine Behauptung - dieselbe Haltung wie bei den Schicht-Presets im
 * Dienstplan. Eine Schule mit 45-Minuten-Raster uebernimmt sie, eine mit
 * 60-Minuten-Raster aendert die Zeiten einmal in den Schichtarten, und der Plan
 * folgt, weil die Zeit an der Stunde haengt und nicht am Fach.
 */
const DEFAULT_PERIODS = Object.freeze([
  { name: '1. Stunde', start: '08:00', end: '08:45', color: '#0369A1' },
  { name: '2. Stunde', start: '08:50', end: '09:35', color: '#0D9488' },
  { name: '3. Stunde', start: '09:50', end: '10:35', color: '#B45309' },
  { name: '4. Stunde', start: '10:40', end: '11:25', color: '#BE185D' },
  { name: '5. Stunde', start: '11:40', end: '12:25', color: '#7C3AED' },
  { name: '6. Stunde', start: '12:30', end: '13:15', color: '#15803D' },
]);

/**
 * Die drei Felder heissen "Fach", "Raum" und "Lehrer" und stehen in `data.js` -
 * dieselbe Liste, aus der die Kachel liest. Eine zweite Kopie hier waere die
 * Stelle, an der ein umbenanntes Feld die Seite weiterlaufen und die Kachel
 * still leer zeigen liesse.
 */

const state = {
  container: null,
  signal: null,
  loading: true,
  error: '',
  busy: false,
  notice: '',
  view: 'tomorrow',
  members: [],
  pupilId: null,
  patterns: [],
  pattern: null,
  patternDays: [],
  shiftTypes: [],
  customFields: [],
  fieldIds: {},
  entries: [],
  weekStart: 1,
  weekOffset: 0,
  settings: null,
  me: null,
};

/* ── Einstellungen ────────────────────────────────────────────────────────── */

function loadSettings() {
  // Gelesen wird ueber `data.js#readSettings()` - die Kachel liest dieselbe
  // Wahl, und zwei Leser mit zwei Auffassungen vom Schluessel sind genau die
  // Dublette, die dieses Modul vermeidet. Hier kommt nur dazu, was allein die
  // Seite angeht: welche Ansicht zuletzt offen war.
  const shared = readSettings();
  let view = 'tomorrow';
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (raw?.view === 'week' || raw?.view === 'edit') view = raw.view;
  } catch {
    // Ein unlesbarer Stand ist kein Fehler, sondern eine fehlende Vorliebe.
  }
  return { pupilId: shared.pupilId, patternId: shared.patternId, view };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      pupilId: state.pupilId,
      patternId: state.pattern?.id ?? null,
      view: state.view,
    }));
  } catch {
    // Ein voller oder gesperrter Speicher darf die Seite nicht anhalten: die
    // Auswahl gilt dann fuer diese Sitzung, und mehr war ohnehin nie versprochen.
  }
}

/* ── Lesen ────────────────────────────────────────────────────────────────── */

async function fetchAll() {
  const [shiftTypes, customFields, members, weekStart] = await Promise.all([
    fetchShiftTypes(),
    fetchCustomFields(),
    fetchHouseholdMembers(),
    fetchWeekStart(),
  ]);
  state.shiftTypes = shiftTypes;
  state.customFields = customFields;
  state.members = members;
  state.weekStart = weekStart;

  state.fieldIds = resolveFieldIds(state.customFields);
  resolvePupil();
  await loadPattern();
}

/** Wer ist der Mensch, dessen Plan gezeigt wird? */
function resolvePupil() {
  // Die Regel steht in `data.js` und nicht hier: die Kachel hat keinen
  // Personenwaehler und muss dieselbe Person treffen wie diese Seite.
  state.pupilId = pickPupil(state.members, { storedId: state.settings.pupilId });
}

function currentMember() {
  return state.members.find((member) => Number(member.id) === Number(state.pupilId)) ?? null;
}

function memberName() {
  const member = currentMember();
  return member?.display_name || member?.username || '';
}

/** Der Name des Musters, das dieses Modul fuer die gewaehlte Person anlegt. */
function expectedPlanName() {
  return planName(currentMember());
}

/**
 * Das Muster dieser Person suchen.
 *
 * Zuerst ueber die gespeicherte Id, dann ueber den Namen `Stundenplan <Name>`.
 * Der zweite Weg ist der wichtige: er traegt die Einrichtung auf ein zweites
 * Geraet, ohne dass dort jemand etwas einstellen muss.
 */
async function loadPattern() {
  state.pattern = null;
  state.patternDays = [];
  state.patterns = [];
  if (state.pupilId == null) return;

  state.patterns = await fetchPatterns(state.pupilId);
  state.pattern = pickPattern(state.patterns, {
    storedId: state.settings.patternId,
    expectedName: expectedPlanName(),
  });
  if (!state.pattern) return;
  state.patternDays = await fetchPatternDays(state.pattern.id);
}

/**
 * Die Stunden eines Zeitraums holen.
 *
 * Welche Quelle das ist und warum, steht in `data.js` - hier bleibt nur, wer
 * fragt und was danach im Zustand steht.
 */
async function loadEntries(from, to) {
  state.entries = await fetchEntries({ userId: state.pupilId, from, to });
}

/**
 * Die Stunden des geladenen Zeitraums, nach Datum - die Uebersetzung steht in
 * `data.js`.
 *
 * Die Farbkarte kommt aus dem Muster UND den Eintraegen, nicht aus dem
 * Zeitraum, den diese Ansicht zeigt: eine Farbe gilt fuer das Fach, und ob die
 * Zeile, an der sie steht, gerade auf dem Bildschirm ist, darf nicht
 * entscheiden, ob sie gefunden wird. Das Muster kennt alle sieben Tage - die
 * Wochenansicht kennt eine Woche.
 */
function lessonsOfPeriod(dateKeys) {
  return lessonsByDate(state.entries, dateKeys, state.fieldIds, subjectPalette());
}

/** Die gewaehlten Farben aller bekannten Zeilen - siehe `subjectColors()`. */
function subjectPalette() {
  return subjectColors([...state.patternDays, ...state.entries], {
    subjectFieldId: state.fieldIds.subject,
    colorFieldId: state.fieldIds.color,
  });
}

/* ── Schreiben ────────────────────────────────────────────────────────────── */

function canWrite() {
  // Dieselbe Abfrage wie die Dienstplan-Seite selbst: 'schedule' ist eine
  // Navigations-Id, kein Rechte-Schluessel - der Umweg ueber navPermissionKey()
  // liegt in isNavModuleReadOnly().
  return !isNavModuleReadOnly('schedule');
}

/**
 * Wem gehoert diese Stunde - und darf ich deshalb ihre Zeiten aendern?
 *
 * Der Server entscheidet das in `ownTypeOrAdmin()` (server/routes/schedule.js:77):
 * ein Admin darf jede Schichtart, alle anderen nur ihre eigene. Hier steht
 * dieselbe Regel, damit der Knopf gar nicht erst erscheint, wo der Server mit
 * 403 antwortet - und damit niemand auf einen Knopf tippt, der nur eine
 * Fehlermeldung oeffnet.
 *
 * Der 403 bleibt trotzdem behandelt (`saveTimes`): dieselbe Regel steht auf
 * zwei Seiten geschrieben, und wenn sie auseinanderlaeuft, gewinnt die des
 * Servers. Ein Typ ohne Ersteller (`created_by == null`) liegt bei den Admins -
 * ebenfalls wie dort.
 */
function canEditPeriodTimes(period) {
  if (!canWrite()) return false;
  if (state.me?.role === 'admin') return true;
  return period?.created_by != null && Number(period.created_by) === Number(state.me?.id);
}

/** `HH:MM`, dieselbe Grammatik wie der Server (`time()` in server/middleware/validate.js). */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Die Zeiten einer Stunde bearbeiten.
 *
 * Diese eine Stelle schreibt das Modul in eine Zeile des Schichtplans statt in
 * eine Plan-Zelle - die Stunde SELBST ist die Zeile. Deshalb haengt an ihr
 * dieselbe Frage wie an einer Schichtart-Karte, und deshalb geht genau ein
 * Wertpaar hinaus: `PUT /schedule/shift-types/:id` liest jedes fehlende Feld
 * als "nicht anfassen" (server/routes/schedule.js:319-322), also koennen Name,
 * Kurzzeichen, Farbe und Symbol hier gar nicht ueberschrieben werden.
 */
function openTimesEditor(periodId) {
  const period = state.shiftTypes.find((type) => Number(type.id) === Number(periodId));
  if (!period) return;

  const picker = (name, labelKey, value) => `
      <label class="school-form__field">
        <span>${esc(t(labelKey))}</span>
        <yuvomi-datepicker name="${name}" type="time" label="${esc(t(labelKey))}" value="${esc(value ?? '')}"></yuvomi-datepicker>
      </label>`;

  openModal({
    title: period.name,
    size: 'sm',
    content: `<form id="school-times-form" class="form-stack school-form">
      ${picker('start_time', 'extensions.school-planner.times.start', period.start_time)}
      ${picker('end_time', 'extensions.school-planner.times.end', period.end_time)}
      <p class="school-hint">${esc(t('extensions.school-planner.times.hint'))}</p>
      <div class="modal-actions">
        <button type="submit" class="btn btn--primary">${esc(t('common.save'))}</button>
      </div>
    </form>`,
    onSave: (modal) => {
      const form = modal.querySelector('#school-times-form');
      if (!form) return;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveTimes(form, period);
      });
    },
  });
}

/**
 * Die Zeiten schreiben.
 *
 * Beide Zeiten sind hier Pflicht, anders als beim Server: der liest eine
 * FEHLENDE Zeit als "nicht anfassen", eine LEERE aber als `{value: null}` -
 * eine geraeumte Zeit macht die Stunde damit zur ganztags-Zeit und wirft sie
 * aus dem Plan (`periodTypes()` filtert ohne Uhrzeit). Ein Feld, das sich
 * leeren laesst, verspricht hier also etwas, das es nicht gibt.
 */
async function saveTimes(form, period) {
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  const start = String(values.start_time ?? '').trim();
  const end = String(values.end_time ?? '').trim();

  if (!start || !end) {
    window.yuvomi?.showToast(t('extensions.school-planner.times.required'), 'danger');
    return;
  }
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
    window.yuvomi?.showToast(t('extensions.school-planner.times.invalid'), 'danger');
    return;
  }
  // Ende vor Beginn liest der Kern als "ueber Mitternacht" und haengt ein "+1"
  // an die Anzeige. Im Schichtplan ist das richtig, im Stundenplan immer ein
  // Vertipper. Ein Vergleich als Zeichenkette genuegt: HH:MM ist nullgefuellt.
  if (end <= start) {
    window.yuvomi?.showToast(t('extensions.school-planner.times.order'), 'danger');
    return;
  }

  if (button) button.disabled = true;
  try {
    await api.put(`/schedule/shift-types/${encodeURIComponent(period.id)}`, { start_time: start, end_time: end });
    // `{ force: true }`, weil das Schreiben schon durch ist: der Dirty-Waechter
    // vergleicht das Formular mit dem Stand beim Oeffnen, und ein Formular ist
    // genau dann abweichend, wenn jemand etwas geaendert hat - also immer, wenn
    // hier jemand speichert. Ohne `force` kaeme die Rueckfrage "Aenderungen
    // verwerfen?" NACH dem erfolgreichen Speichern und wuerfe Eingaben weg, die
    // laengst in der Datenbank stehen. Im `catch` bleibt der Dialog offen und
    // der Waechter scharf - dort waeren die Eingaben wirklich verloren.
    await closeModal({ force: true });
    await reload();
    if (!state.signal?.aborted) {
      state.notice = '';
      renderShell();
      window.yuvomi?.showToast(t('extensions.school-planner.times.saved'), 'success');
    }
  } catch (error) {
    if (button) button.disabled = false;
    window.yuvomi?.showToast(error?.message || String(error), 'danger');
  }
}

/**
 * Alle Zyklustage speichern.
 *
 * Immer der vollstaendige Satz - siehe die Falle im Kopfkommentar. `days` sind
 * rohe Plan-Zeilen in der Form der API (`position`, `shift_type_id`,
 * `field_values`).
 */
async function saveDays(days) {
  if (!state.pattern) throw new Error(t('extensions.school-planner.error.noPlan'));
  await api.put(`/schedule/patterns/${encodeURIComponent(state.pattern.id)}/days`, {
    days: days.map((row) => ({
      position: row.position,
      shift_type_id: row.shift_type_id,
      field_values: row.field_values ?? {},
    })),
  });
  const fresh = await api.get(`/schedule/patterns/${encodeURIComponent(state.pattern.id)}/days`);
  state.patternDays = fresh.data ?? [];
}

/** Die Plan-Zeilen als schlichte Objekte - die Form, die `saveDays()` erwartet. */
function plainDays() {
  return state.patternDays.map((row) => ({
    position: Number(row.position),
    shift_type_id: row.shift_type_id == null ? null : Number(row.shift_type_id),
    field_values: row.field_values ?? {},
  }));
}

/* ── Einrichten ───────────────────────────────────────────────────────────── */

/**
 * Fehlende Felder anlegen. Vorhandene werden ueber den Namen wiedergefunden -
 * ein Haushalt, der "Fach" schon benutzt, bekommt kein zweites.
 */
async function ensureFields() {
  for (const [role, names] of Object.entries(FIELD_NAMES)) {
    if (state.fieldIds[role] != null) continue;
    const existing = state.customFields.find((field) => names.some((name) => normalizeName(field.name) === normalizeName(name)));
    if (existing) { state.fieldIds = { ...state.fieldIds, [role]: existing.id }; continue; }
    const response = await api.post('/schedule/custom-fields', { name: names[0] });
    const created = response.data ?? response;
    state.customFields = [...state.customFields, created];
    state.fieldIds = { ...state.fieldIds, [role]: created.id };
  }
  // Am Ende noch einmal ueber die Namen aufloesen, statt den Zwischenstand
  // weiterzutragen: so gilt auch nach dem Anlegen genau die Regel aus
  // `data.js` (Name schlaegt Id) und nicht die Reihenfolge der Schleife.
  state.fieldIds = resolveFieldIds(state.customFields);
  return state.fieldIds;
}

/**
 * Die Stundenarten anlegen bzw. wiederfinden.
 *
 * Wiedererkannt wird ueber Kurzzeichen (`P1`, `P2`, ...) und ueber den Namen
 * (`1. Stunde`) - so uebernimmt das Modul die Stunden, die der Dienstplan mit
 * seiner Schul-Vorlage schon angelegt hat, statt daneben ein zweites Raster
 * aufzubauen. Nur was fehlt, wird ergaenzt.
 */
async function ensurePeriods() {
  const byShortCode = new Map(state.shiftTypes.map((type) => [normalizeName(type.short_code), type]));
  const byName = new Map(state.shiftTypes.map((type) => [normalizeName(type.name), type]));
  const periods = [];

  for (const [index, preset] of DEFAULT_PERIODS.entries()) {
    const shortCode = `P${index + 1}`;
    const found = byShortCode.get(normalizeName(shortCode)) ?? byName.get(normalizeName(preset.name));
    if (found) { periods.push(found); continue; }
    const response = await api.post('/schedule/shift-types', {
      name: preset.name,
      short_code: shortCode,
      start_time: preset.start,
      end_time: preset.end,
      color: preset.color,
      icon: 'book-open',
    });
    const created = response.data ?? response;
    periods.push(created);
    state.shiftTypes = [...state.shiftTypes, created];
  }
  return periods;
}

/**
 * Rollen, deren Wert NICHT in die Kalender-Overlay-Zeile gehoert.
 *
 * Die Farbe ist ein Wert wie "Fach" auch, aber keine Angabe FUER den Termin:
 * "#7C3AED" in der Kalenderzeile oder in einem ICS-Eintrag waere eine Zeichen-
 * kette ohne Bedeutung fuer jeden, der den Termin liest. `show_in_overlay` ist
 * genau der Schalter, den beide Stellen lesen (`public/pages/schedule.js:1311`
 * fuer die Uebersichtszeile, `server/services/schedule-ics.js:46` fuer den
 * Feed), also wird er fuer diese eine Rolle ausgeschaltet.
 *
 * Alles andere an der Farbe ist damit entschieden: der Kalender, der ICS-Feed
 * und das Dashboard zeigen sie nicht. Sichtbar bleibt sie nur dort, wo der
 * Schichtplan JEDES Feld einer Schichtart zeigt - in seinen Tageszeilen und im
 * Detailblatt eines Eintrags. Das ist der Preis, den die README nennt.
 */
const HIDDEN_FROM_OVERLAY = new Set(['color']);

/**
 * Die Felder an eine Stunde haengen.
 *
 * `PUT /shift-types/{id}/fields` ERSETZT die Zuordnung, es ergaenzt sie nicht -
 * also wird der vorhandene Satz mitgeschickt. `show_in_overlay` kommt aus der
 * API als echter Boolean zurueck; ein `!== 0`-Vergleich wuerde `false` als
 * "nicht 0" lesen und die Einstellung des Haushalts still auf `true` drehen.
 *
 * Eine Rolle aus `HIDDEN_FROM_OVERLAY` wird auch dann korrigiert, wenn sie schon
 * haengt: angeheftet wird im Schichtplan mit "im Kalender zeigen" als Vorgabe,
 * und ein Feld, das dort jemand nachtraegt, soll die Farbe nicht in jeden
 * Termin schreiben. Ohne diese Pruefung waere die Regel nur eine Absicht.
 */
async function attachFieldsToPeriod(period, fieldIds) {
  const wanted = Object.entries(fieldIds).filter(([, id]) => id != null);
  if (!wanted.length) return;
  const existing = period.fields ?? [];
  const roleOf = (id) => wanted.find(([, wantedId]) => Number(wantedId) === Number(id))?.[0] ?? null;
  const overlayFor = (id, current) => {
    const role = roleOf(id);
    return role && HIDDEN_FROM_OVERLAY.has(role) ? false : Boolean(current);
  };

  const kept = existing.map((field, index) => ({
    custom_field_id: field.id,
    position: Number.isInteger(field.position) ? field.position : index,
    show_in_overlay: overlayFor(field.id, field.show_in_overlay),
  }));
  const missing = wanted
    .filter(([, id]) => !existing.some((field) => Number(field.id) === Number(id)))
    .map(([, id], index) => ({
      custom_field_id: id,
      position: existing.length + index,
      show_in_overlay: overlayFor(id, true),
    }));
  const corrected = kept.some((row, index) => row.show_in_overlay !== Boolean(existing[index].show_in_overlay));
  if (!missing.length && !corrected) return;

  await api.put(`/schedule/shift-types/${encodeURIComponent(period.id)}/fields`, { fields: [...kept, ...missing] });
}

/**
 * Dieselbe Zuordnung fuer alle Stunden - beim Einrichten.
 *
 * Tolerant je Stunde: eine Stunde, die jemand anderes angelegt hat, laesst sich
 * ohne Adminrecht nicht aendern (403). Das darf das Einrichten nicht abbrechen;
 * die betroffenen Stunden werden gemeldet, und der Editor holt es spaeter
 * einzeln nach.
 */
async function attachFieldsToPeriods(periods, fieldIds) {
  const failed = [];
  for (const period of periods) {
    try {
      await attachFieldsToPeriod(period, fieldIds);
    } catch {
      failed.push(period.name || String(period.id));
    }
  }
  const fresh = await api.get('/schedule/shift-types');
  state.shiftTypes = fresh.data ?? state.shiftTypes;
  return failed;
}

/** Der Montag der Woche, in der `dateKey` liegt. */
function mondayOf(dateKey) {
  return weekDateKeys(dateKey, 1)[0];
}

/** Das 7-Tage-Muster anlegen, falls es noch keines gibt. */
async function ensurePattern() {
  if (state.pattern) return state.pattern;
  if (state.pupilId == null) throw new Error(t('extensions.school-planner.error.noPupil'));
  const response = await api.post('/schedule/patterns', {
    user_id: state.pupilId,
    name: expectedPlanName(),
    // Der Anker muss ein Montag sein: der Plan rechnet die Woche als 7er-Zyklus
    // ab diesem Tag, und ein Anker mitten in der Woche verschiebt jede Spalte.
    anchor_date: mondayOf(todayKey()),
    cycle_length: 7,
    is_active: true,
  });
  state.pattern = response.data ?? response;
  state.patternDays = [];
  saveSettings();
  return state.pattern;
}

async function runSetup() {
  if (!canWrite()) return;
  state.busy = true;
  state.error = '';
  state.notice = '';
  renderShell();
  try {
    const fieldIds = await ensureFields();
    const periods = await ensurePeriods();
    const failed = await attachFieldsToPeriods(periods, fieldIds);
    await ensurePattern();
    await reload();
    state.view = 'edit';
    saveSettings();
    if (failed.length) {
      state.notice = t('extensions.school-planner.setup.partial', { periods: failed.join(', ') });
    }
  } catch (error) {
    state.error = error?.message || String(error);
  } finally {
    state.busy = false;
    if (!state.signal?.aborted) renderShell();
  }
}

/**
 * Nachladen.
 *
 * Das Fenster reicht von gestern bis drei Wochen nach der angezeigten Woche:
 * "Morgen" braucht einen Tag, das Raster sieben, und die Suche nach dem
 * naechsten Schultag soll nicht bei jedem Blaettern neu laden.
 */
async function reload() {
  await fetchAll();
  const today = todayKey();
  const keys = weekDateKeys(addDays(today, state.weekOffset * 7), state.weekStart);
  const from = keys[0] < addDays(today, -1) ? keys[0] : addDays(today, -1);
  const to = addDays(keys[6] > today ? keys[6] : today, LOOKAHEAD_DAYS);
  await loadEntries(from, to);
}

/* ── Anzeige ──────────────────────────────────────────────────────────────── */

function locale() {
  return getLocale?.() || 'de';
}

function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  if (!year || !month || !day) return null;
  // UTC, weil ein Datums-Schluessel eine Kalenderaussage ist: eine lokale
  // Mitternacht kippt in Zeitzonen hinter UTC auf den Vortag.
  return new Date(Date.UTC(year, month - 1, day));
}

function weekdayLabel(dateKey) {
  const date = dateFromKey(dateKey);
  if (!date) return String(dateKey ?? '');
  try {
    return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(date);
  } catch {
    return String(dateKey);
  }
}

function dayLabel(dateKey) {
  const date = dateFromKey(dateKey);
  if (!date) return String(dateKey ?? '');
  try {
    return new Intl.DateTimeFormat(locale(), {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    }).format(date);
  } catch {
    return String(dateKey);
  }
}

function lessonVars(color) {
  return `--lesson-color:${esc(color)};--lesson-ink:${esc(readableTextOn(color))}`;
}

/**
 * Ein Stundenblock.
 *
 * Die Farbe kommt vom Fach, nicht von der Stunde (siehe Kopfkommentar). Die
 * Schriftfarbe entscheidet `readableTextOn()` und nicht ein fester Wert - ein
 * gelbes Fach braucht dunkle Schrift, ein blaues helle.
 */
function lessonBlock(lesson, { compact = false } = {}) {
  const time = formatTimeRange(lesson.startTime, lesson.endTime);
  const meta = [lesson.room, lesson.teacher].filter(Boolean).map(esc).join(' · ');
  return `<li class="school-lesson${compact ? ' school-lesson--compact' : ''}" style="${lessonVars(lesson.color)}">
  ${time ? `<span class="school-lesson__time">${esc(time)}</span>` : ''}
  <span class="school-lesson__body">
    <span class="school-lesson__subject">${esc(lesson.subject || lesson.periodName || '')}</span>
    ${meta ? `<span class="school-lesson__meta">${meta}</span>` : ''}
    ${lesson.note ? `<span class="school-lesson__note">${esc(lesson.note)}</span>` : ''}
  </span>
</li>`;
}

/**
 * "Morgen" - die Ansicht, fuer die es dieses Modul gibt.
 *
 * Zeigt den naechsten Tag MIT Unterricht, nicht stur morgen. Freitagabend ist
 * "morgen" Samstag, und "kein Unterricht" waere zwar richtig, aber nutzlos,
 * wenn drei Tage spaeter wieder Schule ist. Ist morgen Schule, steht morgen da;
 * sonst der naechste Schultag, mit dem Hinweis, dass morgen frei ist.
 */
function renderTomorrow() {
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const keys = [];
  for (let step = 1; step <= LOOKAHEAD_DAYS; step += 1) keys.push(addDays(today, step));
  const byDate = lessonsOfPeriod(keys);

  const hasLessons = (dateKey) => (byDate.get(dateKey) ?? []).length > 0;
  const tomorrowLessons = byDate.get(tomorrow) ?? [];
  const target = tomorrowLessons.length ? tomorrow : nextDateWithLessons(tomorrow, hasLessons, { maxDays: LOOKAHEAD_DAYS });
  const lessons = target ? (byDate.get(target) ?? []) : [];

  if (!lessons.length) {
    return `<section class="school-panel">
  ${emptyStateHTML({
    title: t('extensions.school-planner.tomorrow.none'),
    hint: t('extensions.school-planner.tomorrow.noneHint'),
    action: { label: t('extensions.school-planner.action.toEdit'), attrs: { 'data-view': 'edit' } },
  })}
</section>`;
  }

  const isTomorrow = target === tomorrow;
  return `<section class="school-panel">
  <h2 class="school-panel__title">${esc(isTomorrow ? t('extensions.school-planner.tomorrow.heading') : t('extensions.school-planner.tomorrow.nextSchoolDay'))}</h2>
  <p class="school-panel__subtitle">${esc(dayLabel(target))}</p>
  ${isTomorrow ? '' : `<p class="school-hint school-hint--notice">${esc(t('extensions.school-planner.tomorrow.freeTomorrow'))}</p>`}
  <ul class="school-day">${lessons.map((lesson) => lessonBlock(lesson)).join('')}</ul>
</section>`;
}

/**
 * Das Wochenraster.
 *
 * Zeilen sind Uhrzeiten, Spalten die sieben Tage. Gebaut aus `buildWeekGrid()`
 * und damit aus `timetable.js`: die Zeilenbildung ist die Stelle, an der ein
 * Fehler leise falsch aussieht, und sie ist die einzige, die ein Test ohne
 * Browser erreicht.
 */
function renderWeek() {
  const today = todayKey();
  const keys = weekDateKeys(addDays(today, state.weekOffset * 7), state.weekStart);
  const byDate = lessonsOfPeriod(keys);
  const grid = buildWeekGrid(byDate, keys);

  if (!grid.length) {
    return `<section class="school-panel">
  ${emptyStateHTML({
    title: t('extensions.school-planner.week.empty'),
    hint: t('extensions.school-planner.week.emptyHint'),
    action: { label: t('extensions.school-planner.action.toEdit'), attrs: { 'data-view': 'edit' } },
  })}
</section>`;
  }

  const head = keys.map((dateKey) => `<th scope="col" class="school-grid__head${dateKey === today ? ' is-today' : ''}">
      <span class="school-grid__dow">${esc(weekdayLabel(dateKey))}</span>
      <span class="school-grid__date">${esc(dateKey.slice(8, 10))}.${esc(dateKey.slice(5, 7))}.</span>
    </th>`).join('');

  const body = grid.map((row) => {
    const cells = keys.map((dateKey) => {
      const lessons = row.cells.get(dateKey) ?? [];
      if (!lessons.length) return '<td class="school-grid__cell"></td>';
      const slots = lessons.map((lesson) => `<span class="school-slot" style="${lessonVars(lesson.color)}">
          <span class="school-slot__subject">${esc(lesson.subject)}</span>
          ${lesson.room ? `<span class="school-slot__meta">${esc(lesson.room)}</span>` : ''}
        </span>`).join('');
      return `<td class="school-grid__cell">${slots}</td>`;
    }).join('');
    return `<tr>
      <th scope="row" class="school-grid__time">${esc(formatTimeRange(row.startTime, row.endTime))}</th>
      ${cells}
    </tr>`;
  }).join('');

  return `<section class="school-panel">
  <table class="school-grid">
    <caption class="school-grid__caption">${esc(t('extensions.school-planner.week.heading', { range: weekRangeLabel(keys) }))}</caption>
    <thead><tr><th scope="col" class="school-grid__corner"><span class="sr-only">${esc(t('extensions.school-planner.week.time'))}</span></th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function weekRangeLabel(keys) {
  const first = keys[0] ?? '';
  const last = keys[keys.length - 1] ?? '';
  const short = (dateKey) => `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.`;
  return `${short(first)} - ${short(last)}`;
}

/**
 * Bearbeiten: das wiederkehrende Raster, nicht der einzelne Tag.
 *
 * Eine Aenderung hier gilt fuer jede Woche. Das steht auch in der Ueberschrift,
 * weil der Unterschied zur Abweichung eines einzelnen Tages sonst nur in der
 * Datenbank existiert und nicht im Kopf der Benutzerin.
 */
function renderEdit() {
  if (!state.pattern) {
    return `<section class="school-panel">
  ${emptyStateHTML({
    title: t('extensions.school-planner.edit.noPlan'),
    hint: t('extensions.school-planner.edit.noPlanHint'),
    action: { label: t('extensions.school-planner.setup.create'), attrs: { 'data-action': 'setup' } },
  })}
</section>`;
  }

  const periods = periodTypes();
  if (!periods.length) {
    return `<section class="school-panel">
  ${emptyStateHTML({
    title: t('extensions.school-planner.edit.noPeriods'),
    hint: t('extensions.school-planner.edit.noPeriodsHint'),
  })}
</section>`;
  }

  const anchor = state.pattern.anchor_date;
  const typeById = new Map(state.shiftTypes.map((type) => [Number(type.id), type]));
  // Hier kommen die Zeilen aus dem Muster: die Farbe eines Fachs steht an einer
  // anderen Zeile als der, die gerade gezeichnet wird, und ohne den Vorrat
  // faerbte das Raster eine neu getippte Stunde mit der gerechneten.
  const palette = subjectPalette();

  const head = Array.from({ length: 7 }, (_, position) => `<th scope="col" class="school-grid__head">
      <span class="school-grid__dow">${esc(weekdayLabel(addDays(anchor, position)))}</span>
    </th>`).join('');

  const body = periods.map((period) => {
    const cells = Array.from({ length: 7 }, (_, position) => {
      const row = state.patternDays.find((candidate) => Number(candidate.position) === position
        && Number(candidate.shift_type_id) === Number(period.id));
      const lesson = row ? lessonFromPatternDay(row, typeById, state.fieldIds, palette) : null;
      const hasSubject = Boolean(lesson && lesson.subject && lesson.subject !== lesson.periodName);
      const label = hasSubject
        ? `<span class="school-slot__subject">${esc(lesson.subject)}</span>`
        : `<span class="school-slot__empty">${esc(t('extensions.school-planner.edit.emptyCell'))}</span>`;
      const meta = lesson?.room ? `<span class="school-slot__meta">${esc(lesson.room)}</span>` : '';
      const style = hasSubject
        ? ` style="${lessonVars(lesson.color)}"`
        : ' style="--lesson-color:var(--color-border);--lesson-ink:var(--color-text-secondary)"';
      return `<td class="school-grid__cell">
        <button type="button" class="school-slot school-slot--edit" data-cell="${position}:${esc(period.id)}"${style}>
          ${label}${meta}
        </button>
      </td>`;
    }).join('');
    const times = formatTimeRange(period.start_time, period.end_time);
    // Die Zeit ist der einzige Griff, den diese Ansicht in die Stunde selbst
    // hat - und nur die eigene Stunde bekommt ihn. Ohne ihn sieht die Zeile
    // aus wie die der Wochenansicht, in der es nichts zu tippen gibt.
    return `<tr>
      <th scope="row" class="school-grid__time">${canEditPeriodTimes(period)
        ? `<button type="button" class="school-times" data-times="${esc(period.id)}"
             aria-label="${esc(t('extensions.school-planner.times.edit', { period: period.name }))}">${esc(times)}</button>`
        : esc(times)}</th>
      ${cells}
    </tr>`;
  }).join('');

  return `<section class="school-panel">
  <h2 class="school-panel__title">${esc(t('extensions.school-planner.edit.heading'))}</h2>
  <p class="school-hint">${esc(t('extensions.school-planner.edit.hint'))}</p>
  <table class="school-grid school-grid--edit">
    <caption class="school-grid__caption">${esc(t('extensions.school-planner.edit.caption'))}</caption>
    <thead><tr><th scope="col" class="school-grid__corner"><span class="sr-only">${esc(t('extensions.school-planner.week.time'))}</span></th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>${renderColors()}`;
}

/** Die Schichtarten, die als Unterrichtsstunde durchgehen: mit Uhrzeit, nach Zeit sortiert. */
function periodTypes() {
  return state.shiftTypes
    .filter((type) => type.start_time && type.end_time)
    .sort((a, b) => (minutesOfTime(a.start_time) ?? 0) - (minutesOfTime(b.start_time) ?? 0));
}

/* ── Zelle bearbeiten ─────────────────────────────────────────────────────── */

/**
 * Den Editor fuer eine Zelle oeffnen.
 *
 * `openModal`s `onSave` ist ein MOUNT-Haken, kein Speicher-Handler: er laeuft
 * einmal beim Oeffnen und verdrahtet dort das Formular. Der Speichervorgang
 * haengt am `submit` des Formulars, das im `content` steht.
 */
function openCellEditor(cellKey) {
  const [positionRaw, periodIdRaw] = String(cellKey).split(':');
  const position = Number(positionRaw);
  const periodId = Number(periodIdRaw);
  const period = state.shiftTypes.find((type) => Number(type.id) === periodId);
  if (!period || !state.pattern) return;

  const row = state.patternDays.find((candidate) => Number(candidate.position) === position
    && Number(candidate.shift_type_id) === periodId);
  const current = row ? lessonFromPatternDay(row, new Map([[periodId, period]]), state.fieldIds) : null;
  const hadSubject = Boolean(current && current.subject && current.subject !== current.periodName);

  const field = (role, labelKey, value, placeholder = '') => (state.fieldIds[role] == null ? '' : `
      <label class="school-form__field">
        <span>${esc(t(labelKey))}</span>
        <input type="text" name="${role}" maxlength="120" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>
      </label>`);

  openModal({
    title: `${period.name} · ${weekdayLabel(addDays(state.pattern.anchor_date, position))}`,
    size: 'sm',
    content: `<form id="school-cell-form" class="form-stack school-form">
      ${field('subject', 'extensions.school-planner.field.subject', hadSubject ? current.subject : '', t('extensions.school-planner.field.subjectPlaceholder'))}
      ${field('room', 'extensions.school-planner.field.room', current?.room ?? '')}
      ${field('teacher', 'extensions.school-planner.field.teacher', current?.teacher ?? '')}
      <p class="school-hint">${esc(t('extensions.school-planner.edit.cellHint'))}</p>
      <div class="modal-actions">
        ${row ? `<button type="button" class="btn btn--danger-outline" data-action="clear">${esc(t('extensions.school-planner.edit.clear'))}</button>` : ''}
        <button type="submit" class="btn btn--primary">${esc(t('common.save'))}</button>
      </div>
    </form>`,
    onSave: (modal) => {
      const form = modal.querySelector('#school-cell-form');
      if (!form) return;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void writeCell(form, position, periodId, period);
      });
      form.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
        void writeCell(form, position, periodId, period, { clear: true });
      });
    },
  });
}

/**
 * Eine Zelle schreiben.
 *
 * Erst die Felder an der Stunde sicherstellen, dann den vollstaendigen Satz
 * schicken: ohne die Zuordnung weist der Server jeden Feldwert ab, und ohne den
 * vollstaendigen Satz loescht das Speichern alle anderen Zellen.
 */
async function writeCell(form, position, periodId, period, { clear = false } = {}) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await attachFieldsToPeriod(period, state.fieldIds);

    const read = (name) => String(form.querySelector(`[name="${name}"]`)?.value ?? '').trim();
    const values = {};
    if (!clear && state.fieldIds.subject != null && read('subject')) values[state.fieldIds.subject] = read('subject');
    if (!clear && state.fieldIds.room != null && read('room')) values[state.fieldIds.room] = read('room');
    if (!clear && state.fieldIds.teacher != null && read('teacher')) values[state.fieldIds.teacher] = read('teacher');

    // Die Farbe des Fachs zieht mit. Sie liegt an der Zeile, gemeint ist aber
    // das Fach: ohne diese Zeilen haette eine neu getippte Stunde desselben
    // Fachs keine eigene Farbe mehr - und weil das Lesen die Zeile zuerst
    // fragt, saehe sie anders aus als ihre Geschwister. Zugleich ist das der
    // Weg, auf dem eine vorhandene Farbe das Umschreiben der Zelle ueberlebt:
    // die Zeile wird ersetzt, nicht ergaenzt.
    // Nur eine vorhandene zieht mit: hier wird keine Farbe erfunden.
    const shared = subjectPalette().get(normalizeName(read('subject')));
    if (!clear && shared && state.fieldIds.color != null) values[state.fieldIds.color] = shared;

    const kept = plainDays().filter((day) => !(day.position === position && day.shift_type_id === periodId));
    // Kein Fach, kein Raum, kein Lehrer heisst: die Stunde faellt aus. Die Zeile
    // wird dann nicht geschrieben - eine leere Zelle ist die Abwesenheit einer
    // Zeile, nicht eine Zeile mit leerem Wert.
    if (Object.keys(values).length) {
      kept.push({ position, shift_type_id: periodId, field_values: values });
    }

    await saveDays(kept);
    // Wie in `saveTimes()`: das Schreiben ist durch, die Rueckfrage des
    // Dirty-Waechters waere hier eine Frage nach Eingaben, die schon gespeichert
    // sind. Der `catch` unten laesst den Dialog dagegen offen.
    await closeModal({ force: true });
    await reload();
    if (!state.signal?.aborted) {
      state.notice = '';
      renderShell();
      window.yuvomi?.showToast(t('extensions.school-planner.saved'), 'success');
    }
  } catch (error) {
    if (button) button.disabled = false;
    window.yuvomi?.showToast(error?.message || String(error), 'danger');
  }
}

/* ── Farben ───────────────────────────────────────────────────────────────── */

/**
 * Das Farben-Panel: eine Farbe je Fach.
 *
 * Es haengt an "Bearbeiten", weil eine Farbe zu waehlen ein Einrichten ist und
 * kein Nachschlagen - und weil die Wochenansicht die Wirkung zeigt, aber keinen
 * Griff dafuer hat.
 *
 * Zugeklappt, mit der Zahl im Titel: die Liste kann bei einem vollen Plan lang
 * werden und steht unter einem Raster, das man liest.
 *
 * Ein Farbfeld je Fach und nicht je Zelle, obwohl der Wert an der Zelle liegt:
 * gemeint ist immer das Fach. Eine Farbe je Zelle waere ein Regler, der beim
 * naechsten Tippen wieder auf die gerechnete zurueckfaellt.
 */
function renderColors() {
  const subjects = subjectsInPlan(state.patternDays, {
    subjectFieldId: state.fieldIds.subject,
    colorFieldId: state.fieldIds.color,
  });
  if (!subjects.length) return '';
  const writable = canWrite();

  const rows = subjects.map(({ subject, color }) => {
    const current = color || subjectColor(subject);
    // Das native Farbfeld ist der Regler, den der Schichtplan fuer dieselbe
    // Angabe benutzt (`input.form-input--color`, public/pages/schedule.js:851).
    // Es liefert immer `#rrggbb` - ein Wert, den `normalizeColor()` unveraendert
    // durchlaesst.
    const control = writable
      ? `<input type="color" class="input form-input--color school-color__input"
           data-subject-color="${esc(subject)}" value="${esc(current)}"
           aria-label="${esc(t('extensions.school-planner.colors.choose', { subject }))}">`
      : `<span class="school-color__chip" style="${lessonVars(current)}" aria-hidden="true"></span>`;
    return `<li class="school-color">${control}<span class="school-color__name">${esc(subject)}</span></li>`;
  }).join('');

  // Solange es das Farbfeld nicht gibt, sagt das Panel es vorher: die Farbe
  // anzunehmen legt es an (`saveSubjectColor()`), und ein Feld, das im
  // Schichtplan auftaucht, ohne dass jemand es bestellt hat, will erklaert sein.
  const newField = state.fieldIds.color == null
    ? `<p class="school-hint">${esc(t('extensions.school-planner.colors.newField'))}</p>`
    : '';

  return `<details class="school-panel school-colors" id="school-colors">
  <summary class="school-colors__summary">${esc(t('extensions.school-planner.colors.heading', { count: subjects.length }))}</summary>
  <p class="school-hint">${esc(t('extensions.school-planner.colors.hint'))}</p>
  ${newField}
  <ul class="school-colors__list">${rows}</ul>
</details>`;
}

/**
 * Das Panel nach dem Neuzeichnen wieder aufklappen.
 *
 * `renderShell()` ersetzt die Knoten, also ist ein aufgeklapptes `<details>`
 * danach zu - und wer gerade eine Farbe gewaehlt hat, sieht seinen Regler sonst
 * bei jedem Griff zuklappen.
 */
function keepColorsOpen() {
  const panel = state.container?.querySelector('#school-colors');
  if (panel) panel.open = true;
}

/**
 * Eine Fachfarbe schreiben.
 *
 * Der erste Schritt ist der, den man vergisst: das Farbfeld muss es geben und an
 * jeder betroffenen Stunde haengen. `validateFieldValues` weist JEDEN Feldwert
 * ab, dessen Feld nicht an der Schichtart haengt - und zwar den ganzen Satz, es
 * prueft Zeile fuer Zeile und bricht bei der ersten ab
 * (`server/routes/schedule.js:189`). Fehlschlaege je Stunde werden geschluckt,
 * wie in `attachFieldsToPeriods()`: eine fremde Stunde ohne Adminrecht laesst
 * sich nicht aendern, und das darf die eigenen nicht mitreissen.
 *
 * `ensureFields()` steht deshalb hier und nicht mehr nur in der Einrichtung: die
 * Farbe kam nachtraeglich dazu (1.1.0), und wer davor eingerichtet hat, hat kein
 * Feld `Farbe` - `needsSetup()` schickt ihn aber nicht mehr durch die
 * Einrichtung, weil Muster und Felder ja da sind. Ohne diese Zeile lief die
 * Auswahl in ein stilles `return`: nichts geschrieben, nichts gesagt, und der
 * Regler stand beim naechsten Zeichnen wieder auf der gerechneten Farbe. Genau
 * das liest sich als "die Farbe wird nicht gespeichert". Anlegen darf jedes
 * Haushaltsmitglied (`server/routes/schedule.js:247`), und wenn nichts fehlt,
 * kostet der Aufruf keinen einzigen Request.
 *
 * `''` heisst "wieder automatisch": der Server ueberspringt leere Werte
 * (`fieldValue()` liefert dafuer `null`, server/routes/schedule.js:157), die
 * Zeile verliert ihren Farbwert, und die Ansicht faellt auf die aus dem Namen
 * gerechnete Farbe zurueck. Ein "Zuruecksetzen" braucht deshalb keinen eigenen
 * Knopf - es ist das Feld auf die gerechnete Farbe zu stellen.
 */
async function saveSubjectColor(subject, rawColor) {
  await ensureFields();
  const colorFieldId = state.fieldIds.color;
  const subjectFieldId = state.fieldIds.subject;
  // Nach `ensureFields()` heisst das: anlegen ging nicht (der Aufruf wirft dann)
  // oder der Haushalt hat ein Feld, das die Namensaufloesung nicht sieht. Kein
  // stiller Ausstieg mehr - der Aufrufer meldet den Fehler.
  if (colorFieldId == null || subjectFieldId == null) {
    throw new Error('Ohne die Felder Fach und Farbe laesst sich keine Farbe speichern.');
  }
  const color = normalizeColor(rawColor);
  const wanted = normalizeName(subject);

  const typeById = new Map(state.shiftTypes.map((type) => [Number(type.id), type]));
  const affected = new Set(plainDays()
    .filter((row) => normalizeName(row.field_values?.[subjectFieldId]) === wanted)
    .map((row) => Number(row.shift_type_id)));
  for (const id of affected) {
    const period = typeById.get(id);
    if (!period) continue;
    try {
      await attachFieldsToPeriod(period, state.fieldIds);
    } catch {
      // Siehe oben: das Anheften an einer fremden Stunde darf die eigenen nicht
      // verhindern. Scheitert es an ALLEN, meldet es der Schreibvorgang.
    }
  }

  const rows = spreadSubjectColor(plainDays(), { subjectFieldId, colorFieldId, subject, color });
  await saveDays(rows);
  await reload();
  if (state.signal?.aborted) return;
  state.notice = '';
  renderShell();
  keepColorsOpen();
}

/* ── Seite ────────────────────────────────────────────────────────────────── */

function tabs() {
  const options = [
    ['tomorrow', t('extensions.school-planner.tab.tomorrow')],
    ['week', t('extensions.school-planner.tab.week')],
    ['edit', t('extensions.school-planner.tab.edit')],
  ];
  return `<div class="school-tabs" role="tablist">
    ${options.map(([key, label]) => `<button type="button" role="tab" class="school-tab${state.view === key ? ' is-active' : ''}" data-view="${key}" aria-selected="${state.view === key}">${esc(label)}</button>`).join('')}
  </div>`;
}

function headerActions() {
  const picker = state.members.length > 1
    ? `<label class="school-picker">
        <span class="sr-only">${esc(t('extensions.school-planner.pupil.label'))}</span>
        <select data-action="pupil">
          ${state.members.map((member) => `<option value="${esc(member.id)}"${Number(member.id) === Number(state.pupilId) ? ' selected' : ''}>${esc(member.display_name || member.username || '')}</option>`).join('')}
        </select>
      </label>`
    : '';

  const weekNav = state.view === 'week'
    ? `<button type="button" class="btn btn--secondary btn--icon" data-action="week-prev" aria-label="${esc(t('extensions.school-planner.action.prevWeek'))}"><i data-lucide="chevron-left" aria-hidden="true"></i></button>
      <button type="button" class="btn btn--secondary btn--icon" data-action="week-next" aria-label="${esc(t('extensions.school-planner.action.nextWeek'))}"><i data-lucide="chevron-right" aria-hidden="true"></i></button>
      ${state.weekOffset !== 0 ? `<button type="button" class="btn btn--secondary" data-action="week-today">${esc(t('extensions.school-planner.action.thisWeek'))}</button>` : ''}`
    : '';

  const setup = state.pattern
    ? `<button type="button" class="btn btn--secondary btn--icon" data-action="setup" title="${esc(t('extensions.school-planner.setup.rerun'))}" aria-label="${esc(t('extensions.school-planner.setup.rerun'))}"><i data-lucide="wand-sparkles" aria-hidden="true"></i></button>`
    : '';

  return renderPageActions(`
    ${picker}
    ${weekNav}
    ${setup}
    <button type="button" class="btn btn--secondary btn--icon" data-action="reload" aria-label="${esc(t('extensions.school-planner.action.reload'))}"><i data-lucide="refresh-cw" aria-hidden="true"></i></button>`);
}

function renderShell() {
  const container = state.container;
  if (!container) return;
  container.replaceChildren();

  const who = memberName();
  const title = who ? `${t('extensions.school-planner.title')} · ${who}` : t('extensions.school-planner.title');
  // `full` traegt keine Messbreite: eine Leiste mit `narrow` wuerde hier nichts
  // auf das Mass setzen (PAGE-016), also laeuft sie ueber die volle Breite.
  const header = renderPageHeader({
    narrow: false,
    title: renderPageTitle(esc(title)),
    actions: state.loading || state.error ? '' : headerActions(),
  });

  if (state.loading) {
    container.insertAdjacentHTML('beforeend', header + renderPageBody({
      content: `<section class="school-panel"><p class="school-hint">${esc(t('extensions.school-planner.loading'))}</p></section>`,
    }));
    return;
  }

  if (state.error) {
    container.insertAdjacentHTML('beforeend', header + renderPageBody({
      content: `<section class="school-panel">
        ${emptyStateHTML({
          variant: 'error',
          title: t('extensions.school-planner.error.load'),
          description: state.error,
          action: { label: t('extensions.school-planner.action.retry'), attrs: { 'data-action': 'reload' } },
        })}
      </section>`,
    }));
    if (window.lucide) window.lucide.createIcons({ el: container });
    return;
  }

  const body = needsSetup()
    ? renderSetup()
    : `${tabs()}${notice()}${state.view === 'week' ? renderWeek() : state.view === 'edit' ? renderEdit() : renderTomorrow()}`;

  container.insertAdjacentHTML('beforeend', header + renderPageBody({ content: body }));
  if (window.lucide) window.lucide.createIcons({ el: container });
}

function notice() {
  return state.notice ? `<p class="school-hint school-hint--notice">${esc(state.notice)}</p>` : '';
}

/**
 * Muss noch eingerichtet werden?
 *
 * Ja, wenn kein Plan da ist - oder wenn keines der drei Felder existiert, denn
 * dann koennte der Editor kein Fach schreiben. Die Stunden allein sind kein
 * Grund: wer den Schul-Preset des Dienstplans schon benutzt hat, hat sie.
 */
function needsSetup() {
  return !state.pattern || Object.keys(state.fieldIds).length === 0;
}

function renderSetup() {
  const writable = canWrite();
  return `<section class="school-panel">
  <h2 class="school-panel__title">${esc(t('extensions.school-planner.setup.heading'))}</h2>
  <p class="school-hint">${esc(t('extensions.school-planner.setup.intro'))}</p>
  <ul class="school-setup-list">
    <li>${esc(t('extensions.school-planner.setup.periods'))}</li>
    <li>${esc(t('extensions.school-planner.setup.fields'))}</li>
    <li>${esc(t('extensions.school-planner.setup.plan', { name: memberName() || t('extensions.school-planner.title') }))}</li>
  </ul>
  ${writable
    ? `<button type="button" class="btn btn--primary" data-action="setup"${state.busy ? ' disabled' : ''}>${esc(state.busy ? t('extensions.school-planner.setup.running') : t('extensions.school-planner.setup.create'))}</button>`
    : `<p class="school-hint school-hint--notice">${esc(t('extensions.school-planner.setup.readOnly'))}</p>`}
</section>`;
}

/* ── Einstieg ─────────────────────────────────────────────────────────────── */

export async function render(container, context = {}) {
  state.container = container;
  state.signal = context.signal ?? null;
  // Den Benutzer gibt der Router der Seite mit (public/router.js:1595,
  // `{ user: currentUser, ... }`); die Kachel bekommt ihn ebenfalls. Gebraucht
  // wird er fuer die eine Frage, die dieses Modul nicht selbst beantworten
  // kann: wem gehoert diese Stunde.
  state.me = context.user ?? null;
  state.settings = loadSettings();
  state.view = state.settings.view;
  state.loading = true;
  state.error = '';
  state.notice = '';
  state.weekOffset = 0;
  renderShell();

  // Jeder Listener bekommt `signal`: verlaesst die Benutzerin die Seite, raeumt
  // der Router sie ab, und ein spaeter eintreffender Klick trifft nichts mehr.
  const options = state.signal ? { signal: state.signal } : undefined;

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const view = target.closest('[data-view]');
    if (view) {
      state.view = view.dataset.view;
      state.notice = '';
      saveSettings();
      renderShell();
      return;
    }

    const cell = target.closest('[data-cell]');
    if (cell) {
      if (canWrite()) openCellEditor(cell.dataset.cell);
      else window.yuvomi?.showToast(t('extensions.school-planner.setup.readOnly'), 'danger');
      return;
    }

    // Vor `[data-action]` und nicht darin: die Zeit ist kein `data-action`,
    // weil sie eine Id traegt und keine Aktion benennt.
    const times = target.closest('[data-times]');
    if (times) {
      openTimesEditor(times.dataset.times);
      return;
    }

    const action = target.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
      case 'reload': void refresh(); break;
      case 'setup': void runSetup(); break;
      case 'week-prev': state.weekOffset -= 1; void navigateWeek(); break;
      case 'week-next': state.weekOffset += 1; void navigateWeek(); break;
      case 'week-today': state.weekOffset = 0; void navigateWeek(); break;
      default: break;
    }
  }, options);

  container.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // `change` und nicht `input`: das native Farbfeld meldet sich bei jedem
    // Schieben im Regler, `change` erst beim Schliessen. Geschrieben wird also
    // einmal, wenn die Farbe feststeht, statt bei jedem Zwischenschritt.
    //
    // Kein Erfolgs-Toast: die Ansicht faerbt sich sichtbar um, das ist die
    // Rueckmeldung. Eine Meldung "gespeichert" ueber einem Raster, das sich
    // gerade geaendert hat, sagt dasselbe zweimal.
    const colorInput = target.closest('[data-subject-color]');
    if (colorInput) {
      void saveSubjectColor(colorInput.dataset.subjectColor, colorInput.value).catch((error) => {
        window.yuvomi?.showToast(t('extensions.school-planner.colors.failed'), 'danger');
        console.warn('[school-planner] Farbe konnte nicht gespeichert werden:', error);
        // Neuzeichnen stellt den Regler auf den Stand zurueck, der wirklich
        // gespeichert ist - sonst zeigt er eine Farbe, die es nirgends gibt.
        renderShell();
        keepColorsOpen();
      });
      return;
    }

    const pupil = target.closest('[data-action="pupil"]');
    if (!pupil) return;
    state.pupilId = Number(pupil.value);
    state.weekOffset = 0;
    saveSettings();
    void refresh();
  }, options);

  await refresh();
}

/** Wochenwechsel: erst die neue Woche holen, dann zeichnen. */
async function navigateWeek() {
  renderShell();
  try {
    await reload();
  } catch (error) {
    state.error = error?.message || String(error);
  }
  if (!state.signal?.aborted) renderShell();
}

async function refresh() {
  state.loading = true;
  state.error = '';
  state.notice = '';
  renderShell();
  try {
    await reload();
    if (state.signal?.aborted) return;
    state.loading = false;
  } catch (error) {
    if (state.signal?.aborted) return;
    state.loading = false;
    state.error = error?.message || String(error);
  }
  renderShell();
}
