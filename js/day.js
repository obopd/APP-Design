// The area below the calendar when a day is selected: to-dos + hourly schedule.
import { h, icon, ICONS, todayKey, toMinutes, shortTime, formatDuration, formatClock, formatNumber } from './util.js';
import {
  state, save, eventsOn, todosOn, isDone, isRoutine, toggleDone, childCategories,
  isTracked, valueOn, setValue, startTimer, stopTimer, routineStats,
} from './store.js';
import { askText } from './ui.js';
import { postponeTomorrow, postponePick } from './postpone.js';

const HOUR_PX = 48; // keep in sync with --hour in styles.css

// "1:30" → 90 minutes, "45" → 45 minutes; returns seconds (0 to clear).
function parseMinutes(text) {
  const t = text.trim();
  if (!t) return 0;
  const [a, b] = t.split(':');
  const mins = b !== undefined ? Number(a) * 60 + Number(b) : Number(a);
  return Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : null;
}

// Number shown next to a tracked to-do: tap to record it; time also gets a stopwatch.
function tracker(t, key) {
  const value = valueOn(t, key);

  if (t.track === 'count') {
    return h('span', { class: 'tracker' }, h('button', {
      class: `track-pill${value ? ' has' : ''}`, 'aria-label': `Count for ${t.title}: ${value || 'none'}`,
      onclick: async () => {
        const input = await askText({ title: t.title, message: 'Count', value: value ? String(value) : '', inputmode: 'decimal' });
        if (input === null) return;
        const n = Number(input.trim() || 0);
        if (Number.isFinite(n) && n >= 0) setValue(t, key, n);
      },
    }, value ? formatNumber(value) : '0'));
  }

  const running = t.timer && t.timer.key === key;
  const pill = h('button', {
    class: `track-pill${value || running ? ' has' : ''}${running ? ' running' : ''}`,
    'aria-label': `Time for ${t.title}: ${value ? formatDuration(value) : 'none'}`,
    onclick: async () => {
      if (running) return;
      const mins = value ? `${Math.floor(value / 3600)}:${String(Math.round((value % 3600) / 60)).padStart(2, '0')}` : '';
      const input = await askText({ title: t.title, message: 'Time spent: minutes, or h:mm', value: mins, placeholder: 'e.g. 45 or 1:30', inputmode: 'numeric' });
      if (input === null) return;
      const secs = parseMinutes(input);
      if (secs !== null) setValue(t, key, secs);
    },
  }, running ? formatClock(value + (Date.now() - t.timer.start) / 1000) : value ? formatDuration(value) : '0m');
  if (running) {
    pill.dataset.liveStart = String(t.timer.start);
    pill.dataset.liveBase = String(value);
  }
  const watch = h('button', {
    class: `track-btn${running ? ' running' : ''}`, 'aria-label': running ? 'Stop stopwatch' : 'Start stopwatch',
    onclick: () => (running ? stopTimer(t) : startTimer(t, key)),
  }, icon(running ? ICONS.stop : ICONS.play));
  return h('span', { class: 'tracker' }, pill, watch);
}

// Update running stopwatches in place (called every second by app.js).
export function tickTimers() {
  document.querySelectorAll('[data-live-start]').forEach((el) => {
    el.textContent = formatClock(Number(el.dataset.liveBase) + (Date.now() - Number(el.dataset.liveStart)) / 1000);
  });
}

// Swipe a to-do left to reveal Postpone actions (tomorrow / pick a date).
const ACTIONS_W = 112;
let openRow = null; // only one row stays open at a time
const closeRow = (row) => { if (row) { row.style.transform = ''; row.classList.remove('open'); } if (openRow === row) openRow = null; };
document.addEventListener('pointerdown', (e) => { if (openRow && !e.target.closest('.todo.swipe-open')) closeRow(openRow); }, true);

function makeSwipeable(li, row) {
  let start = null;
  let dragged = false;
  row.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, base: row.classList.contains('open') ? -ACTIONS_W : 0, id: e.pointerId };
    dragged = false;
  });
  row.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    if (!dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.3) {
      dragged = true;
      row.setPointerCapture(e.pointerId);
      row.classList.add('dragging');
      if (openRow && openRow !== row) closeRow(openRow);
    }
    if (dragged) row.style.transform = `translateX(${Math.min(0, Math.max(-ACTIONS_W - 24, start.base + dx))}px)`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const x = start.base + (e.clientX - start.x);
    start = null;
    row.classList.remove('dragging');
    if (!dragged) return;
    if (x < -ACTIONS_W / 2) { row.style.transform = `translateX(${-ACTIONS_W}px)`; row.classList.add('open'); li.classList.add('swipe-open'); openRow = row; }
    else { closeRow(row); li.classList.remove('swipe-open'); }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  // A swipe shouldn't also count as a tap on the mark or the title.
  row.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
}

