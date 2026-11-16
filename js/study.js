// Study mode data (tables + RLS in supabase/study.sql).
//
// Everything lives on the phone in IndexedDB (cards and review history get too big for
// localStorage) and syncs to the account row by row: study_items holds decks, presets,
// note types, notes and cards (one row each, newest edit wins per item); study_reviews
// is the append-only review log (stats, card history). Each row's server time is the
// pull cursor, so a device only downloads what changed since it last looked.
import { api, currentUser, isConfigured, onCloudChange } from './cloud.js';
import { BUILTIN_TYPES, cardOrds, plain } from './cardtext.js';
import { DEFAULT_PRESET, withDefaults, answer as schedule, dayOf, forget } from './srs.js';
import { compileSearch } from './studysearch.js';

const MODE_KEY = 'planner.study'; // '1' when this device is in study mode
const DB_NAME = 'planner-study';
export const KINDS = ['deck', 'preset', 'notetype', 'note', 'card'];

let items = new Map();    // id → { id, kind, ...data }
let reviews = new Map();  // id → { id, card, at, rating, state, ivl, … }
let dirty = new Set();    // item ids to push
let dirtyReviews = new Set();
let goneReviews = new Set(); // review ids to delete on the server (undo)
let meta = { uid: null, cursor: null, rcursor: null };
let ready = null;
let status = 'idle'; // idle | syncing | ok | missing | error | offline
let pushTimer = 0;
let syncing = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const onStudyChange = (fn) => listeners.add(fn);
export const studyStatus = () => status;
export const studyOn = () => localStorage.getItem(MODE_KEY) === '1';
export function setStudy(on) {
  if (on) localStorage.setItem(MODE_KEY, '1'); else localStorage.removeItem(MODE_KEY);
  notify();
  if (on) syncStudy();
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/* ---------- IndexedDB ---------- */

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ['items', 'reviews', 'meta']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        // Card images / sounds: { name, blob, uploaded } (v2)
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const putMany = (store, rows) => (rows.length ? tx(store, 'readwrite', (s) => rows.forEach((r) => s.put(r))) : Promise.resolve());
const delMany = (store, ids) => (ids.length ? tx(store, 'readwrite', (s) => ids.forEach((id) => s.delete(id))) : Promise.resolve());
const saveMeta = () => putMany('meta', [{ id: 'meta', ...meta, dirty: [...dirty], dirtyReviews: [...dirtyReviews], goneReviews: [...goneReviews] }]).catch(() => {});

/** Load this account's study data from the phone (once). */
export function loadStudy() {
  if (ready) return ready;
  ready = (async () => {
    const u = currentUser()?.id || null;
    try {
      const [m] = (await getAll('meta')).filter((x) => x.id === 'meta');
      if (m && m.uid && m.uid !== u) { await clearLocal(); meta.uid = u; }
      else {
        if (m) {
          meta = { uid: m.uid, cursor: m.cursor, rcursor: m.rcursor };
          dirty = new Set(m.dirty || []);
          dirtyReviews = new Set(m.dirtyReviews || []);
          goneReviews = new Set(m.goneReviews || []);
        }
        meta.uid = u;
        for (const it of await getAll('items')) items.set(it.id, it);
        bump();
        for (const r of await getAll('reviews')) reviews.set(r.id, r);
      }
    } catch { /* private mode / no IndexedDB: work in memory */ }
    notify();
  })();
  return ready;
}

async function clearLocal() {
  bump();
  items = new Map(); reviews = new Map(); dirty = new Set(); dirtyReviews = new Set(); goneReviews = new Set();
  meta = { uid: null, cursor: null, rcursor: null };
  try { await Promise.all(['items', 'reviews', 'meta', 'media'].map((s) => tx(s, 'readwrite', (st) => st.clear()))); } catch { /* ignore */ }
}

/* ---------- Reading ---------- */

// Lists by kind are kept until something changes (`ver`), since the deck list asks for them
// once per deck. Callers never sort these arrays in place.
let ver = 0;
const bump = () => { ver += 1; };
const kindCache = new Map();
let kindVer = -1;
function byKind(k) {
  if (kindVer !== ver) { kindCache.clear(); kindVer = ver; }
  if (!kindCache.has(k)) kindCache.set(k, [...items.values()].filter((x) => x.kind === k && !x.deleted));
  return kindCache.get(k);
}
export const getItem = (id) => { const it = items.get(id); return it && !it.deleted ? it : null; };

export const decks = () => byKind('deck');
export const deck = (id) => (getItem(id)?.kind === 'deck' ? getItem(id) : null);
export const childDecks = (parent) => decks().filter((d) => (d.parent || null) === parent).sort((a, b) => a.name.localeCompare(b.name));
/** Depth-first [{ deck, depth }]. */
export function deckTree(parent = null, depth = 0) {
  return childDecks(parent).flatMap((d) => [{ deck: d, depth }, ...deckTree(d.id, depth + 1)]);
}
/** A deck and every deck under it. */
export function deckIds(id) { return [id, ...childDecks(id).flatMap((d) => deckIds(d.id))]; }
export function deckPath(id) {
  const parts = [];
  for (let d = deck(id), i = 0; d && i < 20; d = deck(d.parent), i += 1) parts.unshift(d.name);
  return parts.join('::');
}

export const presets = () => {
  const saved = byKind('preset');
  return saved.some((p) => p.id === 'preset-default') ? saved : [{ id: 'preset-default', kind: 'preset', ...DEFAULT_PRESET }, ...saved];
};
export const presetOf = (deckId) => {
  const d = deck(deckId);
  const id = d?.preset || 'preset-default';
  return withDefaults(presets().find((p) => p.id === id) || presets()[0]);
};

// Built-in types first, in their own order (an edited one in its place), then the deck's own.
let typesCache = null;
let typesVer = -1;
export const noteTypes = () => {
  if (typesVer !== ver) {
    const saved = byKind('notetype');
    const byId = new Map(saved.map((t) => [t.id, t]));
    const builtin = new Set(BUILTIN_TYPES.map((b) => b.id));
    typesCache = [...BUILTIN_TYPES.map((b) => byId.get(b.id) || { kind: 'notetype', ...b }), ...saved.filter((t) => !builtin.has(t.id))];
    typesVer = ver;
  }
  return typesCache;
};
export const noteType = (id) => noteTypes().find((t) => t.id === id) || noteTypes()[0];

export const notes = () => byKind('note');
export const cards = () => byKind('card');
export const note = (id) => (getItem(id)?.kind === 'note' ? getItem(id) : null);
let byNote = null;
let byNoteVer = -1;
export function cardsOfNote(nid) {
  if (byNoteVer !== ver) {
    byNote = new Map();
    for (const c of cards()) { if (!byNote.has(c.note)) byNote.set(c.note, []); byNote.get(c.note).push(c); }
    byNoteVer = ver;
  }
  return byNote.get(nid) || [];
}
export const reviewsOf = (cid) => [...reviews.values()].filter((r) => r.card === cid).sort((a, b) => a.at - b.at);
export const allReviews = () => [...reviews.values()];

/* ---------- Writing ---------- */

function touch(it) {
  bump();
  it.mod = Date.now();
  items.set(it.id, it);
  dirty.add(it.id);
}
function persist(changed) {
  putMany('items', changed).catch(() => {});
  saveMeta();
  schedulePush();
  notify();
}
/** Save one or more items (decks, presets, note types, notes, cards). */
export function put(...list) {
  list.forEach(touch);
  persist(list);
}
/** Delete items (kept as a tombstone until the server has it). */
export function remove(...ids) {
  const changed = [];
  for (const id of ids) {
    const it = items.get(id);
    if (!it) continue;
    if (it.kind === 'note') noteChanges += 1;
    const t = { id, kind: it.kind, deleted: true };
    touch(t);
    changed.push(t);
  }
  persist(changed);
}

export function addDeck(name, parent = null) {
  const d = { id: uid(), kind: 'deck', name: name.trim().replace(/::/g, ' '), parent, preset: deck(parent)?.preset || null };
  put(d);
  return d;
}
/** The deck new cards go to when none is chosen. */
export function defaultDeck() {
  return decks().find((d) => !d.filtered && !d.parent) || addDeck('Default');
}
export function deleteDeck(id) {
  const ids = deckIds(id);
  const cs = cards().filter((c) => ids.includes(c.deck));
  const nids = new Set(cs.map((c) => c.note));
  remove(...ids, ...cs.map((c) => c.id), ...[...nids].filter((n) => cardsOfNote(n).every((c) => ids.includes(c.deck))));
}

// Cards are numbered as they're added, so "new cards in the order added" stays stable.
let nextPos = 0;
const newPos = () => {
  if (!nextPos) nextPos = Math.max(0, ...cards().map((c) => c.pos || 0)) + 1;
  return nextPos++;
};

/** Add a note and make its cards. Returns { note, cards }. */
export function addNote(typeId, fields, tags, deckId) {
  const type = noteType(typeId);
  const n = { id: uid(), kind: 'note', type: type.id, fields, tags: cleanTags(tags), added: Date.now() };
  const made = cardOrds(type, fields).map((ord) => ({
    id: uid(), kind: 'card', note: n.id, ord, deck: deckId, state: 'new', pos: newPos(), due: 0, reps: 0, lapses: 0, flag: 0,
  }));
  put(n, ...made);
  return { note: n, cards: made };
}

/** Save a note's fields / tags; adds cards for new templates or clozes (never removes). */
export function updateNote(n, fields, tags, deckId = null) {
  noteChanges += 1;
  n.fields = fields;
  n.tags = cleanTags(tags);
  const type = noteType(n.type);
  const have = new Set(cardsOfNote(n.id).map((c) => c.ord));
  const firstDeck = deckId || cardsOfNote(n.id)[0]?.deck || defaultDeck().id;
  const made = cardOrds(type, fields).filter((o) => !have.has(o)).map((ord) => ({
    id: uid(), kind: 'card', note: n.id, ord, deck: firstDeck, state: 'new', pos: newPos(), due: 0, reps: 0, lapses: 0, flag: 0,
  }));
  put(n, ...made);
  return made;
}

export function deleteNotes(nids) {
  const set = new Set(nids);
  remove(...nids, ...cards().filter((c) => set.has(c.note)).map((c) => c.id));
}

/* ---------- Note types: fields, card templates, styling ---------- */

export const isBuiltinType = (id) => BUILTIN_TYPES.some((b) => b.id === id);
export const notesOfType = (tid) => notes().filter((n) => n.type === tid);
/** A copy of a note type to edit (built-in ones share their arrays with the app). */
export const editableType = (id) => JSON.parse(JSON.stringify(noteType(id)));

// Cards a note type's notes should have but don't yet (after a template is added or changed).
function missingCards(type) {
  const made = [];
  for (const n of notesOfType(type.id)) {
    const have = cardsOfNote(n.id);
    const ords = new Set(have.map((c) => c.ord));
    const deckId = have[0]?.deck || defaultDeck().id;
    for (const ord of cardOrds(type, n.fields)) {
      if (ords.has(ord)) continue;
      made.push({ id: uid(), kind: 'card', note: n.id, ord, deck: deckId, state: 'new', pos: newPos(), due: 0, reps: 0, lapses: 0, flag: 0 });
    }
  }
  return made;
}
/** How many cards saving this version of a note type would add. */
export const cardsToAdd = (type) => missingCards(type).length;

/** Save a note type (name, templates, styling) and make any cards it now needs. */
export function saveNoteType(type) {
  const t = { ...type, kind: 'notetype' };
  const made = missingCards(t);
  put(t, ...made);
  return made.length;
}

/** A new note type copied from another one. */
export function addNoteType(baseId, name) {
  const base = editableType(baseId);
  const t = { ...base, id: uid(), kind: 'notetype', name: name.trim() };
  delete t.mod;
  put(t);
  return t;
}

const RESERVED = new Set(['FrontSide', 'Tags', 'Deck', 'Subdeck', 'Type', 'Card']);
/** Why a field name can't be used ('' when it can). */
export function fieldNameProblem(type, name, except = null) {
  const v = name.trim();
  if (!v) return 'Type a name.';
  if (/[:{}"]/.test(v) || /^[#^/]/.test(v)) return 'Names can’t use : { } " or start with # ^ /.';
  if (RESERVED.has(v)) return `“${v}” is used by the templates themselves.`;
  if (type.fields.some((f) => f !== except && f.toLowerCase() === v.toLowerCase())) return 'Another field has that name.';
  return '';
}

const reRaw = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function renameField(type, from, to) {
  const name = to.trim();
  const re = new RegExp(`(\\{\\{[#^/]?\\s*(?:[\\w-]+:)*)${reRaw(from)}(\\s*\\}\\})`, 'g');
  const swap = (tpl) => String(tpl || '').replace(re, (all, a, b) => `${a}${name}${b}`);
  type.fields = type.fields.map((f) => (f === from ? name : f));
  type.templates = type.templates.map((tp) => ({ ...tp, front: swap(tp.front), back: swap(tp.back) }));
  if (type.io) type.io = Object.fromEntries(Object.entries(type.io).map(([k, v]) => [k, v === from ? name : v]));
  const changed = notesOfType(type.id).map((n) => {
    const fields = {};
    for (const [k, v] of Object.entries(n.fields || {})) fields[k === from ? name : k] = v;
    n.fields = fields;
    return n;
  });
  put({ ...type, kind: 'notetype' }, ...changed);
}
export function addField(type, name) {
  type.fields = [...type.fields, name.trim()];
  put({ ...type, kind: 'notetype' });
}
/** Remove a field and what every note of this type had in it. */
export function removeField(type, name) {
  type.fields = type.fields.filter((f) => f !== name);
  const changed = notesOfType(type.id).filter((n) => name in (n.fields || {})).map((n) => {
    const fields = { ...n.fields };
    delete fields[name];
    n.fields = fields;
    return n;
  });
  noteChanges += 1; // its pictures may be unused now
  put({ ...type, kind: 'notetype' }, ...changed);
}
export function moveField(type, name, by) {
  const i = type.fields.indexOf(name);
  const j = i + by;
  if (i < 0 || j < 0 || j >= type.fields.length) return;
  const f = [...type.fields];
  [f[i], f[j]] = [f[j], f[i]];
  type.fields = f;
  put({ ...type, kind: 'notetype' });
}

/** What removing card template `ord` deletes: { cards, notes } (notes left with no card). */
export function templateRemoval(type, ord) {
  const doomed = [];
  const orphans = [];
  for (const n of notesOfType(type.id)) {
    const cs = cardsOfNote(n.id);
    const gone = cs.filter((c) => c.ord === ord);
    doomed.push(...gone);
    if (gone.length && gone.length === cs.length) orphans.push(n);
  }
  return { cards: doomed, notes: orphans };
}
export function removeTemplate(type, ord) {
  const { cards: doomed, notes: orphans } = templateRemoval(type, ord);
  const shifted = [];
  for (const n of notesOfType(type.id)) for (const c of cardsOfNote(n.id)) if (c.ord > ord) { c.ord -= 1; shifted.push(c); }
  type.templates = type.templates.filter((t, i) => i !== ord);
  put({ ...type, kind: 'notetype' }, ...shifted);
  if (doomed.length || orphans.length) remove(...doomed.map((c) => c.id), ...orphans.map((n) => n.id));
}

/** Delete a note type with all its notes and cards. */
export function deleteNoteType(id) {
  const ns = notesOfType(id);
  deleteNotes(ns.map((n) => n.id));
  remove(id);
}

export const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(/\s+/))
  .map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];

/** Another note of the same type with the same first field (Anki's duplicate check). */
export function duplicateOf(typeId, first, exceptId = null) {
  const key = plain(first).toLowerCase();
  if (!key) return null;
  const type = noteType(typeId);
  return notes().find((n) => n.id !== exceptId && n.type === typeId && plain(n.fields[type.fields[0]]).toLowerCase() === key) || null;
}

/* ---------- Answering ---------- */

/**
 * Answer a card: schedule it, log the review, bury its siblings if the preset says so.
 * Returns an undo function.
 */
export function answerCard(card, rating, msTaken = 0) {
  const preset = presetOf(card.deck);
  const before = { ...card };
  const { card: next, log, leech } = schedule(card, rating, preset);
  const rid = uid();
  const r = { id: rid, ...log, time: Math.round(msTaken) };
  const n = note(card.note);
  const changed = [next];
  if (leech && n && !n.tags.includes('leech')) { n.tags = [...n.tags, 'leech']; changed.push(n); }
  const today = dayOf(Date.now());
  const siblings = preset.burySiblings ? cardsOfNote(card.note).filter((c) => c.id !== card.id && !c.suspended
    && (c.state === 'new' || (c.state === 'review' && dayOf(c.due) <= today)) && c.buried !== today) : [];
  const sibBefore = siblings.map((c) => ({ ...c }));
  siblings.forEach((c) => { c.buried = today; });
  put(...changed, ...siblings);
  reviews.set(rid, r);
  dirtyReviews.add(rid);
  putMany('reviews', [r]).catch(() => {});
  saveMeta();
  return () => {
    reviews.delete(rid);
    if (dirtyReviews.has(rid)) dirtyReviews.delete(rid); else goneReviews.add(rid);
    delMany('reviews', [rid]).catch(() => {});
    const restore = [before, ...sibBefore].map((c) => ({ ...c }));
    if (leech && n) { n.tags = n.tags.filter((t) => t !== 'leech'); restore.push(n); }
    put(...restore);
    return before;
  };
}

/** Bury until tomorrow, suspend, flag, forget, move. */
export const bury = (cs) => put(...cs.map((c) => ({ ...c, buried: dayOf(Date.now()) })));
export const setSuspended = (cs, on) => put(...cs.map((c) => ({ ...c, suspended: on })));
export const setFlag = (cs, flag) => put(...cs.map((c) => ({ ...c, flag })));
export const forgetCards = (cs) => put(...cs.map((c) => ({ ...forget(c), pos: newPos() })));
export const moveCards = (cs, deckId) => put(...cs.map((c) => ({ ...c, deck: deckId })));

/* ---------- Bulk import (Anki) ---------- */

/** Store many items and reviews at once (they're all new to this account). */
export async function importBatch(newItems, newReviews) {
  const now = Date.now();
  for (const it of newItems) { it.mod = now; items.set(it.id, it); dirty.add(it.id); }
  bump();
  for (const r of newReviews) { reviews.set(r.id, r); dirtyReviews.add(r.id); }
  nextPos = 0;
  await putMany('items', newItems).catch(() => {});
  await putMany('reviews', newReviews).catch(() => {});
  await saveMeta();
  notify();
  schedulePush(300);
}

/* ---------- Sync ---------- */

const rest = (path, opts = {}) => api(`/rest/v1/${path}`, { auth: true, ...opts });
const isMissing = (e) => e.status === 404 || e.code === 'PGRST205' || e.code === '42P01';
const canSync = () => isConfigured() && !!currentUser();
const BATCH = 200;

function schedulePush(ms = 1500) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncStudy(), ms);
}

