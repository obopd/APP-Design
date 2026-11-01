// Chat data: personal (direct) and group chats with friends (tables + RLS in supabase/chat.sql).
// Messages are cached per chat in localStorage `planner.chat` (per user, cleared on
// sign-out). Updates come by polling: only messages newer than the newest one we have
// are downloaded, so checking often stays cheap.
import { api, currentUser, isConfigured, onCloudChange } from './cloud.js';
import { loadProfiles, displayName, handleOf as idOf } from './social.js';

const KEY = 'planner.chat';
const KEEP = 200; // messages kept per chat on the phone (older ones load on request)
export const MAX_LEN = 1000;

let data = read();
let status = 'idle'; // idle | ready | missing (tables not created) | error
let running = null;
const listeners = new Set();

function blank(uid = null) {
  return { uid, chats: {}, members: {}, lastRead: {}, msgs: {}, handles: {} };
}
function read() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.uid && c.uid === currentUser()?.id) return { ...blank(), ...c };
  } catch { /* ignore */ }
  return blank(currentUser()?.id || null);
}
function write() {
  if (!data.uid) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full: keep in memory */ }
}
function notify() { listeners.forEach((fn) => fn()); }

export const onChatChange = (fn) => listeners.add(fn);
export const chatEnabled = () => isConfigured() && !!currentUser();
export const chatStatus = () => status;
const me = () => currentUser()?.id;
export const myId = me;
export const handleOf = idOf;
export const nameOf = (id) => displayName(id, 'Someone'); // nickname, else @ID

const rest = (path, opts = {}) => api(`/rest/v1/${path}`, { auth: true, ...opts });
const isMissing = (e) => e.status === 404 || e.code === 'PGRST205' || e.code === '42P01';

/* ---------- Reading ---------- */

export const getChat = (id) => data.chats[id] || null;
export const membersOf = (id) => data.members[id] || [];
export const messagesOf = (id) => data.msgs[id] || [];

export function chatTitle(chat) {
  if (!chat) return '';
  if (chat.kind === 'group') return chat.name || 'Group';
  const other = membersOf(chat.id).find((u) => u !== me());
  return other ? nameOf(other) : 'Just you';
}

export function unreadIn(id) {
  const last = data.lastRead[id] || 0;
  return messagesOf(id).filter((m) => m.id > last && m.sender !== me() && !m.pending).length;
}
export const unreadTotal = () => Object.keys(data.chats).reduce((n, id) => n + unreadIn(id), 0);

/** Chats, most recent first: { chat, title, last, unread }. */
export function chatList() {
  return Object.values(data.chats).map((chat) => {
    const list = messagesOf(chat.id);
    const last = list[list.length - 1] || null;
    return { chat, title: chatTitle(chat), last, unread: unreadIn(chat.id), at: last?.created_at || chat.last_at || chat.created_at };
  }).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

const merge = (chatId, rows) => {
  const byId = new Map(messagesOf(chatId).filter((m) => !m.pending).map((m) => [m.id, m]));
  rows.forEach((m) => byId.set(m.id, m));
  const pending = messagesOf(chatId).filter((m) => m.pending);
  data.msgs[chatId] = [...[...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP), ...pending];
};
const maxId = () => Math.max(0, ...Object.values(data.msgs).flat().filter((m) => !m.pending).map((m) => m.id));
const MSG_COLS = 'id,chat_id,sender,body,created_at';

/** Reload my chats and members, and download new messages. */
export function refreshChats() {
  if (!chatEnabled()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    try {
      const uid = me();
      if (data.uid !== uid) data = blank(uid);
      const mine = await rest(`chat_members?select=chat_id,last_read&user_id=eq.${uid}`);
      const ids = mine.map((m) => m.chat_id);
      const since = maxId();
      if (!ids.length) {
        Object.assign(data, { chats: {}, members: {}, lastRead: {}, msgs: {} });
      } else {
        const [chats, members] = await Promise.all([
          rest(`chats?select=id,kind,name,created_by,created_at,last_at&id=in.(${ids.join(',')})`),
          rest(`chat_members?select=chat_id,user_id&chat_id=in.(${ids.join(',')})`),
        ]);
        data.chats = Object.fromEntries(chats.map((c) => [c.id, c]));
        data.members = {};
        members.forEach((m) => { (data.members[m.chat_id] ||= []).push(m.user_id); });
        mine.forEach((m) => { data.lastRead[m.chat_id] = Math.max(data.lastRead[m.chat_id] || 0, m.last_read); });
        for (const id of Object.keys(data.msgs)) if (!data.chats[id]) delete data.msgs[id];
        // Chats new to this phone: their latest 50 messages.
        for (const id of ids.filter((x) => !data.msgs[x])) {
          const rows = await rest(`messages?select=${MSG_COLS}&chat_id=eq.${id}&order=id.desc&limit=50`);
          data.msgs[id] = [];
          merge(id, rows);
        }
        await fetchNew(since);
        // Everyone in my chats (names can change, so refresh them all).
        await loadProfiles(members.map((m) => m.user_id)).catch(() => {});
      }
      status = 'ready';
    } catch (e) {
      status = isMissing(e) ? 'missing' : 'error';
    }
    write();
    notify();
  })().finally(() => { running = null; });
  return running;
}

// Everything newer than `since` across all my chats (row-level security limits it to mine).
async function fetchNew(since) {
  for (let after = since; ;) {
    const rows = await rest(`messages?select=${MSG_COLS}&id=gt.${after}&order=id.asc&limit=500`);
    const byChat = {};
    rows.forEach((m) => { (byChat[m.chat_id] ||= []).push(m); });
    Object.entries(byChat).forEach(([id, list]) => { if (data.chats[id] || data.msgs[id]) merge(id, list); });
    if (rows.length < 500) return;
    after = rows[rows.length - 1].id;
  }
}

