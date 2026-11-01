// Film mode "Write" tab: Theme · Plot · Script for the chosen project.
// Theme and Characters are both stored in the 'story' document (the key the database
// already allows), so they share one editing lock.
// Reading is open to all members; editing takes the section's lock (one editor at a
// time), autosaves while typing (which also renews the lock) and frees it on Done.
import { h, icon, ICONS, fmt } from './util.js';
import { tell, ask } from './ui.js';
import {
  currentProject, docOf, editorOf, lockDoc, saveDoc, unlockDoc, nameOf, newId, filmStatus,
} from './film.js';

const LABELS = { story: 'Theme', characters: 'Characters', plot: 'Plot', script: 'Script' };
// The stored document behind each section.
const docKey = (sec) => (sec === 'characters' ? 'story' : sec);
let section = localStorage.getItem('planner.filmsection') || 'story';
let editing = null; // { section, pid, body, el, saveTimer, beat, lost }
let rootEl = null;

/* ---------- Document shapes ---------- */

function normalize(sec, body = {}) {
  if (sec === 'story' || sec === 'characters') {
    // Older fields (logline, synopsis) are kept in the saved body, just not shown.
    const characters = (Array.isArray(body.characters) ? body.characters : [])
      .map((c) => ({ ...c, id: c.id || newId(), name: c.name || '', description: c.description ?? c.desc ?? '' })); // `desc` = the old Story field
    return { ...body, theme: body.theme || '', message: body.message || '', notes: body.notes || '', characters };
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
  const key = docKey(section);
  const who = editorOf(key);
  if (who) { tell(`${nameOf(who)} is editing`, `You can read ${LABELS[section]} now and edit it when they’re done.`); return; }
  let ok = false;
  try { ok = await lockDoc(key); } catch (e) { tell('Couldn’t start editing', e.message); return; }
  if (!ok) { tell(`${nameOf(editorOf(key))} just started editing`, 'Try again when they’re done.'); rerender(); return; }
  const doc = docOf(key);
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
    await saveDoc(docKey(editing.section), editing.body);
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
  try { await unlockDoc(docKey(e.section), e.lost ? undefined : e.body); } catch { /* lock expires on its own */ }
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

const fit = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };

// Rebuilding a list (new card, new script line…) must not move the page. Keep the scroll
// position, size the new text boxes at once (sizing them a frame later briefly shortened
// the page, which threw the scroll back up), then just bring `reveal` into view if it's
// below the screen (above the dock).
function steady(holder, rebuild, reveal) {
  if (!holder.isConnected) { rebuild(); return; }
  const sc = holder.closest('.write-page');
  const top = sc ? sc.scrollTop : 0;
  rebuild();
  holder.querySelectorAll('textarea').forEach(fit);
  if (sc) sc.scrollTop = top;
  const el = typeof reveal === 'function' ? reveal() : reveal;
  if (!el || !sc) return;
  const r = el.getBoundingClientRect();
  const limit = window.innerHeight - 110; // keep clear of the dock / keyboard bar
  if (r.bottom > limit) sc.scrollTop += r.bottom - limit;
}

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
// Editing buttons must not take the focus from the box you're typing in: on iPhone that
// folds the keyboard and the page scrolls away. On a touch, the tap is handled here and
// its default cancelled; `typing` says whether a text box had the focus (keyboard up).
const isField = (el) => !!el && /^(TEXTAREA|INPUT)$/.test(el.tagName);
function tapBtn(props, fn, ...kids) {
  const el = h('button', { type: 'button', ...props }, ...kids);
  el.addEventListener('touchend', (e) => { e.preventDefault(); fn(isField(document.activeElement)); });
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', () => fn(isField(document.activeElement)));
  return el;
}
const tiny = (label, svg, fn) => tapBtn({ class: 'icon-btn write-tiny', 'aria-label': label }, fn, icon(svg));

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

/* ---------- Characters ---------- */

const CHAR_FIELDS = [
  ['description', 'Description', 'Appearance, personality, how they speak…'],
  ['goal', 'Goal', 'What they want — and what they really need'],
  ['arc', 'Arc', 'How they change from beginning to end'],
  ['symbolism', 'Symbolism', 'What they stand for; objects, colors, motifs tied to them'],
  ['backstory', 'Backstory', 'What happened before the film'],
  ['relationships', 'Relationships', 'Who they’re tied to, and how'],
  ['notes', 'Notes', 'Casting ideas, references, anything else'],
];

function charactersRead(b) {
  if (!b.characters.length) return h('div', { class: 'w-doc' }, h('p', { class: 'w-empty' }, 'No characters yet'));
  return h('div', { class: 'w-doc' }, b.characters.map((c) => h('section', { class: 'w-char-card' },
    h('div', { class: 'w-char-top' },
      h('span', { class: 'chat-avatar w-char-av' }, (c.name || '?')[0].toUpperCase()),
      h('span', { class: 'w-char-id' },
        h('b', { class: 'display' }, c.name || 'Unnamed'),
        [c.role, c.age].filter(Boolean).length ? h('small', {}, [c.role, c.age && `${c.age}`].filter(Boolean).join(' · ')) : null)),
    CHAR_FIELDS.filter(([k]) => (c[k] || '').trim()).map(([k, label]) => h('div', { class: 'w-char-f' },
      h('h4', {}, label), h('p', { class: 'w-text' }, c[k]))))));
}

function charactersEdit(b) {
  const root = h('div', { class: 'w-doc editing' });
  const cardEl = (c) => h('section', { class: 'w-char-card edit', 'data-char': c.id },
    h('div', { class: 'w-row' },
      line(c.name, 'Name', (v) => { c.name = v; }, 'w-char-name'),
      tiny('Move up', ICONS.up, () => move(c, -1)),
      tiny('Move down', ICONS.down, () => move(c, 1)),
      tiny('Delete character', ICONS.close, async () => {
        if ((c.name || CHAR_FIELDS.some(([k]) => c[k])) && !await ask({ title: `Delete ${c.name || 'this character'}?`, ok: 'Delete', danger: true })) return;
        b.characters.splice(b.characters.indexOf(c), 1);
        changed();
        root.querySelector(`[data-char="${c.id}"]`)?.remove();
      })),
    h('div', { class: 'w-row w-char-meta' },
      line(c.role || '', 'Role (lead, antagonist, …)', (v) => { c.role = v; }, 'w-char-role'),
      line(c.age || '', 'Age', (v) => { c.age = v; }, 'w-char-age')),
    CHAR_FIELDS.map(([k, label, ph]) => h('div', { class: 'w-char-f' },
      h('h4', {}, label), area(c[k] || '', ph, (v) => { c[k] = v; }))));
  const add = tapBtn({ class: 'pill w-add' }, (typing) => {
    const c = { id: newId(), name: '', role: '' };
    b.characters.push(c);
    changed();
    const el = cardEl(c);
    root.insertBefore(el, add);
    el.querySelectorAll('textarea').forEach(fit);
    reveal(el);
    if (typing) el.querySelector('input').focus({ preventScroll: true });
  }, '+ Character');
  const move = (c, dir) => {
    const i = b.characters.indexOf(c);
    const j = i + dir;
    if (j < 0 || j >= b.characters.length) return;
    [b.characters[i], b.characters[j]] = [b.characters[j], b.characters[i]];
    changed();
    steady(root, build, () => root.querySelector(`[data-char="${c.id}"]`));
  };
  const build = () => root.replaceChildren(...b.characters.map(cardEl), add);
  build();
  return root;
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
  // Indexes are looked up when a button is used, so single cards can be added in place.
  const card = (act, c) => h('div', { class: 'w-card edit', 'data-card': c.id },
    h('div', { class: 'w-row' },
      line(c.title, 'Scene / beat', (v) => { c.title = v; }, 'w-card-title'),
      tiny('Move up', ICONS.up, () => move(act, c, -1)),
      tiny('Move down', ICONS.down, () => move(act, c, 1)),
      tiny('Delete card', ICONS.close, () => {
        act.cards.splice(act.cards.indexOf(c), 1);
        changed();
        root.querySelector(`[data-card="${c.id}"]`)?.remove();
      })),
    area(c.note || '', 'What happens', (v) => { c.note = v; }));

  const actEl = (act) => {
    const cards = h('div', { class: 'w-cards-edit' }, act.cards.map((c) => card(act, c)));
    return h('section', { class: 'w-part', 'data-act': act.id },
      h('div', { class: 'w-row' },
        line(act.title, 'Act title', (v) => { act.title = v; }, 'w-act-title'),
        tiny('Delete act', ICONS.trash, () => {
          if (act.cards.length) { tell('Move or delete its cards first.'); return; }
          b.acts.splice(b.acts.indexOf(act), 1);
          changed();
          root.querySelector(`[data-act="${act.id}"]`)?.remove();
        })),
      cards,
      tapBtn({ class: 'pill w-add' }, (typing) => {
        // Add just this card (no rebuild), so nothing on the page moves.
        const c = { id: newId(), title: '', note: '' };
        act.cards.push(c);
        changed();
        const el = card(act, c);
        cards.append(el);
        el.querySelectorAll('textarea').forEach(fit);
        reveal(el);
        if (typing) el.querySelector('input').focus({ preventScroll: true });
      }, '+ Card'));
  };

  const addAct = tapBtn({ class: 'pill w-add' }, () => {
    const act = { id: newId(), title: `Act ${b.acts.length + 1}`, cards: [] };
    b.acts.push(act);
    changed();
    const el = actEl(act);
    root.insertBefore(el, addAct);
    reveal(el);
  }, '+ Act');

  // Up/down moves within an act, and across into the previous / next act at its edges.
  const move = (act, c, dir) => {
    const ai = b.acts.indexOf(act);
    const cards = act.cards;
    const ci = cards.indexOf(c);
    const j = ci + dir;
    if (j >= 0 && j < cards.length) [cards[ci], cards[j]] = [cards[j], cards[ci]];
    else if (b.acts[ai + dir]) {
      cards.splice(ci, 1);
      if (dir < 0) b.acts[ai - 1].cards.push(c); else b.acts[ai + 1].cards.unshift(c);
    } else return;
    changed();
    steady(root, build, () => root.querySelector(`[data-card="${c.id}"]`));
  };
  const build = () => root.replaceChildren(...b.acts.map(actEl), addAct);
  build();
  return root;
}

// Bring a new / moved element into view only if it's below the visible area.
function reveal(el) {
  const sc = el.closest('.write-page');
  if (!sc) return;
  const r = el.getBoundingClientRect();
  const limit = (window.visualViewport?.height || window.innerHeight) - 110;
  if (r.bottom > limit) sc.scrollTop += r.bottom - limit;
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
  const list = h('div', { class: 'screenplay editing' });
  const bar = h('div', { class: 'sp-bar' });
  let current = b.blocks[0];
  const paintBar = () => bar.replaceChildren(...TYPES.map(([t, label]) => h('button', {
    type: 'button', class: `sp-type${current?.t === t ? ' on' : ''}`,
    // Keep the keyboard up: change the type without taking focus from the line.
    onpointerdown: (e) => e.preventDefault(),
    onclick: () => {
      if (!current) return;
      current.t = t;
      changed();
      const el = list.querySelector(`[data-id="${current.id}"]`);
      if (el) { el.className = `sp sp-${t}`; el.placeholder = PLACE[t]; fit(el); }
      paintBar();
    },
  }, label)));

  const focusAt = (el, caret) => {
    el.focus({ preventScroll: true });
    const c = caret ?? el.value.length;
    el.setSelectionRange(c, c);
    reveal(el);
  };

  // One textarea per block; lines are added / removed in place (never a full rebuild),
  // so the keyboard stays up and the page doesn't move.
  const blockEl = (blk) => {
    const el = h('textarea', { class: `sp sp-${blk.t}`, rows: '1', placeholder: PLACE[blk.t], 'data-id': blk.id });
    el.value = blk.x;
    el.addEventListener('focus', () => { current = blk; paintBar(); });
    el.addEventListener('input', () => {
      blk.x = el.value.replace(/\n/g, ' ');
      if (blk.t === 'action' && /^(int|ext|int\/ext|i\/e)[.\s]/i.test(blk.x)) { blk.t = 'scene'; el.className = 'sp sp-scene'; paintBar(); }
      fit(el);
      changed();
    });
    el.addEventListener('keydown', (e) => {
      const i = b.blocks.indexOf(blk);
      if (e.key === 'Enter' && !e.shiftKey) {
        // A new line is a new block, of the type that usually comes next.
        e.preventDefault();
        const pos = el.selectionStart;
        const next = { id: newId(), t: NEXT[blk.t], x: blk.x.slice(pos) };
        blk.x = blk.x.slice(0, pos);
        el.value = blk.x;
        fit(el);
        b.blocks.splice(i + 1, 0, next);
        changed();
        const nel = blockEl(next);
        el.after(nel);
        fit(nel);
        focusAt(nel, 0);
      } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0 && !blk.x) {
        e.preventDefault();
        b.blocks.splice(i, 1);
        changed();
        const prev = el.previousElementSibling;
        el.remove();
        if (prev) focusAt(prev);
      }
    });
    requestAnimationFrame(() => fit(el));
    return el;
  };

  list.append(...b.blocks.map(blockEl));
  paintBar();
  return h('div', { class: 'w-doc editing' }, bar, list,
    tapBtn({ class: 'pill w-add' }, () => {
      const blk = { id: newId(), t: 'scene', x: '' };
      b.blocks.push(blk);
      changed();
      const el = blockEl(blk);
      list.append(el);
      fit(el);
      focusAt(el);
    }, '+ Scene'));
}

