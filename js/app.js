import { addDays, dateKey, parseKey, todayKey, h } from './util.js';
import { onChange } from './store.js';
import { renderCalendar } from './calendar.js';
import { renderDay, currentLayout, tickTimers } from './day.js';
import { openEditor } from './editor.js';
import { renderSettings, applyTheme } from './settings.js';
import { renderDdays, openDdaySheet, renderTodayDdays } from './dday.js';
import { refreshReminders, setToast } from './reminders.js';
import './haptics.js';

const calendarView = document.getElementById('view-calendar');
const calendarEl = document.getElementById('calendar');
const panelEl = document.getElementById('panel');
const settingsEl = document.getElementById('view-settings');
const ddayEl = document.getElementById('view-dday');
const toastEl = document.getElementById('toast');
const topSlot = document.getElementById('top-slot');

// view.selected = 'YYYY-MM-DD' → week mode; null → month mode.
const now = new Date();
const view = { tab: 'calendar', cursor: new Date(now.getFullYear(), now.getMonth(), 1), selected: null };
let prevView = null;

const actions = {
  select(key) {
    view.selected = view.selected === key ? null : key; // tap the selected day again to go back to month
    const d = parseKey(key);
    view.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  },
  showMonth() {
    if (!view.selected) return;
    view.selected = null;
    render();
  },
  shift(dir) {
    if (view.selected) {
      view.selected = dateKey(addDays(parseKey(view.selected), dir * 7));
      const d = parseKey(view.selected);
      view.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      view.cursor = new Date(view.cursor.getFullYear(), view.cursor.getMonth() + dir, 1);
    }
    render();
  },
  // On the D-Day tab, + adds a D-Day. With the schedule stretched full width, + starts on "Event".
  add: () => (view.tab === 'dday' ? openDdaySheet() : openEditor({
    kind: view.selected && currentLayout() === 'schedule' ? 'event' : 'todo',
    date: view.selected || todayKey(),
  })),
  create: (opts) => openEditor(opts),
  edit: (kind, item) => openEditor({ kind, item }),
  refresh: () => render(),
};

function render() {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.view === view.tab;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  calendarView.hidden = view.tab !== 'calendar';
  settingsEl.hidden = view.tab !== 'settings';
  ddayEl.hidden = view.tab !== 'dday';

  if (view.tab === 'settings') { renderSettings(settingsEl); return; }
  if (view.tab === 'dday') { renderDdays(ddayEl); return; }

  renderCalendar(calendarEl, view, prevView, actions);
  const ddaysToday = renderTodayDdays(topSlot, () => { view.tab = 'dday'; render(); });
  calendarView.classList.toggle('has-dday', ddaysToday > 0);
  // Month mode shows only the calendar, centered; the panel's old content just fades out.
  calendarView.classList.toggle('week-mode', !!view.selected);
  calendarView.classList.toggle('month-mode', !view.selected);
  if (view.selected) renderDay(panelEl, view.selected, actions);
  prevView = { ...view };
}

document.getElementById('add-btn').addEventListener('click', actions.add);

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

onChange(() => { render(); refreshReminders(); });

// Coming back to the app: the date may have changed, so redraw and re-plan alerts.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); refreshReminders(); }
});
setInterval(() => { if (view.tab === 'calendar' && view.selected === todayKey()) render(); }, 60 * 1000); // move the "now" line

setInterval(tickTimers, 1000); // running stopwatches

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

applyTheme();
render();
refreshReminders();
