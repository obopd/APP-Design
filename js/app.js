import { addDays, dateKey, parseKey, todayKey, h } from './util.js';
import { onChange } from './store.js';
import { renderCalendar, renderExpanded } from './calendar.js';
import { filmOn, onFilmChange, refreshFilm, editorOf } from './film.js';
import { setupBrand, renderProjectChip, paintBrand } from './filmui.js';
import { renderWrite, finishEditing, writeBackgrounded, isEditing, showWriteSection } from './write.js';
import { renderOrganize } from './organize.js';
import { renderPreview, leavePreview } from './preview.js';
import { syncPush } from './push.js';
import { openSearch } from './search.js';
import { setupSheets } from './motion.js';
import './live.js';
import { renderDay, tickTimers } from './day.js';
import { openEditor } from './editor.js';
import { renderSettings, applyTheme } from './settings.js';
import { renderDdays, renderTodayDdays } from './dday.js';
import { refreshReminders, setToast } from './reminders.js';
import { onCloudChange, syncNow, handleAuthRedirect, isConfigured, currentUser } from './cloud.js';
import { openAccountSheet, renderLoginGate } from './account.js';
import { socialEnabled, socialStatus, onSocialChange, refreshSocial, unseenCount } from './social.js';
import { openNotifications, redrawNotifications } from './people.js';
import { onChatChange, refreshChats, unreadTotal, chatEnabled } from './chat.js';
import { renderChat, chatShown, openChat } from './chatview.js';

const calendarView = document.getElementById('view-calendar');
const calendarEl = document.getElementById('calendar');
const panelEl = document.getElementById('panel');
const settingsEl = document.getElementById('view-settings');
const ddayEl = document.getElementById('view-dday');
const loginEl = document.getElementById('view-login');
const chatEl = document.getElementById('view-chat');
const writeEl = document.getElementById('view-write');
const organizeEl = document.getElementById('view-organize');
const previewEl = document.getElementById('view-preview');
const chatBadge = document.querySelector('.tab[data-view="chat"] .tab-badge');
const toastEl = document.getElementById('toast');
const ddaySlot = document.getElementById('dday-slot');
const expandedEl = document.getElementById('expanded');
const frameEl = document.getElementById('x-frame');
const bellEl = document.getElementById('bell');
const bellBadge = bellEl.querySelector('.bell-badge');

// view.selected = 'YYYY-MM-DD' → week mode; null → month mode.
const now = new Date();
// view.expand = 'week' | 'month' → the expanded calendar (grid button); view.week = its Sunday.
const view = { tab: 'calendar', cursor: new Date(now.getFullYear(), now.getMonth(), 1), selected: null, expand: null, week: null };

// Sunday of the week to show when expanding: this week if it's in the shown month,
// otherwise the month's first week.
const sundayOf = (key) => { const d = parseKey(key); return dateKey(addDays(d, -d.getDay())); };

function weekToShow() {
  const today = new Date();
  const inMonth = today.getFullYear() === view.cursor.getFullYear() && today.getMonth() === view.cursor.getMonth();
  const d = inMonth ? today : view.cursor;
  return dateKey(addDays(d, -d.getDay()));
}

// The grid form (normal / week / month) is remembered on this device and restored on open,
// showing the current week or month.
const EXPAND_KEY = 'planner.expand';
const savedExpand = localStorage.getItem(EXPAND_KEY);
if (savedExpand === 'week' || savedExpand === 'month') {
  view.expand = savedExpand;
  view.week = weekToShow();
}
let prevView = null;

