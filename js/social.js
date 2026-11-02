// Friends & sharing (tables + row-level security in supabase/social.sql).
//
// Each user picks a unique ID (profiles). Friends are added by ID and must accept.
// Sharing: a to-do / event / folder carries `sharedWith: [friend user ids]` in the
// owner's own planner; this module keeps one `shares` row per (item, friend) holding a
// copy of the item, so the friend can read it (and nothing else of the owner's).
// A friend can check a shared to-do off: that writes a `share_checks` row, which the
// owner's app applies to its own to-do and then deletes.
import { api, currentUser, isConfigured, onCloudChange } from './cloud.js';
import { state, save, onChange, isRoutine, rollsOver, todoDate, occursOn, inFilm } from './store.js';

const CACHE_KEY = 'planner.social';
export const HANDLE_RE = /^[a-z0-9_.]{3,20}$/;

// What we last loaded, cached so shared items show offline too. Cleared on sign-out.
let data = readCache();
let status = 'idle'; // idle | loading | ready | missing (tables not created yet) | error
let running = null;
let pushTimer = null;
const pending = {}; // check-offs tapped since the last refresh: key → { done, day }
const listeners = new Set();

function blank(uid = null) {
  return { uid, me: null, myNick: '', friendships: [], handles: {}, nicks: {}, shares: [], checks: [], seen: {}, log: [] };
}
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && c.uid && c.uid === currentUser()?.id) return { ...blank(), ...c };
  } catch { /* ignore */ }
  return blank(currentUser()?.id || null);
}
function writeCache() {
  if (data.uid) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full: keep in memory */ } }
}
function notify() { listeners.forEach((fn) => fn()); }

export const onSocialChange = (fn) => listeners.add(fn);
export const socialEnabled = () => isConfigured() && !!currentUser();
export const socialStatus = () => status;
export const myHandle = () => data.me;
const me = () => currentUser()?.id;
export const myNickname = () => data.myNick || '';
export const handleOf = (id) => data.handles[id] || null;
// People are shown by the nickname they chose; the ID (@handle) is only for finding friends.
export const displayName = (id, fallback = 'Someone') =>
  (data.nicks?.[id] || (data.handles[id] ? `@${data.handles[id]}` : fallback));
export const nameOf = (id) => displayName(id, 'A friend');

// Friends with their state: requests to answer first, then friends, then requests I sent.
const RANK = { received: 0, friend: 1, sent: 2 };
export function friends() {
  const uid = me();
  return data.friendships.map((f) => {
    const other = f.requester === uid ? f.addressee : f.requester;
    const state = f.status === 'accepted' ? 'friend' : f.requester === uid ? 'sent' : 'received';
    const handle = data.handles[other] || '…';
    return { rowId: f.id, id: other, handle, name: data.nicks?.[other] || `@${handle}`, state };
  }).sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.replace(/^@/, '').localeCompare(b.name.replace(/^@/, '')));
}
export const acceptedFriends = () => friends().filter((f) => f.state === 'friend');

/* ---------- Loading ---------- */

const rest = (path, opts = {}) => api(`/rest/v1/${path}`, { auth: true, ...opts });
const isMissing = (e) => e.status === 404 || e.code === 'PGRST205' || e.code === '42P01';

// Nicknames need the `profiles.nickname` column (supabase/social.sql). Until that setup
// step has run, profiles are read without it and everyone shows as @ID.
let nickMissing = false;
export const nicknamesReady = () => !nickMissing;
const noNickColumn = (e) => e.code === '42703' || e.code === 'PGRST204' || /nickname/i.test(e.message || '');
async function fetchProfiles(filter) {
  if (!nickMissing) {
    try { return await rest(`profiles?select=user_id,handle,nickname&${filter}`); } catch (e) {
      if (!noNickColumn(e)) throw e;
      nickMissing = true;
    }
  }
  return rest(`profiles?select=user_id,handle&${filter}`);
}
function remember(rows) {
  data.nicks ||= {};
  rows.forEach((r) => {
    data.handles[r.user_id] = r.handle;
    if (r.nickname) data.nicks[r.user_id] = r.nickname; else delete data.nicks[r.user_id];
  });
}
/** Load (or refresh) names for these users; chat and film mode use it too. */
export async function loadProfiles(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length || !socialEnabled()) return;
  remember(await fetchProfiles(`user_id=in.(${list.join(',')})`));
  writeCache();
}

