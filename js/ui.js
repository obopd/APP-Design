// The app's own dialogs and menus, replacing the iPhone system ones (confirm/alert/
// prompt and native <select> menus) so everything matches the app's design.
// Each uses a <dialog> opened with showModal(), so it sits above any open sheet.
import { h, icon, ICONS } from './util.js';

export function openLayer(className, content, { onBackdrop } = {}) {
  const dialog = h('dialog', { class: `layer ${className}` }, content);
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog && onBackdrop) onBackdrop(); });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (onBackdrop) onBackdrop(); }); // Esc
  dialog.showModal();
  return {
    dialog,
    close() {
      dialog.classList.add('closing');
      setTimeout(() => { dialog.close(); dialog.remove(); }, 160);
    },
  };
}

/**
 * Yes/no card. Resolves true for the confirm button, false otherwise.
 * danger: confirm button in red (for deletes).
 */
export function ask({ title, message = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let layer;
    const done = (answer) => { layer.close(); resolve(answer); };
    layer = openLayer('ask', h('div', { class: 'ask-card', role: 'alertdialog', 'aria-label': title },
      h('p', { class: 'ask-title display' }, title),
      message ? h('p', { class: 'ask-message' }, message) : null,
      h('div', { class: 'ask-actions' },
        cancel ? h('button', { type: 'button', class: 'ask-btn', onclick: () => done(false) }, cancel) : null,
        h('button', { type: 'button', class: `ask-btn primary${danger ? ' danger' : ''}`, onclick: () => done(true) }, ok))),
    { onBackdrop: () => done(false) });
  });
}

/** Message with a single button. */
export const tell = (title, message = '') => ask({ title, message, ok: 'OK', cancel: null });

/**
 * Text-entry card. Resolves the typed text, or null when cancelled.
 * The field isn't focused automatically, so the keyboard waits for a tap.
 */
export function askText({ title, message = '', value = '', placeholder = '', inputmode = 'text', ok = 'Save' }) {
  return new Promise((resolve) => {
    let layer;
    const input = h('input', { type: 'text', class: 'ask-input', value, placeholder, inputmode, autocomplete: 'off', enterkeyhint: 'done' });
    const done = (answer) => { layer.close(); resolve(answer); };
    layer = openLayer('ask', h('form', { novalidate: true,
      class: 'ask-card', onsubmit: (e) => { e.preventDefault(); done(input.value); },
    },
    h('p', { class: 'ask-title display' }, title),
    message ? h('p', { class: 'ask-message' }, message) : null,
    input,
    h('div', { class: 'ask-actions' },
      // autofocus here keeps showModal() from focusing the field (no keyboard until it's tapped)
      h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => done(null) }, 'Cancel'),
      h('button', { type: 'submit', class: 'ask-btn primary' }, ok))),
    { onBackdrop: () => done(null) });
  });
}

/**
 * Dropdown menu anchored to an element. options: [[value, label], …].
 * Resolves the chosen value, or undefined when dismissed.
 */
export function pick(anchor, options, current) {
  return new Promise((resolve) => {
    let layer;
    const done = (v) => { layer.close(); resolve(v); };
    const menu = h('div', { class: 'menu-card', role: 'listbox' },
      options.map(([v, label]) => h('button', {
        type: 'button', role: 'option', class: 'menu-item', 'aria-selected': String(v === current),
        onclick: () => done(v),
      }, h('span', { class: 'menu-check' }, v === current ? icon(ICONS.check) : null), h('span', {}, label))));
    layer = openLayer('menu', menu, { onBackdrop: () => done(undefined) });

    // Place under the anchor (or above it if there isn't room), right-aligned to it.
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const below = a.bottom + 6 + m.height < innerHeight - 12;
    menu.style.top = `${below ? a.bottom + 6 : Math.max(12, a.top - 6 - m.height)}px`;
    menu.style.left = `${Math.min(innerWidth - m.width - 12, Math.max(12, a.right - m.width))}px`;
    menu.style.transformOrigin = below ? 'top right' : 'bottom right';
  });
}

