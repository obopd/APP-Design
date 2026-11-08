// The area below the calendar when a day is selected: to-dos + hourly schedule.
import { h, icon, ICONS, fmt, todayKey, parseKey, daysBetween, toMinutes, shortTime, formatDuration, formatClock, formatNumber } from './util.js';
import {
  cur, save, eventsOn, todosOn, isDone, isRoutine, toggleDone, childCategories,
  isTracked, valueOn, setValue, startTimer, stopTimer, pauseTimer, timerRunning, timerPaused, routineStats, hasDue, rollsOver, isStarred, folderHome,
} from './store.js';
import { askText, tell, snack } from './ui.js';
import { sharedTodosOn, sharedEventsOn, isSharedDone, toggleShared, nameOf } from './social.js';
import { postponeTomorrow, postponePick } from './postpone.js';
import { openFolderSheet } from './folders.js';

let hourLabels = null;
const hourLabel = (hr) => (hourLabels ||= Array.from({ length: 24 }, (_, i) => fmt({ hour: 'numeric' }).format(new Date(2000, 0, 1, i))))[hr];

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

  const running = timerRunning(t, key);
  const paused = timerPaused(t, key);
  const pill = h('button', {
    class: `track-pill${value || running ? ' has' : ''}${running ? ' running' : ''}${paused ? ' paused' : ''}`,
    'aria-label': `Time for ${t.title}: ${value ? formatDuration(value) : 'none'}`,
    onclick: async () => {
      if (running || paused) return;
      const mins = value ? `${Math.floor(value / 3600)}:${String(Math.round((value % 3600) / 60)).padStart(2, '0')}` : '';
      const input = await askText({ title: t.title, message: 'Time spent: minutes, or h:mm', value: mins, placeholder: 'e.g. 45 or 1:30', inputmode: 'numeric' });
      if (input === null) return;
      const secs = parseMinutes(input);
      if (secs !== null) setValue(t, key, secs);
    },
  }, running ? formatClock(value + (Date.now() - t.timer.start) / 1000) : paused ? formatClock(value) : value ? formatDuration(value) : '0m');
  if (running) {
    pill.dataset.liveStart = String(t.timer.start);
    pill.dataset.liveBase = String(value);
  }
  // Running: ⏸ pause + ■ stop. Paused: ▶ resume + ■ stop. Idle: ▶ start.
  const btn = (label, ic, fn, cls = '') => h('button', { class: `track-btn${cls}`, 'aria-label': label, onclick: fn }, icon(ic));
  const buttons = running
    ? [btn('Pause stopwatch', ICONS.pause, () => pauseTimer(t), ' running'), btn('Stop stopwatch', ICONS.stop, () => stopTimer(t))]
    : paused
      ? [btn('Resume stopwatch', ICONS.play, () => startTimer(t, key), ' running'), btn('Stop stopwatch', ICONS.stop, () => stopTimer(t))]
      : [btn('Start stopwatch', ICONS.play, () => startTimer(t, key))];
  return h('span', { class: 'tracker' }, pill, ...buttons);
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
    if (li.classList.contains('moving')) { start = null; return; }
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

// Press and hold a to-do, then drag it: between two to-dos = put it there (a gap opens;
// it joins their folder), onto a folder = into that folder, onto a section heading = out of any folder.
const HOLD_MS = 450;
let moving = false;
// While a to-do is being moved, the page mustn't scroll under the finger.
document.addEventListener('touchmove', (e) => { if (moving) e.preventDefault(); }, { passive: false });

const headOf = (ul) => ul.closest('li.folder')?.querySelector(':scope > .folder-head')
  || ul.closest('.todo-section')?.querySelector(':scope > .section-head');

