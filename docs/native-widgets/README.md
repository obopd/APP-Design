# Planner — Lock Screen & widget designs (for the native iOS app)

The owner's chosen designs for the native app (built in Xcode). These are **mockups only**:
nothing here is built yet. The web app (repo root) is the source of truth for features,
colors and fonts; see `CLAUDE.md`. The HTML files in `source/` render the mockups (open them
in a browser from this folder; they use `fonts/fraunces-latin-wght-normal.woff2`).

Style everywhere: minimal black & white, **Fraunces** (semi-bold, upright) for headings, dates
and numbers, the system font for small text, slim vertical "dash" marks for to-dos (gray =
open, solid = done, done = struck through). Film mode = warm black `#0d0c0a`, cream text
`#f1ebe0`, tungsten-amber accent `#e2a24a`, still film grain + vignette, sprocket holes.

## 1 · Lock Screen card (Live Activity) — `1-lock-screen-card.png` ★ owner's favorite

One interactive card at the bottom of the Lock Screen (ActivityKit Live Activity), with
**tabs**: Today · Schedule · Routines · D-Day · Film. Buttons use App Intents (iOS 17+).

- **Today**: to-dos left (moved-over ones show their original date, ★ starred, "D-Day" for
  due), tap the dash to check off; a self-ticking countdown to the next event
  (`Text(timerInterval:)`).
- **Routines**: check off; ▶ Start / ■ Stop for tracked (time) routines — the stopwatch keeps
  running on the Lock Screen; nearest D-Day in the corner.
- **Schedule**: the next event with a big live countdown, today's other events (past ones
  faded), "+ to-do" opens the app.
- **D-Day**: the nearest countdown big ("D-12 · Graduation · Sat, Nov 14"), the next ones
  beside it (yearly ones marked ↻), and the latest "Since" count-up (D+430).
- **Film**: next shoot day (date, call / wrap, location, scenes) and project to-dos left; on
  shoot weeks the card can open on this tab by itself.
- **StandBy** (charging, sideways): the same card full screen. **Dynamic Island**: compact
  countdown; long-press for the expanded card.
- Apple limits: one card, ~160 pt tall, lasts ~8 h (restart each morning / when the app
  opens); updates while the app is closed need ActivityKit push (APNs).

## 2 · Lock Screen wallpaper — `2-lock-screen-wallpaper.png`

The app draws a picture of the planner over the owner's photo and a **Shortcuts** automation
("Set Wallpaper", e.g. hourly / each morning) sets it. Provide an App Intent like "Get
Planner Wallpaper" returning the image. Three layouts: **Everyday** (this week strip with
event bars, To-do, Schedule, Routines ring, D-Day), **Film** (next shoot day card, project
to-dos, shoot days list), **Minimal** (just today, no boxes). Not tappable; updates only when
the automation runs. When the Live Activity card is showing it covers the bottom, so keep the
lower part of the wallpaper clear in that case.

## 3 · Home Screen widgets — `3-home-screen-widgets.png`

D-Day (small), Next event (small), To-do (medium), Today (large: routines + to-dos | hourly
schedule), Routines (small, ring), Film (small / medium, film look), Schedule (medium). They
also appear big in StandBy. Light and dark follow the phone.

## 4 · Card + wallpaper together — `4-card-with-wallpaper.png`

Designs 1 and 2 used at the same time. The wallpaper fills the whole space **from the clock down
to the card** (no empty gap; it ends just above the card), so the card never hides it, and it
shows **different** things than the card so nothing is repeated:

- **Everyday + card**: wallpaper = this week strip, today's and tomorrow's schedule, D-Days; card =
  to-dos to check off (other tabs as in 1).
- **Film + card**: wallpaper = next shoot day (call / wrap / location), the shoot-days
  strip, its scenes and cast, film look; card = project to-dos with "Call in 3 days".
- **Minimal + card**: wallpaper = today's schedule, routines and tomorrow as plain text; card = to-dos
  and the countdown to the next event.

When the card isn't showing (ended after ~8 h, or turned off), the plain wallpaper layouts
from 2 can be used instead; the "Get Planner Wallpaper" intent can take a "with card" option.

## Data

All widgets need the same "today" data the web app already computes: unfinished to-dos
(including ones rolled over from earlier days), today's routines and their done state,
today's events in order, the nearest D-Days, and in film mode the next shoot day
(`event.shoot` = location, scenes, cast) and project to-dos. Check-offs and the stopwatch
tapped on the Lock Screen must be written back to the planner and synced like any edit.
