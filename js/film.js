// Film Production Mode data (tables + RLS in supabase/film.sql).
//
// A project has members (owner + collaborators, all with full access), its own to-dos /
// schedule / folders (project_items, one row each) and three writing sections
// (project_docs: story, plot, script) that one person edits at a time (a lock that
// expires after 2 minutes unless renewed). Each project has one group chat.
//
// While film mode is on, store.js shows and edits this project's lists instead of the
// personal planner (useLists); edits are pushed here, row by row, shortly after.
import { api, currentUser, isConfigured, onCloudChange } from './cloud.js';
import { useLists, uid } from './store.js';
import { createGroup, addMembers, removeMember, leaveChat, renameGroup } from './chat.js';
import { addNoteSource, notifySocial } from './social.js';

const MODE_KEY = 'planner.film';      // { on, project } on this device
const CACHE_KEY = 'planner.filmdata'; // per user, removed on sign-out
export const SECTIONS = ['story', 'plot', 'script'];
const LOCK_MS = 2 * 60 * 1000;

let mode = readMode();
let data = readCache();
let status = 'idle'; // idle | ready | missing | error
let lists = null;    // the lists store.js is using while film mode is on
let synced = {};     // item id → JSON last pushed/pulled (for the current project)
let pushTimer = 0;
let running = null;
const listeners = new Set();

function readMode() {
  try { return { on: false, project: null, ...JSON.parse(localStorage.getItem(MODE_KEY)) }; } catch { return { on: false, project: null }; }
}
const writeMode = () => localStorage.setItem(MODE_KEY, JSON.stringify(mode));
function blank(u = null) { return { uid: u, projects: {}, members: {}, items: {}, docs: {}, handles: {}, seen: {} }; }
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && c.uid && c.uid === currentUser()?.id) return { ...blank(), ...c };
  } catch { /* ignore */ }
  return blank(currentUser()?.id || null);
}
function writeCache() {
  if (!data.uid) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
}
function notify() { listeners.forEach((fn) => fn()); }

export const onFilmChange = (fn) => listeners.add(fn);
export const filmOn = () => mode.on;
export const filmStatus = () => status;
const me = () => currentUser()?.id;
export const myId = me;
export const nameOf = (id) => (data.handles[id] ? `@${data.handles[id]}` : 'Someone');

const rest = (path, opts = {}) => api(`/rest/v1/${path}`, { auth: true, ...opts });
const isMissing = (e) => e.status === 404 || e.code === 'PGRST205' || e.code === '42P01';
const canSync = () => isConfigured() && !!currentUser();

/* ---------- Projects ---------- */

export const projects = () => Object.values(data.projects).sort((a, b) => a.name.localeCompare(b.name));
export const currentProject = () => (mode.project && data.projects[mode.project]) || null;
export const membersOf = (pid) => data.members[pid] || [];
export const isOwner = (p = currentProject()) => !!p && p.owner === me();

/** Turn film mode on/off (the logo long-press). */
export function setFilm(on) {
  mode.on = on;
  if (on && !currentProject()) mode.project = projects()[0]?.id || null;
  writeMode();
  applyLists();
  notify();
  if (on) refreshFilm();
}

export function chooseProject(pid) {
  if (mode.project === pid) return;
  flushPush();
  mode.project = pid;
  writeMode();
  synced = {};
  applyLists();
  notify();
  refreshFilm();
}

/* ---------- The project's to-dos / schedule / folders ---------- */

function rowsToLists(rows) {
  const out = { todos: [], events: [], categories: [] };
  for (const r of rows) {
    const list = r.kind === 'todo' ? out.todos : r.kind === 'event' ? out.events : out.categories;
    list.push({ ...r.data, id: r.id });
  }
  return out;
}