function makeMovable(li, row, t) {
  let hold = null; // { x, y, id, timer }
  let drag = null; // { x, y, y0, drop, scroller, raf, gap }
  let swallowClick = false;

  // Slide everything in the list from where it was to where it is now (FLIP).
  const slide = (change) => {
    const sc = drag.scroller || document;
    const els = [...sc.querySelectorAll('li.todo:not(.moving), .folder-head, .section-head')];
    const tops = els.map((el) => el.getBoundingClientRect().top);
    const liTop = li.getBoundingClientRect().top;
    change();
    // The lifted to-do stays under the finger even if the list above it changed.
    drag.y0 += li.getBoundingClientRect().top - liTop;
    li.style.transform = `translateY(${drag.y - drag.y0}px) scale(1.03)`;
    els.forEach((el, i) => {
      const dy = tops[i] - el.getBoundingClientRect().top;
      if (!dy) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => { el.style.transition = 'transform .2s var(--ease)'; el.style.transform = ''; });
    });
  };
  const resetSlides = () => (drag?.scroller || document).querySelectorAll('li.todo, .folder-head, .section-head')
    .forEach((el) => { if (el !== li) { el.style.transition = ''; el.style.transform = ''; } });

  // What's under the finger: a to-do row (the gap opens above / below it), or a folder /
  // section heading.
  const dropAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('.shared-section')) return null;
    if (el === drag.gap || el.closest('li.todo-gap')) return drag.drop;
    const over = el.closest('li.todo');
    if (over && over !== li && over.parentElement.matches('ul.todos')) {
      const box = over.getBoundingClientRect();
      const ul = over.parentElement;
      let before = y < box.top + box.height / 2 ? over : over.nextElementSibling;
      while (before && (before === li || before === drag.gap)) before = before.nextElementSibling;
      return { head: headOf(ul), ul, before };
    }
    const head = el.closest('[data-drop]')
      || el.closest('li.folder')?.querySelector(':scope > .folder-head')
      || el.closest('.todo-section')?.querySelector(':scope > .section-head');
    return head ? { head } : null;
  };
  const mark = (d) => {
    const old = drag.drop;
    if (old === d || (old && d && old.head === d.head && old.ul === d.ul && old.before === d.before)) return;
    old?.head?.classList.remove('drop-on');
    drag.drop = d;
    if (d && !d.ul) d.head.classList.add('drop-on');
    // Open the gap where it will land; over a heading it goes back to its own place.
    const ul = d?.ul || li.parentElement;
    const before = d?.ul ? d.before : li.nextElementSibling === drag.gap ? drag.gap.nextElementSibling : li.nextElementSibling;
    if (drag.gap.parentElement === ul && (drag.gap.nextElementSibling === before || drag.gap === before)) return;
    slide(() => ul.insertBefore(drag.gap, before));
  };
  const cancelHold = () => { if (hold) clearTimeout(hold.timer); hold = null; };

  row.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || li.classList.contains('swipe-open')) return;
    const id = e.pointerId;
    hold = { x: e.clientX, y: e.clientY, id, timer: setTimeout(() => {
      if (!hold) return;
      hold = null;
      moving = true;
      swallowClick = true;
      const height = li.offsetHeight;
      // The lifted to-do gives its space to a gap that travels to where it will land.
      const gap = h('li', { class: 'todo-gap', style: `height:${height}px` });
      drag = { x: e.clientX, y: e.clientY, y0: e.clientY, drop: null, scroller: li.closest('.col-scroll'), gap };
      li.after(gap);
      li.style.marginBottom = `${-height}px`;
      try { row.setPointerCapture(id); } catch { /* pointer already gone */ }
      li.classList.add('moving');
      loop();
    }, HOLD_MS) };
  });
  // Follow the finger; near the top / bottom edge of the list it keeps scrolling.
  const follow = () => {
    const sc = drag.scroller;
    if (sc) {
      const box = sc.getBoundingClientRect();
      const step = drag.y < box.top + 40 ? -5 : drag.y > box.bottom - 40 ? 5 : 0;
      const before = sc.scrollTop;
      if (step) sc.scrollTop += step;
      drag.y0 -= sc.scrollTop - before;
    }
    li.style.transform = `translateY(${drag.y - drag.y0}px) scale(1.03)`;
    li.style.pointerEvents = 'none';
    const d = dropAt(drag.x, drag.y);
    li.style.pointerEvents = '';
    mark(d);
  };
  const loop = () => { if (!drag) return; follow(); drag.raf = requestAnimationFrame(loop); };
  row.addEventListener('pointermove', (e) => {
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
    if (!drag) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const end = () => {
    cancelHold();
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const d = drag.drop;
    d?.head?.classList.remove('drop-on');
    // Where the gap sits = the order to save (the to-do's id in the gap's place).
    const ids = d?.ul ? [...d.ul.children].flatMap((x) => (x === drag.gap ? [t.id] : x.matches('li.todo') && x !== li ? [x.dataset.id] : [])) : null;
    resetSlides();
    drag.gap.remove();
    drag = null;
    moving = false;
    li.classList.remove('moving');
    li.style.transform = '';
    li.style.marginBottom = '';
    setTimeout(() => { swallowClick = false; }, 400);
    if (!d?.head) return;
    drop(d, ids);
  };

  const drop = (d, ids) => {
    const to = d.head.dataset.drop || null;
    const todos = cur().todos;
    const byId = (id) => todos.find((x) => x.id === id);
    // Remember everything this can change, for Undo.
    const before = new Map([[t, { category: t.category, order: t.order }]]);
    const remember = (x) => { if (x && !before.has(x)) before.set(x, { category: x.category, order: x.order }); };

    const from = t.category || null;
    t.category = to;
    if (ids) {
      // Put it exactly where it was dropped; number that list top to bottom.
      ids.forEach((id, i) => { const x = byId(id); if (x) { remember(x); x.order = i; } });
    } else {
      // Onto a folder heading: last in that folder.
      const orders = todos.filter((x) => x !== t && (x.category || null) === to && Number.isFinite(x.order)).map((x) => x.order);
      t.order = orders.length ? Math.max(...orders) + 1 : undefined;
      if (t.order === undefined) delete t.order;
    }
    const changed = [...before].some(([x, was]) => (x.category || null) !== (was.category || null) || x.order !== was.order);
    if (!changed) return;
    save();
    const undo = () => {
      for (const [x, was] of before) {
        x.category = was.category;
        if (was.order === undefined) delete x.order; else x.order = was.order;
      }
      save();
    };
    if (to === from) return; // just rearranged
    const name = to ? cur().categories.find((c) => c.id === to)?.name : null;
    snack(name ? `Moved to ${name}` : 'Moved out of the folder', { action: 'Undo', onAction: undo });
  };

  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.addEventListener('lostpointercapture', end);
  // Letting go after a move shouldn't also open the to-do.
  row.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
  row.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Days left until a to-do's due date: D-3, D-Day, D+2 (overdue).
function dueTag(t, key) {
  const left = daysBetween(key, t.due);
  const text = left > 0 ? `D-${left}` : left === 0 ? 'D-Day' : `D+${-left}`;
  return h('span', { class: `due-tag${left <= 0 ? ' due-now' : ''}`, 'aria-label': `Due ${t.due}` }, text);
}

// A one-off to-do carried over from an earlier day shows that day, small and gray.
function laterTag(t, key) {
  return h('span', { class: 'due-tag', 'aria-label': `Moved from ${t.date}` }, fmt({ month: 'short', day: 'numeric' }).format(parseKey(t.date)));
}
const tagFor = (t, key, done) => (done ? null : hasDue(t) ? dueTag(t, key) : rollsOver(t) && t.date < key ? laterTag(t, key) : null);

// The slim mark checks a to-do off; tapping the text opens it for editing.
function todoItem(t, key, actions) {
  const done = isDone(t, key);
  const starred = isStarred(t, key);
  const row = h('div', { class: 'todo-row' },
    h('button', {
      class: 'mark-btn', role: 'checkbox', 'aria-checked': String(done), 'aria-label': `Done: ${t.title}`,
      onclick: () => toggleDone(t, key),
    }, h('span', { class: 'dash' })),
    h('button', { class: 'todo-title', onclick: () => actions.edit('todo', t, key) },
      t.title,
      starred ? h('span', { class: 'mark star', 'aria-hidden': 'true' }, '★') : null,
      t.sharedWith?.length ? h('span', { class: 'mark shared-mark', 'aria-label': 'Shared' }, icon(ICONS.people)) : null,
      tagFor(t, key, done)),
    isTracked(t) ? tracker(t, key) : null);
  const li = h('li', { class: `todo${done ? ' done' : ''}${starred ? ' imp' : ''}`, 'data-id': t.id },
    h('div', { class: 'todo-actions' },
      h('button', { class: 'todo-act', 'aria-label': `Postpone ${t.title} to tomorrow`, onclick: () => postponeTomorrow(t, key) },
        icon(ICONS.arrow), h('span', {}, 'Tmrw')),
      h('button', { class: 'todo-act', 'aria-label': `Postpone ${t.title} to a date`, onclick: () => { closeRow(row); postponePick(t, key); } },
        icon(ICONS.calendar), h('span', {}, 'Date'))),
    row);
  makeSwipeable(li, row);
  makeMovable(li, row, t);
  return li;
}

// One section's to-dos grouped into (nested) category folders. A folder only shows
// if it has to-dos here somewhere inside it; its open/closed state is saved.
function folderTree(todos, key, actions, opts = {}, section = 'todo') {
  const known = new Set(cur().categories.map((c) => c.id));
  const catOf = (t) => (known.has(t.category) ? t.category : null);

  const countIn = (catId) => todos.filter((t) => catOf(t) === catId).length
    + childCategories(catId).reduce((n, c) => n + countIn(c.id), 0);
  // A folder shows if it has to-dos here, or lives in this section (even empty).
  const shows = (c) => countIn(c.id) > 0 || folderHome(c) === section || childCategories(c.id).some(shows);
  const openIn = (catId) => todos.filter((t) => catOf(t) === catId && !isDone(t, key)).length
    + childCategories(catId).reduce((n, c) => n + openIn(c.id), 0);

  const branch = (catId) => {
    const items = todos.filter((t) => catOf(t) === catId).map((t) => todoItem(t, key, actions));
    const folders = childCategories(catId).filter(shows).map((c) => {
      const left = openIn(c.id);
      const open = c.open !== false;
      // Tap the name to edit the folder, + to add a to-do in it, anywhere else to fold it.
      return h('li', { class: `folder${open ? ' open' : ''}` },
        h('div', {
          class: 'folder-head', 'data-drop': c.id,
          style: c.color ? `--folder-line:${c.color}` : null,
          onclick: () => { c.open = !open; save(); },
        },
        h('button', { class: 'folder-toggle', 'aria-expanded': String(open), 'aria-label': `${open ? 'Close' : 'Open'} ${c.name}` }, icon(ICONS.right)),
        h('button', {
          class: 'folder-name', 'aria-label': `Edit folder ${c.name}`,
          onclick: (e) => {
            e.stopPropagation();
            openFolderSheet({ cat: c, onSubfolder: () => {} });
          },
        }, c.name),
        c.sharedWith?.length ? h('span', { class: 'mark shared-mark', 'aria-label': 'Shared' }, icon(ICONS.people)) : null,
        left ? h('span', { class: 'folder-count' }, String(left)) : null,
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'icon-btn folder-add', 'aria-label': `Add to-do in ${c.name}`,
          onclick: (e) => { e.stopPropagation(); actions.create({ kind: 'todo', date: key, category: c.id, ...opts }); },
        }, icon(ICONS.plus))),
        h('ul', { class: 'todos' }, branch(c.id)));
    });
    return [...items, ...folders];
  };

  return h('ul', { class: 'todos root' }, branch(null));
}

