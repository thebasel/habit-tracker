# Habit Tracker

POV: I turned my life into a game… — a dark, spreadsheet-style gamified habit dashboard.

Local-first single-page app (vanilla HTML/CSS/JS + Chart.js). No accounts, no backend. Data lives in `localStorage` with JSON export/import and clipboard backup handoff for phone ↔ desktop.

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
8. **Sync** → **Copy backup to clipboard** / **Paste backup** for quick handoff between devices (same site URL on phone and desktop).

Edit a habit via ✎ on its row; ▲▼ reorder; Delete confirms before removing.

## Offline & persistence

- After the first visit (while online so Chart.js/fonts load from CDN), the app shell is static files — core UI works offline if the browser has cached assets; charts need Chart.js from the CDN when not cached.
- **All habit data is stored in `localStorage`** under key `habit-tracker-v1` (per browser / origin / profile).
- Clearing site data, using a private window, or switching browsers wipes progress unless you Export or Copy backup first.
- GitHub Pages serves the static site; there is **no server-side database**.

## Sync between devices (Stage 2)

No new SaaS account required.

1. On device A, open the live URL → **Sync** → **Copy backup to clipboard** (or **Export** a `.json` file).
2. On device B, open the **same** live URL → **Sync** → **Paste backup** (or paste JSON into the box → **Apply pasted backup**), or **Import** the file.
3. Confirm the replace prompt. Data on B is overwritten with A’s backup.

Clipboard works best when both browsers allow paste; otherwise use the paste box or file Import/Export. Full cloud accounts / realtime sync are planned for **Stage 3**.

## Feature checklist (vs reference Reel)

| Reference | Status |
|-----------|--------|
| Title vibe / “My Habits” + emoji list | ✅ Seeded + editable |
| Dense checkbox grid, Week 1–5, Mo–Su + dates | ✅ Month-aware (28–31, leap years) |
| Daily Progress bar chart | ✅ Chart.js, live from checks |
| Weekly Progress bars | ✅ |
| Overall wellness (Mood + Sleep) | ✅ + mini trend chart |
| Analysis: Goal / Actual / Left / Progress % | ✅ |
| TOP 10 HABITS leaderboard | ✅ |
| Overall stats + circular ~% progress | ✅ Donut |
| Dark headers, light sheet cells, strong grid | ✅ |
| Streaks / daily·weekly score / level | ✅ Light gamification |
| Habit CRUD, schedule, enable, reorder | ✅ |
| localStorage + JSON import/export | ✅ (+ CSV completions) |
| Clipboard backup handoff (Sync) | ✅ Stage 2 |
| Public URL (GitHub Pages) | ✅ Stage 2 |
| Responsive (sticky col + horizontal scroll) | ✅ |

## Data model

```text
habits[{ id, name, emoji, category, schedule, startDate, endDate, enabled, order }]
completions[{ habitId, date, completed }]
wellness[{ date, mood, sleepHours }]
```

`schedule.type`: `everyday` | `weekdays` | `weekends` | `custom` (with `days: [0–6]`, Su=0).

Storage key: `habit-tracker-v1`.

## Console helpers

```js
HabitTracker.getState()
HabitTracker.exportJson()
HabitTracker.exportCsv()
HabitTracker.copyBackupToClipboard()
HabitTracker.reset()  // wipe localStorage + reload
```

## Known gaps / Stage 3

- No cloud auth or automatic multi-device sync (clipboard/file handoff only).
- No push reminders or notifications.
- CSV import is completions-only (not full habit definitions).
- Past incomplete days tint red as “miss”; future empty days stay neutral — intentional.
- Week numbering follows Mon–Sun blocks overlapping the calendar month (Week 1 may start mid-week).

## Stack

- Vanilla HTML / CSS / JS
- [Chart.js 4](https://www.chartjs.org/) via CDN
- Inter + JetBrains Mono fonts
- Hosted on [GitHub Pages](https://pages.github.com/)