const strip = (it) => { const { id, kind, deleted, ...data } = it; return data; };

async function pushAll() {
  const ids = [...dirty];
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    part.forEach((id) => { if (!items.has(id)) dirty.delete(id); });
    const rows = part.map((id) => items.get(id)).filter(Boolean)
      .map((it) => ({ id: it.id, kind: it.kind, data: strip(it), deleted: !!it.deleted }));
    if (rows.length) await rest('study_items?on_conflict=user_id,id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates' } });
    rows.forEach((r) => { if (items.get(r.id)?.mod === r.data.mod || r.deleted) dirty.delete(r.id); });
  }
  const rids = [...dirtyReviews];
  for (let i = 0; i < rids.length; i += BATCH) {
    const rows = rids.slice(i, i + BATCH).map((id) => reviews.get(id)).filter(Boolean)
      .map((r) => { const { id, card, ...data } = r; return { id, card_id: card, data }; });
    if (rows.length) await rest('study_reviews?on_conflict=user_id,id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates' } });
    rows.forEach((r) => dirtyReviews.delete(r.id));
  }
  const gone = [...goneReviews];
  for (let i = 0; i < gone.length; i += BATCH) {
    const part = gone.slice(i, i + BATCH);
    await rest(`study_reviews?id=in.(${part.map((x) => `"${x}"`).join(',')})`, { method: 'DELETE' });
    part.forEach((x) => goneReviews.delete(x));
  }
}

