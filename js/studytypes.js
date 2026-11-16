// Study mode: managing note types like Anki's "Manage Note Types": add (copy) a type, rename
// it, add / rename / move / delete fields, add / delete card types, and edit each card's
// front and back templates and the type's styling, with a live preview of a real note.
// Scripts in templates never run, and only safe styling is used (cardtext.js scopedCss).
import { h, icon, ICONS } from './util.js';
import { ask, tell, askText, pick, snack } from './ui.js';
import {
  noteTypes, noteType, notesOfType, editableType, isBuiltinType, saveNoteType, addNoteType, fieldNameProblem,
  renameField, addField, removeField, moveField, templateRemoval, removeTemplate, deleteNoteType, cardsToAdd,
  cardsOfNote, deckPath,
} from './study.js';
import { renderCard, safeFragment, styleClass } from './cardtext.js';
import { fillMedia } from './studymedia.js';
import { paintOcclusion } from './occlusion.js';

const sheet = document.getElementById('nt-sheet');
sheet.addEventListener('click', (e) => { if (e.target === sheet) leave(); });
sheet.addEventListener('cancel', (e) => { e.preventDefault(); leave(); });

let onDone = () => {};
let leave = () => sheet.close();
sheet.addEventListener('close', () => onDone());

const head = (left, title, ...right) => h('div', { class: 'sheet-head' },
  left, h('span', { class: 'spacer' }), h('span', { class: 'sheet-title display' }, title), h('span', { class: 'spacer' }), ...right);
const closeBtn = () => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => sheet.close() }, icon(ICONS.close));
const backBtn = (to, label = 'Back') => h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, onclick: to }, icon(ICONS.left));
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const show = (...kids) => {
  sheet.replaceChildren(h('div', { class: 'nt-page' }, h('div', { class: 'grabber' }), ...kids));
  sheet.scrollTop = 0;
};

/** Open the note type manager. `onClose` runs when it closes (e.g. to refresh the add sheet). */
export function openNoteTypes({ typeId = null, onClose = () => {} } = {}) {
  onDone = onClose;
  if (typeId) typePage(typeId); else listPage();
  if (!sheet.open) sheet.showModal();
}

/* ---------- All note types ---------- */

