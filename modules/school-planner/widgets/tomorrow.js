/**
 * Modul: Stundenplan - Dashboard-Kachel "Stunden morgen"
 * Zweck: Der Plan des naechsten Schultages, ohne dass jemand die Seite oeffnen
 *        muss. Das ist der Grund, aus dem es dieses Modul gibt: die Frage
 *        "was hat sie morgen, was muss mit" stellt man abends, und die Antwort
 *        soll auf dem Brett stehen und nicht zwei Klicks entfernt.
 *
 * Abhaengigkeiten: /i18n.js, /utils/html.js, /utils/date.js, /nav-icons.js,
 *        ../data.js, ../timetable.js
 *
 * ── Was diese Kachel anders macht als die Seite ─────────────────────────────
 *
 * Sie hat keinen Personenwaehler und keine Knoepfe: eine Kachel, die man erst
 * einstellen muss, ist keine Antwort. Sie liest deshalb die Person, die auf der
 * Seite gewaehlt wurde (`data.js#readSettings()`), und benutzt dieselbe
 * Aufloesung fuer Muster und Felder. Wuerde sie eigenstaendig raten, zeigte sie
 * in einem Haushalt mit zwei Kindern den Plan des falschen - und niemand koennte
 * sehen, warum.
 *
 * ── Warum die Kachel ihr Stylesheet selbst holt ─────────────────────────────
 *
 * Yuvomi laedt das Modul-Stylesheet auf der ROUTE des Moduls (public/router.js,
 * `loadPageStyle`). Auf dem Dashboard gilt es nicht, und die Kachel braucht ihre
 * Zeilen trotzdem. Sie kennt ihren eigenen Ablageort - `import.meta.url` zeigt
 * auf diese Datei -, also leitet sie den Pfad davon ab, statt einen zweiten
 * hartkodierten Pfad zu fuehren. Der Kern bietet fuer Kacheln keine Styling-
 * Schnittstelle an; die Alternative waere ein Inline-Style je Zeile gewesen,
 * und damit eine Farbregel, die bei jeder Groessenaenderung mitgeschrieben
 * werden muesste.
 */

import { t, getLocale } from '/i18n.js';
import { esc } from '/utils/html.js';
import { todayKey } from '/utils/date.js';
import { moduleIconHTML } from '/nav-icons.js';
import {
  fetchCustomFields,
  fetchEntries,
  fetchHouseholdMembers,
  fetchPatterns,
  fetchWeekStart,
  lessonsByDate,
  pickPattern,
  pickPupil,
  planName,
  readSettings,
  resolveFieldIds,
} from '../data.js';
import { MODULE_ACCENT } from '../theme.js';
import { addDays, nextDateWithLessons } from '../timetable.js';

/** Wie weit die Suche nach dem naechsten Schultag reicht - wie auf der Seite. */
const LOOKAHEAD_DAYS = 21;

/**
 * Wie viele Zeilen die Kachel traegt.
 *
 * Dieselbe Regel wie `listRowCap()` in public/pages/dashboard.js: der
 * Zeilen-Span der Groessenklasse entscheidet, nicht die Pixelhoehe (die kennt
 * erst der Browser, und eine Zeilenzahl, die vom Messzeitpunkt abhaengt,
 * springt beim Laden). Die Zahlen sind eine Abschrift, weil die Funktion
 * dashboard-lokal und nicht exportiert ist - die Begruendung steht dort.
 *
 * Der Deckel ist hier wichtiger als anderswo: ein Schultag hat acht Stunden,
 * die Kachel hat Platz fuer fuenf, und `.widget` schneidet den Rest ab. Die
 * Badge im Kopf zaehlt deshalb ALLE Stunden und nicht die gezeigten - sonst
 * verspraeche "5" einen kurzen Tag, den es nicht gibt.
 */
const ROW_CAP_TALL = 5;
const ROW_CAP_SHORT = 3;

function rowCap(size) {
  return Number(String(size ?? '1x1').split('x')[1]) >= 2 ? ROW_CAP_TALL : ROW_CAP_SHORT;
}

/**
 * Das eigene Stylesheet nachladen, einmal.
 *
 * Der Marker im `data`-Attribut verhindert den zweiten Link, wenn mehrere
 * Kacheln derselben Sorte im Raster stehen oder das Dashboard neu aufbaut. Der
 * Link bleibt beim Verlassen des Dashboards stehen - anders als der der Route -,
 * weil ein Entfernen an das Ende des Kachel-Lebenszyklus gebunden waere, den
 * ein Modul nicht kennt.
 */
function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-school-planner-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../style.css', import.meta.url).href;
  link.dataset.schoolPlannerStyle = '1';
  document.head.appendChild(link);
}

/* ── Anzeige ──────────────────────────────────────────────────────────────── */

function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  if (!year || !month || !day) return null;
  // UTC, weil ein Datums-Schluessel eine Kalenderaussage ist und keine
  // Zeitangabe - eine lokale Mitternacht kippt in Zeitzonen hinter UTC auf den
  // Vortag.
  return new Date(Date.UTC(year, month - 1, day));
}

function dayLabel(dateKey, options) {
  const date = dateFromKey(dateKey);
  if (!date) return String(dateKey ?? '');
  try {
    return new Intl.DateTimeFormat(getLocale?.() || 'de', { timeZone: 'UTC', ...options }).format(date);
  } catch {
    return String(dateKey);
  }
}

