# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

**Planner**: a personal calendar / to-do / schedule PWA for **iPhone** (Safari → Share → Add
to Home Screen). The owner (film director, photographer, reader, college student) builds it
**from their phone** through Claude Code, with no laptop. So:

- No build step, no npm, no bundler: plain HTML/CSS/JS ES modules that run as-is.
- Anything the owner does by hand (Supabase dashboard, SQL) must work in a mobile browser,
  explained step by step in plain language, as **one copy-paste block** where possible.
- Build what the owner describes; check with them before inventing large features.
- **Anyone with the link may create an account.** Accounts are private; the only ways
  another user sees anything are explicit per-item sharing with an accepted friend and film
  project collaboration. Never add any other way to reach someone else's data, and never
  weaken RLS.

## Design rules (from the owner)

- **Minimalist**: clean, small sizes, few words, icons over labels. Default colors black &
  white; accent color and light/dark are chosen in Settings. Check light + dark.
- **Fonts**: headings, dates, numbers in **Fraunces** (semi-bold, upright, never italic)
  via `.display` / `--display`; small UI text in the system sans-serif.
- **Never iPhone system pop-ups**: no `confirm` / `alert` / `prompt`, no native `<select>`.
  Use `ask` / `tell` / `askText` / `askDate` / `pick` / `pickMany` / `selectButton` /
  `snack` from `js/ui.js` (red button for deletes). Forms use `novalidate`.
