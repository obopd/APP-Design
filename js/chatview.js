// Chat tab UI: the list of chats and a conversation (bubbles + composer).
import { h, icon, ICONS, fmt, todayKey, dateKey } from './util.js';
import { ask, tell, askText, openLayer } from './ui.js';
import {
  chatEnabled, chatStatus, chatList, getChat, chatTitle, membersOf, messagesOf, unreadIn, myId, nameOf,
  refreshChats, pollChat, loadEarlier, sendMessage, retryMessage, deleteMessage, markRead,
  openDirect, createGroup, renameGroup, addMembers, removeMember, leaveChat, MAX_LEN,
} from './chat.js';
import { acceptedFriends, myHandle } from './social.js';
import { pickFriends, chooseHandle, askAddFriend } from './people.js';
import { filmOn, currentProject } from './film.js';

let openId = null;  // the open conversation, or null for the list
let conv = null;    // { id, root, list, input } of the conversation on screen
let shown = false;
let pollTimer = 0;
const drafts = {};  // unsent text per chat

/* ---------- Polling (only while the Chat tab is on screen) ---------- */

export function chatShown(on) {
  if (on === shown) return;
  shown = on;
  clearInterval(pollTimer);
  if (!on) { document.body.classList.remove('chatting'); return; }
  refreshChats();
  // An open chat checks every 3s (new messages only); the list every 10s.
  let tick = 0;
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    tick += 1;
    if (openId) pollChat(openId);
    else if (tick % 3 === 0) refreshChats();
  }, 3000);
}

/* ---------- Helpers ---------- */

const timeOf = (iso) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
function whenLabel(iso) {
  const d = new Date(iso);
  const key = dateKey(d);
  if (key === todayKey()) return timeOf(iso);
  const days = (Date.now() - d.getTime()) / 864e5;
  return days < 6 ? fmt({ weekday: 'short' }).format(d) : fmt({ month: 'short', day: 'numeric' }).format(d);
}
const dayLabel = (iso) => {
  const d = new Date(iso);
  return dateKey(d) === todayKey() ? 'Today' : fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(d);
};

function avatar(chat, title) {
  if (chat.kind === 'group') return h('span', { class: 'chat-avatar group' }, icon(ICONS.people));
  return h('span', { class: 'chat-avatar' }, (title.replace('@', '')[0] || '?').toUpperCase());
}

/* ---------- List ---------- */

function emptyState() {
  if (chatStatus() === 'missing') return h('p', { class: 'set-note chat-empty' }, 'Chat isn’t set up yet.');
  if (!myHandle()) {
    return h('div', { class: 'chat-empty' },
      h('p', { class: 'set-note' }, 'Choose an ID so friends can find you.'),
      h('button', { class: 'pill', onclick: chooseHandle }, 'Choose ID'));
  }
  if (!acceptedFriends().length) {
    return h('div', { class: 'chat-empty' },
      h('p', { class: 'set-note' }, 'Add a friend to start chatting.'),
      h('button', { class: 'pill', onclick: askAddFriend }, 'Add friend'));
  }
  return h('p', { class: 'set-note chat-empty' }, 'Tap + to start a chat.');
}

function listView(root) {
  conv = null;
  document.body.classList.remove('chatting');
  const items = chatList();
  root.replaceChildren(h('div', { class: 'settings chat-page' },
    h('div', { class: 'page-head' },
      h('h1', { class: 'display' }, 'Chat'),
      chatStatus() === 'missing' ? null : h('button', { class: 'icon-btn page-add', 'aria-label': 'New chat', onclick: newChat }, icon(ICONS.plus))),
    items.length ? h('ul', { class: 'chat-list' }, items.map(({ chat, title, last, unread }) => h('li', {},
      h('button', { class: 'chat-row', onclick: () => openChat(chat.id) },
        avatar(chat, title),
        h('span', { class: 'chat-main' },
          h('span', { class: 'chat-name' }, title, chat.kind === 'group' ? h('span', { class: 'chat-size' }, String(membersOf(chat.id).length)) : null),
          h('span', { class: 'chat-preview' }, last ? `${chat.kind === 'group' && last.sender !== myId() ? `${nameOf(last.sender)}: ` : ''}${last.body}` : 'No messages yet')),
        h('span', { class: 'chat-meta' },
          last ? h('span', { class: 'chat-time' }, whenLabel(last.created_at)) : null,
          unread ? h('span', { class: 'chat-unread' }, unread > 99 ? '99+' : String(unread)) : null))))) : emptyState()));
}

