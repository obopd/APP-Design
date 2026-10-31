// The area below the calendar: a selected day's to-dos + hourly schedule,
// or (in month view) the list of upcoming important items.
import { h, icon, ICONS, parseKey, todayKey, toMinutes, formatTime, daysBetween } from './util.js';
import { save, eventsOn, todosOn, upcomingImportant } from './store.js';

const HOUR_PX = 52; // keep in sync with --hour in styles.css

function todoColumn(key, actions) {
  const todos = todosOn(key);
  const list = h('ul', { class: 'todos' }, todos.map((t) =>
    h('li', { class: `todo${t.done ? ' done' : ''}` },
      h('button', {
        class: 'check', role: 'checkbox', 'aria-checked': String(!!t.done), 'aria-label': `Done: ${t.title}`,
        onclick: () => { t.done = !t.done; save(); },
      }, icon(ICONS.check)),
      h('button', { class: 'todo-title', onclick: () => actions.edit('todo', t) },
        t.title, t.important ? h('span', { class: 'star', 'aria-label': 'important' }, '★') : null),
    )));

  return h('div', { class: 'col' },
    h('div', { class: 'col-label' }, `To-do${todos.length ? ` · ${todos.filter((t) => !t.done).length}` : ''}`),
    h('div', { class: 'col-scroll', 'data-scroll': 'todos' },
      todos.length ? list : h('p', { class: 'empty' }, 'Nothing to do.'),
      h('button', { class: 'link-btn', onclick: () => actions.create({ kind: 'todo', date: key }) }, '+ Add to-do'),
    ),
  );
}

// Assign overlapping timed events to side-by-side lanes.
function layoutLanes(events) {
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const p of cluster) {
      let lane = lanes.findIndex((end) => end <= p.start);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = p.end;
      p.lane = lane;
    }
    for (const p of cluster) p.lanes = lanes.length;
    placed.push(...cluster);
    cluster = [];
  };
  for (const e of events) {
    const start = toMinutes(e.start);
    const end = Math.max(toMinutes(e.end), start + 20);
    if (start >= clusterEnd) { flush(); clusterEnd = end; }
    else clusterEnd = Math.max(clusterEnd, end);
    cluster.push({ e, start, end });
  }
  flush();
  return placed;
}

function scheduleColumn(key, actions) {
  const events = eventsOn(key);
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const hours = [];
  for (let hr = 0; hr < 24; hr++) {
    const label = new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' });
    hours.push(h('button', {
      class: 'hour', style: `top:${hr * HOUR_PX}px`, 'aria-label': `Add schedule at ${label}`,
      onclick: () => actions.create({ kind: 'event', date: key, hour: hr }),
    }, h('span', {}, label)));
  }

  const blocks = layoutLanes(timed).map(({ e, start, end, lane, lanes }) =>
    h('button', {
      class: `event${e.important ? ' imp' : ''}`,
      style: `top:${(start / 60) * HOUR_PX + 1}px;height:${((end - start) / 60) * HOUR_PX - 2}px;` +
        `left:calc(${(lane / lanes) * 100}% + 2px);width:calc(${100 / lanes}% - 4px)`,
      onclick: () => actions.edit('event', e),
    }, h('b', {}, e.title), h('small', {}, `${formatTime(e.start)} – ${formatTime(e.end)}`)));

  const timeline = h('div', { class: 'timeline' }, hours, h('div', { class: 'events' }, blocks));

  if (key === todayKey()) {
    const now = new Date();
    timeline.append(h('div', { class: 'now', style: `top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px` }));
  }

  return h('div', { class: 'col' },
    h('div', { class: 'col-label' }, 'Schedule'),
    allDay.length ? h('div', { class: 'allday' }, allDay.map((e) =>
      h('button', { class: `event${e.important ? ' imp' : ''}`, onclick: () => actions.edit('event', e) },
        h('b', {}, (e.repeat === 'yearly' ? '↻ ' : '') + e.title)))) : null,
    h('div', { class: 'col-scroll', 'data-scroll': 'timeline' }, timeline),
  );
}

export function renderDay(root, key, actions) {
  // Keep scroll positions when re-rendering the same day (e.g. after ticking a to-do).
  const sameDay = root.dataset.date === key;
  const scrolls = {};
  if (sameDay) root.querySelectorAll('[data-scroll]').forEach((el) => { scrolls[el.dataset.scroll] = el.scrollTop; });

  const date = parseKey(key);
  const diff = daysBetween(todayKey(), key);
  const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : '';

  root.dataset.date = key;
  root.replaceChildren(
    h('div', { class: 'panel-head' },
      h('h2', {}, date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })),
      h('p', {}, rel)),
    h('div', { class: 'columns' }, todoColumn(key, actions), scheduleColumn(key, actions)),
  );

  const tl = root.querySelector('[data-scroll="timeline"]');
  if (sameDay) {
    root.querySelectorAll('[data-scroll]').forEach((el) => { el.scrollTop = scrolls[el.dataset.scroll] || 0; });
  } else {
    // Start at the first event, or at the current hour today, or 8 AM.
    const first = eventsOn(key).find((e) => !e.allDay);
    const hour = first ? toMinutes(first.start) / 60 : key === todayKey() ? new Date().getHours() : 8;
    tl.scrollTop = Math.max(0, (hour - 1) * HOUR_PX - 12); // leave room for the hour label
  }
}

export function renderUpcoming(root, actions) {
  delete root.dataset.date;
  const today = todayKey();
  const items = upcomingImportant(today, 60);

  const list = h('ul', { class: 'upcoming' }, items.map(({ kind, item, date }) => {
    const d = parseKey(date);
    const diff = daysBetween(today, date);
    const when = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff} days`;
    const sub = kind === 'todo' ? 'To-do'
      : item.allDay ? (item.repeat === 'yearly' ? 'Every year' : 'All day')
      : formatTime(item.start);
    return h('li', {},
      h('button', { class: 'up-item', onclick: () => actions.select(date) },
        h('div', { class: 'up-date' },
          h('small', {}, d.toLocaleDateString(undefined, { month: 'short' })),
          h('b', {}, String(d.getDate()))),
        h('div', { class: 'up-main' }, h('b', {}, item.title), h('small', {}, sub)),
        h('span', { class: 'up-when' }, when)));
  }));

  root.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Coming up'), h('p', {}, 'Important · next 60 days')),
    items.length ? list : h('p', { class: 'empty' },
      'Nothing important coming up. Mark a to-do or schedule as Important (★) — like a parent’s birthday — and it shows here.'),
  );
}