// Rows written in the same moment as the cursor could commit a little later, so each
// pull looks back a few seconds; items seen twice are harmless (newest edit wins).
const back = (iso) => (iso ? new Date(new Date(iso).getTime() - 5000).toISOString() : null);

async function pullAll() {
  for (let guard = 0; guard < 200; guard += 1) {
    const since = back(meta.cursor);
    const rows = await rest(`study_items?select=id,kind,data,deleted,updated_at${since ? `&updated_at=gt.${since}` : ''}&order=updated_at.asc&limit=1000`);
    const changed = [];
    for (const r of rows) {
      const local = items.get(r.id);
      const remote = r.deleted ? { id: r.id, kind: r.kind, deleted: true, mod: r.data?.mod || 0 } : { id: r.id, kind: r.kind, ...r.data };
      if (local && dirty.has(r.id) && (local.mod || 0) > (remote.mod || 0)) continue; // ours is newer: push wins
      if (local && !dirty.has(r.id) && JSON.stringify(local) === JSON.stringify(remote)) continue;
      if (r.kind === 'note') noteChanges += 1;
      items.set(r.id, remote);
      dirty.delete(r.id);
      changed.push(remote);
      bump();
    }
    if (changed.length) await putMany('items', changed).catch(() => {});
    const last = rows.at(-1)?.updated_at;
    const moved = last && last !== meta.cursor;
    if (last) meta.cursor = last;
    if (changed.length) { nextPos = 0; notify(); }
    if (rows.length < 1000 || !moved) break;
  }
  for (let guard = 0; guard < 500; guard += 1) {
    const since = back(meta.rcursor);
    const rows = await rest(`study_reviews?select=id,card_id,data,synced_at${since ? `&synced_at=gt.${since}` : ''}&order=synced_at.asc&limit=1000`);
    const fresh = rows.filter((r) => !reviews.has(r.id) && !goneReviews.has(r.id)).map((r) => ({ id: r.id, card: r.card_id, ...r.data }));
    fresh.forEach((r) => reviews.set(r.id, r));
    if (fresh.length) await putMany('reviews', fresh).catch(() => {});
    const last = rows.at(-1)?.synced_at;
    const moved = last && last !== meta.rcursor;
    if (last) meta.rcursor = last;
    if (rows.length < 1000 || !moved) break;
  }
  await saveMeta();
}

