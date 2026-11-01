// Film mode "Write" tab: Theme · Plot · Script for the chosen project.
// (Theme is stored under the 'story' section key, which the database already allows.)
// Reading is open to all members; editing takes the section's lock (one editor at a
// time), autosaves while typing (which also renews the lock) and frees it on Done.
import { h, icon, ICONS, fmt } from './util.js';
import { tell } from './ui.js';
import {
  currentProject, docOf, editorOf, lockDoc, saveDoc, unlockDoc, nameOf, newId, filmStatus,
} from './film.js';

const LABELS = { story: 'Theme', plot: 'Plot', script: 'Script' };
let section = localStorage.getItem('planner.filmsection') || 'story';
let editing = null; // { section, pid, body, el, saveTimer, beat, lost }
let rootEl = null;

/* ---------- Document shapes ---------- */

function normalize(sec, body = {}) {
  if (sec === 'story') {
    // Older fields (logline, synopsis, characters) are kept in the saved body, just not shown.
    return { ...body, theme: body.theme || '', message: body.message || '', notes: body.notes || '' };
  }
  if (sec === 'plot') {
    const acts = Array.isArray(body.acts) && body.acts.length ? body.acts
      : ['Act 1', 'Act 2', 'Act 3'].map((title) => ({ id: newId(), title, cards: [] }));
    return { acts };
  }
  const blocks = Array.isArray(body.blocks) && body.blocks.length ? body.blocks : [{ id: newId(), t: 'scene', x: '' }];
  return { blocks };
}

/* ---------- Editing session ---------- */

async function startEdit() {
  const who = editorOf(section);
  if (who) { tell(`${nameOf(who)} is editing`, `You can read ${LABELS[section]} now and edit it when they’re done.`); return; }
  let ok = false;
  try { ok = await lockDoc(section); } catch (e) { tell('Couldn’t start editing', e.message); return; }
  if (!ok) { tell(`${nameOf(editorOf(section))} just started editing`, 'Try again when they’re done.'); rerender(); return; }
  const doc = docOf(section);
  editing = { section, pid: currentProject().id, body: normalize(section, structuredClone(doc?.body || {})), lost: false };
  editing.beat = setInterval(() => save(true), 45000); // keep the lock while the screen sits open
  rerender();
}

function changed() {
  clearTimeout(editing.saveTimer);
  editing.saveTimer = setTimeout(() => save(), 1200);
}

async function save(quiet) {
  if (!editing) return;
  clearTimeout(editing.saveTimer);
  try {
    await saveDoc(editing.section, editing.body);
    if (editing.lost) { editing.lost = false; paintBanner(); }
  } catch {
    editing.lost = true;
    paintBanner();
    if (!quiet) { /* the banner explains */ }
  }
}

/** Save and free the section (Done, switching sections, leaving the tab). */
export async function finishEditing() {
  if (!editing) return;
  const e = editing;
  editing = null;
  clearTimeout(e.saveTimer);
  clearInterval(e.beat);
  try { await unlockDoc(e.section, e.lost ? undefined : e.body); } catch { /* lock expires on its own */ }
  rerender();
}

/** App went to the background: save now (the lock lasts 2 minutes). */
export function writeBackgrounded() { if (editing) save(true); }

function paintBanner() {
  const el = rootEl?.querySelector('.write-banner');
  if (!el) return;
  el.hidden = !editing?.lost;
}

/* ---------- Small editors ---------- */

function area(value, placeholder, onInput, cls = '') {
  const el = h('textarea', { class: `write-area ${cls}`, rows: '1', placeholder });
  el.value = value;
  const grow = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  el.addEventListener('input', () => { onInput(el.value); grow(); changed(); });
  requestAnimationFrame(grow);
  return el;
}
function line(value, placeholder, onInput, cls = '') {
  const el = h('input', { type: 'text', class: `write-line ${cls}`, value, placeholder });
  el.addEventListener('input', () => { onInput(el.value); changed(); });
  return el;
}
const tiny = (label, svg, onclick) => h('button', { type: 'button', class: 'icon-btn write-tiny', 'aria-label': label, onclick }, icon(svg));

/* ---------- Theme (the film's message) ---------- */

function themeRead(b) {
  const part = (title, text) => h('section', { class: 'w-part' }, h('h3', { class: 'w-h' }, title),
    text ? h('p', { class: 'w-text' }, text) : h('p', { class: 'w-empty' }, 'Not written yet'));
  return h('div', { class: 'w-doc' }, part('Theme', b.theme), part('Message', b.message), part('Notes', b.notes));
}