const actions = {
  // Opening a day keeps view.expand, so going back returns to the same grid form
  // (expanded week = the week of the day you were on).
  select(key) {
    if (view.selected === key && view.expand) view.week = sundayOf(key);
    view.selected = view.selected === key ? null : key; // tap the selected day again to go back to month
    const d = parseKey(key);
    view.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  },
  showMonth() {
    if (!view.selected) return;
    if (view.expand) view.week = sundayOf(view.selected);
    view.selected = null;
    render();
  },
  // Grid button: normal → expanded week → expanded month → normal.
  toggleExpand() {
    if (!view.expand) {
      view.expand = 'week';
      view.week = weekToShow();
    } else if (view.expand === 'week') {
      const mid = addDays(parseKey(view.week), 3);
      view.cursor = new Date(mid.getFullYear(), mid.getMonth(), 1);
      view.expand = 'month';
    } else {
      view.expand = null;
    }
    localStorage.setItem(EXPAND_KEY, view.expand || '');
    render();
  },
  shift(dir) {
    view.lastShift = dir; // which way the expanded calendar slides
    // A selected day wins: view.expand is kept while a day is open (to return to it).
    if (view.selected) {
      view.selected = dateKey(addDays(parseKey(view.selected), dir * 7));
      const d = parseKey(view.selected);
      view.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    } else if (view.expand === 'week') {
      view.week = dateKey(addDays(parseKey(view.week), dir * 7));
      const mid = addDays(parseKey(view.week), 3);
      view.cursor = new Date(mid.getFullYear(), mid.getMonth(), 1);
    } else {
      view.cursor = new Date(view.cursor.getFullYear(), view.cursor.getMonth() + dir, 1);
    }
    render();
  },
  create: (opts) => openEditor(opts),
  edit: (kind, item, occurrence) => openEditor({ kind, item, occurrence }),
  refresh: () => render(),
};

const setStyle = (el, styles) => Object.assign(el.style, styles);
const PANEL_RESET = { transition: '', transform: '', opacity: '', position: '', top: '', left: '', width: '', height: '', zIndex: '' };
let flipTimer = 0;

// FLIP: the calendar card slides from its old position; the day panel rides on the card's
// bottom edge (opening) or fades away from where it was (closing).
function flip(first, opening, panelFirst) {
  const last = calendarEl.getBoundingClientRect();
  clearTimeout(flipTimer);
  setStyle(calendarEl, { transition: 'none', transform: `translateY(${first.top - last.top}px)` });
  if (opening) {
    setStyle(panelEl, { ...PANEL_RESET, transition: 'none', transform: `translateY(${first.bottom - last.bottom}px)`, opacity: '0' });
  } else if (panelFirst) {
    setStyle(panelEl, {
      transition: 'none', position: 'fixed', zIndex: '0', opacity: '1', transform: 'none',
      top: `${panelFirst.top}px`, left: `${panelFirst.left}px`, width: `${panelFirst.width}px`, height: `${panelFirst.height}px`,
    });
  }
  void calendarEl.offsetHeight;
  requestAnimationFrame(() => {
    setStyle(calendarEl, { transition: '', transform: '' });
    if (opening) setStyle(panelEl, { transition: '', transform: '', opacity: '' });
    else if (panelFirst) setStyle(panelEl, { transition: '', opacity: '0', transform: 'translateY(28px)' });
  });
  if (!opening) {
    flipTimer = setTimeout(() => {
      setStyle(panelEl, PANEL_RESET);
      calendarView.classList.remove('closing');
    }, 850);
  }
}

/* ---------- Expanded calendar motion ----------
   Normal ⇄ expanded: the expanded card is clipped (clip-path) from the square card's
   rectangle to its own and back, while its content fades; a thin outline (#x-frame, an
   empty fixed box, so moving it costs no page layout) traces the card's edge.
   Week ⇄ month crossfades; ‹ › slides. Only transform / opacity / clip-path animate. */
let growTimer = 0;
let leavingTimer = 0;
const X_RESET = { transition: '', clipPath: '', position: '', top: '', left: '', width: '', height: '', margin: '', zIndex: '', opacity: '' };
const insetFrom = (outer, inner) =>
  `inset(${inner.top - outer.top}px ${outer.right - inner.right}px ${outer.bottom - inner.bottom}px ${inner.left - outer.left}px round 24px)`;
