// Postpone a to-do: to tomorrow, or to a chosen date. Shows "Moved to …" with Undo.
import { addDays, dateKey, parseKey, fmt } from './util.js';
import { postponeTodo } from './store.js';
import { askDate, snack } from './ui.js';

const label = (key) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(parseKey(key));

export function postpone(todo, fromKey, toKey) {
  if (!toKey || toKey === fromKey) return;
  const undo = postponeTodo(todo, fromKey, toKey);
  snack(`Moved to ${label(toKey)}`, { action: 'Undo', onAction: undo });
}

export const postponeTomorrow = (todo, fromKey) => postpone(todo, fromKey, dateKey(addDays(parseKey(fromKey), 1)));

export async function postponePick(todo, fromKey) {
  const toKey = await askDate({ title: `Move “${todo.title}”`, value: dateKey(addDays(parseKey(fromKey), 1)) });
  postpone(todo, fromKey, toKey);
}
