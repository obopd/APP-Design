// Small bottom sheet to create or edit a to-do folder: name + underline color.
import { h, icon, ICONS } from './util.js';
import { state, save, ensureCategoryPath, deleteCategory } from './store.js';
import { ask } from './ui.js';

const dialog = document.getElementById('folder-sheet');

// null = default thin gray underline.
// Two rows of 10, ordered around the color wheel. Keep existing values (folders store them).
export const FOLDER_COLORS = [
  [null, 'Gray'],
  ['var(--fg)', 'Black'], // follows the theme, so it's white in dark mode
  ['#78716c', 'Stone'],
  ['#92400e', 'Brown'],
  ['#b91c1c', 'Crimson'],
  ['#e11d48', 'Red'],
  ['#fb7185', 'Coral'],
  ['#ea580c', 'Orange'],
  ['#f59e0b', 'Amber'],
  ['#ca8a04', 'Yellow'],
  ['#84cc16', 'Lime'],
  ['#16a34a', 'Green'],
  ['#047857', 'Forest'],
  ['#0d9488', 'Teal'],
  ['#0891b2', 'Cyan'],
  ['#0ea5e9', 'Sky'],
  ['#2563eb', 'Blue'],
  ['#4f46e5', 'Indigo'],
  ['#7c3aed', 'Purple'],
  ['#db2777', 'Pink'],
];

/**
 * openFolderSheet({ cat?, parent?, onDone?(id), onCancel? })
 * New folder: "Academic/Biology" creates nested folders; the color goes on the last one.
 */
export function openFolderSheet({ cat = null, parent = null, onDone = () => {}, onCancel = () => {} } = {}) {
  let color = cat ? cat.color || null : null;
  let finished = false;

  const name = h('input', {
    type: 'text', maxlength: '40', value: cat ? cat.name : '', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: 'Folder name', 'aria-label': 'Folder name',
  });

  const swatches = h('div', { class: 'swatches folder-colors', role: 'radiogroup', 'aria-label': 'Underline color' });
  const paint = () => swatches.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.c || null) === color)));
  for (const [c, label] of FOLDER_COLORS) {
    swatches.append(h('button', {
      type: 'button', role: 'radio', class: `swatch${c ? '' : ' gray'}`, 'aria-label': label,
      'data-c': c || '', style: c ? `background:${c}` : null,
      onclick: () => { color = c; paint(); },
    }));
  }
  paint();

  const close = () => dialog.close();

  const submit = (ev) => {
    ev.preventDefault();
    const text = name.value.trim();
    if (!text) { name.focus(); return; }
    let id;
    if (cat) {
      cat.name = text.replace(/\//g, '-');
      cat.color = color;
      id = cat.id;
    } else {
      id = ensureCategoryPath(text, parent);
      state.categories.find((c) => c.id === id).color = color;
    }
    finished = true;
    save();
    close();
    onDone(id);
  };

  const remove = async () => {
    if (!await ask({ title: `Delete folder “${cat.name}”?`, message: 'Its to-dos move up a level.', ok: 'Delete', danger: true })) return;
    finished = true;
    close();
    deleteCategory(cat.id);
  };

  dialog.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      cat ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete folder', onclick: remove }, icon(ICONS.trash)) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'title-row' }, name),
    swatches));

  dialog.addEventListener('close', () => { if (!finished) onCancel(); }, { once: true });
  dialog.showModal();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
