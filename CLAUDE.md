# CLAUDE.md

Guidance for AI assistants (Claude Code and similar) working in this repository.

## What this is

**Planner** — a personal calendar / to-do / schedule app (it was briefly renamed
"Kairos"; the owner switched back to Planner) (the owner: film director, photographer, reader,
college student). It is a
Progressive Web App (PWA) used on an **iPhone**, installed via Safari →
Share → Add to Home Screen.

The owner builds the app **from their phone** through Claude Code, with no
laptop. So:

- No build step, no npm, no bundler. Plain HTML/CSS/JS (ES modules) that runs as-is.
- Anything the owner must do by hand must be doable in a mobile browser, and
  explained step by step in plain language.
- The owner describes the design; build what they ask for, and check with
  them before inventing large features. **Anyone with the app link may create
  their own account** and use the app privately (open email/password sign-up).
  Accounts are separate; the *only* way another user sees anything is the owner's
  explicit per-item sharing with an accepted friend (see Friends & sharing). Never
  add any other way to reach someone else's data.

## Product requirements (from the owner)

- **Bottom bar** = a floating rounded dock like the iPhone home-screen dock (compact,
  hugs its icons and is centered; frosted `--dock-bg`, 52px tall, radius 26px; icon-only):
  Calendar · D-Day · Chat · Settings. There is **no + in the dock**; adding happens via a + next
  to each section heading (Routines, To-do, D-Day) and by tapping an empty hour. More tabs will be added later; a tab = a `.tab[data-view]` button in
  `index.html` + a `#view-<name>` container, switched by `view.tab` in `js/app.js`.
- The calendar is a **perfect square card** (always 6 week rows) with space on
  all sides, "Month Year" **centered** between ‹ › arrows. There is no date
  heading above the day view (the owner found it redundant). Sundays are tinted red
  and Saturdays blue (`--sun` / `--sat`, weekday letters + date numbers; the selected
  day keeps the accent fill).
- **No date selected → only the calendar is on screen**, exactly centered in the space
  below the small app icon / logo (`.brand`, 30px `icons/icon.svg`, rounded corners) that
  is **always at the top of the calendar screen**, in month and week mode (above today's
  D-Days too). "Logo" means this calendar-outline app icon, not a wordmark. When a
  D-Day is shown above it, it sits slightly lower instead (`.has-dday`: top spacer
  1.3 : bottom 0.7). Tapping a date slides the card to the top, **rolls the month up into
  that date's week**, and the space below shows that day in **two columns**:
  to-do list on the left, hourly schedule timeline on the right. Tapping the
  selected date again, the month name, or swiping down returns to the month.
