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
| Fields `Fach`, `Raum`, `Lehrer`, `Farbe` | Reused by name; an English household finds `Subject`, `Room`, `Teacher`, `Colour` |
| A 7-day pattern `Stundenplan <name>` | Anchored on this week's Monday |

Times are not fixed here: they live on the period, so a school with a
60-minute grid changes the times once and the whole timetable follows. You can
do that from either side - tap the time in **Bearbeiten**, or open the period's
card under *Schichtarten* in the shift planner. Both write the same row.

## Using it

- **Morgen** - the next day that has lessons, not literally tomorrow. On a Friday
  evening it shows Monday and says so, because "no lessons" is the correct answer
  and a useless one.
- **Woche** - the grid. Rows are times, columns are the seven days, colours come
  from the subject. Week navigation, and today is marked.
- **Bearbeiten** - the recurring grid. Tap a cell for subject, room and teacher,
  or tap a period's time to change when it starts and ends.
- **Farben** - at the bottom of **Bearbeiten**, one colour per subject. Every
  lesson of the same subject gets it: in the grid, in tomorrow's list and on the
  tile. Without a choice, a subject keeps the colour computed from its name, so a
  fresh install is coloured too and every device agrees.

The dashboard tile **Stunden morgen** shows the next school day. How much of it
fits depends on the tile's height, and the tile picks between two layouts on its
own - two lines per lesson (time, subject, room and teacher below) while the day
fits, one line per lesson (time and subject, room after it) once it does not:

| Tile | Two lines per lesson | One line per lesson |
| --- | --- | --- |
| 2x2 | 5 lessons | 8 lessons |
| 2x3 | 8 lessons | 14 lessons |
| 2x4 | 12 lessons | 20 lessons |

So a normal eight-lesson day stands completely on a 2x2 tile. A day with breaks
in it is longer than that, and **2x3 is the size that carries a whole day with
breaks**. Whatever still does not fit is counted in a line below the list:
nothing disappears without a number, and the badge in the header always counts
the whole day rather than the visible part. On a flat tile (2x1, 3x1) the
one-line layout would not gain a single row, so the tile keeps its two lines and
the three rows it always had - there the number below the list is the only change.

Clearing subject, room and teacher makes the period free: an empty cell is the
absence of a row, not a row with an empty value.

Editing a time is offered only where the server would allow it. A shift type
belongs to the household but is changed by its creator or an admin
(`ownTypeOrAdmin()` in `server/routes/schedule.js`), so the time is a button for
those people and plain text for everyone else. Whoever ran **Einrichten** owns
the six periods it created.

### Where the colour is stored, and what it costs

A chosen colour is a value of a fourth custom field, **Farbe**, on the lesson
row. A module has no server and no database of its own, so `/api/v1` is the only
place it may write at all ([MODULES.md](../../MODULES.md)) - and a field value is
the only thing there that a household can read back.

Two consequences, both deliberate:

- The colour field is attached with `show_in_overlay: false`. The shift planner
  renders **every** field attached to a period in its day rows, so `#0369A1` is
  visible there and in an entry's detail sheet. It is *not* visible in the family
  calendar or in an ICS subscription: both read that one flag
  (`public/pages/schedule.js`, `server/services/schedule-ics.js`), and that is
  what keeps the hex out of every event.
- The value lives on the row but means per subject, so setting a colour rewrites
  every row of that subject in a single write. "Mathematics is always blue" holds
  everywhere, not only in the cell that was touched.

If the field is later renamed or deleted in the shift planner, the module falls
back to the computed colour instead of failing - the same happens if someone
types something other than a colour into the field by hand.

## Where the data lives

The module brings no server, no database and no migrations. It reads and writes
Yuvomi's own shift planner through `/api/v1/schedule`:

| Timetable concept | Yuvomi |
| --- | --- |
| A period (1st lesson, 08:00) | `schedule_shift_types` - has exactly one time |
| A person's timetable | `schedule_patterns` with `cycle_length: 7` |
| A lesson on a weekday | `schedule_pattern_days`, position `0` = the anchor day |
| Subject, room, teacher, colour | `schedule_custom_fields`, as per-row values |

Two consequences worth knowing:

1. **The subject is not the shift type, the period is.** A shift type carries
   exactly one time, so if "Mathematics" were the type, the same subject could
   not sit in period 1 on Monday and period 3 on Tuesday. The period carries the
   time, the subject hangs off the row - and its colour is either chosen (stored
   on the row, see above) or computed from the subject name, so a household that
   never opens the colour panel still gets the same colours on every device.
2. **The timetable shows up in the shift planner, the family calendar and the
   ICS feed.** That is deliberate: it puts the timetable where a household
   actually looks. In the ICS feed the event title is the period
   (`P1 · 1. Stunde`) and the subject is in the description, because that is
   where the shift planner puts custom field values. The colour is the one value
   that stays out of both, and the paragraph above says how.

A single day - a substitution, a trip, a cancelled lesson - is a shift planner
*override* on that date, not an edit here. An override wins over the pattern,
and every week repeats from the pattern.

## Accessibility and house rules

- The weekday grid scrolls sideways on its own; the page never scrolls
  horizontally.
- The colour of a subject is either chosen in **Farben** or computed from the
  subject name (FNV-1a over a mid-tone palette). Either way the text colour on a
  block is computed for contrast, not fixed - a yellow subject gets dark text, a
  blue one light.
- A value typed into the *Farbe* field in the shift planner is not trusted as
  CSS: it has to be a hex colour to be used.
- The tile never scrolls inside itself: the core removed `overflow: auto` from
  `.widget__body` on purpose (Issue #166, nested scroll containers blank the
  screen on iOS and Android). It shows fewer rows instead - and says how many it
  left out.
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
server's own formula, date arithmetic across daylight saving, the row/column
building of the grid, the colour chain (the hex grammar, listing the subjects of
a plan, spreading one colour over every row of a subject, and falling back to the
computed colour when the stored value is missing or unusable), and how much of a
school day the dashboard tile carries.
`school-planner.test.js` covers the delivery promises: every used translation key
present in both locales, the module accent in `theme.js` equal to the one in
`module.json`, every file the manifest names actually existing (a missing widget
entry makes the whole module load as errored), the two promises the colour rests
on - that the colour field is attached outside the overlay, and that a colour is
attached to the period before it is written - and the tile's arithmetic, which is
compared against the core's own grid (`grid-auto-rows` in `dashboard.css`,
`--space-5` in `tokens.css`) so the estimate cannot drift away from the layout it
describes.


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
