// Appearance (light/dark, accent color), notifications and backup.
import { h } from './util.js';
import { state, save, replaceAll } from './store.js';
import { notificationsSupported, requestNotifications } from './reminders.js';

const dialog = document.getElementById('settings');
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

function notificationRow() {
  const status = h('span', { class: 'status' });
  const row = h('div', { class: 'field' }, h('span', {}, 'Alerts'), status);
  const paint = () => {
    if (!notificationsSupported()) {
      status.textContent = 'Add to Home Screen first';
    } else if (Notification.permission === 'granted') {
      status.textContent = 'On';
    } else if (Notification.permission === 'denied') {
      status.textContent = 'Blocked in iPhone Settings';
    } else {
      status.replaceChildren(h('button', {
        type: 'button', class: 'pill',
        onclick: async () => { await requestNotifications(); paint(); },
      }, 'Turn on'));
    }
  };
  paint();
  return row;
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `planner-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!confirm('Replace all current data with this backup?')) return;
      replaceAll(data);
      applyTheme();
      dialog.close();
    } catch {
      alert('That file is not a Planner backup.');
    }
  });
  input.click();
}

export function openSettings() {
  const themeSeg = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const [v, label] of [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]) {
    themeSeg.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(state.settings.theme === v),
      onclick: () => { state.settings.theme = v; save(); applyTheme(); openSettings(); },
    }, label));
  }

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' },
    ACCENTS.map(([v, label]) => h('button', {
      type: 'button', role: 'radio', class: `swatch ${v}`, 'aria-label': label,
      'aria-checked': String(state.settings.accent === v),
      style: SWATCH[v] ? `background:${SWATCH[v]}` : null,
      onclick: () => { state.settings.accent = v; save(); applyTheme(); openSettings(); },
    })));

  const form = h('form', { method: 'dialog' },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' }, h('span'), h('h3', {}, 'Settings'), h('button', { class: 'save' }, 'Done')),
    h('p', { class: 'section-label' }, 'Appearance'),
    themeSeg,
    h('div', { class: 'group' }, swatches),
    h('p', { class: 'section-label' }, 'Notifications'),
    h('div', { class: 'group' }, notificationRow()),
    h('p', { class: 'hint' },
      'On iPhone, alerts need the app on your Home Screen (Share → Add to Home Screen) and iOS 16.4 or later. ' +
      'They go off while the app is open or recently used — iPhone may pause it in the background, so don’t rely on it for critical alarms. ' +
      'The app icon shows a badge with today’s important items.'),
    h('p', { class: 'section-label' }, 'Backup'),
    h('div', { class: 'group' },
      h('button', { type: 'button', class: 'field', style: 'width:100%', onclick: exportBackup }, h('span', {}, 'Export backup')),
      h('button', { type: 'button', class: 'field', style: 'width:100%', onclick: importBackup }, h('span', {}, 'Restore from backup'))),
    h('p', { class: 'hint' }, 'Your data is stored only on this phone. Export a backup now and then.'),
  );

  dialog.replaceChildren(form);
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