async function load() {
  const uid = me();
  if (data.uid !== uid) data = blank(uid);
  const [profile, friendships, shares, checks] = await Promise.all([
    fetchProfiles(`user_id=eq.${uid}`),
    rest('friendships?select=id,requester,addressee,status,created_at'),
    rest('shares?select=id,owner,friend,kind,item_id,data,created_at'),
    rest('share_checks?select=share_id,todo_id,day,done,by_user,updated_at'),
  ]);
  data.me = profile[0]?.handle || null;
  data.myNick = profile[0]?.nickname || '';
  data.friendships = friendships;
  data.shares = shares;
  data.checks = checks;
  const others = new Set();
  friendships.forEach((f) => { others.add(f.requester); others.add(f.addressee); });
  shares.forEach((s) => { others.add(s.owner); others.add(s.friend); });
  others.delete(uid);
  if (others.size) {
    remember(await fetchProfiles(`user_id=in.(${[...others].join(',')})`));
  }
  if (data.me) remember([{ user_id: uid, handle: data.me, nickname: data.myNick }]);
  for (const k of Object.keys(pending)) delete pending[k];
}

/** Load friends, shares and check-offs; apply friends' check-offs; publish my shares. */
export function refreshSocial() {
  if (!socialEnabled()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    status = status === 'ready' ? 'ready' : 'loading';
    try {
      await load();
      await applyFriendChecks();
      await publishShares();
      status = 'ready';
    } catch (e) {
      status = isMissing(e) ? 'missing' : navigator.onLine ? 'error' : status;
    }
    writeCache();
    notify();
  })().finally(() => { running = null; });
  return running;
}

/* ---------- Profile & friends ---------- */

export const normalizeHandle = (text) => text.trim().replace(/^@/, '').toLowerCase();

/** Set or change my ID. Throws with a plain message if it's invalid or taken. */
export async function setHandle(text) {
  const handle = normalizeHandle(text);
  if (!HANDLE_RE.test(handle)) throw new Error('Use 3–20 letters, numbers, _ or .');
  try {
    if (data.me) await rest(`profiles?user_id=eq.${me()}`, { method: 'PATCH', body: { handle } });
    else await rest('profiles', { method: 'POST', body: { handle } });
  } catch (e) {
    if (e.code === '23505' || e.status === 409) throw new Error(`@${handle} is taken. Try another.`);
    throw e;
  }
  data.me = handle;
  data.handles[me()] = handle;
  writeCache();
  notify();
}

/** Set my nickname (what everyone sees). Needs an ID first (the profile row). */
export async function setNickname(text) {
  const nickname = text.trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!data.me) throw new Error('Choose your ID first.');
  try {
    await rest(`profiles?user_id=eq.${me()}`, { method: 'PATCH', body: { nickname: nickname || null } });
  } catch (e) {
    if (noNickColumn(e)) { nickMissing = true; throw new Error('Nicknames aren’t set up yet (one Supabase step).'); }
    throw e;
  }
  data.myNick = nickname;
  remember([{ user_id: me(), handle: data.me, nickname }]);
  writeCache();
  notify();
}

/** Send a friend request by ID (or accept theirs if they already asked). */
export async function addFriend(text) {
  const handle = normalizeHandle(text);
  if (!data.me) throw new Error('Choose your own ID first.');
  if (!HANDLE_RE.test(handle)) throw new Error('That isn’t a valid ID.');
  if (handle === data.me) throw new Error('That’s your own ID.');
  const [found] = await fetchProfiles(`handle=eq.${encodeURIComponent(handle)}`);
  if (!found) throw new Error(`No one has the ID @${handle}.`);
  const existing = friends().find((f) => f.id === found.user_id);
  if (existing?.state === 'friend') throw new Error(`You’re already friends with @${handle}.`);
  if (existing?.state === 'sent') throw new Error(`You already asked @${handle}.`);
  remember([found]);
  if (existing?.state === 'received') return acceptFriend(existing.rowId);
  await rest('friendships', { method: 'POST', body: { addressee: found.user_id } });
  await refreshSocial();
  return 'sent';
}

export async function acceptFriend(rowId) {
  await rest(`friendships?id=eq.${rowId}`, { method: 'PATCH', body: { status: 'accepted' } });
  await refreshSocial();
  return 'accepted';
}

/** Decline a request, cancel mine, or unfriend. Stops sharing with them too. */
export async function removeFriend(rowId) {
  const f = friends().find((x) => x.rowId === rowId);
  await rest(`friendships?id=eq.${rowId}`, { method: 'DELETE' });
  if (f) {
    let changed = false;
    for (const item of [...state.todos, ...state.events, ...state.categories]) {
      if (item.sharedWith?.includes(f.id)) { item.sharedWith = item.sharedWith.filter((id) => id !== f.id); changed = true; }
    }
    if (changed) save({ personal: true });
  }
  await refreshSocial();
}

