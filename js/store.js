// All app data lives in localStorage on the device; there is no server.
import { parseKey, daysBetween } from './util.js';

const KEY = 'planner.v1';

/*
  todo:     { id, title, date: 'YYYY-MM-DD', important, notes, category: id | null,
              repeat, until, done (one-off), doneOn: { 'YYYY-MM-DD': true } (routines) }
  event:    { id, title, date, allDay, start: 'HH:MM', end: 'HH:MM', repeat, until,
              alert: 'none' | '<minutes before>', important, notes }
  category: { id, name, parent: id | null, open }   — folders for to-dos, nestable
  repeat:   'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'
  until:    '' (forever) or last 'YYYY-MM-DD' a routine occurs
*/
const DEFAULTS = { todos: [], events: [], categories: [], settings: { theme: 'auto', accent: 'mono' } };

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

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn());
}

export function replaceAll(data) {
  if (!data || !Array.isArray(data.todos) || !Array.isArray(data.events)) throw new Error('Not a Planner backup');
  state.todos = data.todos;
  state.events = data.events;
  state.categories = data.categories || [];
  state.settings = { ...DEFAULTS.settings, ...data.settings };
  save();
}

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

export function toggleDone(todo, key) {
  if (isRoutine(todo)) {
    todo.doneOn = { ...todo.doneOn };
    if (todo.doneOn[key]) delete todo.doneOn[key];
    else todo.doneOn[key] = true;
  } else {
    todo.done = !todo.done;
  }
  save();
}

const byTime = (a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') : a.allDay ? -1 : 1);

export const eventsOn = (key) => state.events.filter((e) => occursOn(e, key)).sort(byTime);

// Important first; done items sink to the bottom.
export const todosOn = (key) =>
  state.todos
    .filter((t) => occursOn(t, key))
    .sort((a, b) => isDone(a, key) - isDone(b, key) || b.important - a.important);

/* ---------- Categories (folders) ---------- */

export const categoryById = (id) => state.categories.find((c) => c.id === id) || null;
export const childCategories = (parent) => state.categories.filter((c) => (c.parent || null) === parent);

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
      state.categories.push(cat);
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
  for (const c of state.categories) if (c.parent === id) c.parent = parent;
  for (const t of state.todos) if (t.category === id) t.category = parent;
  state.categories = state.categories.filter((c) => c.id !== id);
  save();
}
