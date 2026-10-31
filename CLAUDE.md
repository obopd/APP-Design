# CLAUDE.md

Guidance for AI assistants (Claude Code and similar) working in this repository.

## What this is

**Planner** — a personal calendar / to-do / schedule app for one person (the
owner: film director, photographer, reader, college student). It is a
Progressive Web App (PWA) used on an **iPhone**, installed via Safari →
Share → Add to Home Screen.

The owner builds the app **from their phone** through Claude Code, with no
laptop. So:

- No build step, no npm, no bundler. Plain HTML/CSS/JS (ES modules) that runs as-is.
- Anything the owner must do by hand must be doable in a mobile browser, and
  explained step by step in plain language.
- The owner describes the design; build what they ask for, and check with
  them before inventing large features. Don't add sharing/multi-user features.

## Product requirements (from the owner)

- **Bottom bar** (icon-only, evenly spaced): Calendar · D-Day · **+** (small round
  add button; on the D-Day tab it adds a D-Day) · Settings. More tabs will be added later; a tab = a `.tab[data-view]` button in
  `index.html` + a `#view-<name>` container, switched by `view.tab` in `js/app.js`.
- The calendar is a **perfect square card** (always 6 week rows) with space on
  all sides, "Month Year" **centered** between ‹ › arrows. There is no date
  heading above the day view (the owner found it redundant).
- **No date selected → only the calendar is on screen, centered** vertically and
  horizontally. Tapping a date slides the card to the top, **rolls the month up into
  that date's week**, and the space below shows that day in **two columns**:
  to-do list on the left, hourly schedule timeline on the right. Tapping the
  selected date again, the month name, or swiping down returns to the month.
- Design: **minimalist** — modern, clean, intuitive, small sizes, as few words as
  possible (prefer icons/symbols over labels). **Default colors are black & white**;
  the user can change the accent color and light/dark mode in Settings.
- Typography: headings, dates and numbers use **Fraunces** (semi-bold, upright —
  **no italics**, the owner rejected them) via the `.display` class / `--display`
  variable; small UI text uses the system sans-serif.
- Adding items: the small round + in the bottom bar. Tapping an empty hour in the
  timeline also adds an event there.
- **To-do folders (categories)**, nestable like computer folders (Academic →
  Biology, Chemistry). New folders start open; each folder's open/closed state is
  saved (`category.open`) and must survive closing/reopening the tab or app.
  A folder shows in a day only if it contains that day's to-dos. Managed in
  Settings (rename, add sub-folder, delete) or via "New…" in the editor;
  "Academic/Biology" creates nested folders. Folder names use the same font as
  the to-dos (one unified font in the list) and have an underline whose color is
  chosen when the folder is created (`category.color`, sheet in `js/folders.js`;
  editable from Settings by tapping the folder name).
- **Done mark**: in front of each to-do is a thin *vertical* line with rounded
  ends (`.dash`, not a circle) — gray when open, solid black/accent when done. Tapping it toggles done;
  done to-dos get a plain `line-through` and gray text (the owner rejected the
  hand-drawn pencil stroke). Tapping the text opens the editor. The mark is
  letter (cap) height and sits close to the text.
- **Stretchable columns**: a divider with a grip sits between to-do and schedule.
  Dragging it to an edge stretches one side to full width (a to-do or schedule
  "tab"); dragging back (or a sideways swipe on the lists) returns to the split.
  Layout state lives in `js/day.js` (`layout`: split | todo | schedule) and is kept
  while changing days. With the schedule full width, + starts on "Event".
- **Routines**: to-dos and events can repeat daily, weekly, every 2 weeks,
  monthly or yearly, with an optional "Until" date. Routine to-dos are checked
  off per day (`doneOn`). Routines only get a calendar dot when starred.
  In the to-do column, **routines have their own section on top ("Routines") and
  regular to-dos sit below ("To-do")**; each section has its own folder tree
  (folder open/closed state is shared). The two must look clearly distinct:
  Routines sit in a shaded rounded box (`.todo-section.routines`), To-do below on
  the plain page; both have display-font headings with an open-item count.
  Headings only show when routines exist.
- **D-Day tab** (`js/dday.js`): countdowns for birthdays, graduation, etc. Each row
  shows title, date (+ ↻ and "58th" for yearly ones) and a big "D-12" / "D-Day" /
  "D+30". Upcoming sorted soonest first; past one-off dates count up under "Since".
  Yearly entries roll to the next occurrence (`ddayTarget`). Tap a row to edit/delete.
- **Tracking (opt-in per to-do)**: editor "Track" = Off | Count | Time. Only tracked
  to-dos show a number pill: Count → tap to enter a number; Time → tap to type
  minutes/h:mm, plus a ▶/■ stopwatch (stored as a start timestamp, so it keeps
  running while the app is closed; ticks via `tickTimers()` every second).
  Values are per occurrence (`values[dateKey]`). "Times done" only increases by
  checking off (routines: once per day). If a day has tracked routines, tapping the
  "Routines" heading reveals per-routine stats: times done so far + total recorded.