/**
 * Drop-in replacement for a <select>: a button showing the current label that opens
 * pick(). Supports .value (get/set), setOptions(), and fires 'change' like a select.
 */
export function selectButton(options, value) {
  let opts = options;
  let current = value;
  const label = h('span', { class: 'select-label' });
  const el = h('button', { type: 'button', class: 'select-btn' }, label, icon(ICONS.updown));
  const paint = () => {
    const found = opts.find(([v]) => v === current);
    label.textContent = found ? found[1].trim() : ''; // menu indents nested folders; the button doesn't
  };
  el.addEventListener('click', async () => {
    const v = await pick(el, opts, current);
    if (v === undefined) return;
    current = v;
    paint();
    el.dispatchEvent(new Event('change'));
  });
  Object.defineProperty(el, 'value', { get: () => current, set: (v) => { current = v; paint(); } });
  el.setOptions = (next, selected = current) => { opts = next; current = selected; paint(); };
  paint();
  return el;
}

/**
 * Date card (the field opens the iPhone date wheel). Resolves 'YYYY-MM-DD' or null.
 */
export function askDate({ title, message = '', value = '', min = '', ok = 'Move' }) {
  return new Promise((resolve) => {
    let layer;
    const input = h('input', { type: 'date', class: 'ask-input ask-date', value, min: min || null });
    const done = (answer) => { layer.close(); resolve(answer); };
    layer = openLayer('ask', h('form', {
      novalidate: true, class: 'ask-card', onsubmit: (e) => { e.preventDefault(); if (input.value) done(input.value); },
    },
    h('p', { class: 'ask-title display' }, title),
    message ? h('p', { class: 'ask-message' }, message) : null,
    input,
    h('div', { class: 'ask-actions' },
      h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => done(null) }, 'Cancel'),
      h('button', { type: 'submit', class: 'ask-btn primary' }, ok))),
    { onBackdrop: () => done(null) });
  });
}

/** Small message above the dock, with an optional action (e.g. Undo). */
let toastTimer = null;
export function snack(text, { action, onAction } = {}) {
  document.querySelector('.snack')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'snack', role: 'status' },
    h('span', {}, text),
    action ? h('button', { type: 'button', class: 'snack-btn', onclick: () => { el.remove(); onAction(); } }, action) : null);
  document.body.append(el);
  toastTimer = setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); }, 4500);
}

/**
 * Card with a checklist. options: [[value, label, sub?]]. Resolves the chosen values in the
 * options' order, or null when cancelled.
 */
export function pickMany(options, selected = [], { title = 'Choose', message = '', empty = 'Nothing to choose yet.', ok = 'Done' } = {}) {
  return new Promise((resolve) => {
    const chosen = new Set(selected);
    let layer;
    const done = (v) => { layer.close(); resolve(v); };
    const rows = options.map(([value, label, sub]) => {
      const mark = h('span', { class: 'menu-check' }, chosen.has(value) ? icon(ICONS.check) : null);
      const btn = h('button', {
        type: 'button', class: 'menu-item', role: 'checkbox', 'aria-checked': String(chosen.has(value)),
        onclick: () => {
          if (chosen.has(value)) chosen.delete(value); else chosen.add(value);
          btn.setAttribute('aria-checked', String(chosen.has(value)));
          mark.replaceChildren(...(chosen.has(value) ? [icon(ICONS.check)] : []));
        },
      }, mark, h('span', { class: 'pick-name' }, label, sub ? h('small', {}, sub) : null));
      return btn;
    });
    layer = openLayer('ask', h('div', { class: 'ask-card' },
      h('p', { class: 'ask-title display' }, title),
      rows.length ? (message ? h('p', { class: 'ask-message' }, message) : null) : h('p', { class: 'ask-message' }, empty),
      h('div', { class: 'friend-pick' }, rows),
      h('div', { class: 'ask-actions' },
        h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => done(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'ask-btn primary', onclick: () => done(options.map(([v]) => v).filter((v) => chosen.has(v))) }, ok))),
    { onBackdrop: () => done(null) });
  });
}
