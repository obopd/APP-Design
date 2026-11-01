// Month grid that "rolls up" into the selected week when a date is picked.
import { h, icon, ICONS, addDays, dateKey, parseKey, todayKey, fmt } from './util.js';
import { eventsOn, todosOn, isDone, isRoutine, isStarred } from './store.js';
import { sharedTodosOn, sharedEventsOn, isSharedDone } from './social.js';

let weekdayCache = null;
const weekdayLabels = () => (weekdayCache ||= Array.from({ length: 7 }, (_, i) => fmt({ weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))));

// Always 6 weeks, so the calendar card stays the same square size every month.
function weeksOfMonth(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

function dayCell(date, view, month, actions) {
  const key = dateKey(date);
  // Routines only get a dot when starred, so a daily routine doesn't dot every day.
  const events = [...eventsOn(key), ...sharedEventsOn(key)];
  const todos = [...todosOn(key).filter((t) => !isDone(t, key)), ...sharedTodosOn(key).filter((t) => !isSharedDone(t, key))];
  const items = [...events, ...todos].filter((i) => isStarred(i, key) || !isRoutine(i));
  const important = items.some((i) => isStarred(i, key));

  const cls = ['day'];
  if (date.getMonth() !== month) cls.push('other');
  if (key === todayKey()) cls.push('today');
  if (key === view.selected) cls.push('selected');

  const dots = [];
  if (important) dots.push(h('i', { class: 'imp' }));
  if (items.length > (important ? 1 : 0)) dots.push(h('i'));

  return h('button', {
    class: cls.join(' '),
    'aria-label': date.toDateString() + (items.length ? `, ${items.length} items` : ''),
    'aria-pressed': key === view.selected ? 'true' : 'false',
    onclick: () => actions.select(key),
  }, h('span', { class: 'num' }, String(date.getDate())), h('span', { class: 'dots' }, dots));
}

// Month grid. In week mode CSS slides the rows up (transform) and masks them (clip-path)
// so only the selected week shows; no row ever changes size, which keeps the
// month ⇄ week animation on the GPU (see app.js `flip()` and styles.css).
export function renderCalendar(root, view, actions) {
  const weekMode = !!view.selected;
  const cursor = weekMode ? parseKey(view.selected) : view.cursor;
  const month = cursor.getMonth();
  const title = fmt({ month: 'long', year: 'numeric' }).format(cursor);

  const head = h('div', { class: 'cal-head' },
    h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Previous week' : 'Previous month', onclick: () => actions.shift(-1) }, icon(ICONS.left)),
    h('button', {
      class: 'cal-title display',
      'aria-label': weekMode ? `${title}, show whole month` : title,
      onclick: actions.showMonth,
    }, title),
    h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Next week' : 'Next month', onclick: () => actions.shift(1) }, icon(ICONS.right)),
  );

  const labels = weekdayLabels().map((l) => h('span', {}, l));

  const weeks = weeksOfMonth(cursor);
  const selRow = Math.max(0, weeks.findIndex((week) => week.some((d) => dateKey(d) === view.selected)));
  root.style.setProperty('--sel-row', String(selRow));
  root.replaceChildren(head, h('div', { class: 'weekdays' }, labels),
    h('div', { class: 'cal-rows' }, h('div', { class: 'cal-rows-inner' },
      weeks.map((week) => h('div', { class: 'row' }, week.map((d) => dayCell(d, view, month, actions)))))));
}