- **Important reminders** (e.g. a parent's birthday): items marked Important ★ get
  an accent-colored dot on the calendar and are counted in the home-screen icon badge.
- **Alerts** at schedule times via notifications.
- Chosen approach: *simple web app*. Known limits on iPhone (tell the owner,
  don't hide them): notifications need iOS 16.4+ and the app on the Home Screen;
  a web app can't schedule notifications in advance, so alerts only fire while
  the app is open or recently used; no home-screen widgets. Upgrading later
  means a push server or a native (Expo/React Native) app.

## Codebase structure

```
index.html             Shell: calendar / D-Day / settings views, bottom bar, toast, sheets (editor, folder, D-Day)
styles.css             All styles. Theme via CSS variables; html[data-theme] light/dark, html[data-accent].
                       Square card size comes from --cal-w / --cell; .month-mode/.week-mode drive layout
fonts/                 Fraunces variable font (latin, upright woff2) + OFL.txt license
manifest.webmanifest   PWA manifest
sw.js                  Service worker: offline cache (network-first) + notification click
js/app.js              Entry point: view state (tab, month, selected day), actions, render(), tabs, swipes
js/util.js             h() DOM helper, inline SVG icons, date helpers (local 'YYYY-MM-DD' keys)
js/store.js            State + localStorage, change listeners, routines (occursOn, isDone), queries, folder helpers
js/calendar.js         Square month card (6 rows); rows collapse to the selected week (animated)
js/day.js              Day view: to-do folders (mark = done, text = edit) + hourly timeline, stretchable split
js/editor.js           Bottom sheet to add/edit a to-do or event (folder, repeat/until, alert)
js/folders.js          Bottom sheet to create/edit a folder: name + underline color
js/dday.js             D-Day tab (countdown list) + its add/edit sheet
js/settings.js         Settings tab: theme, accent color, folders, alerts, backup export/restore
js/reminders.js        Alert timers, notifications, in-app toast, app icon badge
icons/                 icon.svg (source) + 180/192/512 PNGs rendered from it
docs/                  Screenshots of the app
```

## Data model (`js/store.js`)

Stored in `localStorage` under `planner.v1`:

```js
{
  todos:  [{ id, title, date: 'YYYY-MM-DD', important, notes, category: id | null,
             repeat, until, done /* one-off */, doneOn: { 'YYYY-MM-DD': true } /* routines */ }],
  events: [{ id, title, date, allDay, start: 'HH:MM', end: 'HH:MM', repeat, until,
             alert: 'none' | '<minutes before>', important, notes }],
  // todos also: track: 'none' | 'count' | 'time', values: { dateKey: number /* count or seconds */ },
  //             timer: { key: dateKey, start: epochMs } | null
  categories: [{ id, name, parent: id | null, open, color: css color | null }],
  ddays: [{ id, title, date, yearly }],
  settings: { theme: 'auto' | 'light' | 'dark', accent: 'mono' | 'blue' | 'red' | 'green' | 'orange' | 'purple' }
}
// repeat: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'; until: '' = forever
```

- Dates are **local** date keys (`dateKey()`), never UTC ISO strings.
- `date` is the first occurrence; `occursOn(item, key)` decides repeats. Monthly/yearly
  starting on e.g. the 31st fall on the last day of shorter months.
- Use `isDone(todo, key)` / `toggleDone(todo, key)`, never `todo.done` directly.
- Deleting a folder moves its sub-folders and to-dos up one level (`deleteCategory`).
- All-day alerts fire at 9:00 AM minus the alert offset.
- Changing the shape: bump the key and migrate old data in `load()`. Never drop user data.
- Mutate `state`, then call `save()`; `save()` notifies listeners, and `app.js` re-renders.

## Conventions

- Vanilla JS ES modules, `'use strict'` implicit, 2-space indent, single quotes, semicolons.
- Build DOM with `h(tag, props, ...children)`; put user text in via text nodes only.
  `innerHTML` is only for the static SVG strings in `ICONS`.
- No dependencies or CDN scripts (they break offline use). Fonts are self-hosted
  in `fonts/`; npm (`registry.npmjs.org`, e.g. `@fontsource-variable/*`) is reachable
  from cloud sessions for fetching font files, GitHub raw downloads are not.
- Colors only through CSS variables (`--bg --fg --muted --line --soft --accent --on-accent`);
  new accents need a `:root[data-accent=…]` rule in `styles.css` and an entry in `ACCENTS`/`SWATCH` in `settings.js`.
- Mobile first: touch targets ≥ 40px, respect `env(safe-area-inset-*)`, check light + dark.
- `HOUR_PX` in `js/day.js` must match `--hour` in `styles.css`.
- Comments only where the *why* isn't obvious.

## Development workflow

| Task          | Command / method |
| ------------- | ---------------- |
| Install deps  | None             |
| Run locally   | `python3 -m http.server 8765` from repo root, open http://localhost:8765/ |
| Build         | None (static files) |
| Test          | Manual + Playwright script (below); no automated suite yet |
| Lint / format | None configured  |

ES modules and service workers need `http://localhost` or HTTPS; opening
`index.html` as a file won't work.

Verify every UI change in a phone-sized browser with Playwright (pre-installed
in cloud sessions; `require('playwright')` works — don't reinstall). Use
`devices['iPhone 13']`, add items through the UI, tap a date to check the
week roll-up and two-column day view, reload to confirm persistence, check
dark mode, collect `pageerror` events, and look at screenshots.

Icons: edit `icons/icon.svg`, then render it to 180/192/512 px PNGs with
Playwright (`page.setContent` + `page.screenshot`).

## Deployment

GitHub Pages serving the repo root (all paths are relative, so it works under
`/APP-Design/`): repo Settings → Pages → Deploy from a branch → branch, `/ (root)`.

**When you change any file the app loads, bump `CACHE` in `sw.js`**
(currently `planner-v11`; bump to `planner-v12`, …) and keep its `ASSETS` list in sync
with every file in `js/` and `fonts/`, otherwise installed phones keep stale files.

## Git conventions

- Work on the designated feature branch; don't push to other branches without permission.
- Clear, imperative commit messages; keep commits focused.
- Push with `git push -u origin <branch-name>`.
- Don't open pull requests unless the user asks.

## Keeping this file current

Update CLAUDE.md in the same change when you add files or tabs, change the
data shape, add tooling/tests, or change deployment. Only document what
actually exists in the repo.
