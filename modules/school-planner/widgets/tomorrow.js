/**
 * Modul: Stundenplan - Dashboard-Kachel "Stunden heute und morgen"
 *
 * Der Bezeichner der Kachel bleibt `tomorrow`: die Id steht in den gespeicherten
 * Dashboard-Layouts der Haushalte, und ein umbenannter Eintrag waere nach dem
 * naechsten Update eine leere Kachel. Der Name sagt trotzdem, was sie zeigt.
 *
 * Zweck: Was heute noch ansteht und was morgen dran ist, ohne dass jemand die
 *        Seite oeffnen muss. Das ist der Grund, aus dem es dieses Modul gibt:
 *        die Frage "was hat sie morgen, was muss mit" stellt man abends, und die
 *        Antwort soll auf dem Brett stehen und nicht zwei Klicks entfernt.
 *
 * ── Warum zwei Tage und nicht einer ─────────────────────────────────────────
 *
 * "Morgen" war die halbe Antwort. Um sechs Uhr morgens ist der laufende Tag die
 * ganze Frage - und "morgen" verlangt dann, dass jemand im Kopf vom Datum auf
 * den Wochentag rechnet. Die Kachel zeigt deshalb beide: erst den laufenden Tag,
 * dann den naechsten, an dem Unterricht steht. Sie muss dafuer nicht wissen, wie
 * spaet es ist: was heute schon vorbei ist, faellt in `remainingLessons()`
 * heraus, und ein Tag ohne Stunden faellt in `widgetDayPlan()` heraus. Abends
 * steht damit von selbst nur noch der naechste Tag da - dieselbe Kachel, ohne
 * Umschalter und ohne Einstellung.
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
  lessonsByDate,
  pickPattern,
  pickPupil,
  planName,
  readSettings,
  resolveFieldIds,
} from '../data.js';
import { MODULE_ACCENT } from '../theme.js';
import { addDays, nextDateWithLessons, remainingLessons, widgetDayPlan } from '../timetable.js';

/** Wie weit die Suche nach dem naechsten Schultag reicht - wie auf der Seite. */
const LOOKAHEAD_DAYS = 21;

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

/**
 * Wie ein Tag ueber seiner Liste heisst.
 *
 * "Heute" und "Morgen" statt eines Datums: das Datum der beiden naechsten Tage
 * kennt jeder, der auf ein Dashboard sieht, und in einer Kachel von zwei Spalten
 * Breite kostet "Montag, 24. September" die halbe Zeile. Erst der Tag, der
 * weiter weg liegt, braucht seinen Namen - und dann ist er die Auskunft, die die
 * Kachel geben muss ("morgen ist frei, das hier ist Montag").
 */
function dayName(dateKey, { today, tomorrow }) {
  if (dateKey === today) return t('extensions.school-planner.widgets.dayToday');
  if (dateKey === tomorrow) return t('extensions.school-planner.widgets.dayTomorrow');
  return dayLabel(dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
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

/**
 * Eine Zeile der Kachel.
 *
 * `dense` ist die einzeilige Fassung: Uhrzeit und Fach, der Raum dahinter in
 * derselben Zeile. Zwei Zeilen je Stunde sind schoener zu lesen, aber ein
 * halber Schultag ist schlimmer als ein ganzer ohne Raum - und der Raum steht
 * weiter da, solange die Breite reicht, weil ihn die Ellipse des Fachs von
 * hinten abschneidet: erst den Raum, nie das Fach.
 */
function lessonRow(lesson, dense) {
  const meta = [lesson.room, lesson.teacher].filter(Boolean).map(esc).join(' · ');
  const inline = dense && meta
    ? `<span class="school-widget__meta school-widget__meta--inline"> · ${meta}</span>`
    : '';
  return `<li class="school-widget__row" style="--lesson-color:${esc(lesson.color)}">
    <span class="school-widget__time">${esc(lesson.startTime || '')}</span>
    <span class="school-widget__subject">${esc(lesson.subject || lesson.periodName || '')}${inline}</span>
    ${!dense && meta ? `<span class="school-widget__meta">${meta}</span>` : ''}
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
  const [members, customFields] = await Promise.all([
    fetchHouseholdMembers(),
    fetchCustomFields(),
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
  for (let step = 0; step <= LOOKAHEAD_DAYS; step += 1) dateKeys.push(addDays(today, step));

  const entries = await fetchEntries({ userId: pupilId, from: today, to: dateKeys[dateKeys.length - 1] });
  const byDate = lessonsByDate(entries, dateKeys, fieldIds);
  const hasLessons = (dateKey) => (byDate.get(dateKey) ?? []).length > 0;

  // Was heute noch ansteht, und dann der naechste Tag mit Unterricht. Zwei
  // Quellen fuer denselben Vorbehalt: `remainingLessons()` nimmt die Uhr, der
  // zweite Tag ist nicht der Kalender. Beide sind noetig - eine Stunde, die
  // heute noch laeuft, gehoert dazu, und "morgen ist frei" ist die Regel und
  // nicht die Ausnahme.
  const clock = new Date();
  const nextKey = nextDateWithLessons(tomorrow, hasLessons, { maxDays: LOOKAHEAD_DAYS });
  const days = [
    { key: today, lessons: remainingLessons(byDate.get(today) ?? [], clock.getHours() * 60 + clock.getMinutes()) },
    { key: nextKey, lessons: nextKey ? (byDate.get(nextKey) ?? []) : [] },
  ];

  if (!container.isConnected) return;

  // Wie viel von welchem Tag auf die Kachel passt - und in welcher Fassung. Die
  // Entscheidung faellt in `widgetDayPlan()`, damit sie ohne Browser pruefbar
  // bleibt; hier wird nur noch gezeichnet. Ein Tag ohne Stunden ist dort kein
  // Abschnitt: abends steht der laufende Tag nicht mehr da, und die Planung
  // muss dafuer nichts ueber die Uhr wissen.
  const plan = widgetDayPlan(size, days);

  if (!plan.days.length) {
    container.insertAdjacentHTML('afterbegin', header(title, 0) + emptyState());
    return;
  }

  const lessonsOf = new Map(days.map((day) => [day.key, day.lessons]));
  // Die Badge im Kopf zaehlt ALLE Stunden der gezeigten Tage und nicht die
  // sichtbaren: sonst verspraeche "5" einen kurzen Tag, den es nicht gibt. Was
  // die Kachel nicht zeigt, nennt die Tageszeile daneben.
  const total = plan.days.reduce((sum, day) => sum + day.cap + day.more, 0);
  const sections = plan.days.map((day) => {
    const shown = (lessonsOf.get(day.key) ?? []).slice(0, day.cap);
    return `<p class="school-widget__day">
        <span class="school-widget__day-name">${esc(dayName(day.key, { today, tomorrow }))}</span>
        ${day.more > 0 ? `<span class="school-widget__day-more">${esc(t('extensions.school-planner.widgets.moreShort', { rest: day.more }))}</span>` : ''}
      </p>
      <ul class="school-widget__list">${shown.map((lesson) => lessonRow(lesson, plan.dense)).join('')}</ul>`;
  }).join('');

  container.insertAdjacentHTML('afterbegin', header(title, total) + `
    <div class="widget__body school-widget">
      ${sections}
    </div>`);
}