/** Push this phone's changes, then pull everyone else's (other devices). */
export function syncStudy() {
  if (!canSync()) return Promise.resolve();
  if (syncing) { schedulePush(800); return syncing; }
  clearTimeout(pushTimer);
  syncing = (async () => {
    await loadStudy();
    status = 'syncing';
    try {
      await pushAll();
      await pullAll();
      status = 'ok';
    } catch (e) {
      status = isMissing(e) ? 'missing' : navigator.onLine === false ? 'offline' : 'error';
    } finally {
      syncing = null;
      await saveMeta();
      notify();
    }
  })();
  return syncing;
}
export const hasUnsyncedStudy = () => dirty.size > 0 || dirtyReviews.size > 0;

// Another account signs in, or this one signs out: clear this phone's copy.
// (Cloud status changes also fire while the phone's copy is still loading: wait for it, or
// the not-yet-loaded owner looks like someone else and everything gets cleared.)
let switching = null;
onCloudChange(() => {
  if (!ready || switching) return;
  const loading = ready;
  switching = loading.then(() => {
    switching = null;
    const u = currentUser()?.id || null;
    if (u === meta.uid || ready !== loading) return;
    ready = clearFor(u);
  });
});
function clearFor(u) {
  return (async () => {
    await clearLocal();
    meta.uid = u;
    if (!u) localStorage.removeItem(MODE_KEY);
    notify();
    if (u) syncStudy();
  })();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && studyOn()) syncStudy();
  if (document.visibilityState === 'hidden' && (dirty.size || dirtyReviews.size)) syncStudy();
});
window.addEventListener('online', () => { if (studyOn()) syncStudy(); });