/* ---------- Publishing my shares ---------- */

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== '' && o[k] !== null).map((k) => [k, o[k]]));
const TODO_KEYS = ['id', 'title', 'date', 'repeat', 'until', 'done', 'doneOn', 'skipOn', 'important', 'due', 'notes'];
const EVENT_KEYS = ['id', 'title', 'date', 'allDay', 'start', 'end', 'repeat', 'until', 'important', 'notes'];

function folderTodos(catId, path) {
  const own = state.todos.filter((t) => t.category === catId).map((t) => ({ ...pick(t, TODO_KEYS), folder: path }));
  return [...own, ...state.categories.filter((c) => (c.parent || null) === catId).flatMap((c) => folderTodos(c.id, `${path} / ${c.name}`))];
}

function snapshot(kind, item) {
  if (kind === 'todo') return pick(item, TODO_KEYS);
  if (kind === 'event') return pick(item, EVENT_KEYS);
  return { name: item.name, color: item.color || null, todos: folderTodos(item.id, item.name) };
}

// JSON with sorted keys, so a copy that came back from the database compares equal.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

async function publishShares() {
  if (inFilm()) return; // film mode shows project lists; personal shares wait until it ends
  const uid = me();
  const ok = new Set(acceptedFriends().map((f) => f.id));
  const want = new Map();
  const add = (kind, item) => (item.sharedWith || []).filter((id) => ok.has(id)).forEach((friend) => {
    want.set(`${friend}|${kind}|${item.id}`, { friend, kind, item_id: item.id, data: snapshot(kind, item) });
  });
  state.todos.forEach((t) => add('todo', t));
  state.events.forEach((e) => add('event', e));
  state.categories.forEach((c) => add('folder', c));

  const mine = data.shares.filter((s) => s.owner === uid);
  const have = new Map(mine.map((s) => [`${s.friend}|${s.kind}|${s.item_id}`, s]));
  const upserts = [...want.entries()].filter(([k, row]) => !have.has(k) || stable(have.get(k).data) !== stable(row.data)).map(([, row]) => row);
  const stale = mine.filter((s) => !want.has(`${s.friend}|${s.kind}|${s.item_id}`));

  if (upserts.length) {
    const now = new Date().toISOString();
    await rest('shares?on_conflict=owner,friend,kind,item_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: upserts.map((r) => ({ ...r, updated_at: now })),
    });
  }
  if (stale.length) await rest(`shares?id=in.(${stale.map((s) => s.id).join(',')})`, { method: 'DELETE' });
  if (upserts.length || stale.length) {
    data.shares = await rest('shares?select=id,owner,friend,kind,item_id,data,created_at');
  }
}

// After a local edit, re-publish shared copies shortly after (batched).
onChange(() => {
  if (!socialEnabled() || status !== 'ready') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (running) return;
    running = publishShares().catch(() => {}).finally(() => { running = null; writeCache(); });
  }, 2000);
});

/* ---------- Friends checking off my shared to-dos ---------- */

function sharedTodoIds(share) {
  if (share.kind === 'todo') return new Set([share.item_id]);
  if (share.kind === 'folder') return new Set((share.data.todos || []).map((t) => t.id));
  return new Set();
}

async function applyFriendChecks() {
  const uid = me();
  const myShares = new Map(data.shares.filter((s) => s.owner === uid).map((s) => [s.id, s]));
  const incoming = data.checks.filter((c) => myShares.has(c.share_id) && c.by_user !== uid)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  if (!incoming.length) return;
  let changed = false;
  for (const c of incoming) {
    const share = myShares.get(c.share_id);
    const todo = sharedTodoIds(share).has(c.todo_id) && state.todos.find((t) => t.id === c.todo_id);
    if (!todo) continue;
    if (isRoutine(todo)) {
      todo.doneOn = { ...todo.doneOn };
      if (c.done) todo.doneOn[c.day] = true; else delete todo.doneOn[c.day];
    } else {
      if (c.done && rollsOver(todo)) todo.date = c.day;
      todo.done = c.done;
    }
    changed = true;
    logNote(`check:${c.share_id}:${c.todo_id}:${c.day}:${c.updated_at}`,
      `${nameOf(c.by_user)} ${c.done ? 'checked off' : 'unchecked'} “${todo.title}”`);
  }
  if (changed) save({ personal: true });
  await publishShares(); // so the friend sees the result before their check row goes away
  for (const c of incoming) {
    await rest(`share_checks?share_id=eq.${c.share_id}&todo_id=eq.${encodeURIComponent(c.todo_id)}&day=eq.${c.day}`, { method: 'DELETE' });
  }
  data.checks = data.checks.filter((c) => !incoming.includes(c));
}

/* ---------- Things friends shared with me ---------- */

