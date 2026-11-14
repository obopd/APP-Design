// Study mode screens: the deck list (Decks tab), a deck's overview, the review screen,
// and the sheets to add / edit notes, set deck options, start a custom study session and
// see a card's info.
import { h, icon, ICONS, fmt } from './util.js';
import { ask, tell, askText, pick, selectButton, snack, openLayer } from './ui.js';
import {
  decks, deck, deckTree, childDecks, deckPath, addDeck, deleteDeck, put, presets, presetOf, noteTypes, noteType,
  note, cardsOfNote, addNote, updateNote, deleteNotes, duplicateOf, answerCard, bury, setSuspended, setFlag,
  dueCounts, nextCard, reviewsOf, getItem, studyStatus, defaultDeck, uid, remove,
} from './study.js';
import { renderCard, safeFragment, cleanHtml, plain } from './cardtext.js';
import { preview, dueLabel, currentR, withDefaults, dayOf } from './srs.js';

const sheet = document.getElementById('study-sheet');
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

export const FLAGS = [[0, 'No flag'], [1, 'Red'], [2, 'Orange'], [3, 'Green'], [4, 'Blue'], [5, 'Pink'], [6, 'Turquoise'], [7, 'Purple']];
const flagDot = (n) => (n ? h('span', { class: `flag-dot flag-${n}`, 'aria-label': `${FLAGS[n][1]} flag` }) : null);
const countTrio = (c) => h('span', { class: 'trio', 'aria-label': `${c.new} new, ${c.learn} learning, ${c.review} to review` },
  h('span', { class: 'n-new', 'data-zero': c.new ? null : '1' }, String(c.new)),
  h('span', { class: 'n-learn', 'data-zero': c.learn ? null : '1' }, String(c.learn)),
  h('span', { class: 'n-review', 'data-zero': c.review ? null : '1' }, String(c.review)));

// The study logo at the top of Decks: tap to switch mode (the calendar's logo isn't here).
let modeMenu = () => {};
export const setModeMenu = (fn) => { modeMenu = fn; };
function modeButton() {
  const art = document.querySelector('#brand .brand-study')?.cloneNode(true);
  if (art) art.setAttribute('class', 'mode-art');
  return h('button', { class: 'mode-btn', 'aria-label': 'Switch mode', onclick: (e) => modeMenu(e.currentTarget) }, art);
}

let openDeckId = null; // the deck whose overview shows in the Decks tab
let rerender = () => {};

/* ---------- Decks tab ---------- */

export function renderDecks(root, { onImport }) {
  rerender = () => renderDecks(root, { onImport });
  if (session) return; // the review screen is on top
  if (openDeckId && !deck(openDeckId)) openDeckId = null;
  if (openDeckId) { root.replaceChildren(overview(openDeckId)); return; }
  const tree = deckTree();
  const missing = studyStatus() === 'missing';
  root.replaceChildren(h('div', { class: 'settings study-page' },
    h('div', { class: 'page-head' },
      h('span', { class: 'head-title' }, modeButton(), h('h1', { class: 'display' }, 'Decks')),
      h('span', { class: 'head-btns' },
        h('button', { class: 'icon-btn page-add', 'aria-label': 'Import from Anki', onclick: onImport }, icon(ICONS.download)),
        h('button', { class: 'icon-btn page-add section-folder', 'aria-label': 'New deck', onclick: () => newDeck(null) }, icon(ICONS.folderPlus)),
        h('button', { class: 'icon-btn page-add', 'aria-label': 'Add card', onclick: () => openNoteSheet() }, icon(ICONS.plus)))),
    missing ? h('p', { class: 'set-note' }, 'Saved on this phone only: run supabase/study.sql in Supabase to sync.') : null,
    tree.length
      ? h('ul', { class: 'deck-list' }, tree.map(({ deck: d, depth }) => deckRow(d, depth)).filter(Boolean))
      : h('p', { class: 'set-note study-empty' }, 'No decks yet. Tap + to add a card, or ↓ to bring in an Anki deck.'),
  ));
}

function hiddenByParent(d) {
  for (let p = deck(d.parent), i = 0; p && i < 20; p = deck(p.parent), i += 1) if (p.collapsed) return true;
  return false;
}