// "+": a friend (personal chat) or a new group.
function newChat() {
  if (!myHandle()) { chooseHandle(); return; }
  const friends = acceptedFriends();
  if (!friends.length) { askAddFriend(); return; }
  let layer;
  const go = async (fn) => { layer.close(); try { await fn(); } catch (e) { tell('Couldn’t start the chat', e.message); } };
  layer = openLayer('ask', h('div', { class: 'ask-card' },
    h('p', { class: 'ask-title display' }, 'New chat'),
    h('div', { class: 'friend-pick' },
      h('button', { type: 'button', class: 'menu-item new-group', onclick: () => go(startGroup) },
        h('span', { class: 'menu-check' }, icon(ICONS.people)), h('span', {}, 'New group')),
      friends.map((f) => h('button', { type: 'button', class: 'menu-item', onclick: () => go(async () => openChat(await openDirect(f.id))) },
        h('span', { class: 'menu-check' }), h('span', {}, `@${f.handle}`)))),
    h('div', { class: 'ask-actions' },
      h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => layer.close() }, 'Cancel'))),
  { onBackdrop: () => layer.close() });
}

async function startGroup() {
  const ids = await pickFriends([], { title: 'New group', message: 'Choose who’s in it.', ok: 'Next' });
  if (!ids || !ids.length) return;
  const name = await askText({ title: 'Group name', placeholder: 'e.g. Film crew', ok: 'Create' });
  if (name === null) return;
  openChat(await createGroup(name, ids));
}

/* ---------- Conversation ---------- */

export function openChat(id) {
  openId = id;
  rerender();
}

function closeChat() {
  openId = null;
  rerender();
}

let rootEl = null;
const rerender = () => { if (rootEl) renderChat(rootEl); };

function bubbles(id) {
  const me = myId();
  const group = getChat(id)?.kind === 'group';
  const list = messagesOf(id);
  const out = [];
  let prevDay = null;
  list.forEach((m, i) => {
    const day = dateKey(new Date(m.created_at));
    if (day !== prevDay) { out.push(h('li', { class: 'msg-day' }, dayLabel(m.created_at))); prevDay = day; }
    const mine = m.sender === me;
    const prev = list[i - 1];
    const next = list[i + 1];
    const firstOfRun = !prev || prev.sender !== m.sender || dateKey(new Date(prev.created_at)) !== day;
    const lastOfRun = !next || next.sender !== m.sender || (new Date(next.created_at) - new Date(m.created_at)) > 5 * 60e3;
    const bubble = h('div', { class: 'bubble' }, m.body);
    holdToDelete(bubble, id, m, mine);
    out.push(h('li', { class: `msg${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}` },
      group && !mine && firstOfRun ? h('span', { class: 'msg-from' }, nameOf(m.sender)) : null,
      bubble,
      m.failed ? h('button', { class: 'msg-retry', onclick: () => retryMessage(id, m) }, 'Not sent · Retry')
        : lastOfRun ? h('span', { class: 'msg-time' }, m.pending ? 'Sending…' : timeOf(m.created_at)) : null));
  });
  return out;
}

