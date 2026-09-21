# School Planner (Stundenplan)

A real weekly timetable for Yuvomi - a grid of subjects, times and rooms, plus a
"tomorrow" view and a dashboard tile that answers the question a school evening
actually asks: **what does she have tomorrow, and what has to go in the bag.**

This module exists because the shift planner's "school" option is a *preset*
(`PRESET_TEMPLATES.school` in `public/pages/schedule.js`): four periods, one
exam block, and nothing that knows what a subject is. It is a starting point for
shifts, not a timetable.

> **This module ships with the fork, not with Yuvomi.**
> `modules/*` is gitignored upstream (`.gitignore`), so a module folder can never
> be part of a pull request against `ulsklyc/yuvomi`. It is committed here with
> `git add -f` on purpose. The extension-module contract it implements is
> [MODULES.md](../../MODULES.md), and that part *is* upstream and stable.

## Install

Nothing to configure if you run this fork's `docker-compose.yml`: the module
folder is inside the checkout, and the compose file already mounts
`${MODULES_DIR:-./modules}` to `/app/modules`. `docker compose up -d` picks it up.

For a stock Yuvomi image with the module kept outside the checkout:

```bash
# .env
MODULES_DIR=/absolute/path/to/yuvomi-modules
```

Then put this folder at `$MODULES_DIR/school-planner/` and restart the service.
New or changed module folders are scanned at runtime - no image rebuild. See
[MODULES.md](../../MODULES.md) for Podman, Portainer, Unraid and TrueNAS.

The module appears as **Stundenplan** in the navigation, in the custom-modules
section, and as the dashboard widget **Stunden morgen** (hidden by default;
enable it under *Customize*).

## Setup

Open the page once and press **Einrichten**. It creates only what is missing and
finds again what is already there:

| What | Where it comes from |
| --- | --- |
| Six periods 08:00-13:15 | Reused by short code (`P1`…) or name (`1. Stunde`), so the shift planner's school preset is adopted rather than duplicated |
| Fields `Fach`, `Raum`, `Lehrer` | Reused by name; an English household finds `Subject`, `Room`, `Teacher` |
| A 7-day pattern `Stundenplan <name>` | Anchored on this week's Monday |

Times are not fixed here: they live on the period, so a school with a
60-minute grid changes the times once in the shift planner and the timetable
follows.

## Using it

- **Morgen** - the next day that has lessons, not literally tomorrow. On a Friday
  evening it shows Monday and says so, because "no lessons" is the correct answer
  and a useless one.
- **Woche** - the grid. Rows are times, columns are the seven days, colours come
  from the subject. Week navigation, and today is marked.
- **Bearbeiten** - the recurring grid. Tap a cell for subject, room and teacher.

Clearing subject, room and teacher makes the period free: an empty cell is the
absence of a row, not a row with an empty value.

## Where the data lives

The module brings no server, no database and no migrations. It reads and writes
Yuvomi's own shift planner through `/api/v1/schedule`:

| Timetable concept | Yuvomi |
| --- | --- |
| A period (1st lesson, 08:00) | `schedule_shift_types` - has exactly one time |
| A person's timetable | `schedule_patterns` with `cycle_length: 7` |
| A lesson on a weekday | `schedule_pattern_days`, position `0` = the anchor day |
| Subject, room, teacher | `schedule_custom_fields`, as per-row values |

Two consequences worth knowing:

1. **The subject is not the shift type, the period is.** A shift type carries
   exactly one time, so if "Mathematics" were the type, the same subject could
   not sit in period 1 on Monday and period 3 on Tuesday. The period carries the
   time, the subject hangs off the row - and its colour is derived from the
   subject name, so it is the same on every device without storing a mapping.
2. **The timetable shows up in the shift planner, the family calendar and the
   ICS feed.** That is deliberate: it puts the timetable where a household
   actually looks. In the ICS feed the event title is the period
   (`P1 · 1. Stunde`) and the subject is in the description, because that is
   where the shift planner puts custom field values.

A single day - a substitution, a trip, a cancelled lesson - is a shift planner
*override* on that date, not an edit here. An override wins over the pattern,
and every week repeats from the pattern.

## Accessibility and house rules

- The weekday grid scrolls sideways on its own; the page never scrolls
  horizontally.
- Colours are derived from the subject name (FNV-1a over a mid-tone palette) and
  the text colour on a block is computed for contrast, not fixed - a yellow
  subject gets dark text, a blue one light.
- No dash is ever an em dash or en dash.
- The composition mode is `full`, so the page header carries no measure
  (`PAGE-016` in `test/test-frontend-audit.js`).

## Tests

```bash
node --test modules/school-planner/test/timetable.test.js
node --test modules/school-planner/test/school-planner.test.js
```

Neither file is wired into `package.json`'s suite chain, on purpose: this folder
does not exist in an upstream checkout, and a `test:` script pointing at a
missing file would turn `npm test` red there.

`timetable.test.js` covers the pure functions - cycle arithmetic against the
server's own formula, date arithmetic across daylight saving, and the
row/column building of the grid. `school-planner.test.js` covers the delivery
promises: every used translation key present in both locales, the module accent
in `theme.js` equal to the one in `module.json`, and every file the manifest
names actually existing (a missing widget entry makes the whole module load as
errored).

## Layout

```
module.json          manifest (format version 1)
index.js             the page: tomorrow, week, edit
data.js              the read layer both entries share
timetable.js         pure helpers - no DOM, no network, importable by node --test
theme.js             the module's own accent, for the dashboard tile
widgets/tomorrow.js  the dashboard tile
style.css            page and tile
locales/de.json      flat keys, no "extensions." prefix
locales/en.json
test/
```
