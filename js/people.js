// Friends UI: the bell (notifications) sheet, Profile & Friends in Settings, the
// "Share" row used by the editor and the folder sheet, and the friend picker.
import { h, icon, ICONS } from './util.js';
import { ask, tell, askText, openLayer } from './ui.js';
import { inFilm } from './store.js';
import {
  socialEnabled, socialStatus, myHandle, friends, acceptedFriends, nameOf, notifications, markSeen,
  setHandle, addFriend, acceptFriend, removeFriend, refreshSocial,
} from './social.js';

const sheet = document.getElementById('social-sheet');
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
sheet.addEventListener('close', () => markSeen());

/** Ask for an ID until it's valid and free (or cancelled). */
export async function chooseHandle() {
  let message = '3–20 letters, numbers, _ or . — friends add you with it.';
  let value = myHandle() || '';
  for (;;) {
    const text = await askText({ title: myHandle() ? 'Change your ID' : 'Choose your ID', message, value, placeholder: 'yourname', ok: 'Save' });
    if (text === null) return false;
    try { await setHandle(text); return true; } catch (e) { message = e.message; value = text; }
  }
}

export async function askAddFriend() {
  if (!myHandle() && !await chooseHandle()) return;
  let message = 'Type your friend’s ID. They’ll get a request to accept.';
  let value = '';
  for (;;) {
    const text = await askText({ title: 'Add friend', message, value, placeholder: 'friend_id', ok: 'Send' });
    if (text === null || !text.trim()) return;
    try {
      const result = await addFriend(text);
      tell(result === 'accepted' ? 'You’re now friends.' : 'Request sent.');
      return;
    } catch (e) { message = e.message; value = text; }
  }
}

const removeLabel = { friend: 'Remove friend', sent: 'Cancel request', received: 'Decline' };

async function confirmRemove(f) {
  if (f.state === 'friend' && !await ask({
    title: `Remove @${f.handle}?`, message: 'You’ll stop seeing each other’s shared items.', ok: 'Remove', danger: true,
  })) return;
  try { await removeFriend(f.rowId); } catch (e) { tell('Couldn’t update', e.message); }
}

async function accept(rowId) {
  try { await acceptFriend(rowId); } catch (e) { tell('Couldn’t accept', e.message); }
}

/* ---------- Settings: Profile + Friends ---------- */

export function peopleSection() {
  if (!socialEnabled()) return null;
  if (socialStatus() === 'missing') {
    return h('div', {}, h('div', { class: 'set-row' }, h('span', {}, 'Friends'), h('span', { class: 'status' }, 'Not set up yet')));
  }
  const handle = myHandle();
  const list = friends();
  return h('div', {},
    h('div', { class: 'set-row' },
      h('span', {}, 'ID'),
      h('button', { class: handle ? 'link-btn my-id' : 'pill', onclick: chooseHandle }, handle ? `@${handle}` : 'Choose')),
    h('div', { class: 'set-row' },
      h('span', {}, 'Friends'),
      h('button', { class: 'icon-btn', 'aria-label': 'Add friend', onclick: askAddFriend }, icon(ICONS.plus))),
    list.length ? h('div', { class: 'cat-list friend-list' }, list.map((f) => h('div', { class: 'cat-row' },
      h('span', { class: 'friend-name' }, `@${f.handle}`),
      f.state === 'sent' ? h('span', { class: 'status' }, 'Pending') : null,
      f.state === 'received' ? h('button', { class: 'pill', onclick: () => accept(f.rowId) }, 'Accept') : null,
      h('button', { class: 'icon-btn', 'aria-label': `${removeLabel[f.state]} @${f.handle}`, onclick: () => confirmRemove(f) }, icon(ICONS.close))))) : null);
}

/* ---------- Bell ---------- */