// A to-do a friend shared: the mark checks it off for both of you; the text shows details.
function sharedItem(t, key) {
  const done = isSharedDone(t, key);
  const starred = isStarred(t, key);
  const details = () => tell(t.title, [`Shared by ${nameOf(t.owner)}`, t.folder ? `Folder: ${t.folder}` : '', t.notes || ''].filter(Boolean).join('\n'));
  return h('li', { class: `todo shared${done ? ' done' : ''}${starred ? ' imp' : ''}` },
    h('div', { class: 'todo-row' },
      h('button', {
        class: 'mark-btn', role: 'checkbox', 'aria-checked': String(done), 'aria-label': `Done: ${t.title}`,
        onclick: () => toggleShared(t, key).catch((e) => tell('Not saved', e.message)),
      }, h('span', { class: 'dash' })),
      h('button', { class: 'todo-title', onclick: details },
        t.title,
        starred ? h('span', { class: 'mark star', 'aria-hidden': 'true' }, '★') : null,
        tagFor(t, key, done),
        h('span', { class: 'by-tag' }, nameOf(t.owner)))));
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
  const folderBtn = (label, opts = {}) => h('button', {
    class: 'icon-btn section-add section-folder', 'aria-label': label,
    onclick: () => openFolderSheet({ section: opts.repeat ? 'routine' : 'todo' }),
  }, icon(ICONS.folderPlus));

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
      h('div', { class: 'section-head', 'data-drop': '' }, routineTitle, folderBtn('New routine folder', { repeat: 'daily' }), plus('Add routine', { repeat: 'daily' })),
      tracked.length && showStats ? routineStatsList(tracked) : null,
      folderTree(routines, key, actions, { repeat: 'daily' }, 'routine')),
    h('section', { class: 'todo-section' },
      h('div', { class: 'section-head', 'data-drop': '' }, h('h3', { class: 'section-label' }, 'To-do', count(regular)), folderBtn('New folder'), plus('Add to-do')),
      folderTree(regular, key, actions, {}, 'todo')),
    sharedSection(key)));
}

