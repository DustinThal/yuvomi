/**
 * Modul: Stundenplan - die Lese-Schicht ueber /api/v1/schedule
 * Zweck: Eine einzige Stelle, die weiss, wie ein Stundenplan aus Yuvomis
 *        Dienstplan-API gelesen wird. `index.js` (die Seite) und
 *        `widgets/tomorrow.js` (die Kachel) teilen sie sich.
 *
 *        Das ist kein Ordnungssinn, sondern die Lehre aus dem, was hier sonst
 *        passiert waere: die Zuordnung "Fach/Raum/Lehrer" haengt an Feld-NAMEN,
 *        und zwei Kopien davon heissen, dass ein umbenanntes Feld die Seite
 *        weiter funktionieren laesst und die Kachel still leer zeigt.
 *
 *        Dasselbe gilt fuer die zwei Fragen, die sich beide Einstiege stellen:
 *        WELCHE Person (die auf der Seite gewaehlte, sonst die erste) und
 *        WELCHES Muster (die gemerkte Id, der Name, irgendein 7er-Zyklus). Die
 *        Kachel hat keinen Personenwaehler - wuerde sie anders raten als die
 *        Seite, zeigte sie in einem Haushalt mit zwei Kindern den Plan des
 *        falschen und niemand koennte sehen, warum.
 *
 * Abhaengigkeiten: /api.js, /utils/date.js, ./timetable.js
 *
 * Nichts hier haelt Zustand und nichts schreibt: die Schreibwege stehen in
 * `index.js`, weil sie ihre Fehler an einer Oberflaeche melden muessen. Gelesen
 * wird der Speicher des Browsers an genau einer Stelle - die Wahl der Person -,
 * und auch das nur lesend.
 */

import { api } from '/api.js';
import { weekStartIndex } from '/utils/date.js';

/**
 * Die vier Felder, die dieses Modul anlegt und benutzt.
 *
 * "Fach" ist der Wert, den die Ansichten zeigen; ohne Fach zeigt der Block den
 * Namen der Stunde. Raum und Lehrer sind freiwillig, "Farbe" ist die einzige
 * Ausnahme von der Regel unten - siehe gleich.
 *
 * Gefunden wird ueber den NAMEN, nicht ueber eine gespeicherte Id: eine Id in
 * `localStorage` gilt nur fuer das Geraet, auf dem sie geschrieben wurde, und
 * ein Stundenplan, der auf dem Handy anders aussieht als am Kuechenrechner,
 * waere die schlechtere Antwort. Wer die Felder umbenennt, verliert sie - der
 * Hinweis steht in der Einrichtung.
 *
 * Die englischen Zweitnamen sind nicht Zierde: `POST /schedule/custom-fields`
 * legt "Fach" an, und ein Haushalt mit englischer Oberflaeche findet beim
 * Wiedererkennen dasselbe Feld unter "Subject" wieder, statt ein zweites
 * danebenzustellen.
 *
 * "Farbe" hat mit den drei anderen nur den Ablageort gemeinsam. Ohne sie waere
 * die Farbe eines Fachs aus seinem Namen gerechnet (`subjectColor`) und damit
 * unveraenderlich - schoen fuer ein Modul ohne Speicher, aber niemand kann
 * Mathe dann die Farbe geben, die er im Kopf hat. Sie liegt darum als Wert an
 * der Plan-Zeile: der einzige Ort, an den ein Modul ohne eigenen Server
 * schreiben darf (MODULES.md: "read and write through /api/v1"). Was das
 * kostet, steht in der README - der Schichtplan zeigt den Wert als viertes
 * Eingabefeld, weil er jedes Feld zeigt, das an einer Schichtart haengt.
 * Deshalb haengt sie NICHT an `show_in_overlay`: sonst stuende "#7C3AED" in der
 * Kalenderzeile und in jedem ICS-Eintrag.
 */
export const FIELD_NAMES = Object.freeze({
  subject: ['Fach', 'Subject'],
  room: ['Raum', 'Room'],
  teacher: ['Lehrer', 'Teacher'],
  color: ['Farbe', 'Colour', 'Color'],
});

export function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

/** Die Feld-Ids der drei Rollen, soweit es sie im Haushalt gibt. */
export function resolveFieldIds(customFields) {
  const byName = new Map((customFields ?? []).map((field) => [normalizeName(field.name), field.id]));
  const ids = {};
  for (const [role, names] of Object.entries(FIELD_NAMES)) {
    for (const name of names) {
      const id = byName.get(normalizeName(name));
      if (id != null) { ids[role] = id; break; }
    }
  }
  return ids;
}