export function openNotifications() {
  const draw = () => {
    const items = notifications();
    sheet.replaceChildren(h('div', { class: 'sheet-body' },
      h('div', { class: 'grabber' }),
      h('div', { class: 'sheet-head' },
        h('h3', { class: 'display' }, 'Notifications'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add friend', onclick: askAddFriend }, icon(ICONS.people)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => sheet.close() }, icon(ICONS.close))),
      myHandle() ? null : h('div', { class: 'note-row' },
        h('span', {}, 'Choose an ID so friends can add you.'),
        h('button', { class: 'pill', onclick: chooseHandle }, 'Choose')),
      items.length
        ? h('ul', { class: 'notes-list' }, items.map((n) => h('li', { class: 'note-row' },
          h('span', {}, n.text),
          n.kind === 'request' ? h('span', { class: 'note-actions' },
            h('button', { class: 'pill', onclick: () => accept(n.rowId) }, 'Accept'),
            h('button', { class: 'icon-btn', 'aria-label': 'Decline', onclick: () => removeFriend(n.rowId).catch(() => {}) }, icon(ICONS.close))) : null)))
        : h('p', { class: 'set-note notes-empty' }, 'Nothing new.')));
  };
  draw();
  sheet.redraw = draw;
  if (!sheet.open) sheet.showModal();
  refreshSocial();
}

/** Keeps an open notifications sheet current (called on every social change). */
export function redrawNotifications() {
  if (sheet.open && sheet.redraw) sheet.redraw();
}

/* ---------- Sharing ---------- */

/** Multi-select card of friends. Resolves the chosen user ids, or null when cancelled. */
export function pickFriends(selected = [], {
  title = 'Share with', message = 'Friends can see it and check it off. Only you can edit it.', ok = 'Done', exclude = [],
} = {}) {
  return new Promise((resolve) => {
    const chosen = new Set(selected);
    let layer;
    const done = (v) => { layer.close(); resolve(v); };
    const rows = acceptedFriends().filter((f) => !exclude.includes(f.id)).map((f) => {
      const btn = h('button', {
        type: 'button', class: 'menu-item', role: 'checkbox', 'aria-checked': String(chosen.has(f.id)),
        onclick: () => {
          if (chosen.has(f.id)) chosen.delete(f.id); else chosen.add(f.id);
          btn.setAttribute('aria-checked', String(chosen.has(f.id)));
          btn.querySelector('.menu-check').replaceChildren(...(chosen.has(f.id) ? [icon(ICONS.check)] : []));
        },
      }, h('span', { class: 'menu-check' }, chosen.has(f.id) ? icon(ICONS.check) : null), h('span', {}, `@${f.handle}`));
      return btn;
    });
    layer = openLayer('ask', h('div', { class: 'ask-card' },
      h('p', { class: 'ask-title display' }, title),
      h('p', { class: 'ask-message' }, rows.length ? message : 'All your friends are already in.'),
      h('div', { class: 'friend-pick' }, rows),
      h('div', { class: 'ask-actions' },
        h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: () => done(null) }, 'Cancel'),
        h('button', { type: 'button', class: 'ask-btn primary', onclick: () => done([...chosen]) }, ok))),
    { onBackdrop: () => done(null) });
  });
}

const shareLabel = (ids) => {
  const names = ids.map((id) => nameOf(id));
  return !ids.length ? 'Off' : ids.length === 1 ? names[0] : `${ids.length} friends`;
};

/**
 * "Share" row for the editor / folder sheet. Returns { el, value() } or null when
 * friends aren't available. Only friends still on the list are kept.
 */
export function shareField(initial = []) {
  if (!socialEnabled() || socialStatus() === 'missing' || inFilm()) return null; // film projects share via collaborators
  // Keep ids as they are until changed here, so a friend list that hasn't loaded yet
  // (offline) can't silently un-share anything; only current friends are counted.
  let ids = [...initial];
  const shown = () => { const ok = new Set(acceptedFriends().map((f) => f.id)); return ids.filter((id) => ok.has(id)); };
  const label = h('span', { class: 'select-label' }, shareLabel(shown()));
  const btn = h('button', {
    type: 'button', class: 'select-btn',
    onclick: async () => {
      if (!acceptedFriends().length) { tell('No friends yet', 'Add friends in Settings → Friends, or with the bell on the calendar.'); return; }
      const next = await pickFriends(ids);
      if (next) { ids = next; label.textContent = shareLabel(shown()); }
    },
  }, icon(ICONS.people), label);
  return { el: h('div', { class: 'field' }, h('span', {}, 'Share'), btn), value: () => ids };
}