// Friends' shared to-dos for this day (only when there are some).
function sharedSection(key) {
  const list = sharedTodosOn(key);
  if (!list.length) return null;
  const left = list.filter((t) => !isSharedDone(t, key)).length;
  return h('section', { class: 'todo-section shared-section' },
    h('div', { class: 'section-head' },
      h('h3', { class: 'section-label' }, 'Shared', left ? h('span', { class: 'section-count' }, String(left)) : null)),
    h('ul', { class: 'todos root' }, list.map((t) => sharedItem(t, key))));
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
  const events = [...eventsOn(key), ...sharedEventsOn(key)];
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const hours = [];
  for (let hr = 1; hr < 24; hr++) {
    const label = hourLabel(hr);
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

  // A friend's shared event opens a details card instead of the editor.
  const open = (e) => (e.shared
    ? tell(e.title, [`Shared by ${nameOf(e.owner)}`, e.allDay ? 'All day' : `${shortTime(e.start)}–${shortTime(e.end)}`, e.notes || ''].filter(Boolean).join('\n'))
    : actions.edit('event', e));
  const cls = (e) => `event${e.important ? ' imp' : ''}${e.shared ? ' shared' : ''}`;

  const blocks = layoutLanes(timed).map(({ e, start, end, lane, lanes }) =>
    h('button', {
      class: cls(e),
      style: `top:${(start / 60) * HOUR_PX + 1}px;height:${((end - start) / 60) * HOUR_PX - 2}px;` +
        `left:calc(${(lane / lanes) * 100}% + 2px);width:calc(${100 / lanes}% - 4px)`,
      onclick: () => open(e),
    }, h('b', {}, e.title), h('small', {}, `${shortTime(e.start)}–${shortTime(e.end)}${e.shared ? ` · ${nameOf(e.owner)}` : ''}`)));

  const timeline = h('div', { class: 'timeline' }, hours, h('div', { class: 'events' }, blocks));

  if (key === todayKey()) {
    const now = new Date();
    timeline.append(h('div', { class: 'now', style: `top:${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px` }));
  }

  return h('div', { class: 'col' },
    allDay.length ? h('div', { class: 'allday' }, allDay.map((e) =>
      h('button', { class: cls(e), onclick: () => open(e) },
        h('b', {}, e.title), e.shared ? h('small', {}, nameOf(e.owner)) : null))) : null,
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
