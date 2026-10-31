// Bottom sheet for creating / editing a to-do or a schedule item.
import { h, icon, ICONS, todayKey, toMinutes, fromMinutes, pad } from './util.js';
import { state, save, uid, REPEATS, categoryTree } from './store.js';
import { openFolderSheet } from './folders.js';

const dialog = document.getElementById('editor');

const ALERTS = [
  ['none', 'None'],
  ['0', 'On time'],
  ['10', '10 min'],
  ['30', '30 min'],
  ['60', '1 hour'],
  ['1440', '1 day'],
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

const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
const select = (options, value) => {
  const el = h('select', {}, options.map(([v, l]) => h('option', { value: v }, l)));
  el.value = value;
  return el;
};

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
    repeat: 'none', until: '', alert: 'none', category: null,
  };

  const title = h('input', { type: 'text', placeholder: 'Title', maxlength: '80', value: draft.title, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Title' });
  let important = !!draft.important;
  const star = h('button', {
    type: 'button', class: 'icon-btn star-btn', 'aria-label': 'Important', 'aria-pressed': String(important),
    onclick: () => { important = !important; star.setAttribute('aria-pressed', String(important)); star.textContent = important ? '★' : '☆'; },
  }, important ? '★' : '☆');

  const notes = h('textarea', { class: 'notes', placeholder: 'Notes', rows: '2', 'aria-label': 'Notes' });
  notes.value = draft.notes || '';
  const dateIn = h('input', { type: 'date', value: draft.date, required: true });
  const allDay = h('input', { type: 'checkbox', class: 'switch', checked: draft.allDay });
  const start = h('input', { type: 'time', value: draft.start || '09:00', 'aria-label': 'Start' });
  const end = h('input', { type: 'time', value: draft.end || '10:00', 'aria-label': 'End' });
  const repeat = select(REPEATS, draft.repeat || 'none');
  const until = h('input', { type: 'date', value: draft.until || '', 'aria-label': 'Until' });
  const alert = select(ALERTS, draft.alert || 'none');

  // Folder picker; "New…" opens the folder sheet (name + underline color).
  const category = h('select', {});
  const fillCategories = (selected) => {
    category.replaceChildren(
      h('option', { value: '' }, 'None'),
      ...categoryTree().map(({ cat, depth }) => h('option', { value: cat.id }, `${'\u2002'.repeat(depth * 2)}${cat.name}`)),
      h('option', { value: '__new' }, 'New…'));
    category.value = selected || '';
  };
  fillCategories(draft.category);
  let lastCategory = category.value;
  category.addEventListener('change', () => {
    if (category.value !== '__new') { lastCategory = category.value; return; }
    openFolderSheet({
      onDone: (id) => { lastCategory = id; fillCategories(id); },
      onCancel: () => fillCategories(lastCategory),
    });
  });

  const timeRow = field('Time', h('span', { class: 'times' }, start, '–', end));
  const untilRow = field('Until', until);
  const todoRows = [field('Folder', category)];
  const eventRows = [field('All-day', allDay), timeRow, field('Alert', alert)];

  const sync = () => {
    todoRows.forEach((r) => { r.hidden = type !== 'todo'; });
    eventRows.forEach((r) => { r.hidden = type !== 'event'; });
    if (type === 'event') timeRow.hidden = allDay.checked;
    untilRow.hidden = repeat.value === 'none';
  };
  allDay.addEventListener('change', sync);
  repeat.addEventListener('change', sync);

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
    const date = dateIn.value || draft.date;
    const base = {
      title: text, date, important, notes: notes.value.trim(),
      repeat: repeat.value, until: repeat.value !== 'none' && until.value >= date ? until.value : '',
    };

    if (type === 'todo') {
      const data = { ...base, category: category.value && category.value !== '__new' ? category.value : null };
      if (isNew) state.todos.push({ id: uid(), ...data });
      else Object.assign(item, data);
    } else {
      const s = start.value || '09:00';
      let e = end.value || fromMinutes(toMinutes(s) + 60);
      if (toMinutes(e) <= toMinutes(s)) e = fromMinutes(Math.min(toMinutes(s) + 60, 23 * 60 + 59));
      const data = { ...base, allDay: allDay.checked, start: s, end: e, alert: alert.value };
      if (isNew) state.events.push({ id: uid(), ...data });
      else Object.assign(item, data);
    }
    save();
    close();
  };

  const remove = () => {
    if (!confirm(item.repeat && item.repeat !== 'none' ? `Delete routine “${item.title}” (every day it repeats)?` : `Delete “${item.title}”?`)) return;
    const list = kind === 'todo' ? 'todos' : 'events';
    state[list] = state[list].filter((x) => x !== item);
    save();
    close();
  };

  const form = h('form', { onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      isNew
        ? segmented([['todo', 'To-do'], ['event', 'Event']], type, (v) => { type = v; sync(); })
        : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: remove }, icon(ICONS.trash)),
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'title-row' }, title, star),
    h('div', { class: 'fields' }, field('Date', dateIn), ...todoRows, ...eventRows, field('Repeat', repeat), untilRow),
    notes,
  );

  dialog.replaceChildren(form);
  sync();
  dialog.showModal();
  if (isNew) title.focus();
}

// Tap outside the sheet to dismiss.
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
