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

- **One bottom tab for now** ("Calendar"); more tabs will be added later, so
  keep the tab bar (`nav.tabbar` in `index.html`) ready for more buttons.
- The tab shows a **month calendar**. Tapping a date **rolls the month up into
  that date's week**, and the space below shows that day in **two columns**:
  to-do list on the left, hourly schedule timeline on the right.
- Design: very modern, clean, intuitive. **Default colors are black & white**;
  the user can change the accent color and light/dark mode in Settings.
- **Important reminders** (e.g. a parent's birthday): items marked Important ★
  appear in "Coming up" (month view) and are counted in the home-screen icon badge.
- **Alerts** at schedule times via notifications.
- Chosen approach: *simple web app*. Known limits on iPhone (tell the owner,
  don't hide them): notifications need iOS 16.4+ and the app on the Home Screen;
  a web app can't schedule notifications in advance, so alerts only fire while
  the app is open or recently used; no home-screen widgets. Upgrading later
  means a push server or a native (Expo/React Native) app.

## Codebase structure

```
index.html             Shell: calendar section, panel, FAB (+), tab bar, toast, two <dialog> sheets
styles.css             All styles. Theme via CSS variables; html[data-theme] light/dark, html[data-accent]
manifest.webmanifest   PWA manifest
sw.js                  Service worker: offline cache (network-first) + notification click
js/app.js              Entry point: view state, actions, render(), swipe gestures, wiring
js/util.js             h() DOM helper, inline SVG icons, date helpers (local 'YYYY-MM-DD' keys)
js/store.js            State + localStorage persistence, change listeners, queries (eventsOn, todosOn, upcomingImportant)
js/calendar.js         Month grid; rows collapse to the selected week (animated)
js/day.js              Day view (to-do column + hourly timeline) and "Coming up" list
js/editor.js           Bottom sheet to add/edit a to-do or schedule item
js/settings.js         Settings sheet: theme, accent color, notifications, backup export/restore
js/reminders.js        Alert timers, notifications, in-app toast, app icon badge
icons/                 icon.svg (source) + 180/192/512 PNGs rendered from it
docs/                  Screenshots of the app
```

## Data model (`js/store.js`)

Stored in `localStorage` under `planner.v1`:

```js
{
  todos:  [{ id, title, date: 'YYYY-MM-DD', important, done, notes }],
  events: [{ id, title, date, allDay, start: 'HH:MM', end: 'HH:MM',
             repeat: 'none' | 'yearly', alert: 'none' | '<minutes before>',
             important, notes }],
  settings: { theme: 'auto' | 'light' | 'dark', accent: 'mono' | 'blue' | 'red' | 'green' | 'orange' | 'purple' }
}
```

- Dates are **local** date keys (`dateKey()`), never UTC ISO strings.
- Yearly events (birthdays) match on month-day from their start date (`occursOn`).
- All-day alerts fire at 9:00 AM minus the alert offset.
- Changing the shape: bump the key and migrate old data in `load()`. Never drop user data.
- Mutate `state`, then call `save()`; `save()` notifies listeners, and `app.js` re-renders.

## Conventions

- Vanilla JS ES modules, `'use strict'` implicit, 2-space indent, single quotes, semicolons.
- Build DOM with `h(tag, props, ...children)`; put user text in via text nodes only.
  `innerHTML` is only for the static SVG strings in `ICONS`.
- No dependencies or CDN scripts (they break offline use).
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
(`planner-v1` → `planner-v2`) and keep its `ASSETS` list in sync with every
file in `js/`, otherwise installed phones keep stale files.

## Git conventions

- Work on the designated feature branch; don't push to other branches without permission.
- Clear, imperative commit messages; keep commits focused.
- Push with `git push -u origin <branch-name>`.
- Don't open pull requests unless the user asks.

## Keeping this file current

Update CLAUDE.md in the same change when you add files or tabs, change the
data shape, add tooling/tests, or change deployment. Only document what
actually exists in the repo.
