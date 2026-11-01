// Search (magnifying glass, top-left of the calendar): to-dos, events, D-Days, chat messages
// and, in film mode, the project's writing. Everything searched is already on the phone.
// Tapping a result goes there: a day, a chat, the D-Day tab or a Write section.
import { h, icon, ICONS, dateKey, addDays, parseKey, fmt, todayKey } from './util.js';
import { state, cur, inFilm, occursOn, todoDate, hasDue } from './store.js';
import { openLayer } from './ui.js';
import { chatList, messagesOf } from './chat.js';
import { docOf, currentProject } from './film.js';

const LIMIT = 30; // per group
const norm = (s) => String(s || '').toLocaleLowerCase();

// The day to open for a to-do / event: its date, or for a routine the next time it happens.
function dayFor(item, isTodo) {
  if (isTodo && hasDue(item)) return todoDate(item);
  if (!item.repeat || item.repeat === 'none') return item.date;
  const today = todayKey();
  if (item.date >= today) return item.date;
  for (let i = 0; i < 400; i++) { const k = dateKey(addDays(parseKey(today), i)); if (occursOn(item, k)) return k; }
  return item.date;
}

// A short piece of text around the match.
function snippet(text, q) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const i = norm(t).indexOf(q);
  if (i < 0 || t.length <= 70) return t.slice(0, 70);
  const start = Math.max(0, i - 25);
  return `${start ? '…' : ''}${t.slice(start, start + 70)}${start + 70 < t.length ? '…' : ''}`;
}

// Every string inside a writing document, with the section it belongs to.
function texts(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (k !== 'id') texts(v, out); });
  return out;
}

const day = () => fmt({ month: 'short', day: 'numeric' });

function find(qRaw) {
  const q = norm(qRaw.trim());
  if (!q) return [];
  const has = (...fields) => fields.some((f) => norm(f).includes(q));
  const groups = [];
  const lists = cur();

  const todos = lists.todos.filter((t) => has(t.title, t.notes)).slice(0, LIMIT).map((t) => {
    const k = dayFor(t, true);
    return { title: t.title, sub: [k ? day().format(parseKey(k)) : '', t.repeat && t.repeat !== 'none' ? '↻' : '', t.notes && !has(t.title) ? snippet(t.notes, q) : ''].filter(Boolean).join(' · '), go: { date: k }, done: !t.repeat || t.repeat === 'none' ? !!t.done : false };
  });
  if (todos.length) groups.push(['To-do', todos]);

  const events = lists.events.filter((e) => has(e.title, e.notes)).slice(0, LIMIT).map((e) => {
    const k = dayFor(e, false);
    return { title: e.title, sub: [k ? day().format(parseKey(k)) : '', e.allDay ? '' : e.start, e.repeat && e.repeat !== 'none' ? '↻' : ''].filter(Boolean).join(' · '), go: { date: k } };
  });
  if (events.length) groups.push(['Schedule', events]);

  if (!inFilm()) {
    const dd = (state.ddays || []).filter((d) => has(d.title)).slice(0, LIMIT)
      .map((d) => ({ title: d.title, sub: day().format(parseKey(d.date)) + (d.yearly ? ' · ↻' : ''), go: { tab: 'dday' } }));
    if (dd.length) groups.push(['D-Day', dd]);
  }

  const msgs = [];
  for (const { chat, title } of chatList()) {
    if (has(title)) msgs.push({ title, sub: 'Chat', go: { chat: chat.id } });
    for (const m of [...messagesOf(chat.id)].reverse()) {
      if (msgs.length >= LIMIT) break;
      if (m.body && has(m.body)) msgs.push({ title, sub: snippet(m.body, q), go: { chat: chat.id } });
    }
  }
  if (msgs.length) groups.push(['Chat', msgs.slice(0, LIMIT)]);

  if (inFilm() && currentProject()) {
    const w = [];
    // Characters are stored inside the Theme ("story") document.
    const story = docOf('story')?.body || {};
    const { characters = [], ...theme } = story;
    const parts = [['story', 'Theme', theme], ['characters', 'Characters', characters],
      ['plot', 'Plot', docOf('plot')?.body || {}], ['script', 'Script', docOf('script')?.body || {}]];
    for (const [sec, label, body] of parts) {
      for (const t of texts(body)) {
        if (w.length >= LIMIT) break;
        if (has(t)) w.push({ title: label, sub: snippet(t, q), go: { write: sec } });
      }
    }
    if (w.length) groups.push(['Writing', w]);
  }
  return groups;
}

/** Opens the search card. go(target) is called with { date } | { chat } | { tab } | { write }. */
export function openSearch(go) {
  let layer;
  const results = h('div', { class: 'search-results' });
  const input = h('input', {
    type: 'search', class: 'search-input', placeholder: 'Search', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search',
    oninput: () => draw(),
  });
  const close = () => layer.close();
  function draw() {
    const groups = find(input.value);
    if (!input.value.trim()) { results.replaceChildren(); return; }
    if (!groups.length) { results.replaceChildren(h('p', { class: 'set-note search-empty' }, 'Nothing found.')); return; }
    results.replaceChildren(...groups.map(([label, rows]) => h('section', { class: 'search-group' },
      h('h3', { class: 'search-h' }, label),
      rows.map((r) => h('button', { type: 'button', class: `search-row${r.done ? ' done' : ''}`, onclick: () => { close(); go(r.go); } },
        h('b', {}, r.title || 'Untitled'), r.sub ? h('small', {}, r.sub) : null)))));
  }
  layer = openLayer('search-layer', h('div', { class: 'search-card' },
    h('div', { class: 'search-bar' },
      icon(ICONS.search),
      input,
      // autofocus here keeps the keyboard down until the field is tapped (app rule).
      h('button', { type: 'button', class: 'link-btn search-cancel', autofocus: true, onclick: close }, 'Cancel')),
    results), { onBackdrop: close });
}
