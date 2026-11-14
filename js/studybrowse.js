// Study mode's Browse tab: search every card (Anki search syntax, see studysearch.js),
// open one to edit, or select several and change them together.
import { h, icon, ICONS } from './util.js';
import { ask, askText, pick, snack } from './ui.js';
import {
  searchCards, note, noteType, deck, deckPath, deckTree, setSuspended, setFlag, moveCards, forgetCards,
  deleteNotes, put, getItem,
} from './study.js';
import { renderCard, plain } from './cardtext.js';
import { dueLabel, dayOf } from './srs.js';
import { openNoteSheet, FLAGS } from './studyui.js';

const SORTS = [['added', 'Added'], ['due', 'Due'], ['ivl', 'Interval'], ['lapses', 'Lapses'], ['front', 'A–Z']];
const PAGE = 150;
let query = '';
let sort = 'added';
let shown = PAGE;
let selecting = false;
let selected = new Set();
let rootEl = null;

/** Open Browse with a search filled in (from a deck's overview). */
export function browseFor(q) { query = q; shown = PAGE; selecting = false; selected = new Set(); }

const sorters = {
  added: (a, b) => (b.pos || 0) - (a.pos || 0),
  due: (a, b) => rank(a) - rank(b),
  ivl: (a, b) => (b.ivl || 0) - (a.ivl || 0),
  lapses: (a, b) => (b.lapses || 0) - (a.lapses || 0),
  front: (a, b) => frontOf(a).localeCompare(frontOf(b)),
};
function rank(c) { return c.state === 'new' ? 1e15 + (c.pos || 0) : c.due || 0; }
const frontCache = new Map();
function frontOf(c) {
  const key = `${c.id}:${note(c.note)?.mod || 0}`;
  if (!frontCache.has(key)) {
    const n = note(c.note);
    frontCache.set(key, n ? plain(renderCard(noteType(n.type), n, c.ord).front) : '');
  }
  return frontCache.get(key);
}

function dueText(c) {
  if (c.suspended) return 'suspended';
  if (c.state === 'new') return 'new';
  if (c.state !== 'review') return 'learning';
  const days = dayOf(c.due) - dayOf(Date.now());
  return days <= 0 ? 'due' : `in ${dueLabel(0, days)}`;
}

export function renderBrowse(root) {
  rootEl = root;
  const list = searchCards(query).sort(sorters[sort] || sorters.added);
  selected = new Set([...selected].filter((id) => getItem(id)));
  const input = h('input', {
    type: 'search', class: 'browse-search', value: query, placeholder: 'Search: deck:… tag:… is:due', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Search cards',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); query = e.target.value; shown = PAGE; renderBrowse(root); e.target.blur(); } },
  });
  const sortBtn = h('button', { class: 'pill', 'aria-label': 'Sort', onclick: async (e) => {
    const v = await pick(e.currentTarget, SORTS, sort);
    if (v) { sort = v; renderBrowse(root); }
  } }, SORTS.find(([v]) => v === sort)[1]);
  const selBtn = h('button', { class: 'pill', onclick: () => { selecting = !selecting; selected = new Set(); renderBrowse(root); } }, selecting ? 'Done' : 'Select');

  const rows = list.slice(0, shown).map((c) => {
    const on = selected.has(c.id);
    return h('li', { class: `browse-row${c.suspended ? ' suspended' : ''}${on ? ' on' : ''}` },
      h('button', {
        class: 'browse-item', 'aria-pressed': selecting ? String(on) : null,
        onclick: () => {
          if (selecting) { if (on) selected.delete(c.id); else selected.add(c.id); renderBrowse(root); return; }
          openNoteSheet({ noteId: c.note, onSaved: () => renderBrowse(root) });
        },
      },
      selecting ? h('span', { class: `sel-box${on ? ' on' : ''}` }, on ? icon(ICONS.check) : null) : null,
      h('span', { class: 'browse-text' },
        h('span', { class: 'browse-front' }, frontOf(c) || '(empty)'),
        h('small', {}, deckPath(c.deck) || '—')),
      c.flag ? h('span', { class: `flag-dot flag-${c.flag}` }) : null,
      h('small', { class: 'browse-due' }, dueText(c))));
  });

  const bar = selecting && selected.size ? bulkBar(root) : null;
  root.replaceChildren(h('div', { class: `settings study-page browse${bar ? ' has-bulk' : ''}` },
    h('div', { class: 'page-sticky' },
      h('div', { class: 'page-head' }, h('h1', { class: 'display' }, 'Browse'),
        h('span', { class: 'head-btns' }, sortBtn, selBtn)),
      input,
      h('p', { class: 'set-note browse-count' }, `${list.length} card${list.length === 1 ? '' : 's'}${selecting ? ` · ${selected.size} selected` : ''}`,
        selecting && list.length ? h('button', { class: 'link-btn', onclick: () => {
          selected = selected.size === list.length ? new Set() : new Set(list.map((c) => c.id));
          renderBrowse(root);
        } }, selected.size === list.length ? 'Select none' : 'Select all') : null)),
    rows.length ? h('ul', { class: 'browse-list' }, rows) : h('p', { class: 'set-note' }, query ? 'No cards match.' : 'No cards yet.'),
    list.length > shown ? h('button', { class: 'pill more-btn', onclick: () => { shown += PAGE; renderBrowse(root); } }, `Show more (${list.length - shown})`) : null),
  ...(bar ? [bar] : []));
}