- **Opening any sheet or card must not focus a text field** (no keyboard until tapped).
- **No haptics** (removed at the owner's request).
- **No text selection** (no blue highlight) anywhere except chat messages (`.bubble`) and
  fields you type in: `body` has `user-select: none`, inputs / textareas opt back in.
- Animations only animate `transform` / `opacity` (FLIP), never layout. Measure with CDP
  4× CPU throttling and rAF frame times. Sheets (`js/motion.js`) slide away on close, fade
  their backdrop and can be dragged down by the grabber / header; tabs fade in
  (`.view-enter`); buttons give a small press scale; all respect `prefers-reduced-motion`.
- Dark mode: sheets sit on a raised surface (`--bg #1c1c1e`, fields `#2c2c2e`); the selected
  segment is a lighter pill. Small controls get invisible enlarged tap areas (`::after`).
- **Dock**: floating rounded bar like the iPhone dock (52px, radius 26px, frosted, icons
  only, no +). Normal: Calendar · D-Day · Chat · Settings. Film mode: Calendar · Write ·
  Organize · Preview · Chat · Settings. A tab = `.tab[data-view]` in `index.html` + a
  `#view-<name>` container, switched by `view.tab` in `js/app.js`. Adding happens with +
  next to section headings and by tapping an empty hour.

## Features

**Calendar** (`js/calendar.js`, `js/app.js`): a perfect square card (always 6 rows),
"Month Year" centered between ‹ ›; Sundays red, Saturdays blue (`--sun` / `--sat`). The
app icon (`#brand`) is at the top; search (`#search-btn`) top-left, bell (`#bell`)
top-right. No date selected → only the calendar, centered (`.has-dday` shifts it when
today's D-Days show above; film mode shows the project name there, 1:1). Tapping a date
rolls the month up into that week (FLIP: `render()` measures, switches layout, `flip()`
animates; `.cal-rows-inner` slides under a `clip-path`; `--dur` .65s open, `.closing`
.75s back) and shows the day in two columns: to-dos left, hourly timeline right
(`HOUR_PX` in day.js = `--hour` in CSS). Tap the date / month name or swipe down to go back.
Intl formatters are cached (`fmt()` in util.js).

**Expanded calendar** (grid button right of the month name): 1st tap = this week as 7
rows, 2nd = taller month grid (3 chips/day, else 2 + "+n"), 3rd = back. Shows all events
and to-dos with a due date (chips `.chip-ev` / `.chip-due`; `.event` is the timeline
block). Swipes / ‹ › move by week or month; a day opens its normal view and going back
returns to the same form. Last form saved in `planner.expand`. Motion: `growExpanded` /
`leaveExpanded` / `swapExpanded`, outline `#x-frame` (the only size animation: an empty
box), `resetExpandedMotion` for rapid taps.

**Day view** (`js/day.js`): "Routines" section on top (shaded box) and "To-do" below,
both always shown, same indents, each with its folder tree, display-font heading, open
count and + (folder-plus icon left of it). Done mark = slim vertical dash (`.dash`) in a
30×36 tap area; done = gray line-through. Tapping the text opens the editor. A divider
stretches either column to full width (`layout`: split | todo | schedule, kept across days);
sideways swipe on empty list space returns to split. Swipe a to-do left = **postpone**
(Tmrw / Date, Undo snack; routines move only that day via `skipOn`).

**To-dos & events** (`js/editor.js`): repeat daily / weekly / every 2 weeks / monthly /
yearly with optional Until; routine to-dos checked off per day (`doneOn`). **Due date**
(one-off only): an unfinished to-do moves to today daily and is starred from its due day —
computed (`todoDate`, `isStarred`, `hasDue`), never written on open; shows "D-3" tags.
**Tracking** (optional): Count or Time (stopwatch stored as a start timestamp,
`values[dateKey]`); tapping "Routines" shows per-routine stats. **Important ★** = accent
dot + home-screen badge. **Folders** nest ("Academic/Biology"); open/closed saved in
`category.open`; underline color from 20 `FOLDER_COLORS` (`js/folders.js`); a folder shows
in a day only if it has that day's to-dos; Settings lists them (rename/recolor/sub-folder/
delete), hidden when there are none.

**D-Day** (`js/dday.js`): countdowns ("D-12" / "D-Day" / "D+30"), yearly ones roll over
(`ddayTarget`). On the day itself they show above the calendar as a swipeable row with
custom pointer handling (not scroll-snap: iOS mis-centered it); `place()` re-centers after
fonts load and on resize.

**Accounts & sync** (`js/cloud.js`, `js/account.js`, `supabase/setup.sql`): email +
password; a minimal login page gates the app (`body.gated`). Supabase REST via `fetch` (no
SDK), 12s timeout; tokens in `planner.auth`; email links handled by `handleAuthRedirect()`;
auth errors mapped by `error_code` in `friendly()`. Local-first: state in `planner.v1`,
whole state = one `planner_data` row per user (RLS own row). Push ~1.5s after edits, pull
on open / foreground / online. If both sides changed, `mergeStates` does a **three-way
merge** against the last synced copy (`planner.syncbase`): items by id, field by field;
deletes apply unless edited elsewhere; same-field conflicts → newer edit. Writes are
conditional on `updated_at` (re-merge up to 3×). A restored backup (`meta.replacedAt`)
overwrites instead. First sign-in with data on both sides asks which to keep. **Sign-out**
syncs, warns about unsynced edits, removes this phone's push subscription, then clears the
planner and per-user caches. If localStorage is full, `storeItem` clears re-downloadable
caches (`DISPOSABLE` in store.js) and retries; `save()` warns once if it still fails.
**Weekly backups** (maintenance.sql): nightly job keeps 5 copies per person
(`planner_backups`, read own only); Settings → "Weekly copies · Restore…".

**Friends & sharing** (`js/social.js`, `js/people.js`, `supabase/social.sql`): unique **ID**
(`profiles.handle`, a–z 0–9 _ . 3–20) only for finding friends; **Name**
(`profiles.nickname`) is what everyone sees (`displayName(id)`, `loadProfiles(ids)`).
Friend requests must be accepted. Settings friends list folds (`planner.friendsopen`).
Bell sheet: requests, accepts, shares, check-offs. Sharing per to-do / event / folder
(`sharedWith`); `publishShares()` keeps one `shares` row per item+friend; friends see them
dashed ("Shared" section / timeline), read-only, and can check off shared to-dos
(`share_checks`, applied by the owner's app). Refresh on open, foreground, every 60s, bell.
Missing tables (PGRST205) → bell/Share hidden, "Not set up yet".

**Chat** (`js/chat.js`, `js/chatview.js`, `js/live.js`, `supabase/chat.sql`): personal and
group chats, text 1–1000 chars, hold your own message to delete. Opening slides in from the
right (420ms, cubic-bezier(.32,.72,0,1)); ‹ or **swipe right** (`swipeBack`) goes back; the
open chat is a full page and the dock fades (`body.chatting`). Sending keeps the keyboard
up; swiping down on messages folds it. While typing in page fields the dock fades
(`body.typing`); don't re-pin layouts to the visual viewport (it fought iOS scrolling);
bottom padding eases to 0 and messages stack from the bottom. Unread = after
`chat_members.last_read`. **Instant**: a Realtime WebSocket (`live.js`, Phoenix protocol,
joined once the `system` reply confirms) nudges fetches; polling is the fallback (3s / 9s,
or 15s / 45s while live). Cache `planner.chat` (last 200 per chat). Messages older than a
year are deleted nightly.

**Push notifications** (`js/push.js`, `supabase/push.sql`, Edge Function
`supabase/functions/push/index.ts`): Settings → Alerts "Turn on" (needs a tap) subscribes
this phone (`VAPID_PUBLIC_KEY` in config.js, read via `import * as config`;
`save_push_subscription` RPC; local `planner.push`). The app uploads personal alerts for the
next **30 days** (`replace_push_alerts`, on open and on change; film project alerts stay
local). DB triggers push chat messages, friend requests/accepts, first shares and project
invites; pg_cron sends due alerts each minute (skipped if >30 min late). The function is
called only by the database with `x-push-secret` (Vault) and gets the VAPID keys from
`push_settings(secret)`; it forgets endpoints answering 404/410. The service worker always
shows a notification; tapping opens its tab (`view`). With push on, local alerts show only
the in-app toast. Limits: iOS 16.4+, app on the Home Screen.

**Search** (`js/search.js`): card from the top; searches to-dos, events, D-Days, cached
chats and (film mode) writing; results go to the day, chat, D-Day tab or Write section.

**Film Production Mode** (`js/film.js`, `js/filmui.js`, `supabase/film.sql`): **press and
hold the logo** ~0.9s → `html.film`, the logo becomes a clapperboard (CSS only); saved per
device (`planner.film`). The switch animation lives in `js/cinema.js` (`playFilmSwitch`): `FILM_TRANSITION`
= **`'dissolve'`** (the owner's choice, 1.4s): the page eases back and fades out, the logo
tile (`.fx-mark`, a copy of `#brand`'s art, 76px) fades into the empty middle — entering, the
slate's arm softly claps shut; leaving, the calendar icon — and the new mode fades in from
slightly closer; the switch happens at 560ms while the page is invisible. The other
candidates (`dip`, `letterbox`, `leak`, `focus`, `flip` = logo flip only) stay in the file;
reduced motion = instant. The owner rejected a dramatic clapperboard show (too much). **Film look** (styles.css "Film mode's own look"): `:root.film` swaps the
palette — light = "script paper" (warm off-white `#f6f1e8`, ink text), dark = "screening
room" (warm black `#0d0c0a`, cream text) — with a tungsten-amber accent over the chosen
accent, warm sheets in dark, film-strip sprocket holes down both edges of the month card
(`--perf`, month mode only), and the status bar color follows `--bg` (`applyTheme`). **Backgrounds** (`html[data-filmbg]`, set from `FILM_BACKGROUND` in
filmui.js; offered: `grain` still grain + vignette — the owner's choice; also `glow`
projector beam, `grade` teal/orange, `darkroom` red safelight): a fixed, still `body::before` layer; in film
mode cards use `--card` with a soft shadow, pinned headers / script bar / composer are
frosted `--glass`, to-do rows are transparent (swipe actions only show while swiping,
`:has`), timeline hour labels have no fill. The project name chip / clapperboard opens the projects card (New /
Invite / Rename / Delete or Leave / Exit). The calendar, editor, folders and expanded grid
then show **only the project's** items: `cur()` returns the lists set by `useLists()`;
`save()` goes to `film.persist()` (row-per-item upsert into `project_items`, merged by object
identity); personal saves pass `{ personal: true }`. Collaborators = invited accepted
friends with full access, plus one project group chat (the Chat tab opens it directly).
Kinds the database refuses (`23514`, setup not run) are held on the phone per kind
(`needsSetup`) while others sync. Refresh every 15s in film mode. Cache `planner.filmdata`.

- **Write** (`js/write.js`): Theme · Characters (both in the `story` doc, `docKey()`) · Plot
  (acts of cards) · Script (screenplay blocks; Enter = next type, "INT."/"EXT." → scene).
  **One editor at a time**: Edit takes a 2-minute lock (`project_docs.locked_by`, renewed by
  autosave and a 45s heartbeat). Edits insert/remove elements in place and buttons use
  `tapBtn` so the keyboard never folds and the page never jumps. Page tops are pinned
  (`.page-sticky`).
- **Organize** (`js/organize.js`): Supplies · Locations · Cast · Budget · **Shoot**. Entries
  are project items (`supply`, `location`, `actor`, `expense`, one `budget` with currency
  and total) in `lists.org`. Budget totals planned / spent / left / unpaid. **Shoot days**
  are project calendar events with `shoot: { location, scenes: [{ id, label }], cast }`;
  titles are renumbered "Shoot day N" by date after any change; scenes come from the
  script's scene headings (else Plot cards); speaking actors are added from the scenes;
  "Copy call sheet" copies plain text.
- **Preview** (`js/preview.js`): **Concept** images are shrunk on the phone (≤1600px JPEG +
  ≤480px thumb) and uploaded to the private bucket `concepts/<project id>/` (members only);
  items of kind `concept`; signed links (2h, `planner.previewurls`); full-screen viewer with
  swipe, ‹ › reorder (`order`), caption, delete. **Result** = one YouTube link (kind
  `result`), big thumbnail, plays in an embedded youtube-nocookie iframe; redraws that change
  nothing are skipped so refreshes don't restart it; leaving the tab stops it.

**Keep-awake**: `.github/workflows/keep-awake.yml` calls `ping()` every 3 days so the free
Supabase project doesn't pause.

## Codebase structure

```
index.html  styles.css  manifest.webmanifest  sw.js (offline cache, push, notification click)
fonts/       Fraunces (self-hosted) + OFL      icons/  icon.svg + 180/192/512 PNGs
js/app.js    view state, render(), tabs, swipes, search/bell/notification navigation
js/util.js   h() DOM helper, ICONS, date helpers (local 'YYYY-MM-DD'), fmt()
js/store.js  state, save/storeItem, routines (occursOn, isDone), queries, folders, cur()/useLists
js/calendar.js  js/day.js  js/editor.js  js/folders.js  js/dday.js  js/postpone.js
js/ui.js     app dialogs and menus (ask, tell, askText, askDate, pick, pickMany, snack…)
js/motion.js sheet close animation + drag-down to close
js/cinema.js film mode switch animation (candidate styles)
js/config.js Supabase URL + publishable key + VAPID public key (all public)
js/cloud.js  auth, sync + merge, storage helpers   js/account.js  login page
js/settings.js  js/reminders.js (local alerts, badge)  js/push.js  js/live.js  js/search.js
js/social.js  js/people.js  js/chat.js  js/chatview.js
js/film.js  js/filmui.js  js/write.js  js/organize.js  js/preview.js
supabase/    setup → social → chat → film → push → maintenance (.sql, run in this order;
             all safe to re-run) + functions/push/index.ts
tests/       test suite (see below)          docs/  screenshots, logo images
```

## Data model (`js/store.js`)

Keep the internal names as they are, or users lose data/sessions: `planner.v1`,
`planner.auth`, `planner.social`, `planner.friendsopen`, `planner.chat`, `planner.expand`,
`planner.film`, `planner.filmdata`, `planner.filmsection`, `planner.orgsection`,
`planner.previewsection`, `planner.previewurls`, `planner.syncbase`, `planner.push`,
`planner_data`, `planner-vN`.

```js
// localStorage planner.v1
{
  todos:  [{ id, title, date: 'YYYY-MM-DD', important, notes, category: id | null,
             repeat, until, done /* one-off */, doneOn: { key: true } /* routines */,
             due: '' | key, skipOn: { key: true }, track: 'none'|'count'|'time',
             values: { key: number }, timer: { key, start } | null }],
  events: [{ id, title, date, allDay, start: 'HH:MM', end: 'HH:MM', repeat, until,
             alert: 'none' | '<minutes before>', important, notes, shoot? /* film */ }],
  categories: [{ id, name, parent: id | null, open, color }],
  // todos / events / categories may have sharedWith: [friend user id]
  ddays: [{ id, title, date, yearly }],
  meta: { updatedAt, replacedAt? },
  settings: { theme: 'auto'|'light'|'dark', accent: 'mono'|'blue'|'red'|'green'|'orange'|'purple' }
}
// repeat: 'none'|'daily'|'weekly'|'biweekly'|'monthly'|'yearly'; until '' = forever
```

- Dates are local keys (`dateKey()`), never UTC ISO strings. `occursOn(item, key)` decides
  repeats (monthly/yearly from the 31st fall on the last day of short months).
- Use `isDone` / `toggleDone`, `isStarred`, `todosOn`; never `todo.done` directly.
- Deleting a folder moves its contents up a level. All-day alerts fire at 9:00 minus offset.
- Changing the shape: bump the key and migrate in `load()`. Never drop user data.
- Mutate state, then `save()` (listeners re-render). Save after animations finish.
  Only cloud.js applies remote data (`save({ touch: false })` / `replaceAll(…, { touch: false })`).

## Conventions

- Vanilla ES modules, 2-space indent, single quotes, semicolons. Comments only for the why.
- DOM via `h(tag, props, ...children)`; user text only as text nodes; `innerHTML` only for
  the static `ICONS` SVGs.
- No dependencies or CDN scripts (offline use). npm is reachable for fetching font files;
  GitHub raw downloads are not.
- Colors only through CSS variables (`--bg --fg --muted --line --soft --accent --on-accent`);
  new accents need a `:root[data-accent=…]` rule and `ACCENTS` / `SWATCH` entries.
- Touch targets ≥ 40px, respect `env(safe-area-inset-*)`. The viewport has
  `maximum-scale=1` so iOS doesn't zoom into inputs.

## Development workflow

| Task | How |
| --- | --- |
| Run locally | `python3 -m http.server 8765` from the repo root |
| Build / deps / lint | None |
| Test | `tests/run-all.sh` |

**Tests** (`tests/`): `start.sh` starts Postgres, rebuilds the `planner` test database from
every `supabase/*.sql` on top of `db/stub.sql` (stand-ins for Supabase auth / storage /
vault / pg_net / pg_cron) and `db/seed.sql` (users a@x, b@x, c@x, password `secret1`; alice
is friends with bob and carol; an alice↔bob chat), runs `mock-server.js` on :54321
(PostgREST + GoTrue + Storage + RPC + Realtime stand-in with real RLS; `Bearer service` =
service role) and the app on :8765. Suites: `sync`, `storage`, `resilience` (offline, 2 minutes open: errors + memory,
sign-out cleanup), `motion`, `preview`, `shoot`,
`app-features` (push sign-up, instant chat, search, backups, clean-up, ping) and
`push-function` (the Edge Function in Node, decrypting real Web Push). Write tests with
`helpers.js` (`phone`, `inApp`, `sql`, `check`, `filmProject`). **Add a test with each
feature and run the suite before pushing.** Also look at screenshots of UI changes
(iPhone 13, light and dark). `node tests/audit.js` (after `start.sh`) walks every screen
in light and dark: page / console errors, content wider than the screen, small tap targets,
screenshots in `tests/out/audit/`. `PW_DEVICE` (e.g. 'iPhone SE', 'iPhone SE (3rd gen)'),
`PW_TZ` (e.g. Asia/Seoul) and `PW_LOCALE` (e.g. ko-KR) rerun any test or the audit as
another phone; small screens have their own CSS block (≤400px / ≤340px). Never create real accounts in the owner's Supabase project;
anon-key requests are safe checks.

## Deployment

GitHub Pages serves this branch's root (relative paths; `.nojekyll`). Supabase project
`rkpsjkssmfjuavdhayie` (free tier); all SQL files and the push function are set up and
verified. Push needs the `push` Edge Function (Verify JWT off) and four Vault secrets
(`push_url`, `push_secret`, `vapid_public`, `vapid_private`), given to the owner as one
paste from the git-excluded `.setup/`. **Never commit** the service_role key, the VAPID
private key or the push secret.

The service worker installs with `cache: 'reload'`, fetches with `cache: 'no-cache'` and
reloads once on `controllerchange`, so the owner only closes and reopens the app once.
**When you change any file the app loads, bump `CACHE` in `sw.js`** (currently
`planner-v88`) and keep `ASSETS` in sync with every file in `js/` and `fonts/`.

## Git

Work and push on the designated feature branch (`git push -u origin <branch>`); clear,
imperative, focused commits; no pull requests unless asked.

## Keeping this file current

Update it in the same change when you add files or tabs, change the data shape, tooling or
deployment. Keep it short: rules and how things work, not history. Only document what exists.