/** Der Name des Musters, das dieses Modul fuer eine Person anlegt. */
export function planName(member) {
  const who = member?.display_name || member?.username || '';
  return who ? `Stundenplan ${who}` : 'Stundenplan';
}

/** Das Muster einer Person: erst die gemerkte Id, dann der Name, dann irgendein 7er-Zyklus. */
export function pickPattern(patterns, { storedId = null, expectedName = '' } = {}) {
  const list = patterns ?? [];
  return list.find((pattern) => Number(pattern.id) === Number(storedId))
    ?? list.find((pattern) => normalizeName(pattern.name) === normalizeName(expectedName))
    ?? list.find((pattern) => Number(pattern.cycle_length) === 7)
    ?? null;
}

/* ── Die gemerkte Person ──────────────────────────────────────────────────── */

/**
 * Der Schluessel, unter dem die Seite die gewaehlte Person merkt.
 *
 * Er steht hier und nicht in `index.js`, weil die Kachel denselben Schluessel
 * liest. Der Praefix ist bei Yuvomi-Modulen `yuvomi:module:<id>`; Module aus der
 * Zeit vor der Umbenennung schrieben `oikos:module:<id>` - der alte Stand ist
 * eine Personenwahl, die beim naechsten Mal ohnehin neu getroffen wird, also
 * wird er nicht migriert.
 */
export const SETTINGS_KEY = 'yuvomi:module:school-planner';

/**
 * Die gemerkte Wahl - nur die zwei Felder, die beide Einstiege brauchen.
 *
 * `view` fehlt hier absichtlich: welche Ansicht jemand zuletzt offen hatte, ist
 * eine Frage der Seite. Ein gesperrter oder voller Speicher darf die Kachel
 * nicht anhalten, deshalb der leere Rueckfall statt eines Wurfs.
 */
export function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { pupilId: raw?.pupilId ?? null, patternId: raw?.patternId ?? null };
  } catch {
    return { pupilId: null, patternId: null };
  }
}

/**
 * Die Person, deren Plan gezeigt wird.
 *
 * Die gemerkte Wahl gilt nur, solange es die Person noch gibt: eine geloeschte
 * Mitglieds-Id aus einem alten Speicherstand wuerde sonst zu einer leeren Seite
 * fuehren, die nach einem Fehler aussieht und keiner ist.
 */
export function pickPupil(members, { storedId = null } = {}) {
  const list = members ?? [];
  const stored = Number(storedId);
  if (Number.isInteger(stored) && list.some((member) => Number(member.id) === stored)) return stored;
  return list[0]?.id != null ? Number(list[0].id) : null;
}

/* ── Lesen ────────────────────────────────────────────────────────────────── */

export async function fetchShiftTypes() {
  const response = await api.get('/schedule/shift-types');
  return response.data ?? [];
}

export async function fetchCustomFields() {
  const response = await api.get('/schedule/custom-fields');
  return response.data ?? [];
}

export async function fetchHouseholdMembers() {
  const response = await api.get('/schedule/household-members');
  return response.data ?? [];
}

/** Der Wochenstart des Haushalts als `Date#getDay()`-Index (0 = Sonntag). */
export async function fetchWeekStart() {
  const response = await api.get('/preferences');
  return weekStartIndex(response.data?.week_start);
}

export async function fetchPatterns(userId) {
  if (userId == null) return [];
  const response = await api.get(`/schedule/patterns?user_id=${encodeURIComponent(userId)}`);
  return response.data ?? [];
}

export async function fetchPatternDays(patternId) {
  if (patternId == null) return [];
  const response = await api.get(`/schedule/patterns/${encodeURIComponent(patternId)}/days`);
  return response.data ?? [];
}

/**
 * Die aufgeloesten Stunden eines Zeitraums.
 *
 * `/schedule/entries` rechnet Muster, Abweichungen und Zusatzstunden zusammen.
 * Fuer "Morgen" ist genau das richtig: eine Vertretungsstunde, die als
 * Abweichung eingetragen wurde, und ein freier Tag stehen dort und nicht im
 * Muster.
 */
export async function fetchEntries({ userId, from, to }) {
  if (userId == null || !from || !to) return [];
  const response = await api.get(
    `/schedule/entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    + `&user_id=${encodeURIComponent(userId)}`,
  );
  return response.data?.entries ?? [];
}

// `lessonsByDate()` steht in `timetable.js`: sie rechnet nur und liest nichts,
// und dort ist sie ohne Browser pruefbar - genau der Weg, auf dem eine Stunde
// ihre Farbe findet, hatte hier keine Pruefung. Weitergereicht wird sie trotzdem,
// damit Seite und Kachel weiterhin nur eine Abhaengigkeit haben.
export { lessonsByDate } from './timetable.js';
