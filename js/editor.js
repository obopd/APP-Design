// Bottom sheet for creating / editing a to-do or a schedule item.
import { h, todayKey, toMinutes, fromMinutes, pad } from './util.js';
import { state, save, uid } from './store.js';

const dialog = document.getElementById('editor');

const ALERTS = [
  ['none', 'None'],
  ['0', 'At time of event'],
  ['10', '10 minutes before'],
  ['30', '30 minutes before'],
  ['60', '1 hour before'],
  ['1440', '1 day before'],
];

function segmented(options, value, onPick) {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  const paint = (v) => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  for (const [v, label] of options) {
    el.append(h('button', { type: 'button', role: 'radio', 'data-v': v, onclick: () => { paint(v); onPick(v); } }, label));
  }
  paint(value);
  return el;
}

const field = (label, control, attrs = {}) => h('label', { class: 'field', ...attrs }, h('span', {}, label), control);
const toggle = (checked) => h('input', { type: 'checkbox', class: 'switch', checked });

/**
 * openEditor({ kind: 'todo'|'event', item?, date?, hour? })
 * With `item` it edits in place; otherwise it creates a new one.
 */
export function openEditor({ kind, item = null, date = todayKey(), hour = null }) {
  const isNew = !item;
  let type = kind;
  const startHour = hour ?? Math.min(new Date().getHours() + 1, 23);
  const draft = item ? { ...item } : {
    title: '', date, important: false, notes: '',
    allDay: false, start: `${pad(startHour)}:00`, end: fromMinutes(Math.min(startHour * 60 + 60, 23 * 60 + 59)),
    repeat: 'none', alert: 'none',
  };

  const title = h('input', { type: 'text', placeholder: 'Title', maxlength: '80', value: draft.title, autocomplete: 'off', enterkeyhint: 'done' });
  const notes = h('textarea', { placeholder: 'Notes', rows: '3' });
  notes.value = draft.notes || '';
  const dateIn = h('input', { type: 'date', value: draft.date, required: true });
  const allDay = toggle(draft.allDay);
  const start = h('input', { type: 'time', value: draft.start || '09:00' });
  const end = h('input', { type: 'time', value: draft.end || '10:00' });
  const repeat = h('select', {}, h('option', { value: 'none' }, 'Never'), h('option', { value: 'yearly' }, 'Every year'));
  repeat.value = draft.repeat || 'none';
  const alert = h('select', {}, ALERTS.map(([v, l]) => h('option', { value: v }, l)));
  alert.value = draft.alert || 'none';
  const important = toggle(draft.important);

  const startRow = field('Starts', start);
  const endRow = field('Ends', end);
  const eventGroup = h('div', { class: 'group' },
    field('All-day', allDay), startRow, endRow, field('Repeat', repeat), field('Alert', alert));
  const allDayHint = h('p', { class: 'hint' }, 'All-day alerts go off at 9:00 AM.');

  const sync = () => {
    eventGroup.hidden = type !== 'event';
    startRow.hidden = endRow.hidden = allDay.checked;
    allDayHint.hidden = type !== 'event' || !allDay.checked;
  };
  allDay.addEventListener('change', sync);

  // Keep the end after the start when the start moves.
  start.addEventListener('change', () => {
    if (end.value && toMinutes(end.value) <= toMinutes(start.value)) {
      end.value = fromMinutes(Math.min(toMinutes(start.value) + 60, 23 * 60 + 59));
    }
  });

  const close = () => dialog.close();

  const submit = (ev) => {
    ev.preventDefault();
    const text = title.value.trim();
    if (!text) { title.focus(); return; }
    const base = { title: text, date: dateIn.value || draft.date, important: important.checked, notes: notes.value.trim() };

    if (type === 'todo') {
      const data = { ...base, done: item?.done || false };
      if (isNew) state.todos.push({ id: uid(), ...data });
      else Object.assign(item, data);
    } else {
      let s = start.value || '09:00';
      let e = end.value || fromMinutes(toMinutes(s) + 60);
      if (toMinutes(e) <= toMinutes(s)) e = fromMinutes(Math.min(toMinutes(s) + 60, 23 * 60 + 59));
      const data = { ...base, allDay: allDay.checked, start: s, end: e, repeat: repeat.value, alert: alert.value };
      if (isNew) state.events.push({ id: uid(), ...data });
      else Object.assign(item, data);
    }
    save();
    close();
  };

  const remove = () => {
    if (!confirm(`Delete “${item.title}”?`)) return;
    const list = kind === 'todo' ? 'todos' : 'events';
    state[list] = state[list].filter((x) => x !== item);
    save();
    close();
  };

  const form = h('form', { onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      h('h3', {}, isNew ? 'New' : type === 'todo' ? 'Edit to-do' : 'Edit schedule'),
      h('button', { type: 'submit', class: 'save' }, isNew ? 'Add' : 'Save')),
    isNew ? segmented([['todo', 'To-do'], ['event', 'Schedule']], type, (v) => { type = v; sync(); }) : null,
    h('div', { class: 'group' }, title, notes),
    h('div', { class: 'group' }, field('Date', dateIn), field('Important ★', important)),
    eventGroup,
    allDayHint,
    isNew ? null : h('button', { type: 'button', class: 'danger', onclick: remove }, 'Delete'),
  );

  dialog.replaceChildren(form);
  sync();
  dialog.showModal();
  if (isNew) title.focus();
}

// Tap outside the sheet to dismiss.
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