// Point store.js at the current project's lists (or empty lists while none is chosen).
function applyLists() {
  if (!mode.on) {
    lists = null;
    useLists(null);
    return;
  }
  const p = currentProject();
  const rows = p ? data.items[p.id] || [] : [];
  const l = rowsToLists(rows);
  synced = Object.fromEntries(rows.map((r) => [r.id, JSON.stringify({ kind: r.kind, data: r.data })]));
  lists = { ...l, persist: () => schedulePush() };
  useLists(lists);
}

const kindOf = (l, item) => (l.todos.includes(item) ? 'todo' : l.events.includes(item) ? 'event' : 'category');
const dataOf = (item) => { const { id, ...rest } = item; return rest; };

function localRows() {
  if (!lists) return [];
  return [...lists.todos, ...lists.events, ...lists.categories].map((item) => ({ id: item.id, kind: kindOf(lists, item), data: dataOf(item) }));
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushItems, 700);
}
function flushPush() {
  if (pushTimer) { clearTimeout(pushTimer); pushItems(); }
}

async function pushItems() {
  pushTimer = 0;
  const p = currentProject();
  if (!p || !lists || !canSync()) return;
  const rows = localRows();
  const now = new Date().toISOString();
  const changed = rows.filter((r) => synced[r.id] !== JSON.stringify({ kind: r.kind, data: r.data }));
  const ids = new Set(rows.map((r) => r.id));
  const removed = Object.keys(synced).filter((id) => !ids.has(id));
  try {
    if (changed.length) {
      await rest('project_items?on_conflict=project_id,id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: changed.map((r) => ({ project_id: p.id, id: r.id, kind: r.kind, data: r.data, updated_by: me(), updated_at: now })),
      });
    }
    if (removed.length) await rest(`project_items?project_id=eq.${p.id}&id=in.(${removed.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
    changed.forEach((r) => { synced[r.id] = JSON.stringify({ kind: r.kind, data: r.data }); });
    removed.forEach((id) => { delete synced[id]; });
    data.items[p.id] = rows.map((r) => ({ ...r, updated_at: now }));
    writeCache();
  } catch { schedulePushLater(); }
}
function schedulePushLater() { clearTimeout(pushTimer); pushTimer = setTimeout(pushItems, 10000); }

// Bring in collaborators' changes without losing my unsent ones (kept by object identity,
// so an editor that's open on an item keeps editing the same object).
function mergeRemote(pid, remote) {
  data.items[pid] = remote;
  if (!lists || pid !== currentProject()?.id) return;
  const local = new Map(localRows().map((r) => [r.id, r]));
  const dirty = new Set([...local.values()].filter((r) => synced[r.id] !== JSON.stringify({ kind: r.kind, data: r.data })).map((r) => r.id));
  const objects = new Map([...lists.todos, ...lists.events, ...lists.categories].map((o) => [o.id, o]));
  const next = { todos: [], events: [], categories: [] };
  const put = (kind, obj) => next[kind === 'todo' ? 'todos' : kind === 'event' ? 'events' : 'categories'].push(obj);
  const seen = new Set();
  for (const r of remote) {
    seen.add(r.id);
    if (dirty.has(r.id)) { put(local.get(r.id).kind, objects.get(r.id)); continue; }
    const obj = objects.get(r.id) || {};
    Object.keys(obj).forEach((k) => delete obj[k]);
    Object.assign(obj, r.data, { id: r.id });
    put(r.kind, obj);
    synced[r.id] = JSON.stringify({ kind: r.kind, data: r.data });
  }
  for (const [id, r] of local) {
    if (seen.has(id)) continue;
    if (!(id in synced) || dirty.has(id)) put(r.kind, objects.get(id)); // mine, not sent yet
    else delete synced[id]; // deleted by a collaborator
  }
  lists.todos = next.todos;
  lists.events = next.events;
  lists.categories = next.categories;
}

/* ---------- Loading ---------- */

let again = false;
export function refreshFilm() {
  if (!canSync()) return Promise.resolve();
  // A refresh asked for mid-run (e.g. film mode just switched on) runs once more after.
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const u = me();
      if (data.uid !== u) data = blank(u);
      const mine = await rest(`project_members?select=project_id&user_id=eq.${u}`);
      const ids = mine.map((m) => m.project_id);
      if (!ids.length) {
        Object.assign(data, { projects: {}, members: {}, items: {}, docs: {} });
      } else {
        const inList = ids.join(',');
        const [projs, members] = await Promise.all([
          rest(`projects?select=id,name,owner,chat_id,created_at&id=in.(${inList})`),
          rest(`project_members?select=project_id,user_id,added_by,joined_at&project_id=in.(${inList})`),
        ]);
        data.projects = Object.fromEntries(projs.map((p) => [p.id, p]));
        data.members = {};
        members.forEach((m) => { (data.members[m.project_id] ||= []).push(m); });
        const users = [...new Set(members.flatMap((m) => [m.user_id, m.added_by]))].filter((x) => !data.handles[x]);
        if (users.length) {
          const rows = await rest(`profiles?select=user_id,handle&user_id=in.(${users.join(',')})`);
          rows.forEach((r) => { data.handles[r.user_id] = r.handle; });
        }
      }
      // No project chosen (or it's gone): open the first one.
      if (!mode.project || !data.projects[mode.project]) {
        const first = projects()[0]?.id || null;
        if (first !== mode.project) { mode.project = first; writeMode(); synced = {}; applyLists(); }
      }
      const p = currentProject();
      if (p && mode.on) {
        if (!pushTimer) {
          const items = await rest(`project_items?select=id,kind,data,updated_at,updated_by&project_id=eq.${p.id}`);
          if (!lists || !Object.keys(synced).length) { data.items[p.id] = items; applyLists(); } else mergeRemote(p.id, items);
        }
        await loadDocs(p.id);
      }
      status = 'ready';
    } catch (e) {
      status = isMissing(e) ? 'missing' : 'error';
    }
    writeCache();
    notify();
    notifySocial();
  })().finally(() => {
    running = null;
    if (again) { again = false; refreshFilm(); }
  });
  return running;
}

async function loadDocs(pid) {
  const rows = await rest(`project_docs?select=section,body,updated_by,updated_at,locked_by,lock_until&project_id=eq.${pid}`);
  const docs = data.docs[pid] || {};
  rows.forEach((r) => {
    // While I hold a section, my own copy is the newest; keep it.
    if (docs[r.section] && heldByMe(docs[r.section]) && r.locked_by === me()) return;
    docs[r.section] = r;
  });
  data.docs[pid] = docs;
}

/* ---------- Create / invite / leave ---------- */

export async function createProject(name) {
  const clean = name.trim().slice(0, 80) || 'Untitled';
  const [p] = await rest('projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { name: clean } });
  await rest('project_members', { method: 'POST', body: { project_id: p.id, user_id: me() } });
  await rest('project_docs', { method: 'POST', body: SECTIONS.map((section) => ({ project_id: p.id, section, body: {} })) });
  try {
    const chatId = await createGroup(clean, []);
    await rest(`projects?id=eq.${p.id}`, { method: 'PATCH', body: { chat_id: chatId } });
  } catch { /* chat not set up: the project works without it */ }
  mode.project = p.id;
  writeMode();
  synced = {};
  data.items[p.id] = [];
  applyLists();
  await refreshFilm();
  return p.id;
}

export async function renameProject(pid, name) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  await rest(`projects?id=eq.${pid}`, { method: 'PATCH', body: { name: clean } });
  const chat = data.projects[pid]?.chat_id;
  if (chat) await renameGroup(chat, clean).catch(() => {});
  await refreshFilm();
}

export async function inviteCollaborators(pid, ids) {
  if (!ids.length) return;
  await rest('project_members', { method: 'POST', body: ids.map((user_id) => ({ project_id: pid, user_id })) });
  const chat = data.projects[pid]?.chat_id;
  if (chat) await addMembers(chat, ids).catch(() => {});
  await refreshFilm();
}

export async function removeCollaborator(pid, userId) {
  await rest(`project_members?project_id=eq.${pid}&user_id=eq.${userId}`, { method: 'DELETE' });
  const chat = data.projects[pid]?.chat_id;
  if (chat) await removeMember(chat, userId).catch(() => {});
  await refreshFilm();
}

export async function leaveProject(pid) {
  const p = data.projects[pid];
  if (p?.owner === me()) {
    await rest(`projects?id=eq.${pid}`, { method: 'DELETE' }); // owner: delete it for everyone
    if (p.chat_id) await rest(`chats?id=eq.${p.chat_id}`, { method: 'DELETE' }).catch(() => {});
  } else {
    await rest(`project_members?project_id=eq.${pid}&user_id=eq.${me()}`, { method: 'DELETE' });
    if (p?.chat_id) await leaveChat(p.chat_id).catch(() => {});
  }
  delete data.projects[pid];
  delete data.items[pid];
  delete data.docs[pid];
  if (mode.project === pid) { mode.project = projects()[0]?.id || null; writeMode(); synced = {}; applyLists(); }
  await refreshFilm();
}

/* ---------- Writing (one editor at a time) ---------- */

export const docOf = (section) => data.docs[currentProject()?.id]?.[section] || null;
const lockActive = (d) => d && d.locked_by && d.lock_until && new Date(d.lock_until).getTime() > Date.now();
const heldByMe = (d) => lockActive(d) && d.locked_by === me();
/** Who's editing a section right now (someone else), or null. */
export const editorOf = (section) => { const d = docOf(section); return lockActive(d) && d.locked_by !== me() ? d.locked_by : null; };

async function patchDoc(section, body) {
  const p = currentProject();
  const rows = await rest(`project_docs?project_id=eq.${p.id}&section=eq.${section}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body,
  });
  if (!rows.length) return null;
  data.docs[p.id] = { ...data.docs[p.id], [section]: rows[0] };
  writeCache();
  return rows[0];
}