function deckRow(d, depth) {
  if (hiddenByParent(d)) return null;
  const kids = childDecks(d.id).length;
  return h('li', { class: `deck-row${d.filtered ? ' filtered' : ''}`, style: `--depth:${depth}` },
    kids ? h('button', {
      class: `deck-fold${d.collapsed ? '' : ' open'}`, 'aria-label': d.collapsed ? `Open ${d.name}` : `Close ${d.name}`,
      onclick: () => put({ ...d, collapsed: !d.collapsed }),
    }, icon(ICONS.right)) : h('span', { class: 'deck-fold' }),
    h('button', { class: 'deck-name', onclick: () => { openDeckId = d.id; rerender(); } }, d.name),
    countTrio(dueCounts(d.id)));
}

async function newDeck(parent) {
  const name = await askText({ title: parent ? `New deck in ${deck(parent).name}` : 'New deck', placeholder: 'e.g. Biology', ok: 'Create' });
  if (name && name.trim()) addDeck(name, parent);
}

/* ---------- Deck overview ---------- */

function overview(id) {
  const d = deck(id);
  const c = dueCounts(id);
  const total = c.new + c.learn + c.review;
  const more = async (e) => {
    const v = await pick(e.currentTarget, [
      ...(d.filtered ? [] : [['sub', 'Add subdeck'], ['rename', 'Rename']]),
      ['delete', d.filtered ? 'Delete session' : 'Delete deck'],
    ]);
    if (v === 'sub') newDeck(id);
    if (v === 'rename') {
      const name = await askText({ title: 'Rename deck', value: d.name, ok: 'Save' });
      if (name && name.trim()) put({ ...d, name: name.trim().replace(/::/g, ' ') });
    }
    if (v === 'delete') {
      const ok = await ask(d.filtered
        ? { title: `Delete “${d.name}”?`, message: 'The cards stay in their own decks.', ok: 'Delete', danger: true }
        : { title: `Delete “${d.name}”?`, message: 'Its subdecks and all their cards are deleted too.', ok: 'Delete', danger: true });
      if (ok) { (d.filtered ? remove(id) : deleteDeck(id)); openDeckId = null; rerender(); }
    }
  };
  return h('div', { class: 'settings study-page deck-overview' },
    h('div', { class: 'page-head' },
      h('button', { class: 'icon-btn back-btn', 'aria-label': 'Decks', onclick: () => { openDeckId = d.parent && deck(d.parent) ? d.parent : null; rerender(); } }, icon(ICONS.left)),
      h('button', { class: 'icon-btn', 'aria-label': 'More', onclick: more }, icon(ICONS.more))),
    h('h1', { class: 'display ov-title' }, deckPath(id) || d.name),
    d.filtered ? h('p', { class: 'set-note ov-query' }, d.filtered.query) : null,
    h('div', { class: 'ov-counts' },
      h('div', {}, h('b', { class: 'display n-new' }, String(c.new)), h('small', {}, 'New')),
      h('div', {}, h('b', { class: 'display n-learn' }, String(c.learn)), h('small', {}, 'Learning')),
      h('div', {}, h('b', { class: 'display n-review' }, String(c.review)), h('small', {}, 'To review'))),
    h('button', { class: 'study-now', disabled: !total && !nextCard(id).wait, onclick: () => startSession(id) },
      total ? 'Study now' : nextCard(id).wait ? 'Learning cards later today' : 'Done for today'),
    h('div', { class: 'ov-actions' },
      d.filtered ? null : h('button', { class: 'pill', onclick: () => openNoteSheet({ deckId: id }) }, 'Add'),
      h('button', { class: 'pill', onclick: () => browseHook(d.filtered ? d.filtered.query : `deck:"${deckPath(id)}"`) }, 'Browse'),
      d.filtered ? null : h('button', { class: 'pill', onclick: () => openOptions(id) }, 'Options'),
      d.filtered ? null : h('button', { class: 'pill', onclick: () => openCustomStudy(id) }, 'Custom study')),
    childDecks(id).length ? h('ul', { class: 'deck-list ov-subdecks' }, deckTree(id).map(({ deck: s, depth }) => deckRow(s, depth)).filter(Boolean)) : null);
}

let browseHook = () => {};
export const setBrowseHook = (fn) => { browseHook = fn; };
export const showDeck = (id) => { openDeckId = id; rerender(); };

/* ---------- Review ---------- */

let session = null; // { deckId, card, shown, start, seen, answered, undo, root, wait }
let keyHandler = null;