function bulkBar(root) {
  const cs = () => [...selected].map(getItem).filter(Boolean);
  const done = (msg) => { snack(msg); renderBrowse(root); };
  const act = async (e) => {
    const v = await pick(e.currentTarget, [
      ['suspend', 'Suspend'], ['unsuspend', 'Unsuspend'], ['flag', 'Flag…'], ['move', 'Change deck…'],
      ['tag', 'Add tags…'], ['untag', 'Remove tags…'], ['forget', 'Reset to new'], ['delete', 'Delete notes'],
    ]);
    const list = cs();
    if (!v || !list.length) return;
    if (v === 'suspend') { setSuspended(list, true); done(`Suspended ${list.length}`); }
    if (v === 'unsuspend') { setSuspended(list, false); done(`Unsuspended ${list.length}`); }
    if (v === 'flag') {
      const f = await pick(e.currentTarget, FLAGS);
      if (f !== undefined) { setFlag(list, f); done('Flag changed'); }
    }
    if (v === 'move') {
      const d = await pick(e.currentTarget, deckTree().filter(({ deck: x }) => !x.filtered).map(({ deck: x, depth }) => [x.id, `${' '.repeat(depth * 2)}${x.name}`]));
      if (d) { moveCards(list, d); done(`Moved to ${deck(d).name}`); }
    }
    if (v === 'tag' || v === 'untag') {
      const t = await askText({ title: v === 'tag' ? 'Add tags' : 'Remove tags', placeholder: 'tag1 tag2', ok: v === 'tag' ? 'Add' : 'Remove' });
      if (!t) return;
      const tags = t.split(/\s+/).filter(Boolean);
      const ns = [...new Set(list.map((c) => c.note))].map(note).filter(Boolean);
      put(...ns.map((n) => ({ ...n, tags: v === 'tag' ? [...new Set([...n.tags, ...tags])] : n.tags.filter((x) => !tags.includes(x)) })));
      done(v === 'tag' ? 'Tags added' : 'Tags removed');
    }
    if (v === 'forget') {
      if (await ask({ title: `Reset ${list.length} card${list.length === 1 ? '' : 's'} to new?`, message: 'Their progress is cleared (history stays).', ok: 'Reset', danger: true })) {
        forgetCards(list);
        done('Reset to new');
      }
    }
    if (v === 'delete') {
      const nids = [...new Set(list.map((c) => c.note))];
      if (await ask({ title: `Delete ${nids.length} note${nids.length === 1 ? '' : 's'}?`, message: 'All their cards are deleted too.', ok: 'Delete', danger: true })) {
        deleteNotes(nids);
        selected = new Set();
        done('Deleted');
      }
    }
  };
  return h('div', { class: 'bulk-bar' },
    h('span', {}, `${selected.size} selected`),
    h('button', { class: 'pill', onclick: act }, 'Actions'));
}

export const redrawBrowse = () => { if (rootEl && !rootEl.hidden) renderBrowse(rootEl); };