/** Take the section for editing. Resolves true, or false if someone else has it. */
export async function lockDoc(section) {
  const ok = await patchDoc(section, { locked_by: me(), lock_until: new Date(Date.now() + LOCK_MS).toISOString() });
  if (!ok) await loadDocs(currentProject().id);
  notify();
  return !!ok;
}

/** Save while editing (also renews the lock). Throws if the lock was lost. */
export async function saveDoc(section, body) {
  const ok = await patchDoc(section, {
    body, updated_by: me(), updated_at: new Date().toISOString(),
    locked_by: me(), lock_until: new Date(Date.now() + LOCK_MS).toISOString(),
  });
  if (!ok) { await loadDocs(currentProject().id); notify(); throw new Error('lost'); }
}

/** Finish editing: save and free the section for others. */
export async function unlockDoc(section, body) {
  const fields = { locked_by: null, lock_until: null };
  if (body !== undefined) Object.assign(fields, { body, updated_by: me(), updated_at: new Date().toISOString() });
  await patchDoc(section, fields);
  notify();
}

/* ---------- Bell: "@x added you to …" ---------- */

addNoteSource(() => {
  const u = me();
  return Object.entries(data.members).flatMap(([pid, list]) => list
    .filter((m) => m.user_id === u && m.added_by !== u)
    .map((m) => ({
      key: `film:${pid}`, at: m.joined_at,
      text: `${nameOf(m.added_by)} added you to the film project “${data.projects[pid]?.name || ''}”. Long-press the logo to open it.`,
    })));
});

/* ---------- Session ---------- */

onCloudChange(() => {
  const u = currentUser()?.id || null;
  if (u === data.uid) return;
  if (!u) {
    localStorage.removeItem(CACHE_KEY);
    mode = { on: false, project: null };
    writeMode();
  }
  data = blank(u);
  synced = {};
  applyLists();
  notify();
  if (u) refreshFilm();
});

// Start in film mode if that's where the app was left.
applyLists();
export const newId = uid;