function inbox() {
  const uid = me();
  return data.shares.filter((s) => s.friend === uid && s.owner !== uid);
}

const checkKey = (shareId, todo, day) => `${shareId}|${todo.id}|${isRoutine(todo) ? day : 'once'}`;

// A shared to-do's done state as I see it: my latest tap, then my unapplied check, then the owner's copy.
function override(shareId, todo, day) {
  const k = checkKey(shareId, todo, day);
  if (pending[k]) return pending[k];
  const mine = data.checks.filter((c) => c.share_id === shareId && c.todo_id === todo.id && c.by_user === me()
    && (!isRoutine(todo) || c.day === day)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return mine ? { done: mine.done, day: mine.day } : null;
}

export function sharedTodos() {
  if (inFilm()) return []; // friends' shared items belong to the personal planner
  return inbox().flatMap((s) => {
    const list = s.kind === 'todo' ? [s.data] : s.kind === 'folder' ? (s.data.todos || []) : [];
    return list.map((t) => ({ ...t, shareId: s.id, owner: s.owner, folder: t.folder || null, shared: true }));
  });
}

export function sharedTodosOn(key) {
  return sharedTodos().map((t) => {
    if (isRoutine(t)) return t;
    const o = override(t.shareId, t, key);
    return o ? { ...t, done: o.done, date: o.done && rollsOver(t) ? o.day : t.date } : t;
  }).filter((t) => (isRoutine(t) ? occursOn(t, key) && !t.skipOn?.[key] : rollsOver(t) ? todoDate(t) === key : t.date === key));
}

export const sharedEventsOn = (key) => (inFilm() ? [] : inbox()).filter((s) => s.kind === 'event')
  .map((s) => ({ ...s.data, shareId: s.id, owner: s.owner, shared: true }))
  .filter((e) => occursOn(e, key));

export function isSharedDone(t, key) {
  if (!isRoutine(t)) return !!t.done;
  const o = override(t.shareId, t, key);
  return o ? o.done : !!t.doneOn?.[key];
}

/** Check a shared to-do off (or back on). Shows at once; the owner's app applies it. */
export async function toggleShared(t, key) {
  const done = !isSharedDone(t, key);
  pending[checkKey(t.shareId, t, key)] = { done, day: key };
  notify();
  try {
    await rest('share_checks?on_conflict=share_id,todo_id,day', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { share_id: t.shareId, todo_id: t.id, day: key, done, updated_at: new Date().toISOString() },
    });
  } catch {
    delete pending[checkKey(t.shareId, t, key)];
    notify();
    throw new Error('Couldn’t reach your friend’s planner. Check your connection.');
  }
}

/* ---------- Notifications (bell) ---------- */

function logNote(key, text) {
  if (data.log.some((n) => n.key === key)) return;
  data.log = [{ key, text, at: new Date().toISOString() }, ...data.log].slice(0, 40);
}

// Other features (film projects) can add their own bell items.
const noteSources = [];
export const addNoteSource = (fn) => noteSources.push(fn);
export const notifySocial = () => notify();

export function notifications() {
  const uid = me();
  const list = [];
  for (const f of data.friendships) {
    if (f.status === 'pending' && f.addressee === uid) {
      list.push({ key: `req:${f.id}`, kind: 'request', rowId: f.id, text: `${nameOf(f.requester)} wants to be friends`, at: f.created_at });
    } else if (f.status === 'accepted' && f.requester === uid) {
      list.push({ key: `acc:${f.id}`, text: `${nameOf(f.addressee)} accepted your friend request`, at: f.created_at });
    } else if (f.status === 'accepted') {
      list.push({ key: `new:${f.id}`, text: `You and ${nameOf(f.requester)} are now friends`, at: f.created_at });
    }
  }
  for (const s of inbox()) {
    const what = s.kind === 'folder' ? `the folder “${s.data.name}”` : `“${s.data.title}”`;
    list.push({ key: `share:${s.id}`, text: `${nameOf(s.owner)} shared ${what} with you`, at: s.created_at });
  }
  list.push(...data.log);
  noteSources.forEach((fn) => list.push(...fn()));
  return list.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export const unseenCount = () => notifications().filter((n) => !data.seen[n.key] || n.kind === 'request').length;

export function markSeen() {
  for (const n of notifications()) data.seen[n.key] = true;
  writeCache();
  notify();
}

/* ---------- Session ---------- */

onCloudChange(() => {
  const uid = currentUser()?.id || null;
  if (uid === data.uid) return;
  if (!uid) localStorage.removeItem(CACHE_KEY); // signed out: forget friends and shared items
  data = blank(uid);
  status = 'idle';
  notify();
  if (uid) refreshSocial();
});