function themeEdit(b) {
  return h('div', { class: 'w-doc editing' },
    h('section', { class: 'w-part' }, h('h3', { class: 'w-h' }, 'Theme'), area(b.theme, 'What the film is about, in a few words.', (v) => { b.theme = v; })),
    h('section', { class: 'w-part' }, h('h3', { class: 'w-h' }, 'Message'), area(b.message, 'What the audience should feel or take away.', (v) => { b.message = v; })),
    h('section', { class: 'w-part' }, h('h3', { class: 'w-h' }, 'Notes'), area(b.notes, 'Motifs, tone, references…', (v) => { b.notes = v; })));
}

/* ---------- Plot (acts of scene cards) ---------- */

function plotRead(b) {
  let n = 0;
  return h('div', { class: 'w-doc' }, b.acts.map((act) => h('section', { class: 'w-part' },
    h('h3', { class: 'w-h' }, act.title || 'Act'),
    act.cards.length ? h('ol', { class: 'w-cards' }, act.cards.map((c) => h('li', { class: 'w-card' },
      h('span', { class: 'w-card-n' }, String(++n)),
      h('span', { class: 'w-card-main' }, h('b', {}, c.title || 'Untitled'), c.note ? h('span', {}, c.note) : null))))
      : h('p', { class: 'w-empty' }, 'No cards yet'))));
}

function plotEdit(b) {
  const root = h('div', { class: 'w-doc editing' });
  const draw = () => root.replaceChildren(
    ...b.acts.map((act, ai) => h('section', { class: 'w-part' },
      h('div', { class: 'w-row' },
        line(act.title, 'Act title', (v) => { act.title = v; }, 'w-act-title'),
        tiny('Delete act', ICONS.trash, () => {
          if (act.cards.length) { tell('Move or delete its cards first.'); return; }
          b.acts.splice(ai, 1); changed(); draw();
        })),
      h('div', { class: 'w-cards-edit' }, act.cards.map((c, ci) => h('div', { class: 'w-card edit' },
        h('div', { class: 'w-row' },
          line(c.title, 'Scene / beat', (v) => { c.title = v; }, 'w-card-title'),
          tiny('Move up', ICONS.up, () => { move(ai, ci, -1); }),
          tiny('Move down', ICONS.down, () => { move(ai, ci, 1); }),
          tiny('Delete card', ICONS.close, () => { act.cards.splice(ci, 1); changed(); draw(); })),
        area(c.note || '', 'What happens', (v) => { c.note = v; })))),
      h('button', { type: 'button', class: 'pill w-add', onclick: () => { act.cards.push({ id: newId(), title: '', note: '' }); changed(); draw(); } }, '+ Card'))),
    h('button', { type: 'button', class: 'pill w-add', onclick: () => { b.acts.push({ id: newId(), title: `Act ${b.acts.length + 1}`, cards: [] }); changed(); draw(); } }, '+ Act'));
  // Up/down moves within an act, and across into the previous / next act at its edges.
  const move = (ai, ci, dir) => {
    const cards = b.acts[ai].cards;
    const j = ci + dir;
    if (j >= 0 && j < cards.length) [cards[ci], cards[j]] = [cards[j], cards[ci]];
    else if (b.acts[ai + dir]) {
      const [card] = cards.splice(ci, 1);
      if (dir < 0) b.acts[ai - 1].cards.push(card); else b.acts[ai + 1].cards.unshift(card);
    } else return;
    changed();
    draw();
  };
  draw();
  return root;
}

/* ---------- Script (screenplay blocks) ---------- */

const TYPES = [['scene', 'Scene'], ['action', 'Action'], ['character', 'Character'], ['dialogue', 'Dialogue'], ['paren', '( )'], ['transition', 'Transition']];
const NEXT = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene' };
const PLACE = { scene: 'INT. LOCATION - DAY', action: 'What we see…', character: 'NAME', dialogue: 'Line', paren: '(beat)', transition: 'CUT TO:' };

function scriptRead(b) {
  const filled = b.blocks.filter((x) => x.x.trim());
  if (!filled.length) return h('div', { class: 'w-doc' }, h('p', { class: 'w-empty' }, 'No script yet'));
  let scene = 0;
  const scenes = filled.filter((x) => x.t === 'scene').length;
  return h('div', { class: 'w-doc' },
    h('p', { class: 'w-meta' }, `${scenes} scene${scenes === 1 ? '' : 's'}`),
    h('div', { class: 'screenplay' }, filled.map((x) => h('p', { class: `sp sp-${x.t}` },
      x.t === 'scene' ? h('span', { class: 'sp-num' }, String(++scene)) : null,
      x.t === 'paren' && !x.x.trim().startsWith('(') ? `(${x.x})` : x.x))));
}

