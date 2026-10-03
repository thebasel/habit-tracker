# Habit Tracker

POV: I turned my life into a game… — a dark, spreadsheet-style gamified habit dashboard.

Local-first single-page app (vanilla HTML/CSS/JS + Chart.js). No accounts. Data lives in `localStorage`, with optional automatic multi-device sync (a Sync code) plus JSON export/import and clipboard backup.

## Live demo

**https://thebasel.github.io/habit-tracker/**

Repo: https://github.com/thebasel/habit-tracker

## Open locally

```bash
cd habit-tracker
python3 -m http.server 8765
```

Then open **http://localhost:8765**. Or open `index.html` directly (`file://` works; Chart.js still loads from CDN when online).

## Create habits → Start tracking

1. The app seeds **10 starter habits** (Wake up at 05:00, Gym, Reading / Learning, … Cold Shower) so the dashboard is demo-ready.
2. Use **+ Habit** to add more. Set emoji, name, category, schedule (every day / weekdays / weekends / custom weekdays), optional start/end dates, and enable/disable.
3. Click checkboxes in the grid for each day. Sticky habit names + sticky headers; **Week 1–5** labels with Mo–Su and dates.
4. Navigate months with **◀ ▶** or jump with **Today**.
5. Log **Mood** (1–5) and **Hours of Sleep** (e.g. 7.5) under **Overall wellness**.
6. Watch live updates: Daily Progress bars, Weekly Progress, overall donut, Habit Analysis (Goal / Actual / Left / %), and **TOP 10 HABITS**.
7. **Export** downloads JSON (Shift+click Export → completions CSV). **Import** restores a JSON backup (or simple completions CSV).
8. A **Sync code** is created automatically and shown in the header. On another device, **Sync** → paste that code → **Join**. Checks, habits, and wellness stay aligned automatically. Clipboard backup and Export/Import remain as a fallback.

Edit a habit via ✎ on its row; ▲▼ reorder; Delete confirms before removing.

## Offline & persistence

- After the first visit (while online so Chart.js/fonts load from CDN), the app shell is static files — core UI works offline if the browser has cached assets; charts need Chart.js from the CDN when not cached.
- **Habit data is stored in `localStorage`** under key `habit-tracker-v1` (per browser / origin / profile). Sync settings are in `habit-tracker-sync-v1`.
- The app works with no network. If a Sync code is linked, it pushes and pulls again when you are back online.
- Clearing site data wipes this browser unless you Export, copy a backup, or still have the Sync code on another device.
- GitHub Pages only serves the static site. Remote state is a public [Telegraph](https://telegra.ph) page (no API key in this repo).

## Sync between devices

No signup. On first load, if this browser has no Sync code yet, the app creates one (your existing habits stay in `localStorage`) and shows the code in the header. The badge turns green **Synced** after the remote save succeeds. If create or upload fails, the badge shows a red **Sync error** plus the reason.

1. On device A, open the live URL. The header shows the code (it looks like `ht-ab12cd34-10-03`) once **Synced** is green. Copy it.
2. On device B, open the same URL → **Sync** → paste the code → **Join**. Join replaces this browser’s code. If this browser has no newer edits, the other device’s habits are kept.
3. After that, each change is saved locally and uploaded about 800ms later. Each open, window focus, and every ~15s, the app downloads the remote copy.
4. Merge rule: the payload’s `updatedAt` wins. If the remote copy is newer, it replaces this device and the page re-renders. If this device is newer, it uploads. Same timestamp: do nothing.
5. **Stop syncing on this device** forgets the code locally. The other device keeps working. Export / Import and clipboard paste still work and, if the JSON includes sync info, re-link the device.

The code is the secret. Anyone who has it can read and change that tracker. The page is stored on telegra.ph, not on GitHub. There is no per-field merge: if two devices both edit while offline, the older `updatedAt` is discarded entirely.

## Feature checklist (vs reference Reel)

| Reference | Status |
|-----------|--------|
| Title vibe / “My Habits” + emoji list | ✅ Seeded + editable |
| Dense checkbox grid, Week 1–5, Mo–Su + dates | ✅ Month-aware (28–31, leap years) |
| Daily Progress bar chart | ✅ Chart.js, live from checks |
| Weekly Progress bars | ✅ |
| Overall wellness (Mood + Sleep) | ✅ Rows in the sheet plus the form and mini chart |
| Analysis: Goal / Actual / Left / Progress % | ✅ |
| TOP 10 HABITS leaderboard | ✅ |
| Overall stats + circular ~% progress | ✅ Donut |
| Dark headers, light sheet cells, strong grid | ✅ |
| Streaks / daily·weekly score / level | ✅ Light gamification |
| Habit CRUD, schedule, enable, reorder | ✅ |
| localStorage + JSON import/export | ✅ (+ CSV completions) |
| Clipboard backup handoff | ✅ Fallback inside Sync |
| Automatic multi-device sync (Sync code) | ✅ telegra.ph, no API key |
| Public URL (GitHub Pages) | ✅ |
| Responsive (sticky col + horizontal scroll) | ✅ |

## Data model

```text
habits[{ id, name, emoji, category, schedule, startDate, endDate, enabled, order }]
completions[{ habitId, date, completed }]
wellness[{ date, mood, sleepHours }]
updatedAt
```

`schedule.type`: `everyday` | `weekdays` | `weekends` | `custom` (with `days: [0–6]`, Su=0).

Storage key: `habit-tracker-v1`. Sync link (not the habit rows): `habit-tracker-sync-v1`.

## Console helpers

```js
HabitTracker.getState()
HabitTracker.exportJson()
HabitTracker.exportCsv()
HabitTracker.copyBackupToClipboard()
HabitTracker.createSyncCode()
HabitTracker.joinSyncCode("ht-...")
HabitTracker.getSyncCode()
HabitTracker.pull()
HabitTracker.reset()  // wipe localStorage + reload
```

## Known gaps

- No push reminders or notifications.
- Sync is last-write-wins on the whole document, not per habit or per day.
- Remote pages are unlisted but not encrypted. A leaked Sync code is full read/write access. Very large histories can hit Telegraph’s page size limit.
- CSV import is completions-only (not full habit definitions).
- Past incomplete days tint red as “miss”; future empty days stay neutral — intentional.
- Week numbering follows Mon–Sun blocks overlapping the calendar month (Week 1 may start mid-week).

## Stack

- Vanilla HTML / CSS / JS
- [Chart.js 4](https://www.chartjs.org/) via CDN
- Inter + JetBrains Mono fonts
- Hosted on [GitHub Pages](https://pages.github.com/)