function header(title, count, { link = true } = {}) {
  const badge = Number.isFinite(count) && count > 0 ? `<span class="widget__badge">${count}</span>` : '';
  const all = link
    ? `<a href="/m/school-planner" data-route="/m/school-planner" class="widget__link"
        aria-label="${esc(t('extensions.school-planner.widgets.allLessons', { name: title }))}">${esc(t('extensions.school-planner.widgets.all'))}</a>`
    : '';
  return `<div class="widget__header">
    <h3 class="widget__title">
      <span class="module-seal module-seal--sm" style="--seal-accent:${MODULE_ACCENT}" aria-hidden="true">${moduleIconHTML('graduation-cap')}</span>
      <span class="widget__title-text">${esc(title)}</span>
      ${badge}
    </h3>
    ${all}
  </div>`;
}

/** Der Leerzustand, der zur Einrichtung fuehrt - ohne ihn ist die Kachel eine Sackgasse. */
function setupState() {
  return `<div class="widget__empty">
    <span class="module-seal module-seal--sm" style="--seal-accent:${MODULE_ACCENT}" aria-hidden="true">${moduleIconHTML('graduation-cap')}</span>
    <div>${esc(t('extensions.school-planner.widgets.notSetUp'))}</div>
    <button type="button" class="widget__empty-cta" data-route="/m/school-planner">
      ${moduleIconHTML('wand-sparkles')}
      <span>${esc(t('extensions.school-planner.widgets.setUp'))}</span>
    </button>
  </div>`;
}

function emptyState() {
  return `<div class="widget__empty">
    ${moduleIconHTML('sun')}
    <div>${esc(t('extensions.school-planner.widgets.free'))}</div>
  </div>`;
}

function lessonRow(lesson) {
  const meta = [lesson.room, lesson.teacher].filter(Boolean).map(esc).join(' · ');
  return `<li class="school-widget__row" style="--lesson-color:${esc(lesson.color)}">
    <span class="school-widget__time">${esc(lesson.startTime || '')}</span>
    <span class="school-widget__subject">${esc(lesson.subject || lesson.periodName || '')}</span>
    ${meta ? `<span class="school-widget__meta">${meta}</span>` : ''}
  </li>`;
}

/* ── Einstieg ─────────────────────────────────────────────────────────────── */

/**
 * Die Kachel zeichnen.
 *
 * Der Kern ruft `renderWidget()` nach `mount.replaceChildren()` auf und laedt
 * danach die Lucide-Zeichen im Mount nach - es gibt hier also KEINEN
 * `context.signal` (siehe public/pages/dashboard.js, `mountExtensionWidgets`).
 * Die Stelle, an der ein Abbrechen noetig waere, ist deshalb eine andere: das
 * Dashboard kann das Raster waehrend des Ladens neu aufbauen, und dann haengt
 * dieses Element nicht mehr im Dokument. Geschrieben wird nur, wenn es noch
 * haengt.
 */
export async function renderWidget(container, { size } = {}) {
  ensureStyle();
  container.style.setProperty('--widget-accent', MODULE_ACCENT);

  const settings = readSettings();
  const [members, customFields, weekStart] = await Promise.all([
    fetchHouseholdMembers(),
    fetchCustomFields(),
    fetchWeekStart(),
  ]);
  const fieldIds = resolveFieldIds(customFields);
  const pupilId = pickPupil(members, { storedId: settings.pupilId });
  const member = members.find((candidate) => Number(candidate.id) === Number(pupilId)) ?? null;
  const patterns = pupilId == null ? [] : await fetchPatterns(pupilId);
  const pattern = pickPattern(patterns, {
    storedId: settings.patternId,
    expectedName: planName(member),
  });

  const title = t('extensions.school-planner.widgets.tomorrow');
  // Ohne Muster gibt es nichts zu zeigen UND nichts zu rechnen: die Kachel
  // fuehrt zur Einrichtung, statt einen leeren Plan als "frei" auszugeben.
  // Derselbe Unterschied wie in `renderEdit()` der Seite.
  if (!pattern) {
    if (container.isConnected) container.insertAdjacentHTML('afterbegin', header(title, 0, { link: false }) + setupState());
    return;
  }

  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const dateKeys = [];
  for (let step = 1; step <= LOOKAHEAD_DAYS; step += 1) dateKeys.push(addDays(today, step));

  const entries = await fetchEntries({ userId: pupilId, from: tomorrow, to: dateKeys[dateKeys.length - 1] });
  const byDate = lessonsByDate(entries, dateKeys, fieldIds);
  const hasLessons = (dateKey) => (byDate.get(dateKey) ?? []).length > 0;

  const tomorrowLessons = byDate.get(tomorrow) ?? [];
  const target = tomorrowLessons.length ? tomorrow : nextDateWithLessons(tomorrow, hasLessons, { maxDays: LOOKAHEAD_DAYS });
  const lessons = target ? (byDate.get(target) ?? []) : [];

  if (!container.isConnected) return;

  if (!lessons.length) {
    container.insertAdjacentHTML('afterbegin', header(title, 0) + emptyState());
    return;
  }

  const cap = rowCap(size);
  const shown = lessons.slice(0, cap);
  const day = dayLabel(target, { weekday: 'long', day: 'numeric', month: 'long' });
  const isTomorrow = target === tomorrow;
  const note = isTomorrow
    ? ''
    : `<p class="school-widget__note">${esc(t('extensions.school-planner.tomorrow.freeTomorrow'))}</p>`;

  container.insertAdjacentHTML('afterbegin', header(title, lessons.length) + `
    <div class="widget__body school-widget">
      <p class="school-widget__day">${esc(day)}</p>
      ${note}
      <ul class="school-widget__list">${shown.map(lessonRow).join('')}</ul>
      ${lessons.length > cap ? `<p class="school-widget__more">${esc(t('extensions.school-planner.widgets.more', { rest: lessons.length - cap }))}</p>` : ''}
    </div>`);
}
