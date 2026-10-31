# CLAUDE.md

Guidance for AI assistants (Claude Code and similar) working in this repository.

## What this is

**Habits** — a mobile-first daily habit tracker built as a Progressive Web App
(PWA). Users open it in their phone's browser and "Add to Home Screen" to get an
app icon that launches full-screen and works offline.

The owner builds and manages the project **from a phone** (via Claude Code in
the Claude app), with no laptop. Keep that in mind:

- No build step, no npm, no bundler. Plain HTML/CSS/JS that runs as-is.
- Anything the owner must do by hand should be doable in a mobile browser
  (e.g. GitHub settings), and explained in plain, step-by-step language.

## Codebase structure

```
index.html             Single page: header, habit list, add button, add/edit <dialog>
styles.css             All styling; CSS variables in :root, dark mode via prefers-color-scheme
app.js                 All app logic: state, localStorage persistence, rendering, events
sw.js                  Service worker: offline cache (network-first, cache fallback)
manifest.webmanifest   PWA manifest (name, icons, standalone display, theme color)
icons/icon.svg         Source icon; the PNGs are rendered from it
icons/icon-{180,192,512}.png   Apple touch icon + manifest icons
docs/screenshot.png    Phone-sized screenshot of the app
```

## How the app works

- **State** (`app.js`): `{ habits: [{ id, name, emoji, done: { 'YYYY-MM-DD': true } }] }`,
  stored in `localStorage` under key `habits.v1`. If you change the shape,
  bump the key and migrate old data in `load()` — never silently drop user data.
- **Dates** use the phone's *local* date (`dayKey()`), not UTC.
- **Streak** = consecutive done days ending today, or ending yesterday if today
  isn't checked yet.
- **Rendering**: `render()` rebuilds the list from state with DOM APIs
  (`createElement` / `textContent`). Don't use `innerHTML` with user text.
- Data lives only on the device; there is no backend or account system.

## Development workflow

Run locally (from repo root):

```sh
python3 -m http.server 8765   # then open http://localhost:8765/
```

Service workers need `http://localhost` or HTTPS; opening `index.html` as a
file won't register it.

Verify changes in a phone-sized browser with Playwright (pre-installed in
cloud sessions; `require('playwright')` works, don't reinstall it):
use `devices['iPhone 13']`, exercise add/edit/check, reload to confirm
persistence, collect `pageerror`/console errors, and screenshot the result.
There is no automated test suite yet.

Regenerating icons after editing `icons/icon.svg`: render the SVG at 180, 192
and 512 px with Playwright (`page.setContent` + `page.screenshot`) and
overwrite the PNGs.

## Deployment

Intended host is **GitHub Pages** serving the repo root (all paths are
relative, so it works under `/<repo-name>/`). Enable via repo
Settings → Pages → Deploy from a branch → pick the branch, folder `/ (root)`.

**When you change any cached file, bump `CACHE` in `sw.js`** (e.g.
`habits-v1` → `habits-v2`) and keep its `ASSETS` list in sync with the files
the app loads. Otherwise installed phones may keep stale files.

## Conventions

- Vanilla JS, `'use strict'`, 2-space indent, single quotes, semicolons.
- Keep it dependency-free; no CDN scripts (they break offline use).
- Mobile first: touch targets ≥ 44px, respect `env(safe-area-inset-*)`,
  test light and dark mode.
- Use CSS variables in `:root` for colors; add dark values in the media query.
- Accessibility: buttons for interactive things, `aria-label`/`aria-pressed`
  where text isn't enough.
- Comments only where the *why* isn't obvious.

## Git conventions

- Work on a feature branch; don't push to the default branch without permission.
- Clear, imperative commit messages; keep commits focused.
- Push with `git push -u origin <branch-name>`.
- Don't open pull requests unless the user asks.

## Keeping this file current

Update CLAUDE.md in the same change when you add files, change the data
shape, add tooling/tests, or change deployment. Only document what actually
exists in the repo.