/* ---------- Search (Anki syntax, see studysearch.js) ---------- */

/** Cards matching a search, e.g. "deck:French is:due -tag:leech". */
export function searchCards(query, now = Date.now()) {
  const test = compileSearch(query);
  const types = new Map(noteTypes().map((t) => [t.id, t]));
  const byCard = new Map();
  for (const r of reviews.values()) { if (!byCard.has(r.card)) byCard.set(r.card, []); byCard.get(r.card).push(r); }
  for (const list of byCard.values()) list.sort((a, b) => a.at - b.at);
  const paths = new Map();
  const pathsOf = (deckId) => {
    if (!paths.has(deckId)) {
      const out = [];
      let d = deck(deckId);
      for (let i = 0; d && i < 20; d = deck(d.parent), i += 1) out.push(deckPath(d.id));
      paths.set(deckId, out);
    }
    return paths.get(deckId);
  };
  const textCache = new Map();
  const x = {
    now,
    today: dayOf(now),
    note: (c) => getItem(c.note),
    type: (c) => types.get(getItem(c.note)?.type),
    deckOf: (c) => deck(c.deck),
    deckPaths: (c) => pathsOf(c.deck),
    reviews: (c) => byCard.get(c.id) || [],
    text: (c) => {
      if (!textCache.has(c.note)) {
        const n = getItem(c.note);
        textCache.set(c.note, n ? Object.values(n.fields || {}).map(plain).join(' ') + ' ' + (n.tags || []).join(' ') : '');
      }
      return textCache.get(c.note);
    },
  };
  return cards().filter((c) => test(c, x));
}