// Press and hold one of my messages to delete it.
function holdToDelete(el, chatId, m, mine) {
  if (!mine) return;
  let timer = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', () => {
    timer = setTimeout(async () => {
      if (await ask({ title: 'Delete this message?', message: 'It’s removed for everyone in the chat.', ok: 'Delete', danger: true })) {
        deleteMessage(chatId, m).catch((e) => tell('Couldn’t delete', e.message));
      }
    }, 500);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((t) => el.addEventListener(t, cancel));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// fixed: film mode's single project chat (no back button; the dock stays).
function convView(root, id, fixed = false) {
  const chat = getChat(id);
  if (!chat) { openId = null; listView(root); return; }
  document.body.classList.toggle('chatting', !fixed);
  const title = chatTitle(chat);

  if (conv?.id === id && conv.fixed === fixed && root.contains(conv.root)) {
    // Same chat: refresh the title and messages only, so typing isn't interrupted.
    conv.titleEl.textContent = title;
    const nearBottom = conv.list.scrollHeight - conv.list.scrollTop - conv.list.clientHeight < 80;
    conv.items.replaceChildren(...bubbles(id));
    if (nearBottom) conv.list.scrollTop = conv.list.scrollHeight;
    if (shown && document.visibilityState === 'visible') markRead(id);
    return;
  }

  const input = h('textarea', {
    class: 'composer-input', rows: '1', maxlength: String(MAX_LEN), placeholder: 'Message', 'aria-label': 'Message', enterkeyhint: 'enter',
  });
  input.value = drafts[id] || '';
  const sendBtn = h('button', { class: 'composer-send', 'aria-label': 'Send', disabled: !input.value.trim() }, icon(ICONS.send));
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener('input', () => { drafts[id] = input.value; sendBtn.disabled = !input.value.trim(); grow(); });
  const send = () => {
    const text = input.value;
    if (!text.trim()) return;
    input.value = ''; drafts[id] = ''; sendBtn.disabled = true; grow();
    sendMessage(id, text).then(() => { conv.list.scrollTop = conv.list.scrollHeight; });
    conv.list.scrollTop = conv.list.scrollHeight;
  };
  // Sending keeps the keyboard up: on a touch, the tap is handled here and its default
  // (which would take focus from the message box and fold the keyboard) is cancelled.
  sendBtn.addEventListener('touchend', (e) => {
    if (sendBtn.disabled) return;
    e.preventDefault();
    send();
    input.focus();
  });
  sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
  sendBtn.addEventListener('click', send);

  const items = h('ul', { class: 'msgs' });
  const earlier = h('button', {
    class: 'link-btn msg-earlier',
    onclick: async () => {
      const before = list.scrollHeight;
      const n = await loadEarlier(id).catch(() => 0);
      if (!n) earlier.hidden = true;
      list.scrollTop = list.scrollHeight - before;
    },
  }, 'Earlier messages');
  earlier.hidden = messagesOf(id).length < 50;
  const list = h('div', { class: 'msg-scroll' }, earlier, items);
  // Swipe down on the messages to fold the keyboard (it otherwise stays up).
  let dragY = null;
  list.addEventListener('touchstart', (e) => { dragY = e.touches[0].clientY; }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (dragY !== null && e.touches[0].clientY - dragY > 40 && document.activeElement === input) { input.blur(); dragY = null; }
  }, { passive: true });
  const titleEl = h('span', { class: 'conv-title display' }, title);
  const convRoot = h('div', { class: 'conv' },
    h('div', { class: 'conv-head' },
      fixed ? h('span') : h('button', { class: 'icon-btn', 'aria-label': 'Back to chats', onclick: closeChat }, icon(ICONS.left)),
      titleEl,
      h('button', { class: 'icon-btn', 'aria-label': 'Chat info', onclick: () => chatInfo(id) }, icon(chat.kind === 'group' ? ICONS.people : ICONS.more))),
    list,
    h('div', { class: 'composer' }, input, sendBtn));
  root.replaceChildren(convRoot);
  conv = { id, root: convRoot, list, items, input, titleEl, fixed };
  items.replaceChildren(...bubbles(id));
  grow();
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  markRead(id);
  pollChat(id);
}

// As the keyboard opens or folds the chat glides to its new height; keep the newest
// messages in view while it does.
if (window.visualViewport) {
  visualViewport.addEventListener('resize', () => {
    const list = conv?.list;
    if (!list || !list.isConnected) return;
    const end = performance.now() + 400;
    const stick = () => { list.scrollTop = list.scrollHeight; if (performance.now() < end) requestAnimationFrame(stick); };
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) stick();
  });
}

