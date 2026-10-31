// Small DOM + date helpers shared by every module.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

// Static SVG markup only (never user text).
export function icon(markup) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${markup}</svg>`;
  return span.firstChild;
}

export const ICONS = {
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5.8v12.4l10-6.2z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
};

export const pad = (n) => String(n).padStart(2, '0');

// Dates are stored as local 'YYYY-MM-DD' keys so "today" follows the phone's timezone.
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export const todayKey = () => dateKey(new Date());

// 'HH:MM' <-> minutes since midnight
export const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMinutes = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export function formatTime(t) {
  const d = new Date(2000, 0, 1, ...t.split(':').map(Number));
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// '9:00' instead of '9:00 AM' — for tight spots where position already implies the time of day.
export const shortTime = (t) => formatTime(t).replace(/\s?[AP]M$/i, '');

export function daysBetween(fromKey, toKey) {
  return Math.round((parseKey(toKey) - parseKey(fromKey)) / 86400000);
}

// Recorded time, compact: '45s', '25m', '1h 05m'.
export function formatDuration(secs) {
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

// Running stopwatch: '4:07' or '1:02:03'.
export function formatClock(secs) {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export const formatNumber = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
