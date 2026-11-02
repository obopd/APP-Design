// App data lives in localStorage on the device. When signed in, js/cloud.js also
// backs the whole state up to the user's Supabase account and syncs it.
import { parseKey, daysBetween, todayKey } from './util.js';
import { snack } from './ui.js';

const KEY = 'planner.v1';

/*
  todo:     { id, title, date: 'YYYY-MM-DD', important, notes, category: id | null,
              repeat, until, done (one-off), doneOn: { 'YYYY-MM-DD': true } (routines),
              track: 'none' | 'count' | 'time',
              values: { 'YYYY-MM-DD': number }   (count, or seconds for time)
              timer: { key, start: epoch ms } | null   (running stopwatch)
              skipOn: { 'YYYY-MM-DD': true }   (routine days moved away by "postpone")
              due: '' | 'YYYY-MM-DD'   (one-off only: rolls to today until done, starred from due) }
  event:    { id, title, date, allDay, start: 'HH:MM', end: 'HH:MM', repeat, until,
              alert: 'none' | '<minutes before>', important, notes }
  category: { id, name, parent: id | null, open, color: '#hex' | null }   — nestable to-do folders
  repeat:   'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
  until:    '' (forever) or last 'YYYY-MM-DD' a routine occurs
  dday:     { id, title, date: 'YYYY-MM-DD', yearly }   — countdowns (birthdays, graduation…)
  meta:     { updatedAt: epoch ms }   — last local change, used by cloud sync
*/
const DEFAULTS = { todos: [], events: [], categories: [], ddays: [], settings: { theme: 'auto', accent: 'mono' } };

export const REPEATS = [
  ['none', 'Never'],
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
];

export const state = load();
const listeners = new Set();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.todos) && Array.isArray(data.events)) {
      return { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...data.settings } };
    }
  } catch { /* fall through to defaults */ }
  return structuredClone(DEFAULTS);
}

/* Film Production Mode swaps the to-do / event / folder lists for the chosen project's
   (see film.js). Everything that shows or edits those lists goes through cur(); saving
   then goes to the project, never into the personal planner (so film edits can't stamp
   the personal planner and win a sync). Personal-only changes (theme, D-Days, sharing,
   sign-out) pass { personal: true }. */
let film = null; // { todos, events, categories, persist() } | null
export const cur = () => film || state;
export const inFilm = () => !!film;
export function useLists(lists) {
  film = lists;
  listeners.forEach((fn) => fn());
}

// Caches the app can download again. When the phone's storage for the app is full, they're
// cleared one by one until the write fits (the sync copy only makes merges less precise).
// (Not planner.filmdata: it can hold project entries that haven't reached the account yet.)
const DISPOSABLE = ['planner.chat', 'planner.previewurls', 'planner.social', 'planner.syncbase'];
export function storeItem(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { /* full: make room */ }
  for (const k of DISPOSABLE) {
    if (k === key || localStorage.getItem(k) === null) continue;
    localStorage.removeItem(k);
    try { localStorage.setItem(key, value); return true; } catch { /* still full */ }
  }
  return false;
}
let warnedFull = false;

// touch: stamp this as a local change (false when applying data that came from the cloud).
export function save({ touch = true, personal = false } = {}) {
  if (film && !personal) {
    film.persist();
    listeners.forEach((fn) => fn());
    return;
  }
  if (touch) state.meta = { ...state.meta, updatedAt: Date.now() };
  if (!storeItem(KEY, JSON.stringify(state)) && !warnedFull) {
    // The planner stays in memory (and syncs to the account if signed in).
    warnedFull = true;
    snack(localStorage.getItem('planner.auth')
      ? 'Phone storage is full: changes go to your account but can’t be kept on this phone.'
      : 'Phone storage is full: changes can’t be saved. Export a backup in Settings.');
  }
  listeners.forEach((fn) => fn());
}

export function replaceAll(data, { touch = true } = {}) {
  if (!data || !Array.isArray(data.todos) || !Array.isArray(data.events)) throw new Error('Not a Planner backup');
  state.todos = data.todos;
  state.events = data.events;
  state.categories = data.categories || [];
  state.ddays = data.ddays || [];
  state.settings = { ...DEFAULTS.settings, ...data.settings };
  // A restored backup replaces everything, also in the account (cloud.js won't merge it).
  state.meta = touch ? { ...data.meta, replacedAt: Date.now() } : { ...data.meta };
  save({ touch, personal: true });
}