const placeFrame = (r) => setStyle(frameEl, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });

function moveFrame(from, to) {
  frameEl.hidden = false;
  setStyle(frameEl, { transition: 'none' });
  placeFrame(from);
  void frameEl.offsetWidth;
  requestAnimationFrame(() => { setStyle(frameEl, { transition: '' }); placeFrame(to); });
}

function resetExpandedMotion() {
  clearTimeout(growTimer);
  clearTimeout(leavingTimer);
  leavingTimer = 0;
  setStyle(expandedEl, X_RESET);
  expandedEl.classList.remove('morph', 'x-hiding', 'x-leaving');
  frameEl.hidden = true;
}

function growExpanded(from) {
  const to = expandedEl.getBoundingClientRect();
  expandedEl.classList.add('morph', 'x-hiding');
  setStyle(expandedEl, { transition: 'none', clipPath: insetFrom(to, from) });
  moveFrame(from, to);
  void expandedEl.offsetWidth;
  requestAnimationFrame(() => {
    setStyle(expandedEl, { transition: '', clipPath: 'inset(0px 0px 0px 0px round 24px)' });
    expandedEl.classList.remove('x-hiding');
  });
  growTimer = setTimeout(resetExpandedMotion, 700);
}

// Back to the square card (shrink onto it), or to a day (just fade away).
function leaveExpanded(from, toCard) {
  setStyle(expandedEl, {
    transition: 'none', position: 'fixed', margin: '0', zIndex: '3',
    top: `${from.top}px`, left: `${from.left}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  expandedEl.hidden = false;
  expandedEl.classList.add('morph', 'x-leaving');
  const to = toCard ? calendarEl.getBoundingClientRect() : null;
  if (to) {
    moveFrame(from, to);
    // The square card fades in as the frame arrives (so there's only ever one outline).
    setStyle(calendarEl, { transition: 'none', opacity: '0' });
  }
  void expandedEl.offsetWidth;
  requestAnimationFrame(() => {
    // Shrinking onto the card: the content fades first, then the card itself fades to
    // reveal the square calendar underneath. Going to a day: a quick fade.
    setStyle(expandedEl, { transition: to ? '' : 'opacity .3s ease', opacity: '0' });
    expandedEl.classList.add('x-hiding');
    if (to) {
      expandedEl.style.clipPath = insetFrom(from, to);
      setStyle(calendarEl, { transition: 'opacity .3s ease .32s', opacity: '' });
    }
  });
  leavingTimer = setTimeout(() => {
    resetExpandedMotion();
    expandedEl.hidden = true;
    setStyle(calendarEl, { transition: '', opacity: '' });
  }, 760);
}

function swapExpanded(oldNodes, { kind, dir }) {
  expandedEl.querySelectorAll('.x-ghost').forEach((g) => g.remove());
  const ghost = h('div', { class: `x-ghost ${kind}`, style: `--dir:${dir}`, 'aria-hidden': 'true' }, oldNodes);
  [...expandedEl.children].forEach((n) => { n.classList.add('x-new', kind); n.style.setProperty('--dir', dir); });
  expandedEl.append(ghost);
  setTimeout(() => {
    ghost.remove();
    expandedEl.querySelectorAll('.x-new').forEach((n) => n.classList.remove('x-new', 'mode', 'slide'));
  }, 420);
}

// Accounts are required: while signed out, only the login page shows (no dock).
const FILM_TABS = ['write', 'organize', 'preview'];
const isGated = () => isConfigured() && !currentUser();
let gateShown = false;

function render() {
  const gated = isGated();
  document.body.classList.toggle('gated', gated);
  loginEl.hidden = !gated;
  if (gated) {
    calendarView.hidden = settingsEl.hidden = ddayEl.hidden = chatEl.hidden = writeEl.hidden = organizeEl.hidden = previewEl.hidden = true;
    leavePreview();
    chatShown(false);
    if (!gateShown) renderLoginGate(loginEl); // once per visit, so typing isn't wiped
    gateShown = true;
    return;
  }
  if (gateShown) {
    // Just signed in: start fresh on the month calendar.
    gateShown = false;
    loginEl.replaceChildren();
    Object.assign(view, { tab: 'calendar', selected: null });
    prevView = null;
  }

  // Film mode has a Write tab instead of D-Day.
  if (filmOn() && view.tab === 'dday') view.tab = 'calendar';
  if (!filmOn() && FILM_TABS.includes(view.tab)) view.tab = 'calendar';
  if (view.tab !== 'write' && isEditing()) finishEditing();
  if (view.tab !== 'preview') leavePreview(); // stop a playing video

  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === view.tab;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  // A newly opened tab fades in (not on the first draw).
  if (prevView && prevView.tab !== view.tab) {
    const el = document.getElementById(`view-${view.tab}`);
    if (el) { el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter'); }
  }
  calendarView.hidden = view.tab !== 'calendar';
  paintBell();
  settingsEl.hidden = view.tab !== 'settings';
  chatEl.hidden = view.tab !== 'chat';
  chatShown(view.tab === 'chat');
  paintChatBadge();
  ddayEl.hidden = view.tab !== 'dday';
  writeEl.hidden = view.tab !== 'write';
  organizeEl.hidden = view.tab !== 'organize';
  previewEl.hidden = view.tab !== 'preview';

  if (view.tab === 'settings') { renderSettings(settingsEl); prevView = { ...view }; return; }
  if (view.tab === 'chat') { renderChat(chatEl); prevView = { ...view }; return; }
  if (view.tab === 'dday') { renderDdays(ddayEl); prevView = { ...view }; return; }
  if (view.tab === 'write') { renderWrite(writeEl); prevView = { ...view }; return; }
  if (view.tab === 'organize') { renderOrganize(organizeEl); prevView = { ...view }; return; }
  if (view.tab === 'preview') { renderPreview(previewEl); prevView = { ...view }; return; }

  // Month ⇄ week: lay out the end state at once, then animate only transform / opacity /
  // clip-path from where things were (FLIP), so the phone never re-lays out mid-animation.
  const wasWeek = calendarView.classList.contains('week-mode');
  const willWeek = !!view.selected;
  // Expanded calendar (grid button). Measure before switching so each change can animate.
  const onCal = prevView?.tab === 'calendar';
  const wasExpanded = calendarView.classList.contains('expand-mode');
  const expanded = !!view.expand && !view.selected;
  const calFirst = onCal && !wasExpanded && expanded ? calendarEl.getBoundingClientRect() : null;
  const xFirst = onCal && wasExpanded && !expanded ? expandedEl.getBoundingClientRect() : null;
  let swap = null;
  if (onCal && wasExpanded && expanded) {
    const moved = view.expand === 'week' ? prevView.week !== view.week : +prevView.cursor !== +view.cursor;
    if (prevView.expand !== view.expand) swap = { kind: 'mode', dir: 0 };
    else if (moved) swap = { kind: 'slide', dir: view.lastShift || 1 };
  }
  const oldNodes = swap ? [...expandedEl.children].filter((n) => !n.classList.contains('x-ghost')) : null;
  if (expanded || calFirst) resetExpandedMotion();
  calendarView.classList.toggle('expand-mode', expanded);
  if (expanded) renderExpanded(expandedEl, view, actions);
  if (!xFirst && !leavingTimer) expandedEl.hidden = !expanded;
  if (calFirst) growExpanded(calFirst);
  else if (xFirst) leaveExpanded(xFirst, !view.selected);
  else if (swap) swapExpanded(oldNodes, swap);
  const animate = wasWeek !== willWeek && prevView?.tab === 'calendar' && !prevView?.expand && !expanded;
  const first = animate ? calendarEl.getBoundingClientRect() : null;
  const panelFirst = animate && wasWeek ? panelEl.getBoundingClientRect() : null;

  renderCalendar(calendarEl, view, actions);
  // Film mode shows the project's name above the month instead of today's D-Days.
  const ddaysToday = filmOn() ? renderProjectChip(ddaySlot) : renderTodayDdays(ddaySlot, () => { view.tab = 'dday'; render(); });
  calendarView.classList.toggle('has-dday', ddaysToday > 0);
  if (view.selected) renderDay(panelEl, view.selected, actions);
  if (animate) void calendarEl.offsetHeight; // commit the start state so CSS transitions run
  // Going back to the month uses a slower, gentler timing (.closing in styles.css).
  if (animate) calendarView.classList.toggle('closing', !willWeek);
  calendarView.classList.toggle('week-mode', willWeek);
  calendarView.classList.toggle('month-mode', !willWeek);
  if (animate) flip(first, willWeek, panelFirst);
  prevView = { ...view };
}

// Bell (top right of the calendar): friend requests, shares, check-offs.
function paintBell() {
  bellEl.hidden = !socialEnabled() || socialStatus() === 'missing';
  const n = bellEl.hidden ? 0 : unseenCount();
  bellBadge.hidden = !n;
  bellBadge.textContent = n > 9 ? '9+' : String(n);
  bellEl.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}
bellEl.addEventListener('click', () => { openNotifications(); refreshFilm(); });

// Search: results lead to a day, a chat, the D-Day tab or a Write section.
document.getElementById('search-btn').addEventListener('click', () => openSearch((to) => {
  if (to.date) {
    const d = parseKey(to.date);
    Object.assign(view, { tab: 'calendar', selected: to.date, cursor: new Date(d.getFullYear(), d.getMonth(), 1) });
    render();
  } else if (to.chat) {
    view.tab = 'chat';
    render();
    openChat(to.chat);
  } else if (to.write) {
    showWriteSection(to.write);
    view.tab = 'write';
    render();
  } else if (to.tab) {
    view.tab = to.tab;
    render();
  }
}));

// Film Production Mode: the logo (press and hold) switches; project data redraws the views.
setupBrand(document.getElementById('brand'), () => {
  if (filmOn() && view.tab === 'dday') view.tab = 'calendar';
  if (!filmOn() && FILM_TABS.includes(view.tab)) view.tab = 'calendar';
  render();
});
onFilmChange(() => {
  // The film look follows the mode even when it changes without the logo (e.g. signing out).
  // Checked after this turn, so the logo's own animated switch (paintBrand(true)) goes first.
  setTimeout(() => {
    if (document.documentElement.classList.contains('film') !== filmOn()) paintBrand(false);
    applyTheme(); // the status bar takes film mode's background color
  }, 0);
  if (!isGated()) render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') writeBackgrounded();
  else refreshFilm(); // also outside film mode: project invites show in the bell
});
// Collaborators' changes: every 15s in film mode; every 5s while someone else edits the open section.
setInterval(() => {
  if (document.visibilityState !== 'visible' || !filmOn()) return;
  if (view.tab === 'write' && !isEditing() && ['story', 'plot', 'script'].some((s) => editorOf(s))) refreshFilm();
}, 5000);
setInterval(() => { if (document.visibilityState === 'visible' && filmOn()) refreshFilm(); }, 15000);

// Chat: unread count on the dock's Chat tab; the open tab redraws on new messages.
function paintChatBadge() {
  const n = chatEnabled() ? unreadTotal() : 0;
  chatBadge.hidden = !n;
  chatBadge.textContent = n > 99 ? '99+' : String(n);
}
onChatChange(() => {
  paintChatBadge();
  if (view.tab === 'chat' && !isGated()) renderChat(chatEl);
});

// Friends' data changed (shares, requests): redraw what shows it.
onSocialChange(() => {
  paintBell();
  redrawNotifications();
  if (view.tab === 'settings' || view.tab === 'chat' || (view.tab === 'calendar' && !isGated())) render();
});

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  view.tab = t.dataset.view;
  render();
}));

let toastTimer;
setToast((title, body) => {
  toastEl.replaceChildren(h('b', {}, title), body);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
});
toastEl.addEventListener('click', () => { toastEl.hidden = true; });

// Swipe left/right on the calendar to change month/week; swipe down to expand the month.
let touch = null;
calendarEl.addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
calendarEl.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) actions.shift(dx < 0 ? 1 : -1);
  else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) actions.showMonth();
});
// Expanded calendar: swipe sideways to the previous / next week or month.
let xTouch = null;
expandedEl.addEventListener('touchstart', (e) => { xTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
expandedEl.addEventListener('touchend', (e) => {
  if (!xTouch) return;
  const dx = e.changedTouches[0].clientX - xTouch.x;
  const dy = e.changedTouches[0].clientY - xTouch.y;
  xTouch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) actions.shift(dx < 0 ? 1 : -1);
});

onChange(() => { render(); refreshReminders(); });

// Coming back to the app: the date may have changed, so redraw and re-plan alerts.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); refreshReminders(); refreshSocial(); refreshChats(); }
});
// Friends' changes arrive by checking now and then while the app is open.
setInterval(() => { if (document.visibilityState === 'visible') { refreshSocial(); refreshChats(); refreshFilm(); } }, 60 * 1000);

// While typing in a page field (chat composer, Write tab), the dock steps aside so it
// doesn't ride up on top of the keyboard; it returns when the keyboard closes.
const isField = (el) => !!el && el.matches?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])') && !el.closest('dialog');
document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('typing'); });
// Keyboard folding: keep the typing layout until the keyboard is actually down (the
// visible area is full height again), so nothing jumps while it slides away.
let unTypeTimer = 0;
const keyboardDown = () => !window.visualViewport || visualViewport.height > window.innerHeight * 0.85;
function endTyping() {
  clearTimeout(unTypeTimer);
  if (isField(document.activeElement)) return; // focus moved to the next field
  if (keyboardDown()) { document.body.classList.remove('typing'); return; }
  unTypeTimer = setTimeout(endTyping, 60); // still folding; check again (gives up via the cap below)
}
document.addEventListener('focusout', () => {
  setTimeout(endTyping, 80);
  setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('typing'); }, 900);
});

setInterval(() => { if (view.tab === 'calendar' && view.selected === todayKey()) render(); }, 60 * 1000); // move the "now" line

setInterval(tickTimers, 1000); // running stopwatches

// Updates: check for a new version on open and whenever the app comes back to the
// foreground; when a new service worker takes over, reload once to show it.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing old to replace
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });
}

applyTheme();
render();
refreshReminders();
setupSheets();

// Notification taps open the right tab (the service worker sends the view, or #view= on a cold start).
function openFromNotification(target) {
  if (!target || isGated()) return;
  if (target === 'bell') { view.tab = 'calendar'; render(); if (!bellEl.hidden) openNotifications(); return; }
  view.tab = target;
  render();
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open-view') openFromNotification(e.data.view); });
}
const launchView = new URLSearchParams(location.hash.slice(1)).get('view');
if (launchView) history.replaceState(null, '', location.pathname + location.search);

// Account: keep Settings' sync status fresh, handle links from Supabase emails, sync on open.
onCloudChange(() => {
  // Signing in/out swaps between the login page and the app; otherwise only Settings shows sync status.
  if (isGated() !== gateShown || view.tab === 'settings') render();
});
handleAuthRedirect()
  .then((type) => { if (type === 'recovery') { view.tab = 'settings'; render(); openAccountSheet('new-password'); } })
  .catch(() => {})
  .finally(() => syncNow().then(() => { refreshSocial(); refreshChats(); refreshFilm(); syncPush(); openFromNotification(launchView); }));