/* ---------- What to study next ---------- */

let byDeck = null;
let byDeckVer = -1;
function cardsInDeck(id) {
  if (byDeckVer !== ver) {
    byDeck = new Map();
    for (const c of cards()) { if (!byDeck.has(c.deck)) byDeck.set(c.deck, []); byDeck.get(c.deck).push(c); }
    byDeckVer = ver;
  }
  return byDeck.get(id) || [];
}

const LEARN_AHEAD = 20 * 60_000; // learning cards due within 20 minutes can come early (Anki)
const isLearning = (c) => c.state === 'learn' || c.state === 'relearn';
const available = (c, today) => !c.suspended && c.buried !== today;

// The cards a deck studies: itself and its subdecks, or a filtered deck's search.
function poolOf(deckId, now) {
  const d = deck(deckId);
  if (d?.filtered) {
    const f = d.filtered;
    let list = searchCards(f.query || '', now).filter((c) => !c.suspended);
    const order = {
      due: (a, b) => (a.due || 0) - (b.due || 0),
      added: (a, b) => (a.pos || 0) - (b.pos || 0),
      lapses: (a, b) => (b.lapses || 0) - (a.lapses || 0),
      random: () => Math.random() - 0.5,
    }[f.order || 'due'];
    list = list.sort(order).slice(0, Math.max(1, f.limit || 100));
    return { filtered: true, cards: list };
  }
  const ids = new Set(deckIds(deckId));
  return { filtered: false, ids, cards: [...ids].flatMap((id) => cardsInDeck(id)) };
}

