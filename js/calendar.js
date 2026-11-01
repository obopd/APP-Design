// Month grid that "rolls up" into the selected week when a date is picked.
import { h, icon, ICONS, addDays, dateKey, parseKey, todayKey, fmt, formatTime } from './util.js';
import { state, eventsOn, todosOn, isDone, isRoutine, isStarred, hasDue } from './store.js';
import { sharedTodosOn, sharedEventsOn, isSharedDone, sharedTodos } from './social.js';

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
    h('span', { class: 'cal-title-wrap' },
      h('button', {
        class: 'cal-title display',
        'aria-label': weekMode ? `${title}, show whole month` : title,
        onclick: actions.showMonth,
      }, title),
      weekMode ? null : gridButton(null, actions)),
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

/* ---------- Expanded calendar (grid button) ----------
   One tap: this week as 7 rows; two taps: the whole month, taller; three: back.
   Shows every event and every to-do with a due date (on its due date). */

function gridButton(expand, actions) {
  const label = expand === 'week' ? 'Show whole month expanded' : expand === 'month' ? 'Back to calendar' : 'Expand to week';
  return h('button', {
    class: `icon-btn grid-btn${expand ? ' on' : ''}`, 'aria-label': label, 'aria-pressed': String(!!expand),
    'data-expand': expand || '', onclick: actions.toggleExpand,
  }, icon(ICONS.grid));
}

// Events (mine + shared) and to-dos due that day (mine + shared), events by time first.
function agendaOn(key) {
  const events = [...eventsOn(key), ...sharedEventsOn(key)].sort((a, b) =>
    (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') : a.allDay ? -1 : 1));
  const due = [...state.todos.filter((t) => hasDue(t) && t.due === key), ...sharedTodos().filter((t) => hasDue(t) && t.due === key)];
  return [
    ...events.map((e) => ({ kind: 'event', item: e })),
    ...due.map((t) => ({ kind: 'due', item: t })),
  ];
}

// '2:00 PM' → '2PM', '2:30 PM' → '2:30PM' (24-hour formats stay as they are).
const compactTime = (t) => (/[AP]M/i.test(formatTime(t)) ? formatTime(t).replace(':00', '').replace(/\s/g, '') : formatTime(t));

function chip({ kind, item }, withTime) {
  const cls = ['chip', kind === 'event' ? 'chip-ev' : 'chip-due']; // not .event: that's the timeline block
  if (item.important || (kind === 'due' && !item.done)) cls.push('imp');
  if (item.shared) cls.push('shared');
  if (kind === 'due' && item.done) cls.push('done');
  const time = kind === 'event' && !item.allDay && withTime ? h('span', { class: 'chip-time' }, compactTime(item.start)) : null;
  return h('span', { class: cls.join(' ') }, kind === 'due' ? h('i', { class: 'chip-dash' }) : null, time, h('span', { class: 'chip-text' }, item.title));
}

export function renderExpanded(root, view, actions) {
  const expand = view.expand;
  const today = todayKey();
  let title;
  let body;

  if (expand === 'week') {
    const start = parseKey(view.week);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const end = days[6];
    title = start.getMonth() === end.getMonth()
      ? `${fmt({ month: 'short' }).format(start)} ${start.getDate()} – ${end.getDate()}`
      : `${fmt({ month: 'short', day: 'numeric' }).format(start)} – ${fmt({ month: 'short', day: 'numeric' }).format(end)}`;
    body = h('div', { class: 'xw-rows' }, days.map((d) => {
      const key = dateKey(d);
      const items = agendaOn(key);
      return h('button', {
        class: `xw-row${key === today ? ' today' : ''}${d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : ''}`,
        'aria-label': `${d.toDateString()}${items.length ? `, ${items.length} items` : ''}`,
        onclick: () => actions.select(key),
      },
      h('span', { class: 'xw-date' },
        h('span', { class: 'xw-dow' }, fmt({ weekday: 'short' }).format(d)),
        h('span', { class: 'xw-num display' }, String(d.getDate()))),
      h('span', { class: 'xw-items' }, items.length ? items.map((it) => chip(it, true)) : h('span', { class: 'xw-none' }, '·')));
    }));
  } else {
    const cursor = view.cursor;
    const month = cursor.getMonth();
    title = fmt({ month: 'long', year: 'numeric' }).format(cursor);
    const MAX = 3;
    body = h('div', { class: 'xm' },
      h('div', { class: 'weekdays' }, weekdayLabels().map((l) => h('span', {}, l))),
      h('div', { class: 'xm-rows' }, weeksOfMonth(cursor).map((week) => h('div', { class: 'xm-row' }, week.map((d) => {
        const key = dateKey(d);
        const items = agendaOn(key);
        const cls = ['xm-day'];
        if (d.getMonth() !== month) cls.push('other');
        if (key === today) cls.push('today');
        return h('button', {
          class: cls.join(' '), 'aria-label': `${d.toDateString()}${items.length ? `, ${items.length} items` : ''}`,
          onclick: () => actions.select(key),
        },
        h('span', { class: 'xm-num' }, String(d.getDate())),
        // Room for 3 lines: 3 items, or 2 and "+n more".
        items.slice(0, items.length > MAX ? MAX - 1 : MAX).map((it) => chip(it, false)),
        items.length > MAX ? h('span', { class: 'xm-more' }, `+${items.length - MAX + 1}`) : null);
      })))));
  }

  root.replaceChildren(
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': expand === 'week' ? 'Previous week' : 'Previous month', onclick: () => actions.shift(-1) }, icon(ICONS.left)),
      h('span', { class: 'cal-title-wrap' },
        h('span', { class: 'cal-title display' }, title),
        gridButton(expand, actions)),
      h('button', { class: 'icon-btn', 'aria-label': expand === 'week' ? 'Next week' : 'Next month', onclick: () => actions.shift(1) }, icon(ICONS.right))),
    body);
  root.dataset.expand = expand;
}