/** While a chat is open: new messages, and drop ones their sender deleted. */
export async function pollChat(chatId) {
  if (!chatEnabled() || running) return;
  try {
    await fetchNew(maxId());
    const kept = messagesOf(chatId).filter((m) => !m.pending);
    if (kept.length) {
      const rows = await rest(`messages?select=id&chat_id=eq.${chatId}&id=gte.${kept[0].id}`);
      const alive = new Set(rows.map((r) => r.id));
      data.msgs[chatId] = messagesOf(chatId).filter((m) => m.pending || alive.has(m.id));
    }
    write();
    notify();
  } catch { /* try again next time */ }
}

export async function loadEarlier(chatId) {
  const first = messagesOf(chatId).find((m) => !m.pending);
  if (!first) return 0;
  const rows = await rest(`messages?select=${MSG_COLS}&chat_id=eq.${chatId}&id=lt.${first.id}&order=id.desc&limit=50`);
  const byId = new Map(messagesOf(chatId).map((m) => [m.id, m]));
  rows.forEach((m) => byId.set(m.id, m));
  const sent = [...byId.values()].filter((m) => !m.pending).sort((a, b) => a.id - b.id);
  data.msgs[chatId] = [...sent, ...messagesOf(chatId).filter((m) => m.pending)];
  notify();
  return rows.length;
}

/* ---------- Writing ---------- */

let tempId = 0;

/** Sends a message; it shows at once and is marked if sending fails. */
export async function sendMessage(chatId, text) {
  const body = text.trim().slice(0, MAX_LEN);
  if (!body) return;
  const temp = { id: `t${++tempId}`, chat_id: chatId, sender: me(), body, created_at: new Date().toISOString(), pending: true };
  data.msgs[chatId] = [...messagesOf(chatId), temp];
  notify();
  try {
    const [row] = await rest('messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { chat_id: chatId, body } });
    data.msgs[chatId] = messagesOf(chatId).filter((m) => m !== temp);
    merge(chatId, [row]);
    data.lastRead[chatId] = Math.max(data.lastRead[chatId] || 0, row.id);
  } catch {
    temp.failed = true;
  }
  write();
  notify();
}

export function retryMessage(chatId, msg) {
  data.msgs[chatId] = messagesOf(chatId).filter((m) => m !== msg);
  return sendMessage(chatId, msg.body);
}

export async function deleteMessage(chatId, msg) {
  if (msg.pending) { data.msgs[chatId] = messagesOf(chatId).filter((m) => m !== msg); notify(); return; }
  await rest(`messages?id=eq.${msg.id}`, { method: 'DELETE' });
  data.msgs[chatId] = messagesOf(chatId).filter((m) => m.id !== msg.id);
  write();
  notify();
}

/** Remember that I've seen everything in this chat. */
export async function markRead(chatId) {
  const last = Math.max(0, ...messagesOf(chatId).filter((m) => !m.pending).map((m) => m.id));
  if (last <= (data.lastRead[chatId] || 0)) return;
  data.lastRead[chatId] = last;
  write();
  notify();
  try {
    await rest(`chat_members?chat_id=eq.${chatId}&user_id=eq.${me()}`, { method: 'PATCH', body: { last_read: last } });
  } catch { /* the badge is already cleared here; the server catches up next time */ }
}

async function createChat(kind, name, friendIds) {
  const [chat] = await rest('chats', { method: 'POST', headers: { Prefer: 'return=representation' }, body: kind === 'group' ? { kind, name } : { kind } });
  await rest('chat_members', { method: 'POST', body: [me(), ...friendIds].map((user_id) => ({ chat_id: chat.id, user_id })) });
  await refreshChats();
  return chat.id;
}

/** The personal chat with a friend (made the first time). */
export async function openDirect(friendId) {
  const existing = Object.values(data.chats).find((c) => c.kind === 'direct'
    && membersOf(c.id).length === 2 && membersOf(c.id).includes(friendId));
  if (existing) return existing.id;
  return createChat('direct', null, [friendId]);
}

export const createGroup = (name, friendIds) => createChat('group', name.trim().slice(0, 60) || 'Group', friendIds);

export async function renameGroup(chatId, name) {
  const clean = name.trim().slice(0, 60);
  if (!clean) return;
  await rest(`chats?id=eq.${chatId}`, { method: 'PATCH', body: { name: clean } });
  data.chats[chatId] = { ...data.chats[chatId], name: clean };
  write();
  notify();
}

export async function addMembers(chatId, ids) {
  if (!ids.length) return;
  await rest('chat_members', { method: 'POST', body: ids.map((user_id) => ({ chat_id: chatId, user_id })) });
  await refreshChats();
}

export async function removeMember(chatId, userId) {
  await rest(`chat_members?chat_id=eq.${chatId}&user_id=eq.${userId}`, { method: 'DELETE' });
  await refreshChats();
}

/** Leave a group, or remove a personal chat from my list. */
export async function leaveChat(chatId) {
  await rest(`chat_members?chat_id=eq.${chatId}&user_id=eq.${me()}`, { method: 'DELETE' });
  delete data.chats[chatId];
  delete data.msgs[chatId];
  write();
  notify();
  refreshChats();
}

/* ---------- Session ---------- */

onCloudChange(() => {
  const uid = currentUser()?.id || null;
  if (uid === data.uid) return;
  if (!uid) localStorage.removeItem(KEY); // signed out: forget chats on this phone
  data = blank(uid);
  status = 'idle';
  notify();
  if (uid) refreshChats();
});
