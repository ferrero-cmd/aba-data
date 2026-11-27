# ABA Data

A fast, offline iPhone web app (PWA) for BCBAs to take behavior data in schools: pick a client, start a
session, tap tiles to record, then email a formatted Excel file. Client profiles show ABA-style graphs
(phase-change lines, trend lines, ABC function summary).

- **No server, no accounts.** Everything is stored on the phone (IndexedDB). Data leaves only when the user
  emails an Excel file or saves a backup.
- **Initials only.** Clients are a first initial + school initial (e.g. `K · S`), optional short note.
- Plain HTML/CSS/JS ES modules, no build step. Only dependency: ExcelJS 4.4.0, vendored in `vendor/`.

## Data types

| Group | Types |
|---|---|
| Count & time | Frequency (rate + IRT), Duration, Latency |
| Interval | Partial interval, Whole interval, Momentary time sampling, PLACHECK (group), Interval rating (1–N) |
| Other | ABC (tap-chips), Compliance (complied / after prompt / did not), Direct Behavior Rating (AE / DB / RS, 0–10) |

A session runs several targets at once. Interval cue is a silent screen-edge flash. Pause excludes time from every measure.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js` | App shell, styles (light + dark), install manifest, offline cache |
| `js/app.js` | Router, client list, client profile, targets, session setup, settings |
| `js/session.js` | Live data collection tiles and the session summary |
| `js/summary.js` | Pure calculations (rates, %, IRT, intervals, DBR, raw tables) shared by everything |
| `js/export.js` | Excel workbook + share sheet / email |
| `js/graphs.js` | Phase 2 graphs |
| `js/db.js`, `js/model.js`, `js/ui.js` | Storage + backup/restore, data types and defaults, DOM helpers |
| `tests/` | `node --test tests/` |
| `docs/AMANDA.md` | One-page how-to for users |
| `docs/SHARING.md` | Publishing on GitHub Pages and installing on an iPhone |
| `docs/IDEAS.md` | Parked features and ideas for later |

## Develop

```bash
node --test tests/
```

Serve the folder with any static server (e.g. `npx serve .`) and open it. The service worker is skipped on
`localhost` so edits show up immediately; add `?sw` to the URL to test offline caching.

**Releasing a change:** bump `VERSION` in `sw.js` (and add any new file to `SHELL`). Installed apps show
"Update available — tap to reload".
