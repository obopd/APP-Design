import { addDays, dateKey, parseKey, todayKey, h } from './util.js';
import { onChange } from './store.js';
import { renderCalendar } from './calendar.js';
import { renderDay, renderUpcoming } from './day.js';
import { openEditor } from './editor.js';
import { openSettings, applyTheme } from './settings.js';
import { refreshReminders, setToast } from './reminders.js';

const calendarEl = document.getElementById('calendar');
const panelEl = document.getElementById('panel');
const toastEl = document.getElementById('toast');

// view.selected = 'YYYY-MM-DD' → week mode; null → month mode.
const now = new Date();
const view = { cursor: new Date(now.getFullYear(), now.getMonth(), 1), selected: null };
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
  create: (opts) => openEditor(opts),
  edit: (kind, item) => openEditor({ kind, item }),
  openSettings,
};

function render() {
  renderCalendar(calendarEl, view, prevView, actions);
  if (view.selected) renderDay(panelEl, view.selected, actions);
  else renderUpcoming(panelEl, actions);
  prevView = { ...view };
}

let toastTimer;
setToast((title, body) => {
  toastEl.replaceChildren(h('b', {}, title), body);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
});
toastEl.addEventListener('click', () => { toastEl.hidden = true; });

document.getElementById('add-btn').addEventListener('click', () => {
  openEditor({ kind: 'todo', date: view.selected || todayKey() });
});

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
setInterval(() => { if (view.selected === todayKey()) render(); }, 60 * 1000); // move the "now" line

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

applyTheme();
render();
refreshReminders();