- **Expanded calendar** (grid button `.grid-btn` right of the month name, month mode only;
  `renderExpanded` in calendar.js, `#expanded`, `view.expand` / `view.week` in app.js):
  1st tap = this week as **7 stacked rows** (date left, chips right), 2nd tap = the whole
  month as a taller grid (up to 3 chips per day, else 2 + "+n"), 3rd tap = back. It shows
  every event (own + shared, time first) and every to-do **that has a due date, on its due
  date** (slim-dash outlined chip; done = struck). ‹ › and sideways swipes move by week /
  month; tapping a day opens that day's normal view, and going back (tap the date / month
  name, swipe down) returns to the same expanded form (week = that day's week). The last grid form is saved on the
  device (localStorage `planner.expand`) and restored when the app opens (current week/month).
  Motion (app.js `growExpanded` / `leaveExpanded` / `swapExpanded`): normal → expanded
  clips the expanded card (`clip-path inset … round 24px`) from the square card's rect to
  its own while content fades in; back = the reverse (expanded pinned `position: fixed`,
  the square card fades in as it arrives); to a day = quick fade. The outline during these
  is `#x-frame`, an empty fixed box whose top/left/width/height transition (the one
  allowed size animation: it has no children, so it costs no page layout). Week ⇄ month
  crossfades with a slight zoom (old `.x-ghost` leaves in .18s, new arrives .1s later);
  ‹ › / swipes slide the days while the title crossfades. Rapid taps reset cleanly
  (`resetExpandedMotion`).
  Chip classes are `.chip-ev` / `.chip-due` — never `.event`, which is the timeline block.
- Design: **minimalist** — modern, clean, intuitive, small sizes, as few words as
  possible (prefer icons/symbols over labels). **Never use iPhone system pop-ups**:
  no `confirm` / `alert` / `prompt` and no native `<select>` — use `ask` / `tell` /
  `askText` / `pick` / `selectButton` from `js/ui.js` (the app's own cards and menus;
  red button for deletes).
- Month ⇄ day transition must feel smooth. It is a **FLIP animation that never animates
  layout** (the old version animated `grid-template-rows`/`flex-grow` and re-laid out the
  page every frame → visible jank on iPhone). On a mode change `render()` measures the card,
  switches to the final layout at once, then `flip()` animates only `transform`/`opacity`:
  the card slides from its old position; the day panel rides on the card's bottom edge
  (opening) or is pinned `position: fixed` where it was and fades/drops away (closing).
  Inside the card, `.cal-rows-inner` slides to the selected week and is masked with
  `clip-path`; the rounded outline is two pseudo-elements (`::before` clipped, `::after`
  translated by `--frame-cut`). The card has a solid background + `z-index: 1` so the
  fading panel never shows through. All parts share `--dur` (.65s opening) / `--ease`; going back to the month is slower and eased in-out
  (`#view-calendar.closing`: .75s, added in `render()` and removed by `flip()`'s timer). Intl formatters
  are cached (`fmt()` in util.js) because creating them on every render made the tap
  itself slow. Measure with CDP CPU throttling (4×) and rAF frame times before/after. **Default colors are black & white**;
  the user can change the accent color and light/dark mode in Settings.
- Typography: headings, dates and numbers use **Fraunces** (semi-bold, upright —
  **no italics**, the owner rejected them) via the `.display` class / `--display`
  variable; small UI text uses the system sans-serif.
- Adding items: + next to "Routines" (new to-do preset to repeat daily), + next to
  "To-do", + next to the "D-Day" title; a **folder-plus icon** sits left of each
  section's + to create a folder (then the editor opens with that folder preselected,
  since an empty folder doesn't show in a day); events by tapping an empty hour in the timeline.
  Opening any sheet must **not** focus a text field (no keyboard until the owner taps one).
- **To-do folders (categories)**, nestable like computer folders (Academic →
  Biology, Chemistry). New folders start open; each folder's open/closed state is
  saved (`category.open`) and must survive closing/reopening the tab or app.
  A folder shows in a day only if it contains that day's to-dos. New folders come from the folder-plus icons in the calendar (no "New" button in
  Settings); Settings lists existing folders (rename/recolor, add sub-folder, delete)
  and hides the Folders row when there are none; "New…" in the editor also works;
  "Academic/Biology" creates nested folders. Folder names use the same font as
  the to-dos (one unified font in the list) and have an underline whose color is
  chosen when the folder is created from 20 colors (`FOLDER_COLORS`, 2 rows of 10; `category.color`, sheet in `js/folders.js`;
  editable from Settings by tapping the folder name).
- **Done mark**: in front of each to-do is a slim *vertical* line with rounded
  ends (`.dash`, 3.5×13px, not a circle) inside a 30×36px tap area (`.mark-btn`; the owner
  found the smaller one hard to hit) — gray when open, solid black/accent when done. Tapping it toggles done;
  done to-dos get a plain `line-through` and gray text (the owner rejected the
  hand-drawn pencil stroke). Tapping the text opens the editor. The mark sits close to the text.
- **Stretchable columns**: a divider with a grip sits between to-do and schedule.
  Dragging it to an edge stretches one side to full width (a to-do or schedule
  "tab"); dragging back (or a sideways swipe on the lists) returns to the split.
  Layout state lives in `js/day.js` (`layout`: split | todo | schedule) and is kept
  while changing days.
- **Routines**: to-dos and events can repeat daily, weekly, every 2 weeks,
  monthly or yearly, with an optional "Until" date. Routine to-dos are checked
  off per day (`doneOn`). Routines only get a calendar dot when starred.
  In the to-do column, **routines have their own section on top ("Routines") and
  regular to-dos sit below ("To-do")**; each section has its own folder tree
  (folder open/closed state is shared). The two must look clearly distinct:
  Routines sit in a shaded rounded box (`.todo-section.routines`), To-do below on
  the plain page; both have display-font headings with an open-item count and a +.
  **Both sections always show** on a selected day, even when empty, and share the
  same margins/indent (`.todo-section`) so headings, + and items line up exactly.
- **D-Day tab** (`js/dday.js`): countdowns for birthdays, graduation, etc. Each row
  shows title, date (+ ↻ and "58th" for yearly ones) and a big "D-12" / "D-Day" /
  "D+30". Upcoming sorted soonest first; past one-off dates count up under "Since".
  Yearly entries roll to the next occurrence (`ddayTarget`). Tap a row to edit/delete.
  **On the day itself**, the starting screen (month mode) shows it in the free space
  above the centered calendar (`#dday-slot` inside the top spacer, below the wordmark; `renderTodayDdays`); tapping it opens the
  D-Day tab. It fades out in week mode and never shifts the calendar.
  Several D-Days on the same day form a horizontal row: the centered one is fully
  opaque, neighbours peek in at low opacity (12px gap). The row is positioned with
  `transform` and custom pointer-swipe handling (snap to next/previous; tapping a faded
  one centers it), **not native scroll-snap** — iOS Safari mis-centered that and
  wouldn't swipe. `place()` re-centers after layout, after `document.fonts.ready`
  (Fraunces changes widths) and on resize.
- **Haptics**: every button-like tap gives a light haptic tick (Settings → Haptics,
  on by default). iOS Safari has no vibration API; toggling an `<input type="checkbox"
  switch>` plays a system haptic, but newer iOS only for a *real* tap (`label.click()`
  from code stays silent — the old approach stopped working). So `js/haptics.js` places a
  transparent `.haptic-hit` label for a hidden switch exactly over the button on
  `pointerdown` (fixed, in `body` or the open `<dialog>`, so re-renders can't remove it);
  the finger's click lands on it, it calls `host.click()` (still inside the real tap),
  then the label flips the switch. Moving >8px / scrolling removes it, so swipes work.
  Android uses `navigator.vibrate`. No sound. Automated browsers skip the layer
  (Playwright's click hit-check would fail) unless `window.__hapticTest` is set.
- **Account required — email + password login with cloud backup/sync** via
  Supabase (`js/cloud.js`, login page + new-password sheet in `js/account.js`,
  Settings → Account shows the email, sync status and Sign out). When accounts are
  configured, a full-screen, compact and minimal **login page appears first** (280px
  wide, small type, lots of empty space; `#view-login`, `body.gated`
  hides the dock) until the user signs in or creates an account; the session persists,
  so it's only shown again after signing out. **Signing out syncs first, warns if
  edits haven't reached the account, then clears the planner from the device**
  (`clearData`, device prefs kept) so the next person on that phone can't see it.
  Data is still local-first in localStorage while signed in.
  Signed in, the whole state is stored as one JSON row per user (`planner_data`,
  RLS so users only reach their own row; schema in `supabase/setup.sql`) and synced
  last-write-wins using `state.meta.updatedAt` vs the session's `lastSyncedAt`:
  pushes ~1.5s after local edits, pulls on open / foreground / `online`. First sign-in
  with data on both sides asks which to keep.
  Supabase REST is called directly with `fetch` (no SDK); requests time out after
  12s so a hung request can't block later syncs. Passwords are never stored by the
  app (Supabase Auth); the session tokens live in localStorage `planner.auth`.
  Email links (confirm / reset password) return with `#access_token…` handled by
  `handleAuthRedirect()`. `js/config.js` holds the project URL + anon/publishable key
  (public by design); empty = accounts hidden ("Not set up yet").
  Multiple independent users are expected (anyone with the link can sign up);
  RLS is what keeps each user's row private, so never weaken those policies.
  Auth errors are mapped by Supabase `error_code` in `friendly()` (cloud.js) to plain
  messages — e.g. `over_email_send_rate_limit` = the free email sender's ~2 emails/hour
  project-wide limit (not "wait a minute"). With "Confirm email" on, sign-up of an
  existing email returns a user with empty `identities` → treated as "already has an
  account". All forms use `novalidate` so the browser never shows its own validation
  pop-ups; the app validates and shows its own messages.
- **Friends & sharing** (`js/social.js` data/sync, `js/people.js` UI, tables in
  `supabase/social.sql`, must be run once in Supabase): each user picks a unique **ID**
  (`profiles.handle`, lowercase a–z 0–9 _ . , 3–20; Settings → ID). Friends are added by
  ID (Settings → Friends +, or the people icon in the bell sheet) and must **accept**.
  A **bell** (`#bell`, fixed top-right of the calendar screen, red count badge) opens the
  notifications sheet (`#social-sheet`): friend requests (Accept / ✕), accepted requests,
  "@x shared …", "@x checked off …"; opening it marks them seen (requests keep counting
  until answered). **Sharing** is per to-do / event / folder: a "Share" row in the editor
  and folder sheet (friend picker card) sets `sharedWith: [userId]` on the item in the
  owner's own planner; `publishShares()` keeps one `shares` row per (item, friend) with a
  copy (folders = all to-dos inside, incl. sub-folders), re-published ~2s after edits and
  deleted when un-shared, deleted or unfriended. Friends see shared to-dos in a dashed
  **"Shared"** section under To-do (with @owner) and shared events dashed on the timeline;
  tapping them shows a details card (read-only). Friends can **check off** shared to-dos:
  that writes a `share_checks` row, shown at once on their side; the owner's app applies
  it to its own to-do on the next refresh and deletes it. Refresh = on open, foreground,
  every 60s while open, and when the bell opens. Shared data is cached in localStorage
  `planner.social` (per user, removed on sign-out). If the tables don't exist (404
  PGRST205) the bell and Share rows hide and Settings says "Not set up yet".
  RLS (verified on local Postgres): profiles readable by signed-in users, only own row
  writable and only `handle`; friendships visible to the two people, inserted only as
  pending by the requester, only the addressee can set `status` (column grants); shares
  written only by the owner and only for accepted friends, readable by the friend only
  while still friends; share_checks written only by the share's friend.
- **Chat** (`js/chat.js` data, `js/chatview.js` UI, tables in `supabase/chat.sql`, run once
  after social.sql): dock tab with an unread-count badge. **Personal** chats (with one
  friend, made on first open, reused after) and **group** chats (named; creator or any
  member adds their own friends; the creator removes people; anyone renames or leaves).
  Text only, 1–1000 characters; press and hold your own message to delete it (for
  everyone). Opening a chat hides the dock (`body.chatting`); the composer sits at the
  bottom and `--vvh` (visualViewport height) keeps it above the iPhone keyboard. No read
  receipts; unread = messages after `chat_members.last_read` (a message id). Polling, no
  websockets: open chat every 3s (`pollChat`: only ids newer than the newest cached, plus
  a cheap id check to drop deleted ones), list every 9s, otherwise every 60s/foreground.
  Cache: localStorage `planner.chat` (last 200 per chat, older via "Earlier messages";
  removed on sign-out). RLS (verified on local Postgres): only members read/post, senders
  delete their own, direct chats never get a 3rd member, you can only add accepted
  friends, removed members lose access at once, members may only update `last_read`.
  Not possible as a web app: message notifications while the app is closed (needs push).
- **Postpone a to-do** (`js/postpone.js`): swipe a to-do left to reveal **Tmrw** and
  **Date** (date card from `askDate`), or use the editor's "Postpone" row (Tomorrow /
  Pick date). A "Moved to …" snack with **Undo** appears (`snack` in ui.js). One-off
  to-dos change `date` (recorded count/time moves with them); for a routine only that day
  moves: `skipOn[day]` hides it there and a one-off copy is added on the new date.
  Swiping sideways *on a to-do* = postpone; on empty list space = stretch columns.
- **Due dates** (one-off to-dos only; editor "Due" row, hidden for routines/events):
  an unfinished to-do with `due` moves forward to today every day until it's done, and
  is starred from its due date on (calendar accent dot, badge, bold). Both are
  *computed* (`todoDate`, `isStarred`, `hasDue` in store.js), never written on open,
  so a phone opening the app can't create an edit that wins a sync. Checking it off
  pins `date` to that day. The row shows a small "D-3" / "D-Day" / "D+2" tag
  (`.due-tag`, accent from the due day on).
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
index.html             Shell: login / calendar / D-Day / chat / settings views, bell, bottom bar, toast, sheets (editor, folder, D-Day, account, social)
styles.css             All styles. Theme via CSS variables; html[data-theme] light/dark, html[data-accent].
                       Square card size comes from --cal-w / --cell; .month-mode/.week-mode drive layout
fonts/                 Fraunces variable font (latin, upright woff2) + OFL.txt license
manifest.webmanifest   PWA manifest
sw.js                  Service worker: offline cache (network-first) + notification click
js/app.js              Entry point: view state (tab, month, selected day), actions, render(), tabs, swipes
js/util.js             h() DOM helper, inline SVG icons, date helpers (local 'YYYY-MM-DD' keys)
js/store.js            State + localStorage, change listeners, routines (occursOn, isDone), queries, folder helpers
js/calendar.js         Square month card (6 rows); week mode = rows slid + clip-path masked to one week;
                       expanded week/month agenda (grid button)
js/day.js              Day view: to-do folders (mark = done, text = edit) + hourly timeline, stretchable split
js/editor.js           Bottom sheet to add/edit a to-do or event (folder, repeat/until, alert)
js/folders.js          Bottom sheet to create/edit a folder: name + underline color
js/dday.js             D-Day tab (countdown list) + its add/edit sheet
js/ui.js               App-styled dialogs/menus: ask, tell, askText, askDate, pick, selectButton, snack (no system pop-ups)
js/postpone.js         Postpone a to-do to tomorrow / a picked date, with Undo
js/haptics.js          Haptic tick on every button tap (iOS 18+ hidden-switch trick; Android vibrate)
js/config.js           Supabase project URL + anon key (empty = no accounts)
js/cloud.js            Supabase auth (sign up/in/out, reset) + whole-state cloud sync
js/account.js          Login page (sign in / create account / forgot password) + new-password sheet
supabase/setup.sql     Table + row-level-security policies to run once in Supabase
js/settings.js         Settings tab: theme, accent color, folders, alerts, backup export/restore
js/reminders.js        Alert timers, notifications, in-app toast, app icon badge
js/social.js           Friends & sharing data: profile ID, friend requests, publishing shares, check-offs, bell items
js/people.js           Friends UI: bell sheet, Settings ID/Friends, Share row + friend picker
js/chat.js             Chat data: chats, members, messages (polling + local cache), send/delete/read marks
js/chatview.js         Chat tab: chat list, conversation (bubbles + composer), group info
supabase/chat.sql      Tables + RLS for chats, chat_members, messages (run once after social.sql)
supabase/social.sql    Tables + RLS for profiles, friendships, shares, share_checks (run once after setup.sql)
icons/                 icon.svg (source) + 180/192/512 PNGs rendered from it
docs/                  Screenshots of the app
```

## Data model (`js/store.js`)

Keep the internal names (`planner.v1`, `planner.auth`, `planner.social`, `planner.chat`, `planner.expand`, `planner_data`, `planner-vN`) as they
are, or existing users lose their data/session.

Stored in `localStorage` under `planner.v1`:

```js
{
  todos:  [{ id, title, date: 'YYYY-MM-DD', important, notes, category: id | null,
             repeat, until, done /* one-off */, doneOn: { 'YYYY-MM-DD': true } /* routines */,
             due: '' | 'YYYY-MM-DD' /* one-off only */ }],
  events: [{ id, title, date, allDay, start: 'HH:MM', end: 'HH:MM', repeat, until,
             alert: 'none' | '<minutes before>', important, notes }],
  // todos also: track: 'none' | 'count' | 'time', values: { dateKey: number /* count or seconds */ },
  //             timer: { key: dateKey, start: epochMs } | null
  categories: [{ id, name, parent: id | null, open, color: css color | null }],
  // todos, events and categories may have sharedWith: [friend user id] (see Friends & sharing)
  ddays: [{ id, title, date, yearly }],
  meta: { updatedAt: epochMs },   // last local change (save() stamps it; cloud sync compares it)
  settings: { haptics: bool, theme: 'auto' | 'light' | 'dark', accent: 'mono' | 'blue' | 'red' | 'green' | 'orange' | 'purple' }
}
// repeat: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'; until: '' = forever
```

- Dates are **local** date keys (`dateKey()`), never UTC ISO strings.
- `date` is the first occurrence; `occursOn(item, key)` decides repeats. Monthly/yearly
  starting on e.g. the 31st fall on the last day of shorter months.
- Use `isDone(todo, key)` / `toggleDone(todo, key)`, never `todo.done` directly; use
  `isStarred(item, key)` for "important" (includes due-date stars) and `todosOn(key)`
  (which places due to-dos on `todoDate`).
- Deleting a folder moves its sub-folders and to-dos up one level (`deleteCategory`).
- All-day alerts fire at 9:00 AM minus the alert offset.
- Changing the shape: bump the key and migrate old data in `load()`. Never drop user data.
- Mutate `state`, then call `save()`; `save()` notifies listeners, and `app.js` re-renders.
  Re-rendering rebuilds the view, so for animated controls (e.g. the Haptics switch)
  save after the animation finishes, or the change looks instant.
  Only cloud.js applies remote data, with `save({ touch: false })` / `replaceAll(data, { touch: false })`.

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
  The viewport has `maximum-scale=1` so iOS doesn't auto-zoom when focusing inputs
  smaller than 16px (pinch-zoom still works on iOS).
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

Because `js/config.js` points at the real Supabase project, the app opens on the
login page. For UI tests either route `**/js/config.js` to empty values (accounts off)
or route it to a fake URL and mock the Supabase REST endpoints with `context.route`.
Never create real accounts in the owner's project from tests (confirmation emails
are sent to the address); a wrong-password sign-in is a safe connectivity check.

Verify every UI change in a phone-sized browser with Playwright (pre-installed
in cloud sessions; `require('playwright')` works — don't reinstall). Use
`devices['iPhone 13']`, add items through the UI, tap a date to check the
week roll-up and two-column day view, reload to confirm persistence, check
dark mode, collect `pageerror` events, and look at screenshots.

App icon / logo = white calendar outline with a dot on near-black (`icons/icon.svg`).
Render it to the 180/192/512 PNGs with Playwright (`page.setContent` + `page.screenshot`).
Full-size logo images for other uses live in `docs/logo/`.

## Deployment

GitHub Pages serving the repo root (all paths are relative, so it works under
`/APP-Design/`): repo Settings → Pages → Deploy from a branch → branch, `/ (root)`.
`.nojekyll` makes Pages serve files as-is (no Jekyll build). Note: the repo is
private, and free GitHub accounts only get Pages for public repos.

Accounts: Supabase project (free tier; open sign-ups for anyone with the link). The
built-in email sender is heavily rate-limited, so the owner may turn off
Authentication → Email → "Confirm email" (or add custom SMTP). Free projects pause
after ~1 week of no activity; sync then fails until restored in the dashboard. Run `supabase/setup.sql` in its SQL editor,
set Authentication → URL Configuration → Site URL / Redirect URLs to the Pages URL,
and put the Project URL + anon (publishable) key in `js/config.js` (done: project
`rkpsjkssmfjuavdhayie`, table + RLS verified). For friends & sharing also run
`supabase/social.sql` there, then `supabase/chat.sql` for chat (both safe to run again). Never commit the service_role/secret key. The service worker only caches same-origin GETs, so API
responses are never cached.

Updates reach phones quickly: the service worker installs with `cache: 'reload'` and
fetches with `cache: 'no-cache'` (bypassing Pages' 10-minute HTTP cache), the app calls
`registration.update()` when it returns to the foreground, and reloads once on
`controllerchange`. So the owner only needs to close and reopen the app once.

**When you change any file the app loads, bump `CACHE` in `sw.js`**
(currently `planner-v53`; bump to `planner-v54`, …) and keep its `ASSETS` list in sync
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