/* ---------- Chat info (members, rename, add, leave) ---------- */

function chatInfo(id) {
  const chat = getChat(id);
  if (!chat) return;
  const me = myId();
  const group = chat.kind === 'group';
  const mineGroup = group && chat.created_by === me;
  let layer;
  const run = (fn) => async () => { layer.close(); try { await fn(); } catch (e) { tell('Couldn’t update', e.message); } };
  const members = membersOf(id);
  layer = openLayer('ask', h('div', { class: 'ask-card' },
    h('p', { class: 'ask-title display' }, chatTitle(chat)),
    group ? h('div', { class: 'friend-pick' },
      members.map((u) => h('div', { class: 'menu-item member-row' },
        h('span', { class: 'member-name' }, u === me ? `${nameOf(u)} (you)` : nameOf(u)),
        mineGroup && u !== me ? h('button', {
          class: 'icon-btn', 'aria-label': `Remove ${nameOf(u)}`,
          onclick: run(async () => { if (await ask({ title: `Remove ${nameOf(u)}?`, ok: 'Remove', danger: true })) await removeMember(id, u); }),
        }, icon(ICONS.close)) : null))) : null,
    h('div', { class: 'info-actions' },
      group ? h('button', { type: 'button', class: 'pill', onclick: run(async () => {
        const name = await askText({ title: 'Rename group', value: chat.name || '', ok: 'Save' });
        if (name) await renameGroup(id, name);
      }) }, 'Rename') : null,
      group ? h('button', { type: 'button', class: 'pill', onclick: run(async () => {
        const ids = await pickFriends([], { title: 'Add people', message: 'Friends to add to this group.', ok: 'Add', exclude: members });
        if (ids?.length) await addMembers(id, ids);
      }) }, 'Add people') : null),
    h('div', { class: 'ask-actions' },
      h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => layer.close() }, 'Close'),
      h('button', { type: 'button', class: 'ask-btn primary danger', onclick: run(async () => {
        const ok = await ask(group
          ? { title: 'Leave this group?', message: 'You’ll stop getting its messages.', ok: 'Leave', danger: true }
          : { title: 'Remove this chat?', message: 'It’s removed from your list. Your friend keeps their copy.', ok: 'Remove', danger: true });
        if (!ok) return;
        await leaveChat(id);
        closeChat();
      }) }, group ? 'Leave' : 'Remove'))),
  { onBackdrop: () => layer.close() });
}

/* ---------- Entry ---------- */

export function renderChat(root) {
  rootEl = root;
  if (!chatEnabled()) {
    document.body.classList.remove('chatting');
    root.replaceChildren(h('div', { class: 'settings chat-page' }, h('h1', { class: 'display' }, 'Chat'),
      h('p', { class: 'set-note chat-empty' }, 'Sign in to chat with friends.')));
    return;
  }
  if (filmOn()) { filmChat(root); return; }
  if (filmChatShown) { filmChatShown = false; openId = null; } // back from film mode: the list
  if (openId) convView(root, openId);
  else listView(root);
}

// Film mode: the Chat tab is the project's one group chat.
let filmChatShown = false;
let fetchedFor = null;
function filmChat(root) {
  const p = currentProject();
  const note = (text) => {
    document.body.classList.remove('chatting');
    conv = null;
    root.replaceChildren(h('div', { class: 'settings chat-page' }, h('h1', { class: 'display' }, 'Chat'), h('p', { class: 'set-note chat-empty' }, text)));
  };
  if (!p) { note('Choose or create a project: tap the slate on the Calendar.'); return; }
  if (!p.chat_id) { note('This project has no chat (Chat isn’t set up).'); return; }
  if (!getChat(p.chat_id)) {
    if (fetchedFor !== p.chat_id) { fetchedFor = p.chat_id; refreshChats(); }
    note(chatStatus() === 'missing' ? 'Chat isn’t set up yet.' : 'Loading the project chat…');
    return;
  }
  filmChatShown = true;
  openId = p.chat_id;
  convView(root, p.chat_id, true);
}

export const inConversation = () => !!openId;
export { unreadIn };