function startSession(deckId) {
  const root = document.getElementById('view-decks');
  session = { deckId, seen: new Set(), answered: 0, undo: null, root, card: null, shown: false, timer: 0 };
  document.body.classList.add('studying');
  showNext();
  keyHandler = (e) => onKey(e);
  document.addEventListener('keydown', keyHandler);
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  document.removeEventListener('keydown', keyHandler);
  document.body.classList.remove('studying');
  session = null;
  rerender();
}

function showNext() {
  clearTimeout(session.timer);
  const next = nextCard(session.deckId, Date.now(), session.seen, session.answered);
  session.card = next.card || null;
  session.shown = false;
  session.typed = '';
  session.start = Date.now();
  session.wait = next.wait || null;
  if (session.wait) session.timer = setTimeout(() => session && !session.card && showNext(), Math.max(1000, session.wait - Date.now() + 500));
  paintReview();
}

function paintReview() {
  const s = session;
  const c = dueCounts(s.deckId, Date.now(), s.seen);
  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: endSession }, icon(ICONS.close)),
    countTrio(c),
    h('span', { class: 'rv-tools' },
      s.undo ? h('button', { class: 'icon-btn', 'aria-label': 'Undo', onclick: undoLast }, icon(ICONS.undo)) : null,
      s.card ? h('button', { class: 'icon-btn', 'aria-label': 'Card menu', onclick: (e) => cardMenu(e.currentTarget) }, icon(ICONS.more)) : null));
  if (!s.card) {
    const later = s.wait ? `Next learning card at ${fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(s.wait))}.` : '';
    s.root.replaceChildren(h('div', { class: 'study-review done' }, top,
      h('div', { class: 'rv-done' },
        h('p', { class: 'display rv-done-title' }, s.wait ? 'Almost done' : 'Done for today'),
        h('p', { class: 'set-note' }, later || 'Come back tomorrow, or start a custom study session.'),
        h('div', { class: 'ov-actions' },
          deck(s.deckId)?.filtered ? null : h('button', { class: 'pill', onclick: () => { const id = s.deckId; endSession(); openCustomStudy(id); } }, 'Custom study'),
          h('button', { class: 'pill', onclick: endSession }, 'Back')))));
    return;
  }
  const n = note(s.card.note);
  const type = noteType(n?.type);
  const html = renderCard(type, n || { fields: {}, tags: [] }, s.card.ord, { deck: deckPath(s.card.deck) });
  const face = h('div', { class: 'rv-card' }, safeFragment(s.shown ? html.back : html.front));
  // Type-in: a field on the front, a comparison on the back.
  face.querySelectorAll('.typein').forEach((slot, i) => {
    if (i > 0) { slot.remove(); return; }
    if (!s.shown) {
      const input = h('input', {
        type: 'text', class: 'typein-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        enterkeyhint: 'done', placeholder: 'Type the answer', 'aria-label': 'Your answer', value: s.typed,
        oninput: (e) => { s.typed = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); reveal(); } },
      });
      slot.replaceWith(input);
    } else slot.replaceWith(typeResult(s.typed, html.expected || ''));
  });
  const flag = s.card.flag ? h('span', { class: `rv-flag flag-${s.card.flag}`, 'aria-label': `${FLAGS[s.card.flag][1]} flag` }) : null;
  const bottom = s.shown
    ? h('div', { class: 'rv-answers' }, preview(s.card, presetOf(s.card.deck)).map(({ rating, label }) => h('button', {
      class: `rv-btn r${rating}`, onclick: () => answerNow(rating), 'aria-label': `${['Again', 'Hard', 'Good', 'Easy'][rating - 1]}, ${label}`,
    }, h('small', {}, label), h('span', {}, ['Again', 'Hard', 'Good', 'Easy'][rating - 1]))))
    : h('div', { class: 'rv-answers' }, h('button', { class: 'rv-show', onclick: reveal }, 'Show answer'));
  s.root.replaceChildren(h('div', { class: 'study-review' }, top, h('div', { class: 'rv-scroll' }, flag, face), bottom));
}

function typeResult(typed, expected) {
  const a = typed.trim();
  const b = expected.trim();
  if (a && a.toLowerCase() === b.toLowerCase()) return h('span', { class: 'typed ok' }, b);
  return h('span', { class: 'typed' },
    a ? h('s', { class: 'typed-wrong' }, a) : h('span', { class: 'typed-none' }, '(no answer)'),
    ' → ', h('span', { class: 'typed-right' }, b));
}