// The slim mark checks a to-do off; tapping the text opens it for editing.
function todoItem(t, key, actions) {
  const done = isDone(t, key);
  const row = h('div', { class: 'todo-row' },
    h('button', {
      class: 'mark-btn', role: 'checkbox', 'aria-checked': String(done), 'aria-label': `Done: ${t.title}`,
      onclick: () => toggleDone(t, key),
    }, h('span', { class: 'dash' })),
    h('button', { class: 'todo-title', onclick: () => actions.edit('todo', t, key) },
      t.title,
      t.important ? h('span', { class: 'mark star', 'aria-hidden': 'true' }, '★') : null),
    isTracked(t) ? tracker(t, key) : null);
  const li = h('li', { class: `todo${done ? ' done' : ''}${t.important ? ' imp' : ''}` },
    h('div', { class: 'todo-actions' },
      h('button', { class: 'todo-act', 'aria-label': `Postpone ${t.title} to tomorrow`, onclick: () => postponeTomorrow(t, key) },
        icon(ICONS.arrow), h('span', {}, 'Tmrw')),
      h('button', { class: 'todo-act', 'aria-label': `Postpone ${t.title} to a date`, onclick: () => { closeRow(row); postponePick(t, key); } },
        icon(ICONS.calendar), h('span', {}, 'Date'))),
    row);
  makeSwipeable(li, row);
  return li;
}

// One section's to-dos grouped into (nested) category folders. A folder only shows
// if it has to-dos here somewhere inside it; its open/closed state is saved.
function folderTree(todos, key, actions) {
  const known = new Set(state.categories.map((c) => c.id));
  const catOf = (t) => (known.has(t.category) ? t.category : null);

  const countIn = (catId) => todos.filter((t) => catOf(t) === catId).length
    + childCategories(catId).reduce((n, c) => n + countIn(c.id), 0);
  const openIn = (catId) => todos.filter((t) => catOf(t) === catId && !isDone(t, key)).length
    + childCategories(catId).reduce((n, c) => n + openIn(c.id), 0);

  const branch = (catId) => {
    const items = todos.filter((t) => catOf(t) === catId).map((t) => todoItem(t, key, actions));
    const folders = childCategories(catId).filter((c) => countIn(c.id) > 0).map((c) => {
      const left = openIn(c.id);
      return h('li', { class: `folder${c.open === false ? '' : ' open'}` },
        h('button', {
          class: 'folder-head', 'aria-expanded': String(c.open !== false),
          style: c.color ? `--folder-line:${c.color}` : null,
          onclick: () => { c.open = c.open === false; save(); },
        }, icon(ICONS.right), h('span', { class: 'folder-name' }, c.name), left ? h('span', { class: 'folder-count' }, String(left)) : null),
        h('ul', { class: 'todos' }, branch(c.id)));
    });
    return [...items, ...folders];
  };

  return h('ul', { class: 'todos root' }, branch(null));
}

let showStats = false;

function routineStatsList(tracked) {
  return h('ul', { class: 'routine-stats' }, tracked.map((t) => {
    const { times, total } = routineStats(t);
    const amount = t.track === 'time' ? formatDuration(total) : formatNumber(total);
    return h('li', {},
      h('span', { class: 'rs-name' }, t.title),
      h('span', { class: 'rs-times' }, `${times}×`),
      h('span', { class: 'rs-total' }, total ? amount : '—'));
  }));
}

