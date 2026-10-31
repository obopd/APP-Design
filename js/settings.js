// Settings tab: appearance (light/dark, accent color), folders, alerts and backup.
import { h, icon, ICONS } from './util.js';
import { state, save, replaceAll, categoryTree, deleteCategory } from './store.js';
import { openFolderSheet } from './folders.js';
import { ask, tell } from './ui.js';
import { isConfigured, currentUser, syncStatus, syncNow, signOut, hasUnsyncedChanges } from './cloud.js';
import { notificationsSupported, requestNotifications } from './reminders.js';

const media = matchMedia('(prefers-color-scheme: dark)');

export const ACCENTS = [
  ['mono', 'Black & white'],
  ['blue', 'Blue'],
  ['red', 'Red'],
  ['green', 'Green'],
  ['orange', 'Orange'],
  ['purple', 'Purple'],
];
const SWATCH = { blue: '#2563eb', red: '#e11d48', green: '#16a34a', orange: '#ea580c', purple: '#7c3aed' };

export function applyTheme() {
  const { theme, accent } = state.settings;
  const dark = theme === 'dark' || (theme === 'auto' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = accent;
  document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#ffffff';
}
media.addEventListener('change', applyTheme);

function alertsControl(rerender) {
  if (!notificationsSupported()) return h('span', { class: 'status' }, 'Add to Home Screen');
  if (Notification.permission === 'granted') return h('span', { class: 'status' }, 'On');
  if (Notification.permission === 'denied') return h('span', { class: 'status' }, 'Off in iPhone Settings');
  return h('button', { class: 'pill', onclick: async () => { await requestNotifications(); rerender(); } }, 'Turn on');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `kairos-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!await ask({ title: 'Restore this backup?', message: 'It replaces everything currently in your planner.', ok: 'Restore', danger: true })) return;
      replaceAll(data);
      applyTheme();
    } catch {
      tell('That file isn’t a Kairos backup.');
    }
  });
  input.click();
}

function syncLabel() {
  const { state: st, at, error } = syncStatus();
  if (st === 'syncing') return 'Syncing…';
  if (st === 'offline') return 'Offline · will sync later';
  if (st === 'error') return `Sync failed · ${error}`;
  if (!at) return 'Signed in';
  const mins = Math.round((Date.now() - at) / 60000);
  return `Synced ${mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}`;
}

// Sign out: save to the account first; the planner is then cleared from this phone.
async function confirmSignOut() {
  await syncNow();
  const ok = hasUnsyncedChanges()
    ? await ask({
      title: 'Sign out anyway?',
      message: 'Some changes haven’t reached your account yet (no connection). They’ll be lost if you sign out now.',
      ok: 'Sign out', danger: true,
    })
    : await ask({
      title: 'Sign out?',
      message: 'Your planner is saved in your account and leaves this phone until you sign in again.',
      ok: 'Sign out',
    });
  if (ok) await signOut();
}

// Account: email/password login (required when accounts are set up) that backs up and syncs.
function accountSection() {
  const user = currentUser();
  if (!isConfigured() || !user) {
    return h('div', {}, h('div', { class: 'set-row' }, h('span', {}, 'Account'), h('span', { class: 'status' }, 'Not set up yet')));
  }
  return h('div', {},
    h('div', { class: 'set-row' },
      h('span', { class: 'account-email' }, user.email),
      h('button', { class: 'pill', onclick: confirmSignOut }, 'Sign out')),
    h('button', { class: `sync-line ${syncStatus().state}`, onclick: () => syncNow() }, syncLabel()));
}

function foldersSection() {
  const rows = categoryTree().map(({ cat, depth }) => h('div', { class: 'cat-row', style: `padding-left:${depth * 16}px` },
    h('span', { class: 'cat-dot', style: cat.color ? `background:${cat.color}` : null }),
    h('button', { class: 'cat-name', 'aria-label': `Edit ${cat.name}`, onclick: () => openFolderSheet({ cat }) }, cat.name),
    h('button', { class: 'icon-btn', 'aria-label': `Add folder inside ${cat.name}`, onclick: () => openFolderSheet({ parent: cat.id }) }, icon(ICONS.plus)),
    h('button', {
      class: 'icon-btn', 'aria-label': `Delete ${cat.name}`,
      onclick: async () => {
        if (await ask({ title: `Delete folder “${cat.name}”?`, message: 'Its to-dos move up a level.', ok: 'Delete', danger: true })) deleteCategory(cat.id);
      },
    }, icon(ICONS.trash))));

  return h('div', {},
    h('div', { class: 'set-row' }, h('span', {}, 'Folders'), h('button', { class: 'pill', onclick: () => openFolderSheet() }, 'New')),
    rows.length ? h('div', { class: 'cat-list' }, rows) : null);
}

export function renderSettings(root) {
  const rerender = () => renderSettings(root);
  const set = (k, v) => { state.settings[k] = v; save(); applyTheme(); rerender(); };

  const theme = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
    [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => h('button', {
      role: 'radio', 'aria-checked': String(state.settings.theme === v), onclick: () => set('theme', v),
    }, label)));

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' },
    ACCENTS.map(([v, label]) => h('button', {
      role: 'radio', class: `swatch ${v}`, 'aria-label': label,
      'aria-checked': String(state.settings.accent === v),
      style: SWATCH[v] ? `background:${SWATCH[v]}` : null,
      onclick: () => set('accent', v),
    })));

  root.replaceChildren(h('div', { class: 'settings' },
    h('h1', { class: 'display' }, 'Settings'),
    accountSection(),
    h('div', {},
      h('div', { class: 'set-row' }, h('span', {}, 'Theme'), theme),
      h('div', { class: 'set-row' }, h('span', {}, 'Color'), swatches)),
    h('div', {},
      h('div', { class: 'set-row' }, h('span', {}, 'Haptics'),
        h('input', {
          type: 'checkbox', class: 'switch', 'aria-label': 'Haptics', checked: state.settings.haptics !== false,
          // Saving re-renders Settings, which would cut the slide short; save once it's done.
          onchange: (e) => {
            const on = e.target.checked;
            setTimeout(() => { state.settings.haptics = on; save(); }, 320);
          },
        }))),
    foldersSection(),
    h('div', {},
      h('div', { class: 'set-row' }, h('span', {}, 'Alerts'), alertsControl(rerender))),
    h('p', { class: 'set-note' }, 'Works while the app is open or recently used.'),
    h('div', {},
      h('div', { class: 'set-row' }, h('span', {}, 'Backup'),
        h('span', { class: 'swatches' },
          h('button', { class: 'pill', onclick: exportBackup }, 'Export'),
          h('button', { class: 'pill', onclick: importBackup }, 'Restore')))),
  ));
}