function listPage() {
  leave = () => sheet.close();
  const add = async (e) => {
    const base = await pick(e.currentTarget, noteTypes().map((t) => [t.id, `Copy of ${t.name}`]));
    if (!base) return;
    const name = await askText({ title: 'New note type', value: `${noteType(base).name} copy`, ok: 'Create' });
    if (!name || !name.trim()) return;
    typePage(addNoteType(base, name).id);
  };
  show(
    head(closeBtn(), 'Note types', h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add note type', onclick: add }, icon(ICONS.plus))),
    h('ul', { class: 'nt-list' }, noteTypes().map((t) => h('li', {},
      h('button', { type: 'button', class: 'nt-row', onclick: () => typePage(t.id) },
        h('span', { class: 'nt-name' }, t.name),
        h('small', {}, count(notesOfType(t.id).length, 'note')),
        icon(ICONS.right))))),
    h('p', { class: 'set-note' }, 'A note type sets a note’s fields, the cards it makes and how they look.'));
}

/* ---------- One note type ---------- */

function typePage(id) {
  leave = () => sheet.close();
  const t = editableType(id);
  const again = () => typePage(id);
  const nNotes = notesOfType(id).length;

  const more = async (e) => {
    const v = await pick(e.currentTarget, [
      ['rename', 'Rename'], ['copy', 'Make a copy'],
      ...(isBuiltinType(id) ? [] : [['delete', 'Delete note type']]),
    ]);
    if (v === 'rename') {
      const name = await askText({ title: 'Rename note type', value: t.name, ok: 'Save' });
      if (name && name.trim()) { t.name = name.trim(); saveNoteType(t); again(); }
    }
    if (v === 'copy') {
      const name = await askText({ title: 'Copy note type', value: `${t.name} copy`, ok: 'Create' });
      if (name && name.trim()) typePage(addNoteType(id, name).id);
    }
    if (v === 'delete') {
      const ok = await ask({
        title: `Delete “${t.name}”?`,
        message: nNotes ? `Its ${count(nNotes, 'note')} and their cards are deleted too.` : 'No notes use it.',
        ok: 'Delete', danger: true,
      });
      if (ok) { deleteNoteType(id); listPage(); }
    }
  };

  const fieldMenu = async (e, f, i) => {
    const v = await pick(e.currentTarget, [
      ['rename', 'Rename'],
      ...(i > 0 ? [['up', 'Move up']] : []),
      ...(i < t.fields.length - 1 ? [['down', 'Move down']] : []),
      ...(t.fields.length > 1 && !Object.values(t.io || {}).includes(f) ? [['delete', 'Delete']] : []),
    ]);
    if (v === 'rename') {
      const name = await askText({ title: 'Rename field', value: f, ok: 'Save' });
      if (name == null || name.trim() === f) return;
      const why = fieldNameProblem(t, name, f);
      if (why) { tell('Can’t use that name', why); return; }
      renameField(t, f, name);
      again();
    }
    if (v === 'up' || v === 'down') { moveField(t, f, v === 'up' ? -1 : 1); again(); }
    if (v === 'delete') {
      const used = notesOfType(id).filter((n) => String(n.fields?.[f] || '').trim()).length;
      const ok = await ask({
        title: `Delete the field “${f}”?`,
        message: used ? `What ${count(used, 'note has', 'notes have')} in it is deleted too.` : 'No note has anything in it.',
        ok: 'Delete', danger: true,
      });
      if (ok) { removeField(t, f); again(); }
    }
  };
  const newField = async () => {
    const name = await askText({ title: 'New field', placeholder: 'e.g. Example', ok: 'Add' });
    if (name == null) return;
    const why = fieldNameProblem(t, name);
    if (why) { tell('Can’t use that name', why); return; }
    addField(t, name);
    again();
  };
  const newCard = async () => {
    const draft = editableType(id);
    const n = draft.templates.length + 1;
    draft.templates.push({ name: `Card ${n}`, front: `{{${draft.fields[1] || draft.fields[0]}}}`, back: `{{FrontSide}}<hr id=answer>{{${draft.fields[0]}}}` });
    const adds = cardsToAdd(draft);
    if (adds && !await ask({ title: 'Add a card type?', message: `Each note of this type gets one more card: ${count(adds, 'new card')}.`, ok: 'Add' })) return;
    saveNoteType(draft);
    templatePage(id, draft.templates.length - 1);
  };

  show(
    head(backBtn(listPage, 'Note types'), t.name,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', onclick: more }, icon(ICONS.more))),
    h('p', { class: 'set-note nt-sub' }, `${count(nNotes, 'note')}${t.cloze ? ' · Cloze' : ''}`),
    h('div', { class: 'section-head nt-head' },
      h('h3', { class: 'section-label display' }, 'Fields'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add field', onclick: newField }, icon(ICONS.plus))),
    h('ul', { class: 'nt-list' }, t.fields.map((f, i) => h('li', {},
      h('button', { type: 'button', class: 'nt-row', onclick: (e) => fieldMenu(e, f, i) },
        h('span', { class: 'nt-name' }, f), i === 0 ? h('small', {}, 'Sorts & checks duplicates') : null, icon(ICONS.more))))),
    h('div', { class: 'section-head nt-head' },
      h('h3', { class: 'section-label display' }, t.cloze ? 'Card' : 'Cards'),
      t.cloze ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add card type', onclick: newCard }, icon(ICONS.plus))),
    h('ul', { class: 'nt-list' }, t.templates.map((tp, i) => h('li', {},
      h('button', { type: 'button', class: 'nt-row', onclick: () => templatePage(id, i) },
        h('span', { class: 'nt-name' }, tp.name || `Card ${i + 1}`), h('small', {}, 'Front · Back · Styling'), icon(ICONS.right))))),
    t.io ? h('p', { class: 'set-note' }, `One card for each box drawn over the picture (“${t.io.occl}” keeps the boxes, “${t.io.image}” the picture).`)
      : t.cloze ? h('p', { class: 'set-note' }, 'A cloze note makes one card for each {{c1::…}}, {{c2::…}} number.') : null);
}

/* ---------- One card type: front, back, styling ---------- */

const PARTS = [['front', 'Front'], ['back', 'Back'], ['css', 'Styling']];

// A note to preview with: the first one of this type that makes this card, else the field names.
function sampleNote(t, ord) {
  for (const n of notesOfType(t.id)) if (cardsOfNote(n.id).some((c) => c.ord === ord)) return { note: n, deck: deckPath(cardsOfNote(n.id)[0].deck) };
  const fields = Object.fromEntries(t.fields.map((f) => [f, t.cloze && f === t.fields[0] && !t.io ? `{{c${ord + 1}::(${f})}}` : `(${f})`]));
  return { note: { fields, tags: [] }, deck: 'Default' };
}

function templatePage(id, ord) {
  const saved = editableType(id);
  const t = editableType(id);
  const tp = t.templates[ord];
  if (!tp) { typePage(id); return; }
  let part = 'front';
  const changed = () => tp.front !== saved.templates[ord].front || tp.back !== saved.templates[ord].back
    || (t.css || '') !== (saved.css || '') || tp.name !== saved.templates[ord].name;
  const back = async () => {
    if (changed() && !await ask({ title: 'Discard changes?', message: 'What you changed in this card isn’t saved.', ok: 'Discard', danger: true })) return;
    typePage(id);
  };
  leave = () => { if (!changed()) sheet.close(); else back(); };

  const code = h('textarea', {
    class: 'nt-code', rows: '9', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
    'aria-label': 'Template', oninput: () => { if (part === 'css') t.css = code.value; else tp[part] = code.value; schedule(); },
  });
  const face = h('div', { class: 'rv-card nt-preview' });
  const sample = sampleNote(t, ord);
  const paint = () => {
    const html = renderCard(t, sample.note, ord, { deck: sample.deck });
    face.className = `rv-card nt-preview ${styleClass(t)}`.trim();
    face.replaceChildren(safeFragment(part === 'front' ? html.front : html.back, { card: true }));
    face.querySelectorAll('.typein').forEach((slot) => slot.replaceWith(h('span', { class: 'typed typed-none' }, '[type the answer]')));
    if (t.io) paintOcclusion(face, t, sample.note, ord, part !== 'front');
    fillMedia(face);
  };
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 250); };
  const hint = h('p', { class: 'set-note nt-hint' });
  const tabs = h('div', { class: 'segmented nt-tabs', role: 'radiogroup' }, PARTS.map(([v, label]) => h('button', {
    type: 'button', role: 'radio', 'data-v': v, onclick: () => setPart(v),
  }, label)));
  const setPart = (v) => {
    part = v;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    code.value = v === 'css' ? t.css || '' : tp[v] || '';
    code.setAttribute('aria-label', PARTS.find((p) => p[0] === v)[1]);
    hint.textContent = v === 'css'
      ? 'Styling for this note type’s cards (.card is the whole card; .nightMode for dark). Web images, fonts and positions aren’t used.'
      : `Fields: ${t.fields.map((f) => `{{${f}}}`).join(' ')}${v === 'back' ? ' · {{FrontSide}}' : ''}${t.cloze ? ' · {{cloze:Field}}' : ' · {{type:Field}}'}. Scripts don’t run.`;
    paint();
  };

  const more = async (e) => {
    const v = await pick(e.currentTarget, [
      ['rename', 'Rename card type'],
      ...(t.cloze || t.templates.length < 2 ? [] : [['delete', 'Delete card type']]),
    ]);
    if (v === 'rename') {
      const name = await askText({ title: 'Rename card type', value: tp.name, ok: 'Save' });
      if (name && name.trim()) { tp.name = name.trim(); titleEl.textContent = tp.name; }
    }
    if (v === 'delete') {
      const { cards, notes } = templateRemoval(saved, ord);
      const ok = await ask({
        title: `Delete “${tp.name}”?`,
        message: [`${count(cards.length, 'card')} and their history are deleted.`,
          notes.length ? `${count(notes.length, 'note has', 'notes have')} no other card and ${notes.length === 1 ? 'is' : 'are'} deleted too.` : ''].filter(Boolean).join(' '),
        ok: 'Delete', danger: true,
      });
      if (ok) { removeTemplate(saved, ord); typePage(id); }
    }
  };
  const save = async () => {
    const adds = cardsToAdd(t);
    if (adds > 0 && !await ask({ title: 'Save card type?', message: `Notes that now fill in its front get a card: ${count(adds, 'new card')}.`, ok: 'Save' })) return;
    saveNoteType(t);
    if (adds) snack(`Added ${count(adds, 'card')}`);
    typePage(id);
  };

  const titleEl = h('span', { class: 'sheet-title display' }, tp.name || `Card ${ord + 1}`);
  show(
    h('div', { class: 'sheet-head' },
      backBtn(back, t.name), h('span', { class: 'spacer' }), titleEl, h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', onclick: more }, icon(ICONS.more)),
      h('button', { type: 'button', class: 'icon-btn ok', 'aria-label': 'Save', onclick: save }, icon(ICONS.check))),
    tabs, code, hint,
    h('p', { class: 'nt-preview-label' }, 'Preview'),
    face);
  setPart('front');
}