// Routines on top (shaded box), regular to-dos below. Both sections always show,
// each with its own + (a routine starts as a daily to-do).
function todoColumn(key, actions) {
  const todos = todosOn(key);
  const routines = todos.filter(isRoutine);
  const regular = todos.filter((t) => !isRoutine(t));

  const left = (list) => list.filter((t) => !isDone(t, key)).length;
  const count = (list) => (left(list) ? h('span', { class: 'section-count' }, String(left(list))) : null);
  const plus = (label, opts) => h('button', {
    class: 'icon-btn section-add', 'aria-label': label,
    onclick: () => actions.create({ kind: 'todo', date: key, ...opts }),
  }, icon(ICONS.plus));

  // If any routine is tracked, tapping "Routines" reveals how often each was done.
  const tracked = routines.filter(isTracked);
  const routineTitle = tracked.length
    ? h('button', {
      class: `section-label stats-toggle${showStats ? ' open' : ''}`, 'aria-expanded': String(showStats),
      onclick: () => { showStats = !showStats; actions.refresh(); },
    }, 'Routines', count(routines), icon(ICONS.right))
    : h('h3', { class: 'section-label' }, 'Routines', count(routines));

  return h('div', { class: 'col' }, h('div', { class: 'col-scroll', 'data-scroll': 'todos' },
    h('section', { class: 'todo-section routines' },
      h('div', { class: 'section-head' }, routineTitle, plus('Add routine', { repeat: 'daily' })),
      tracked.length && showStats ? routineStatsList(tracked) : null,
      routines.length ? folderTree(routines, key, actions) : null),
    h('section', { class: 'todo-section' },
      h('div', { class: 'section-head' }, h('h3', { class: 'section-label' }, 'To-do', count(regular)), plus('Add to-do')),
      regular.length ? folderTree(regular, key, actions) : null)));
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
  for (let hr = 1; hr < 24; hr++) {
    const label = new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' });
    hours.push(h('button', {
      class: 'hour', style: `top:${hr * HOUR_PX}px`, 'aria-label': `Add at ${label}`,
      onclick: () => actions.create({ kind: 'event', date: key, hour: hr }),
    }, h('span', {}, label)));
  }
  // Midnight row has no label (keeps the top clean) but is still tappable.
  hours.unshift(h('button', {
    class: 'hour', style: 'top:0;border-top:0', 'aria-label': 'Add at midnight',
    onclick: () => actions.create({ kind: 'event', date: key, hour: 0 }),
  }));

  const blocks = layoutLanes(timed).map(({ e, start, end, lane, lanes }) =>
    h('button', {
      class: `event${e.important ? ' imp' : ''}`,
      style: `top:${(start / 60) * HOUR_PX + 1}px;height:${((end - start) / 60) * HOUR_PX - 2}px;` +
        `left:calc(${(lane / lanes) * 100}% + 2px);width:calc(${100 / lanes}% - 4px)`,
      onclick: () => actions.edit('event', e),
    }, h('b', {}, e.title), h('small', {}, `${shortTime(e.start)}–${shortTime(e.end)}`)));

  const timeline = h('div', { class: 'timeline' }, hours, h('div', { class: 'events' }, blocks));

  if (key === todayKey()) {
    const now = new Date();
    timeline.append(h('div', { class: 'now', style: `top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px` }));
  }

  return h('div', { class: 'col' },
    allDay.length ? h('div', { class: 'allday' }, allDay.map((e) =>
      h('button', { class: `event${e.important ? ' imp' : ''}`, onclick: () => actions.edit('event', e) },
        h('b', {}, e.title)))) : null,
    h('div', { class: 'col-scroll', 'data-scroll': 'timeline' }, timeline),
  );
}

/* ---------- Stretchable split ----------
   'split' shows both columns; 'todo' / 'schedule' stretch one column to full width.
   Drag the divider (or swipe sideways) to stretch a side, and the same way back. */
const SPLIT = 1 / 2.25; // default to-do share (to-do 1 : schedule 1.25)
let layout = 'split';

const shareFor = (mode) => (mode === 'todo' ? 1 : mode === 'schedule' ? 0 : SPLIT);

function setShare(columns, share) {
  columns.style.gridTemplateColumns = `minmax(0, ${share}fr) var(--divider) minmax(0, ${1 - share}fr)`;
  columns.dataset.layout = share >= 1 ? 'todo' : share <= 0 ? 'schedule' : 'split';
}

function applyLayout(columns, mode) {
  layout = mode;
  setShare(columns, shareFor(mode));
}

function makeStretchable(columns, divider) {
  let drag = null;
  divider.addEventListener('pointerdown', (e) => {
    const box = columns.getBoundingClientRect();
    drag = { left: box.left, width: box.width };
    divider.setPointerCapture(e.pointerId);
    columns.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!drag) return;
    setShare(columns, Math.min(1, Math.max(0, (e.clientX - drag.left) / drag.width)));
  });
  const end = (e) => {
    if (!drag) return;
    const share = Math.min(1, Math.max(0, (e.clientX - drag.left) / drag.width));
    drag = null;
    columns.classList.remove('dragging');
    // Snap: near an edge stretches that side, otherwise back to the split.
    applyLayout(columns, share > 0.72 ? 'todo' : share < 0.2 ? 'schedule' : 'split');
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);

  // Sideways swipe anywhere on the lists moves one step: schedule ⇄ split ⇄ to-do.
  let touch = null;
  columns.addEventListener('touchstart', (e) => {
    if (e.target.closest('.divider') || e.target.closest('.todo')) return; // swiping a to-do = postpone
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  columns.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const order = ['schedule', 'split', 'todo'];
    const i = order.indexOf(layout) + (dx > 0 ? 1 : -1);
    if (i >= 0 && i < order.length) applyLayout(columns, order[i]);
  });
}

export function renderDay(root, key, actions) {
  // Keep scroll positions when re-rendering the same day (e.g. after ticking a to-do).
  const sameDay = root.dataset.date === key;
  const scrolls = {};
  if (sameDay) root.querySelectorAll('[data-scroll]').forEach((el) => { scrolls[el.dataset.scroll] = el.scrollTop; });

  root.dataset.date = key;
  const divider = h('div', { class: 'divider', role: 'separator', 'aria-label': 'Drag to stretch to-do or schedule' }, h('span', { class: 'grip' }));
  const columns = h('div', { class: 'columns' }, todoColumn(key, actions), divider, scheduleColumn(key, actions));
  setShare(columns, shareFor(layout));
  makeStretchable(columns, divider);
  root.replaceChildren(columns);

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