// Used on sign-out: remove this user's planner from the device (it lives on in their
// account). Device preferences (theme, accent) stay.
export function clearData() {
  state.todos = [];
  state.events = [];
  state.categories = [];
  state.ddays = [];
  state.meta = {};
  save({ touch: false, personal: true });
}

export const hasContent = (data = state) =>
  [data.todos, data.events, data.categories, data.ddays].some((list) => list && list.length);

export const onChange = (fn) => listeners.add(fn);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/* ---------- Repeating (routines) ---------- */

const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

// Same day-of-month; a start on the 31st falls on the last day of shorter months.
const sameMonthDay = (start, d) =>
  start.getDate() === d.getDate() || (start.getDate() > daysInMonth(d) && d.getDate() === daysInMonth(d));

export function occursOn(item, key) {
  if (item.date === key) return true;
  const repeat = item.repeat || 'none';
  if (repeat === 'none' || key < item.date || (item.until && key > item.until)) return false;
  const start = parseKey(item.date);
  const d = parseKey(key);
  switch (repeat) {
    case 'daily': return true;
    case 'weekly': return daysBetween(item.date, key) % 7 === 0;
    case 'biweekly': return daysBetween(item.date, key) % 14 === 0;
    case 'monthly': return sameMonthDay(start, d);
    case 'yearly': return start.getMonth() === d.getMonth() && sameMonthDay(start, d);
    default: return false;
  }
}

export const isRoutine = (item) => !!item.repeat && item.repeat !== 'none';

// Routines are checked off per day; one-off to-dos have a single done flag.
export const isDone = (todo, key) => (isRoutine(todo) ? !!todo.doneOn?.[key] : !!todo.done);

/* ---------- Due dates (one-off to-dos) ---------- */

// An unfinished to-do with a due date moves forward to today each day until it's done.
// Computed, not stored, so opening the app never creates an edit that could win a sync.
export const hasDue = (todo) => !!todo.due && !isRoutine(todo);
// One-off to-dos that aren't done move forward to today, day after day, until checked off.
// Computed (never written on open), so just opening the app can't create an edit.
export const rollsOver = (todo) => !isRoutine(todo);
export const todoDate = (todo, today = todayKey()) =>
  (rollsOver(todo) && !todo.done && todo.date < today ? today : todo.date);

// Starred by hand, or automatically from its due date on while unfinished.
export const isStarred = (item, key = todayKey()) =>
  !!item.important || (hasDue(item) && !item.done && key >= item.due);

export function toggleDone(todo, key) {
  if (isRoutine(todo)) {
    todo.doneOn = { ...todo.doneOn };
    if (todo.doneOn[key]) delete todo.doneOn[key];
    else todo.doneOn[key] = true;
  } else {
    if (!todo.done && rollsOver(todo)) todo.date = key; // stays on the day it was finished
    todo.done = !todo.done;
  }
  save();
}

const byTime = (a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') : a.allDay ? -1 : 1);

export const eventsOn = (key) => cur().events.filter((e) => occursOn(e, key)).sort(byTime);

// Important first; done items sink to the bottom.
export const todosOn = (key) =>
  cur().todos
    .filter((t) => (rollsOver(t) ? todoDate(t) === key : occursOn(t, key)) && !t.skipOn?.[key])
    .sort((a, b) => isDone(a, key) - isDone(b, key) || isStarred(b, key) - isStarred(a, key));

/* ---------- Categories (folders) ---------- */

export const categoryById = (id) => cur().categories.find((c) => c.id === id) || null;
export const childCategories = (parent) => cur().categories.filter((c) => (c.parent || null) === parent);

// Depth-first list of { cat, depth } for pickers and the settings tree.
export function categoryTree(parent = null, depth = 0) {
  return childCategories(parent).flatMap((cat) => [{ cat, depth }, ...categoryTree(cat.id, depth + 1)]);
}

export function categoryPath(id) {
  const names = [];
  for (let c = categoryById(id); c; c = categoryById(c.parent)) names.unshift(c.name);
  return names.join(' / ');
}

// 'Academic/Biology' → finds or creates each level; returns the last id. Folders start open.
export function ensureCategoryPath(path, parent = null) {
  let id = parent;
  for (const name of path.split('/').map((s) => s.trim()).filter(Boolean)) {
    let cat = childCategories(id).find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { id: uid(), name, parent: id, open: true };
      cur().categories.push(cat);
    }
    id = cat.id;
  }
  return id;
}