/* ---------- Page ---------- */

const READ = { story: themeRead, characters: charactersRead, plot: plotRead, script: scriptRead };
const EDIT = { story: themeEdit, characters: charactersEdit, plot: plotEdit, script: scriptEdit };

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

  const doc = docOf(docKey(section));
  const other = editorOf(docKey(section));
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
  // The name, Edit / Done and the section switch stay pinned while scrolling.
  const top = h('div', { class: 'page-sticky' },
    h('div', { class: 'write-head' },
      h('span', { class: 'write-project' }, p.name),
      action),
    tabs);
  const page = h('div', { class: 'settings write-page' },
    top,
    h('p', { class: 'write-banner', hidden: true }, 'Not saved: your editing time ran out. Tap Done to try again.'),
    !mine && doc?.updated_by && doc?.updated_at && Object.keys(doc.body || {}).length
      ? h('p', { class: 'w-meta' }, `Edited by ${nameOf(doc.updated_by)} · ${since(doc.updated_at)}`) : null,
    body);
  // Switching between reading and editing the same section keeps your place.
  const old = root.querySelector('.write-page');
  const keep = old && old.dataset.key === `${p.id}:${section}` ? old.scrollTop : 0;
  page.dataset.key = `${p.id}:${section}`;
  root.replaceChildren(page);
  if (keep) page.scrollTop = keep;
  // The script's line-type bar sticks just under the pinned header.
  page.style.setProperty('--sticky-h', `${top.offsetHeight}px`);
  if (mine) { editing.el = page; paintBanner(); }
}

export const isEditing = () => !!editing;

/** Open a section (used by search). */
export function showWriteSection(sec) {
  if (!LABELS[sec]) return;
  section = sec;
  localStorage.setItem('planner.filmsection', sec);
}
