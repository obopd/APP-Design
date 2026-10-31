// Month grid that "rolls up" into the selected week when a date is picked.
import { h, icon, ICONS, addDays, dateKey, parseKey, todayKey } from './util.js';
import { eventsOn, todosOn, isDone, isRoutine } from './store.js';

// Always 6 weeks, so the calendar card stays the same square size every month.
function weeksOfMonth(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

function dayCell(date, view, month, actions) {
  const key = dateKey(date);
  // Routines only get a dot when starred, so a daily routine doesn't dot every day.
  const events = eventsOn(key);
  const todos = todosOn(key).filter((t) => !isDone(t, key));
  const items = [...events, ...todos].filter((i) => i.important || !isRoutine(i));
  const important = items.some((i) => i.important);

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

// `prev` is the view before this render; rows start in their old collapsed state
// and switch on the next frame so the roll-up/roll-down animates.
export function renderCalendar(root, view, prev, actions) {
  const weekMode = !!view.selected;
  const cursor = weekMode ? parseKey(view.selected) : view.cursor;
  const month = cursor.getMonth();
  const title = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const head = h('div', { class: 'cal-head' },
    h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Previous week' : 'Previous month', onclick: () => actions.shift(-1) }, icon(ICONS.left)),
    h('button', {
      class: 'cal-title display',
      'aria-label': weekMode ? `${title}, show whole month` : title,
      onclick: actions.showMonth,
    }, title),
    h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Next week' : 'Next month', onclick: () => actions.shift(1) }, icon(ICONS.right)),
  );

  const labels = [];
  for (let i = 0; i < 7; i++) {
    labels.push(h('span', {}, new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' })));
  }

  const isCollapsed = (week, sel) => !!sel && !week.some((d) => dateKey(d) === sel);
  const weeks = weeksOfMonth(cursor);
  // Animate only month<->week switches within the same month; otherwise start in the final state.
  let startSel = view.selected;
  if (prev && !prev.selected) startSel = null;
  else if (prev && prev.selected && parseKey(prev.selected).getMonth() === month) startSel = prev.selected;
  const rows = weeks.map((week) => {
    const wrap = h('div', { class: 'row-wrap' }, h('div', { class: 'row' }, week.map((d) => dayCell(d, view, month, actions))));
    wrap.classList.toggle('collapsed', isCollapsed(week, startSel));
    return { wrap, week };
  });

  root.replaceChildren(head, h('div', { class: 'weekdays' }, labels), ...rows.map((r) => r.wrap));

  void root.offsetHeight; // commit the starting state before transitioning
  for (const r of rows) r.wrap.classList.toggle('collapsed', isCollapsed(r.week, view.selected));
}