// Deleting a folder moves its sub-folders and to-dos up one level.
export function deleteCategory(id) {
  const cat = categoryById(id);
  if (!cat) return;
  const parent = cat.parent || null;
  const lists = cur();
  for (const c of lists.categories) if (c.parent === id) c.parent = parent;
  for (const t of lists.todos) if (t.category === id) t.category = parent;
  lists.categories = lists.categories.filter((c) => c.id !== id);
  save();
}

/* ---------- Tracking (count / time per occurrence) ---------- */

export const TRACKS = [['none', 'Off'], ['count', 'Count'], ['time', 'Time']];

export const isTracked = (todo) => todo.track === 'count' || todo.track === 'time';
export const valueOn = (todo, key) => todo.values?.[key] || 0;

export function setValue(todo, key, value) {
  todo.values = { ...todo.values };
  if (value > 0) todo.values[key] = value;
  else delete todo.values[key];
  save();
}

// The stopwatch is stored as a start time, so it keeps running while the app is closed.
export function startTimer(todo, key) {
  if (todo.timer) stopTimer(todo, false);
  todo.timer = { key, start: Date.now() };
  save();
}

export function stopTimer(todo, persist = true) {
  if (!todo.timer) return;
  const { key, start } = todo.timer;
  todo.timer = null;
  todo.values = { ...todo.values, [key]: valueOn(todo, key) + Math.round((Date.now() - start) / 1000) };
  if (persist) save();
}

// Times a routine was checked off up to today, and the sum of everything recorded.
export function routineStats(todo) {
  const today = todayKey();
  return {
    times: Object.keys(todo.doneOn || {}).filter((k) => k <= today).length,
    total: Object.values(todo.values || {}).reduce((a, b) => a + b, 0),
  };
}

/* ---------- D-Day ---------- */

// Next date a D-Day falls on (yearly ones roll to this or next year; Feb 29 → Feb 28).
export function ddayTarget(dday, fromKey = todayKey()) {
  if (!dday.yearly) return dday.date;
  const start = parseKey(dday.date);
  const from = parseKey(fromKey);
  for (let y = Math.max(from.getFullYear(), start.getFullYear()); ; y++) {
    const last = new Date(y, start.getMonth() + 1, 0).getDate();
    const d = new Date(y, start.getMonth(), Math.min(start.getDate(), last));
    const key = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (key >= fromKey) return key;
  }
}

// Days until (positive), 0 on the day, negative once passed.
export const ddayDiff = (dday, fromKey = todayKey()) => daysBetween(fromKey, ddayTarget(dday, fromKey));

/* ---------- Postpone ---------- */

// Move a to-do from fromKey to toKey. One-off to-dos just change date (recorded count/time
// moves with them). For a routine only that day moves: the day is skipped and a one-off
// copy is added on the new date. Returns an undo function.
export function postponeTodo(todo, fromKey, toKey) {
  if (isRoutine(todo)) {
    todo.skipOn = { ...todo.skipOn, [fromKey]: true };
    const copy = {
      id: uid(), title: todo.title, date: toKey, important: !!todo.important, notes: todo.notes || '',
      category: todo.category || null, repeat: 'none', until: '', track: todo.track || 'none',
    };
    cur().todos.push(copy);
    save();
    return () => {
      todo.skipOn = { ...todo.skipOn };
      delete todo.skipOn[fromKey];
      cur().todos = cur().todos.filter((t) => t !== copy);
      save();
    };
  }
  const prev = { date: todo.date, values: todo.values };
  if (todo.values?.[fromKey] !== undefined) {
    todo.values = { ...todo.values, [toKey]: todo.values[fromKey] };
    delete todo.values[fromKey];
  }
  todo.date = toKey;
  save();
  return () => { todo.date = prev.date; todo.values = prev.values; save(); };
}