function reveal() {
  if (!session?.card || session.shown) return;
  session.shown = true;
  paintReview();
}

function answerNow(rating) {
  const s = session;
  if (!s?.card || !s.shown) return;
  const card = getItem(s.card.id) || s.card;
  const undo = answerCard(card, rating, Date.now() - s.start);
  s.seen.add(card.id);
  s.answered += 1;
  s.undo = () => {
    const before = undo();
    s.seen.delete(card.id);
    s.answered = Math.max(0, s.answered - 1);
    s.card = before;
    s.shown = false;
    s.start = Date.now();
    s.undo = null;
    paintReview();
  };
  showNext();
}
function undoLast() { session?.undo?.(); }

async function cardMenu(anchor) {
  const s = session;
  const c = getItem(s.card.id) || s.card;
  const v = await pick(anchor, [
    ['edit', 'Edit note'], ['flag', 'Flag…'], ['bury', 'Bury card'], ['burynote', 'Bury note'],
    ['suspend', 'Suspend card'], ['info', 'Card info'],
  ]);
  if (!v || !session) return;
  if (v === 'edit') { openNoteSheet({ noteId: c.note, onSaved: () => session && paintReview() }); return; }
  if (v === 'info') { openCardInfo(c); return; }
  if (v === 'flag') {
    const f = await pick(anchor, FLAGS, c.flag || 0);
    if (f !== undefined) { setFlag([c], f); s.card = getItem(c.id); paintReview(); }
    return;
  }
  if (v === 'bury') { bury([c]); snack('Buried until tomorrow'); }
  if (v === 'burynote') { bury(cardsOfNote(c.note)); snack('Note buried until tomorrow'); }
  if (v === 'suspend') { setSuspended([c], true); snack('Suspended'); }
  s.undo = null;
  showNext();
}

// Computers: Space / Enter shows the answer (then = Good), 1–4 answer, Z undoes, Esc closes.
function onKey(e) {
  if (!session || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const typing = e.target.closest?.('input, textarea, [contenteditable="true"]');
  if (e.key === 'Escape') { e.preventDefault(); endSession(); return; }
  if (typing) return;
  if ((e.key === ' ' || e.key === 'Enter') && session.card) { e.preventDefault(); if (session.shown) answerNow(3); else reveal(); return; }
  if (/^[1-4]$/.test(e.key) && session.shown) { e.preventDefault(); answerNow(Number(e.key)); return; }
  if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undoLast(); }
}

/* ---------- Add / edit note ---------- */

/**
 * openNoteSheet({ noteId?, deckId?, typeId?, onSaved? }) — adding stays open for the next
 * note (like Anki); editing closes on save.
 */
