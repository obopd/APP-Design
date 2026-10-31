// All app data lives in localStorage on the device; there is no server.
import { addDays, dateKey, parseKey } from './util.js';

const KEY = 'planner.v1';

/*
  todo:  { id, title, date: 'YYYY-MM-DD', important, done, notes }
  event: { id, title, date, allDay, start: 'HH:MM', end: 'HH:MM',
           repeat: 'none' | 'yearly', alert: 'none' | minutes-before (string),
           important, notes }
*/
const DEFAULTS = { todos: [], events: [], settings: { theme: 'auto', accent: 'mono' } };

export const state = load();
const listeners = new Set();

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.todos) && Array.isArray(data.events)) {
      return { ...DEFAULTS, ...data, settings: { ...DEFAULTS.settings, ...data.settings } };
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
  state.settings = { ...DEFAULTS.settings, ...data.settings };
  save();
}

export const onChange = (fn) => listeners.add(fn);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// Yearly events (birthdays) occur on the same month/day every year from their start date.
export function occursOn(event, key) {
  if (event.date === key) return true;
  return event.repeat === 'yearly' && event.date < key && event.date.slice(5) === key.slice(5);
}

const byTime = (a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') : a.allDay ? -1 : 1);

export const eventsOn = (key) => state.events.filter((e) => occursOn(e, key)).sort(byTime);

// Important first, then done items sink to the bottom.
export const todosOn = (key) =>
  state.todos
    .filter((t) => t.date === key)
    .sort((a, b) => a.done - b.done || b.important - a.important);

export function upcomingImportant(fromKey, days) {
  const out = [];
  let d = parseKey(fromKey);
  for (let i = 0; i < days; i++, d = addDays(d, 1)) {
    const key = dateKey(d);
    for (const e of eventsOn(key)) if (e.important) out.push({ kind: 'event', item: e, date: key });
    for (const t of todosOn(key)) if (t.important && !t.done) out.push({ kind: 'todo', item: t, date: key });
  }
  return out;
}