/** Today's numbers for a deck: { new, learn, review } still to do (after daily limits). */
export function dueCounts(deckId, now = Date.now(), seen = null) {
  const today = dayOf(now);
  const pool = poolOf(deckId, now);
  const p = presetOf(deckId);
  const live = pool.cards.filter((c) => available(c, today) && !(seen && seen.has(c.id) && !isLearning(c)));
  const learn = live.filter((c) => isLearning(c) && dayOf(c.due) <= today).length;
  let review = live.filter((c) => c.state === 'review' && (pool.filtered || dayOf(c.due) <= today)).length;
  let fresh = live.filter((c) => c.state === 'new').length;
  if (!pool.filtered) {
    let newDone = 0;
    let revDone = 0;
    for (const [deckId, [n, r]] of todayByDeck(today)) {
      if (!pool.ids.has(deckId)) continue;
      newDone += n;
      revDone += r;
    }
    review = Math.min(review, Math.max(0, p.reviewsPerDay - revDone));
    fresh = Math.min(fresh, Math.max(0, p.newPerDay - newDone), Math.max(0, p.reviewsPerDay - revDone - review));
  }
  return { new: fresh, learn, review };
}

// Today's answers per deck: deck id → [new cards started, reviews done] (counted once).
let tally = { key: '', map: new Map() };
function todayByDeck(today) {
  const key = `${ver}:${reviews.size}:${today}`;
  if (tally.key === key) return tally.map;
  const map = new Map();
  for (const r of reviews.values()) {
    if (dayOf(r.at) !== today || (r.state !== 'new' && r.state !== 'review')) continue;
    const c = getItem(r.card);
    if (!c) continue;
    const row = map.get(c.deck) || [0, 0];
    row[r.state === 'new' ? 0 : 1] += 1;
    map.set(c.deck, row);
  }
  tally = { key, map };
  return map;
}