export function openNoteSheet({ noteId = null, deckId = null, typeId = null, onSaved = () => {} } = {}) {
  const editing = noteId ? note(noteId) : null;
  const lastType = localStorage.getItem('planner.studytype');
  let type = noteType(editing?.type || typeId || lastType || 'nt-basic');
  const typeBtn = selectButton(noteTypes().map((t) => [t.id, t.name]), type.id);
  const deckBtn = selectButton([], '');
  const fillDecks = (sel) => {
    const opts = deckTree().filter(({ deck: d }) => !d.filtered).map(({ deck: d, depth }) => [d.id, `${'\u2002'.repeat(depth * 2)}${d.name}`]);
    deckBtn.setOptions(opts.length ? opts : [['', 'Default']], opts.length ? sel || opts[0][0] : '');
  };
  const firstDeck = deckId || (editing && cardsOfNote(editing.id)[0]?.deck) || localStorage.getItem('planner.studydeck') || decks().find((d) => !d.filtered)?.id || '';
  fillDecks(deck(firstDeck) && !deck(firstDeck).filtered ? firstDeck : '');
  const tags = h('input', { type: 'text', class: 'tags-input', placeholder: 'Tags (space between)', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Tags', value: (editing?.tags || []).join(' ') });
  const dupe = h('p', { class: 'dupe-note', hidden: true }, 'Duplicate: another note already has this.');
  const fieldsBox = h('div', { class: 'note-fields' });
  let editors = {};

  const checkDupe = () => {
    const first = editors[type.fields[0]];
    dupe.hidden = !first || !duplicateOf(type.id, first.innerHTML, editing?.id);
  };
  const buildFields = (values = {}) => {
    editors = {};
    fieldsBox.replaceChildren(...type.fields.map((f, i) => {
      const ed = h('div', { class: 'field-edit', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': f, 'data-field': f });
      ed.append(safeFragment(values[f] || ''));
      if (i === 0) ed.addEventListener('input', checkDupe);
      editors[f] = ed;
      return h('div', { class: 'note-field' }, h('span', { class: 'note-field-name' }, f), ed);
    }));
    checkDupe();
  };
  buildFields(editing?.fields || {});
  typeBtn.addEventListener('change', () => {
    const old = Object.fromEntries(Object.entries(editors).map(([k, el]) => [k, el.innerHTML]));
    const oldOrder = type.fields.map((f) => old[f]);
    type = noteType(typeBtn.value);
    // Keep what was typed: same-named fields, else in order.
    buildFields(Object.fromEntries(type.fields.map((f, i) => [f, old[f] ?? oldOrder[i] ?? ''])));
    toolbarPaint();
  });

  // Formatting (works on the field being typed in): bold, italic, underline, cloze.
  let lastEd = null;
  fieldsBox.addEventListener('focusin', (e) => { if (e.target.classList?.contains('field-edit')) lastEd = e.target; });
  const fmtBtn = (label, cls, run) => h('button', {
    type: 'button', class: `fmt-btn ${cls}`, 'aria-label': label,
    onpointerdown: (e) => e.preventDefault(), // keep the keyboard and selection
    onclick: run,
  }, label === 'Cloze' ? '[…]' : label[0]);
  const clozeBtn = fmtBtn('Cloze', 'fmt-cloze', () => {
    const ed = lastEd || editors[type.fields[0]];
    if (!ed) return;
    const used = [...(ed.innerHTML.matchAll(/\{\{c(\d+)::/g))].map((m) => Number(m[1]));
    const n = (used.length ? Math.max(...used) : 0) + 1;
    const sel = window.getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) {
      const text = sel.toString();
      document.execCommand('insertText', false, `{{c${n}::${text}}}`);
    } else {
      ed.append(document.createTextNode(` {{c${n}::}}`));
    }
  });
  const toolbar = h('div', { class: 'fmt-bar' },
    fmtBtn('Bold', 'fmt-b', () => document.execCommand('bold')),
    fmtBtn('Italic', 'fmt-i', () => document.execCommand('italic')),
    fmtBtn('Underline', 'fmt-u', () => document.execCommand('underline')),
    clozeBtn);
  const toolbarPaint = () => { clozeBtn.hidden = !type.cloze; };
  toolbarPaint();

  const read = () => Object.fromEntries(type.fields.map((f) => [f, cleanHtml(editors[f].innerHTML)]));
  const close = () => sheet.close();
  const submit = (ev) => {
    ev.preventDefault();
    const fields = read();
    if (!plain(fields[type.fields[0]])) { tell('Nothing to add', `Fill in “${type.fields[0]}” first.`); return; }
    if (type.cloze && !/\{\{c\d+::/.test(Object.values(fields).join(' '))) {
      tell('No cloze yet', 'Select a word and tap […] to hide it, or type {{c1::word}}.');
      return;
    }
    const d = deckBtn.value || defaultDeck().id;
    localStorage.setItem('planner.studytype', type.id);
    localStorage.setItem('planner.studydeck', d);
    if (editing) {
      if (editing.type !== type.id) editing.type = type.id;
      updateNote(editing, fields, tags.value, d);
      close();
      onSaved();
      return;
    }
    const { cards: made } = addNote(type.id, fields, tags.value, d);
    if (!made.length) { tell('No cards made', 'This note type made no cards from what was typed.'); return; }
    snack(`Added ${made.length === 1 ? 'a card' : `${made.length} cards`}`);
    buildFields({});
    onSaved();
  };
  const del = async () => {
    if (!await ask({ title: 'Delete this note?', message: `Its ${cardsOfNote(editing.id).length} card(s) and their history are deleted.`, ok: 'Delete', danger: true })) return;
    deleteNotes([editing.id]);
    close();
    onSaved();
  };

  sheet.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'sheet-title display' }, editing ? 'Edit' : 'Add'),
      h('span', { class: 'spacer' }),
      editing ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete note', onclick: del }, icon(ICONS.trash)) : null,
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': editing ? 'Save' : 'Add' }, icon(ICONS.check))),
    h('div', { class: 'fields' },
      h('div', { class: 'field' }, h('span', {}, 'Type'), typeBtn),
      h('div', { class: 'field' }, h('span', {}, 'Deck'), deckBtn)),
    toolbar,
    fieldsBox,
    dupe,
    tags,
    editing ? h('div', { class: 'info-actions' }, cardsOfNote(editing.id).map((c) => h('button', {
      type: 'button', class: 'pill', onclick: () => openCardInfo(c),
    }, `Card ${c.ord + 1} info`))) : null));
  sheet.showModal(); // no focus: the keyboard opens when a field is tapped
}

/* ---------- Deck options (presets) ---------- */

export function openOptions(deckId) {
  const d = deck(deckId);
  let preset = { ...withDefaults(presetOf(deckId)), id: d.preset || 'preset-default' };
  const num = (v, label, step = '1') => h('input', { type: 'number', inputmode: 'decimal', step, value: String(v), 'aria-label': label, class: 'opt-num' });
  const steps = (v, label) => h('input', { type: 'text', value: v.map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`)).join(' '), 'aria-label': label, class: 'opt-steps', autocapitalize: 'off' });
  const parseSteps = (s) => s.split(/[\s,]+/).filter(Boolean).map((x) => {
    const m = x.match(/^([\d.]+)\s*([smhd]?)$/i);
    if (!m) return null;
    const n = Number(m[1]);
    return { s: n / 60, m: n, h: n * 60, d: n * 1440, '': n }[m[2].toLowerCase()];
  }).filter((x) => x && x > 0);
  const presetBtn = selectButton([...presets().map((p) => [p.id, p.name]), ['__new', 'New preset…']], preset.id);
  const f = {};
  const build = () => {
    f.newPerDay = num(preset.newPerDay, 'New cards per day');
    f.reviewsPerDay = num(preset.reviewsPerDay, 'Maximum reviews per day');
    f.learnSteps = steps(preset.learnSteps, 'Learning steps');
    f.relearnSteps = steps(preset.relearnSteps, 'Relearning steps');
    f.scheduler = selectButton([['fsrs', 'FSRS'], ['sm2', 'SM-2 (older)']], preset.scheduler);
    f.retention = num(preset.retention, 'Desired retention', '0.01');
    f.graduatingIvl = num(preset.graduatingIvl, 'Graduating interval');
    f.easyIvl = num(preset.easyIvl, 'Easy interval');
    f.startEase = num(preset.startEase, 'Starting ease', '0.05');
    f.maxIvl = num(preset.maxIvl, 'Maximum interval');
    f.leechThreshold = num(preset.leechThreshold, 'Leech threshold');
    f.leechAction = selectButton([['suspend', 'Suspend card'], ['tag', 'Tag only']], preset.leechAction);
    f.burySiblings = h('input', { type: 'checkbox', class: 'switch', checked: preset.burySiblings });
    f.newOrder = selectButton([['added', 'Order added'], ['random', 'Random']], preset.newOrder);
  };
  const row = (label, el, cls = '') => h('label', { class: `field ${cls}` }, h('span', {}, label), el);
  const body = h('div', { class: 'fields opt-fields' });
  const paint = () => {
    build();
    const fsrs = () => f.scheduler.value !== 'sm2';
    const used = decks().filter((x) => (x.preset || 'preset-default') === preset.id).length;
    body.replaceChildren(
      h('p', { class: 'set-note' }, `Preset used by ${used} deck${used === 1 ? '' : 's'}.`),
      h('h3', { class: 'section-label' }, 'Daily limits'),
      row('New cards / day', f.newPerDay), row('Maximum reviews / day', f.reviewsPerDay),
      h('h3', { class: 'section-label' }, 'Steps'),
      row('Learning steps', f.learnSteps), row('Relearning steps', f.relearnSteps),
      h('h3', { class: 'section-label' }, 'Scheduling'),
      row('Scheduler', f.scheduler),
      row('Desired retention', f.retention, 'only-fsrs'),
      row('Graduating interval (days)', f.graduatingIvl, 'only-sm2'),
      row('Easy interval (days)', f.easyIvl, 'only-sm2'),
      row('Starting ease', f.startEase, 'only-sm2'),
      row('Maximum interval (days)', f.maxIvl),
      h('h3', { class: 'section-label' }, 'Lapses'),
      row('Leech after (lapses)', f.leechThreshold), row('Leech action', f.leechAction),
      h('h3', { class: 'section-label' }, 'Burying & order'),
      row('Bury related cards', f.burySiblings), row('New cards', f.newOrder));
    const sync = () => {
      body.querySelectorAll('.only-fsrs').forEach((el) => { el.hidden = !fsrs(); });
      body.querySelectorAll('.only-sm2').forEach((el) => { el.hidden = fsrs(); });
    };
    f.scheduler.addEventListener('change', sync);
    sync();
  };
  paint();
  presetBtn.addEventListener('change', async () => {
    if (presetBtn.value === '__new') {
      const name = await askText({ title: 'New preset', placeholder: 'e.g. Exams', ok: 'Create' });
      if (!name) { presetBtn.value = preset.id; return; }
      preset = { ...withDefaults(preset), id: uid(), name: name.trim() };
      presetBtn.setOptions([...presets().map((p) => [p.id, p.name]), [preset.id, preset.name], ['__new', 'New preset…']], preset.id);
    } else {
      preset = { ...withDefaults(presets().find((p) => p.id === presetBtn.value)), id: presetBtn.value };
    }
    paint();
  });
  const n = (el, min, max, fallback) => { const v = Number(String(el.value).replace(',', '.')); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback; };
  const submit = (ev) => {
    ev.preventDefault();
    const learn = parseSteps(f.learnSteps.value);
    const relearn = parseSteps(f.relearnSteps.value);
    const saved = {
      ...preset, kind: 'preset',
      newPerDay: Math.round(n(f.newPerDay, 0, 9999, 20)),
      reviewsPerDay: Math.round(n(f.reviewsPerDay, 0, 99999, 200)),
      learnSteps: learn, relearnSteps: relearn,
      scheduler: f.scheduler.value,
      retention: n(f.retention, 0.7, 0.99, 0.9),
      graduatingIvl: Math.round(n(f.graduatingIvl, 1, 365, 1)),
      easyIvl: Math.round(n(f.easyIvl, 1, 365, 4)),
      startEase: n(f.startEase, 1.3, 5, 2.5),
      maxIvl: Math.round(n(f.maxIvl, 1, 36500, 36500)),
      leechThreshold: Math.round(n(f.leechThreshold, 0, 99, 8)),
      leechAction: f.leechAction.value,
      burySiblings: f.burySiblings.checked,
      newOrder: f.newOrder.value,
    };
    put(saved, { ...d, preset: saved.id === 'preset-default' ? null : saved.id });
    sheet.close();
  };
  sheet.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: () => sheet.close() }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'sheet-title display' }, 'Options'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'fields' }, h('div', { class: 'field' }, h('span', {}, 'Preset'), presetBtn)),
    body));
  sheet.showModal();
}

/* ---------- Custom study (filtered deck) ---------- */

export async function openCustomStudy(deckId) {
  const path = deckPath(deckId);
  const inDeck = `deck:"${path}"`;
  const v = await choose('Custom study', [
    ['forgot', 'Review forgotten cards', 'Cards you pressed Again on lately'],
    ['ahead', 'Review ahead', 'Cards due in the next few days'],
    ['new', 'Preview new cards', 'New cards, beyond today’s limit'],
    ['tag', 'Study by tag', 'Cards with a tag'],
    ['all', 'All cards in this deck', 'Due or not'],
    ['search', 'Custom search', 'Anki search, e.g. is:due prop:lapses>3'],
  ]);
  if (!v) return;
  let query = '';
  let order = 'due';
  let limit = 100;
  if (v === 'forgot') { const n = await askNum('Forgotten in the last … days', 1); if (n == null) return; query = `${inDeck} rated:${n}:1`; order = 'lapses'; }
  if (v === 'ahead') { const n = await askNum('Due in the next … days', 3); if (n == null) return; query = `${inDeck} is:review prop:due<=${n} prop:due>0`; }
  if (v === 'new') { const n = await askNum('How many new cards', 20); if (n == null) return; query = `${inDeck} is:new`; order = 'added'; limit = n; }
  if (v === 'tag') { const t = await askText({ title: 'Tag', placeholder: 'e.g. verbs', ok: 'Study' }); if (!t) return; query = `${inDeck} tag:${t.trim().split(/\s+/)[0]}`; }
  if (v === 'all') { query = inDeck; limit = 9999; }
  if (v === 'search') { const q = await askText({ title: 'Search', value: `${inDeck} `, ok: 'Study' }); if (!q) return; query = q; }
  // One custom session at a time (like Anki's "Custom Study Session").
  const old = decks().find((x) => x.filtered && x.name === 'Custom study session');
  const fd = { id: old?.id || uid(), kind: 'deck', name: 'Custom study session', parent: null, filtered: { query, order, limit } };
  put(fd);
  openDeckId = fd.id;
  rerender();
}

function askNum(title, value) {
  return askText({ title, value: String(value), ok: 'Study', inputmode: 'numeric' }).then((t) => {
    if (t == null) return null;
    const n = Math.round(Number(t));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
}

function choose(title, options) {
  return new Promise((resolve) => {
    let layer;
    const done = (v) => { layer.close(); resolve(v); };
    layer = openLayer('ask', h('div', { class: 'ask-card' },
      h('p', { class: 'ask-title display' }, title),
      h('div', { class: 'friend-pick' }, options.map(([v, label, sub]) => h('button', {
        type: 'button', class: 'menu-item', onclick: () => done(v),
      }, h('span', { class: 'pick-name' }, label, sub ? h('small', {}, sub) : null)))),
      h('div', { class: 'ask-actions' }, h('button', { type: 'button', class: 'ask-btn', onclick: () => done(null) }, 'Cancel'))),
    { onBackdrop: () => done(null) });
  });
}

/* ---------- Card info ---------- */

const dateFmt = (ms) => fmt({ year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
export function openCardInfo(cardIn) {
  const c = getItem(cardIn.id) || cardIn;
  const n = note(c.note);
  const type = noteType(n?.type);
  const log = reviewsOf(c.id);
  const R = currentR(c);
  const today = dayOf(Date.now());
  const due = c.suspended ? 'Suspended' : c.state === 'new' ? `New #${c.pos || 0}`
    : c.state === 'review' ? `${dateFmt(c.due)} (${dueLabel(0, Math.max(0, dayOf(c.due) - today))})` : dateFmt(c.due);
  const rows = [
    ['Added', n?.added ? dateFmt(n.added) : '—'],
    ['First review', log[0] ? dateFmt(log[0].at) : '—'],
    ['Latest review', log.at(-1) ? dateFmt(log.at(-1).at) : '—'],
    ['Due', due],
    ['Interval', c.ivl ? dueLabel(0, c.ivl) : '—'],
    ['Stability', c.S != null ? dueLabel(0, Math.max(1, Math.round(c.S))) : '—'],
    ['Difficulty', c.D != null ? `${Math.round((c.D - 1) / 9 * 100)}%` : '—'],
    ['Retrievability', R != null ? `${Math.round(R * 100)}%` : '—'],
    ['Ease', c.ease ? `${Math.round(c.ease * 100)}%` : '—'],
    ['Reviews', String(c.reps || 0)],
    ['Lapses', String(c.lapses || 0)],
    ['Card', `${type.name} · ${type.cloze ? `Cloze ${c.ord + 1}` : type.templates[c.ord]?.name || ''}`],
    ['Deck', deckPath(c.deck)],
  ];
  let layer;
  const done = () => layer.close();
  layer = openLayer('ask', h('div', { class: 'ask-card card-info' },
    h('p', { class: 'ask-title display' }, plain(renderCard(type, n || { fields: {}, tags: [] }, c.ord).front).slice(0, 80) || 'Card info'),
    h('dl', { class: 'info-grid' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    log.length ? h('table', { class: 'info-log' },
      h('thead', {}, h('tr', {}, ['Date', 'Answer', 'Interval'].map((t) => h('th', {}, t)))),
      h('tbody', {}, log.slice().reverse().slice(0, 50).map((r) => h('tr', {},
        h('td', {}, dateFmt(r.at)),
        h('td', { class: `ans r${r.rating}` }, ['Again', 'Hard', 'Good', 'Easy'][r.rating - 1]),
        h('td', {}, r.ivl ? dueLabel(0, r.ivl) : '—'))))) : null,
    h('div', { class: 'ask-actions' }, h('button', { type: 'button', class: 'ask-btn primary', onclick: done }, 'Close'))),
  { onBackdrop: done });
}

/** True while the review screen is open (the app leaves it alone on redraws). */
export const reviewing = () => !!session;
export const leaveStudy = () => { if (session) endSession(); openDeckId = null; };