function scriptEdit(b) {
  let focus = 0;
  const list = h('div', { class: 'screenplay editing' });
  const bar = h('div', { class: 'sp-bar' });
  const paintBar = () => bar.replaceChildren(...TYPES.map(([t, label]) => h('button', {
    type: 'button', class: `sp-type${b.blocks[focus]?.t === t ? ' on' : ''}`,
    // Keep the keyboard up: change the type without taking focus from the line.
    onpointerdown: (e) => e.preventDefault(),
    onclick: () => { b.blocks[focus].t = t; changed(); draw(focus); },
  }, label)));

  const draw = (focusAt = null, caret = null) => {
    list.replaceChildren(...b.blocks.map((blk, i) => {
      const el = h('textarea', { class: `sp sp-${blk.t}`, rows: '1', placeholder: PLACE[blk.t], 'data-i': String(i) });
      el.value = blk.x;
      const grow = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
      el.addEventListener('focus', () => { focus = i; paintBar(); });
      el.addEventListener('input', () => {
        blk.x = el.value.replace(/\n/g, ' ');
        if (blk.t === 'action' && /^(int|ext|int\/ext|i\/e)[.\s]/i.test(blk.x)) { blk.t = 'scene'; el.className = 'sp sp-scene'; paintBar(); }
        grow();
        changed();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // A new line is a new block, of the type that usually comes next.
          e.preventDefault();
          const pos = el.selectionStart;
          const rest = blk.x.slice(pos);
          blk.x = blk.x.slice(0, pos);
          b.blocks.splice(i + 1, 0, { id: newId(), t: NEXT[blk.t], x: rest });
          changed();
          draw(i + 1, 0);
        } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0 && !blk.x) {
          e.preventDefault();
          b.blocks.splice(i, 1);
          changed();
          draw(i - 1, b.blocks[i - 1].x.length);
        }
      });
      requestAnimationFrame(grow);
      return el;
    }));
    paintBar();
    if (focusAt !== null) {
      const el = list.children[focusAt];
      if (el) { el.focus(); const c = caret ?? el.value.length; el.setSelectionRange(c, c); focus = focusAt; paintBar(); }
    }
  };
  draw();
  return h('div', { class: 'w-doc editing' }, bar, list,
    h('button', { type: 'button', class: 'pill w-add', onclick: () => { b.blocks.push({ id: newId(), t: 'scene', x: '' }); changed(); draw(b.blocks.length - 1); } }, '+ Scene'));
}

/* ---------- Page ---------- */

const READ = { story: themeRead, plot: plotRead, script: scriptRead };
const EDIT = { story: themeEdit, plot: plotEdit, script: scriptEdit };

function since(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return fmt({ month: 'short', day: 'numeric' }).format(new Date(iso));
}

const rerender = () => { if (rootEl) renderWrite(rootEl); };

export function renderWrite(root) {
  rootEl = root;
  const p = currentProject();
  if (!p) {
    root.replaceChildren(h('div', { class: 'settings write-page' }, h('h1', { class: 'display' }, 'Write'),
      h('p', { class: 'set-note' }, filmStatus() === 'missing'
        ? 'Film mode isn’t set up yet.'
        : 'Choose or create a project: tap the slate on the Calendar.')));
    return;
  }
  // While editing this section, leave the editor alone (typing must not be interrupted).
  if (editing && editing.pid === p.id && editing.section === section && editing.el && root.contains(editing.el)) return;
  if (editing && (editing.pid !== p.id || editing.section !== section)) { finishEditing(); return; }

  const doc = docOf(section);
  const other = editorOf(section);
  const mine = editing && editing.section === section;
  const tabs = h('div', { class: 'segmented write-tabs', role: 'radiogroup' }, Object.entries(LABELS).map(([k, label]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(k === section),
    onclick: async () => {
      if (k === section) return;
      await finishEditing();
      section = k;
      localStorage.setItem('planner.filmsection', k);
      rerender();
    },
  }, label)));
  const action = mine
    ? h('button', { class: 'pill write-done', onclick: finishEditing }, 'Done')
    : other ? h('span', { class: 'write-lock' }, `${nameOf(other)} is editing`)
      : h('button', { class: 'pill', onclick: startEdit }, 'Edit');
  const body = mine ? EDIT[section](editing.body) : READ[section](normalize(section, doc?.body || {}));
  const page = h('div', { class: 'settings write-page' },
    h('div', { class: 'write-head' },
      h('span', { class: 'write-project' }, p.name),
      action),
    tabs,
    h('p', { class: 'write-banner', hidden: true }, 'Not saved: your editing time ran out. Tap Done to try again.'),
    !mine && doc?.updated_by && doc?.updated_at && Object.keys(doc.body || {}).length
      ? h('p', { class: 'w-meta' }, `Edited by ${nameOf(doc.updated_by)} · ${since(doc.updated_at)}`) : null,
    body);
  root.replaceChildren(page);
  if (mine) { editing.el = page; paintBanner(); }
}

export const isEditing = () => !!editing;
