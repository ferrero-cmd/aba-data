# Parked ideas

Features that were built, then removed to keep the app simple. Kept here so they can come back.

## Period / activity tagging + scatterplot (removed in v1.1)

**What it did**
- Settings had a "Periods / activities" list (one per line). Defaults:
  Arrival, Morning meeting, Math, ELA, Science, Social studies, Specials, Lunch, Recess, Transition,
  Small group, Independent work, Dismissal.
- The *Start session* sheet let you optionally pick the starting period.
- During a live session a horizontally scrolling row of chips sat under the clock. Tapping one logged
  `{ e, t, name }` to `session.periodLog` (undoable), and every later event was stamped with `p` = that period.
- Raw Excel sheets had a "Period" column; the Summary sheet listed "Periods / activities"; the session
  summary showed the periods after the observed time; the DBR sheet title showed the current period.
- Graphs tab: **Scatterplot by period** — a period × weekday (Mon–Fri) heat grid per target
  (frequency/ABC/non-compliance = events per hour of observation in that cell; duration = % of observed time),
  6-step blue sequential scale, hatched = not observed. Shown only when some session had a period log.

**Why it was parked**: extra taps during sessions that weren't being used.

**How to bring it back**: the full implementation is in commit `cf0fc39` (the initial version). Look at
`periodAt`, `periodExposure`, `eventsByPeriod`, `supportsScatter` in `js/summary.js`, `renderPeriods`
in `js/session.js`, `scatterCard` in `js/graphs.js`, `.period-row` / `.heat*` in `styles.css`, and the
start-sheet / settings code in `js/app.js`. Settings saved on phones still hold the user's `periods`
list, and old sessions still carry `periodLog` and per-event `p`, so restored code would pick that data
straight back up.

**Ideas if it returns**
- Make it opt-in per client (a toggle on the client) so the chip row only appears where it's wanted.
- Auto-switch periods from a per-client daily schedule instead of tapping.
