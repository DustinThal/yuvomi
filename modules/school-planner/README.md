# School Planner (Stundenplan)

A real weekly timetable for Yuvomi - a grid of subjects, times and rooms, plus a
"tomorrow" view and a dashboard tile that answers the question a school day
actually asks: **what is left today, what is on tomorrow, and what has to go in
the bag.**

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
section, and as the dashboard widget **Stunden heute und morgen** (hidden by
default; enable it under *Customize*).

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
- **Woche** - the grid. Rows are times, columns are the school days, colours come
  from the subject. Week navigation, and today is marked.
- **Bearbeiten** - the recurring grid. Tap a cell for subject, room and teacher,
  or tap a period's time to change when it starts and ends.
- **Schultage** - at the bottom of **Bearbeiten**, one checkbox per weekday,
  Monday to Friday by default. Saturday and Sunday are columns that mostly stand
  empty; hiding them makes the grid narrower without touching the plan. The last
  remaining day cannot be switched off - a timetable without columns looks like a
  fault rather than a choice - and if a hidden day still carries lessons, the
  panel says which.
- **Farben** - at the bottom of **Bearbeiten**, one colour per subject. Every
  lesson of the same subject gets it: in the grid, in tomorrow's list and on the
  tile. Without a choice, a subject keeps the colour computed from its name, so a
  fresh install is coloured too and every device agrees.

### Which days are school days

This choice lives in the browser, not in the household, and that is not
carelessness: a module cannot add keys to `/preferences` (the server checks
against a fixed list) and it does not see the database
([MODULES.md](../../MODULES.md)), so the device is the only honest store. The
consequence is the useful one - what annoys you on the phone may be fine on the
kitchen computer.

It is a *display* setting, and deliberately nothing more:

- The **Morgen** tab and the dashboard tile still look at all seven days when they
  search for the next school day. A hidden Saturday is a statement about columns,
  not about whether the bus runs: silently dropping a lesson that exists would be
  the one thing a timetable must not do.
- The loaded window in `index.js#reload()` is still the full week, so a hidden day
  cannot shorten what the views afterwards ask for.
- What a hidden day *does* carry is reported in the panel rather than swallowed.

The dashboard tile **Stunden heute und morgen** shows the running day and the
next school day. That order is the whole design: at six in the morning the day
ahead is the question, and "tomorrow" would make you work out the weekday from
the date. It needs no clock face for that - a lesson that is already over drops
out of today's list, and a day without lessons is not a section
(`remainingLessons()`, `widgetDayPlan()` in `timetable.js`). So the tile shifts
by itself: today while school is on, tomorrow from the last bell, and on a
Friday evening Monday - with its date, because that is then the one answer worth
giving.

Which day gets how much room is decided per day, not per tile: today takes what
it needs and leaves the next day at least one row, so a full day cannot push
tomorrow off the tile entirely. How much fits depends on the tile's height, and
the tile picks between two layouts on its own - two lines per lesson (time,
subject, room and teacher below) while the day fits, one line per lesson (time
and subject, room after it) once it does not:

| Tile | Two lines per lesson | One line per lesson |
| --- | --- | --- |
| 2x2 | 5 lessons | 8 lessons |
| 2x3 | 8 lessons | 14 lessons |
| 2x4 | 12 lessons | 20 lessons |

(For one day. Two days cost one extra day line, so each carries roughly one
lesson less - and writing one line per lesson is what makes room for the second
day at all.)

So a normal eight-lesson day stands completely on a 2x2 tile. A day with breaks
in it is longer than that, and **2x3 is the size that carries a whole day with
breaks**. Whatever still does not fit is counted next to the day it belongs to -
"Heute +2" - so nothing disappears without a number, and the badge in the header
counts every lesson of the days shown rather than the visible part. On a flat
tile (2x1, 3x1) the one-line layout would not gain a single row, so the tile
keeps its two lines and the three rows it always had, and it stays with one day:
splitting a single row of height into two headings would take the day line from
both of them.

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

A colour chosen today also has to reach a lesson typed tomorrow, and that is the
harder half. The value is stored on the row, but the row for next Thursday does
not exist yet when the colour is picked - and when it is typed, nobody picks the
colour again. Nothing on that row says "blue". So the colour is resolved per
subject rather than per row, from every row the reader knows:

1. the value on the row itself, if it has one - a substitution may be coloured
   differently from its subject, and that has to stay possible;
2. otherwise the first colour found for that subject across the whole plan
   (`subjectColors()`), compared case- and whitespace-insensitively, the same way
   the colour panel groups subjects;
3. otherwise the colour computed from the subject name.

The page hands in a palette built from the pattern *and* the loaded entries, so
the answer does not depend on which week happens to be on screen; the tile builds
its own from the entries it fetched. Typing a lesson also carries the known
colour of that subject onto the new row, so the stored plan stays consistent and
editing a cell does not silently drop its colour.

The field is created when it is first needed. **Einrichten** creates it with the
other three, but a household that set the module up before the colour existed
(1.1.0) has no `Farbe` field - and setup is not offered a second time once a plan
exists. So picking a colour creates the field if it is missing, and the panel says
so above the list before the first pick. Any household member may create one
(`server/routes/schedule.js`); the field is then attached to the affected periods,
which is what the paragraph above is about. Without that repair the pick had
nowhere to go: nothing was written and nothing was said, which looks exactly like
a save that does not work.

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
  horizontally. Its columns are all the same width (`table-layout: fixed`), so a
  day carrying a room does not get the wide column - the cells wrap long words
  instead.
- The checkboxes in **Schultage** are the core's `.form-check`, not a new one:
  size, hit area and the "one voice" rule for the accent live there.
- The colour of a subject is either chosen in **Farben** or computed from the
  subject name (FNV-1a over a mid-tone palette). Either way the text colour on a
  block is computed for contrast, not fixed - a yellow subject gets dark text, a
  blue one light.
- A value typed into the *Farbe* field in the shift planner is not trusted as
  CSS: it has to be a hex colour to be used.
- The tile never scrolls inside itself: the core removed `overflow: auto` from
  `.widget__body` on purpose (Issue #166, nested scroll containers blank the
  screen on iOS and Android). It shows fewer rows instead - and says how many it
  left out, next to the day it left them out of.
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
building of the grid, which days count as school days (the normaliser, the
window built for the household's week start, the cycle positions read off the
anchor rather than the index, and what a hidden day still carries), the colour
chain (the hex grammar, listing the subjects of a plan, spreading one colour over
every row of a subject, resolving a lesson's colour in its three stages, and
falling back to the computed colour when the stored value is missing or
unusable), and how much of which school day the dashboard tile carries (the
budget from the tile's own height, the day line each day costs, the split
between today and tomorrow, an empty day that costs nothing, and the clock that
decides what still counts as today).
`school-planner.test.js` covers the delivery promises: every used translation key
present in both locales, the module accent in `theme.js` equal to the one in
`module.json`, every file the manifest names actually existing (a missing widget
entry makes the whole module load as errored), the widget's name agreeing with
itself in all four places it is written down, the four promises the colour rests
on - that the colour field is attached outside the overlay, that a colour is
attached to the period before it is written, that a missing colour field is
created rather than quietly skipped, and that the palette reaches the rendering
and the writing side alike - the school-day promises (that the two grids ask for
the shown days while the loader keeps the full week, that the choice is stored
per device and survives a reload, that the panel hides nothing silently, and that
the last day cannot be switched off) - and the tile: that it hands both days to
the one planner instead of capping them itself, that the count it left out is
the planner's number and sits in the day line, and that its arithmetic is
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
