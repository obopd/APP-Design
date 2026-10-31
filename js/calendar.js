// Month grid that "rolls up" into the selected week when a date is picked.
import { h, icon, ICONS, addDays, dateKey, parseKey, todayKey } from './util.js';
import { eventsOn, todosOn } from './store.js';

function weeksOfMonth(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let start = addDays(first, -first.getDay());
  const weeks = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    start = addDays(start, 7);
  } while (start.getMonth() === cursor.getMonth());
  return weeks;
}

function dayCell(date, view, month, actions) {
  const key = dateKey(date);
  const events = eventsOn(key);
  const todos = todosOn(key).filter((t) => !t.done);
  const items = [...events, ...todos];
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
  const title = cursor.toLocaleDateString(undefined, { month: 'long', year: cursor.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

  const head = h('div', { class: 'cal-head' },
    h('button', {
      class: `cal-title display${weekMode ? ' week' : ''}`,
      'aria-label': weekMode ? 'Show whole month' : title,
      onclick: actions.showMonth,
    }, title, icon(ICONS.down)),
    h('div', { class: 'cal-actions' },
      h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Previous week' : 'Previous month', onclick: () => actions.shift(-1) }, icon(ICONS.left)),
      h('button', { class: 'icon-btn', 'aria-label': weekMode ? 'Next week' : 'Next month', onclick: () => actions.shift(1) }, icon(ICONS.right)),
      h('button', { class: 'icon-btn add-btn', 'aria-label': 'Add', onclick: actions.add }, icon(ICONS.plus)),
    ),
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