/**
 * The next card to show: { card } — or { wait: ms } when only learning cards due later
 * today remain — or {} when the deck is done for today.
 * `seen` = cards answered this session (a filtered deck shows each once, except learning).
 */
export function nextCard(deckId, now = Date.now(), seen = new Set(), answered = 0) {
  const today = dayOf(now);
  const pool = poolOf(deckId, now);
  const p = presetOf(deckId);
  const live = pool.cards.filter((c) => available(c, today) && !(seen.has(c.id) && !isLearning(c)));
  const learning = live.filter(isLearning).sort((a, b) => a.due - b.due);
  if (learning[0] && learning[0].due <= now) return { card: learning[0] };
  const counts = dueCounts(deckId, now, seen);
  const reviewsDue = live.filter((c) => c.state === 'review' && (pool.filtered || dayOf(c.due) <= today))
    .sort((a, b) => (a.due || 0) - (b.due || 0)).slice(0, counts.review);
  const newOnes = live.filter((c) => c.state === 'new')
    .sort(p.newOrder === 'random' ? (a, b) => seededOrder(a.id, today) - seededOrder(b.id, today) : (a, b) => (a.pos || 0) - (b.pos || 0))
    .slice(0, counts.new);
  // New cards are spread among the reviews.
  if (newOnes.length && (!reviewsDue.length || answered % Math.max(1, Math.round((reviewsDue.length + newOnes.length) / newOnes.length)) === 0)) {
    return { card: newOnes[0] };
  }
  if (reviewsDue.length) return { card: reviewsDue[0] };
  if (learning[0] && learning[0].due <= now + LEARN_AHEAD) return { card: learning[0] };
  if (learning[0] && dayOf(learning[0].due) <= today) return { wait: learning[0].due };
  return {};
}
function seededOrder(id, day) {
  let h = day;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return (h >>> 0) / 4294967296;
}

/* ---------- Media files (images, sounds) on the phone: see studymedia.js ---------- */

export const mediaGet = (name) => tx('media', 'readonly', (st) => st.get(name)).catch(() => null);
export const mediaPut = (recs) => putMany('media', recs);
export const mediaHas = async (names) => {
  const out = new Set();
  await tx('media', 'readonly', (st) => names.forEach((n) => { const r = st.getKey(n); r.onsuccess = () => { if (r.result !== undefined) out.add(n); }; })).catch(() => {});
  return out;
};
/** Every media file on the phone: [{ name, uploaded, added }] (no file contents). */
export async function mediaList() {
  const out = [];
  await tx('media', 'readonly', (st) => {
    const r = st.openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return; out.push({ name: c.value.name, uploaded: !!c.value.uploaded, added: c.value.added || 0 }); c.continue(); };
  }).catch(() => {});
  return out;
}
export const mediaDelete = (names) => delMany('media', names);
// Counts note deletes / edits, so media cleanup only runs when it could find something.
let noteChanges = 0;
export const noteChangeCount = () => noteChanges;

/** Names of files not yet uploaded to the account. */
export async function mediaPending() {
  const out = [];
  await tx('media', 'readonly', (st) => {
    const r = st.openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return; if (!c.value.uploaded) out.push(c.value.name); c.continue(); };
  }).catch(() => {});
  return out;
}
