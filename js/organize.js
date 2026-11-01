// Film mode "Organize" tab: Supplies · Locations · Cast · Budget for the chosen project.
// Entries are project items (film.js: cur().org[kind]), one row each, so collaborators
// can work on different entries at once; the budget adds everything up.
import { h, icon, ICONS, fmt, parseKey, todayKey } from './util.js';
import { cur, save, uid, onChange, inFilm } from './store.js';
import { ask, pick, pickMany, snack } from './ui.js';
import { currentProject, filmStatus, orgNeedsSetup, docOf } from './film.js';

const SECTIONS = [['supply', 'Supplies'], ['location', 'Locations'], ['actor', 'Cast'], ['budget', 'Budget'], ['shoot', 'Shoot']];
let section = localStorage.getItem('planner.orgsection') || 'supply';
const dialog = document.getElementById('org-sheet');
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

/* ---------- Money ---------- */

export const CURRENCIES = [['KRW', '₩ Won'], ['USD', '$ Dollar'], ['EUR', '€ Euro'], ['JPY', '¥ Yen'], ['GBP', '£ Pound'], ['CNY', '¥ Yuan']];
const org = (kind) => cur().org?.[kind] || [];
function settings() {
  let s = org('budget').find((x) => x.id === 'budget');
  if (!s) {
    s = { id: 'budget', currency: 'KRW', total: 0 };
    if (cur().org) cur().org.budget.push(s);
  }
  return s;
}
const formatters = {};
function money(n) {
  const c = settings().currency || 'KRW';
  formatters[c] ||= new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: ['KRW', 'JPY'].includes(c) ? 0 : 2 });
  return formatters[c].format(Number(n) || 0);
}
const symbol = () => money(0).replace(/[\d.,\s]/g, '') || settings().currency;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const fixUrl = (u) => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u);

/* ---------- Totals ---------- */

const supplyCost = (x) => num(x.qty || 1) * num(x.price);
function totals() {
  const sup = org('supply');
  const loc = org('location').filter((x) => x.status !== 'rejected');
  const cast = org('actor');
  const exp = org('expense').filter((x) => x.type !== 'income');
  const inc = org('expense').filter((x) => x.type === 'income');
  const groups = [
    { label: 'Supplies', planned: sup.reduce((n, x) => n + supplyCost(x), 0), spent: sup.filter((x) => x.bought).reduce((n, x) => n + supplyCost(x), 0) },
    { label: 'Locations', planned: loc.reduce((n, x) => n + num(x.fee), 0), spent: loc.filter((x) => x.paid).reduce((n, x) => n + num(x.fee), 0) },
    { label: 'Cast', planned: cast.reduce((n, x) => n + num(x.fee), 0), spent: cast.filter((x) => x.paid).reduce((n, x) => n + num(x.fee), 0) },
  ];
  const cats = {};
  exp.forEach((x) => {
    const k = (x.category || 'Other').trim() || 'Other';
    cats[k] ||= { label: k, planned: 0, spent: 0 };
    cats[k].planned += num(x.amount);
    if (x.paid) cats[k].spent += num(x.amount);
  });
  groups.push(...Object.values(cats));
  const planned = groups.reduce((n, g) => n + g.planned, 0);
  const spent = groups.reduce((n, g) => n + g.spent, 0);
  const income = inc.reduce((n, x) => n + num(x.amount), 0);
  const budget = num(settings().total) + income;
  return { groups, planned, spent, income, budget, left: budget - planned, unpaid: planned - spent };
}

/* ---------- Entry sheet ---------- */

const FORMS = {
  supply: {
    title: 'Supply',
    fields: [
      { key: 'name', label: 'Item', type: 'text', placeholder: 'e.g. Fog machine', required: true },
      { key: 'category', label: 'Group', type: 'text', placeholder: 'Props, Costume, Camera…' },
      { key: 'qty', label: 'Amount', type: 'number', placeholder: '1' },
      { key: 'price', label: 'Price each', type: 'money' },
      { key: 'link', label: 'Link', type: 'url', placeholder: 'Shop link' },
      { key: 'bought', label: 'Bought', type: 'toggle' },
      { key: 'note', label: 'Notes', type: 'area' },
    ],
  },
  location: {
    title: 'Location',
    fields: [
      { key: 'name', label: 'Place', type: 'text', placeholder: 'e.g. Old bus depot', required: true },
      { key: 'status', label: 'Status', type: 'choice', options: [['scouting', 'Scouting'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected']] },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'link', label: 'Map link', type: 'url', placeholder: 'Google / Naver / Apple Maps' },
      { key: 'contact', label: 'Contact', type: 'text', placeholder: 'Owner, phone…' },
      { key: 'fee', label: 'Fee', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'toggle' },
      { key: 'note', label: 'Notes', type: 'area', placeholder: 'Light, sound, parking, power, permits…' },
    ],
  },
  actor: {
    title: 'Cast',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'role', label: 'Role', type: 'text', placeholder: 'Character' },
      { key: 'contact', label: 'Contact', type: 'text', placeholder: 'Phone, email, Instagram…' },
      { key: 'link', label: 'Profile link', type: 'url', placeholder: 'Portfolio, reel…' },
      { key: 'fee', label: 'Payment', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'toggle' },
      { key: 'availability', label: 'Availability', type: 'text', placeholder: 'e.g. Weekends, not Dec 3–5' },
      { key: 'note', label: 'Notes', type: 'area', placeholder: 'Age, sizes, allergies, agency…' },
    ],
  },
  expense: {
    title: 'Budget line',
    fields: [
      { key: 'title', label: 'What', type: 'text', placeholder: 'e.g. Food, transport, grant', required: true },
      { key: 'type', label: 'Type', type: 'choice', options: [['expense', 'Expense'], ['income', 'Income']] },
      { key: 'category', label: 'Group', type: 'text', placeholder: 'Food, Transport, Rental…' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'toggle' },
      { key: 'note', label: 'Notes', type: 'area' },
    ],
  },
};

function openForm(kind, item = null) {
  const form = FORMS[kind];
  const isNew = !item;
  const draft = item ? { ...item } : { status: 'scouting', type: 'expense' };
  const inputs = {};

  const control = (f) => {
    if (f.type === 'toggle') {
      const el = h('input', { type: 'checkbox', class: 'switch', 'aria-label': f.label, checked: !!draft[f.key] });
      inputs[f.key] = () => el.checked;
      return el;
    }
    if (f.type === 'choice') {
      let v = draft[f.key] || f.options[0][0];
      const el = h('div', { class: 'segmented', role: 'radiogroup' });
      const paint = () => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
      f.options.forEach(([val, label]) => el.append(h('button', { type: 'button', role: 'radio', 'data-v': val, onclick: () => { v = val; paint(); } }, label)));
      paint();
      inputs[f.key] = () => v;
      return el;
    }
    if (f.type === 'area') {
      const el = h('textarea', { class: 'notes', rows: '3', placeholder: f.placeholder || f.label, 'aria-label': f.label });
      el.value = draft[f.key] || '';
      inputs[f.key] = () => el.value.trim();
      return el;
    }
    const money = f.type === 'money';
    const el = h('input', {
      type: f.type === 'url' ? 'url' : 'text', class: 'org-input', value: draft[f.key] ?? '', 'aria-label': f.label,
      placeholder: f.placeholder || (money ? `${symbol()} 0` : ''), autocomplete: 'off', autocapitalize: f.type === 'url' ? 'off' : null,
      inputmode: money || f.type === 'number' ? 'decimal' : f.type === 'url' ? 'url' : null,
    });
    inputs[f.key] = () => (money || f.type === 'number' ? (el.value.trim() === '' ? '' : num(el.value)) : el.value.trim());
    return el;
  };

  const head = form.fields[0];
  const titleInput = h('input', { type: 'text', placeholder: head.placeholder || head.label, value: draft[head.key] || '', autocomplete: 'off', 'aria-label': head.label });
  inputs[head.key] = () => titleInput.value.trim();
  const rows = form.fields.slice(1).map((f) => (f.type === 'area' ? control(f)
    : h('label', { class: 'field' }, h('span', {}, f.label), control(f))));

  const close = () => dialog.close();
  const submit = (ev) => {
    ev.preventDefault();
    if (!titleInput.value.trim()) { titleInput.focus(); return; }
    const data = {};
    form.fields.forEach((f) => { data[f.key] = inputs[f.key](); });
    if (data.link) data.link = fixUrl(data.link);
    if (isNew) cur().org[kind].push({ id: uid(), ...data, created: Date.now() });
    else Object.assign(item, data);
    save();
    close();
  };
  const remove = async () => {
    if (!await ask({ title: `Delete “${item[head.key]}”?`, ok: 'Delete', danger: true })) return;
    cur().org[kind] = cur().org[kind].filter((x) => x !== item);
    save();
    close();
  };

  dialog.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      isNew ? h('span', { class: 'org-sheet-title' }, form.title) : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: remove }, icon(ICONS.trash)),
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'title-row' }, titleInput),
    h('div', { class: 'fields' }, rows.filter((r) => r.tagName === 'LABEL')),
    rows.filter((r) => r.tagName !== 'LABEL')));
  dialog.showModal(); // no auto-focus: the keyboard waits for a tap
}

/* ---------- Lists ---------- */

const linkBtn = (url, label) => (url ? h('a', { class: 'icon-btn org-link', href: url, target: '_blank', rel: 'noopener', 'aria-label': label, onclick: (e) => e.stopPropagation() }, icon(ICONS.link)) : null);
const markBtn = (on, label, toggle) => h('button', {
  class: 'mark-btn org-mark', role: 'checkbox', 'aria-checked': String(!!on), 'aria-label': label,
  onclick: (e) => { e.stopPropagation(); toggle(); save(); },
}, h('span', { class: 'dash' }));
const summary = (parts) => h('p', { class: 'org-sum' }, parts.filter(Boolean).map(([k, v, cls]) => h('span', { class: cls || '' }, h('small', {}, k), v)));
const empty = (text) => h('p', { class: 'set-note org-empty' }, text);

function suppliesView() {
  const list = org('supply');
  const total = list.reduce((n, x) => n + supplyCost(x), 0);
  const bought = list.filter((x) => x.bought).reduce((n, x) => n + supplyCost(x), 0);
  const groups = {};
  [...list].sort((a, b) => (!!a.bought - !!b.bought) || (a.name || '').localeCompare(b.name || ''))
    .forEach((x) => { (groups[(x.category || '').trim()] ||= []).push(x); });
  const keys = Object.keys(groups).sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  return h('div', { class: 'org-body' },
    list.length ? summary([['Total', money(total)], ['Bought', money(bought)], ['To buy', money(total - bought), 'org-due']]) : null,
    list.length ? keys.map((k) => h('section', { class: 'org-group' },
      k ? h('h3', { class: 'org-group-h' }, k) : null,
      h('ul', { class: 'org-list' }, groups[k].map((x) => h('li', { class: `org-row${x.bought ? ' done' : ''}`, onclick: () => openForm('supply', x) },
        markBtn(x.bought, `Bought: ${x.name}`, () => { x.bought = !x.bought; }),
        h('span', { class: 'org-main' }, h('b', {}, x.name),
          h('small', {}, `${num(x.qty || 1)} × ${money(x.price)}`)),
        linkBtn(x.link, `Open link for ${x.name}`),
        h('span', { class: 'org-amt' }, money(supplyCost(x)))))))) : empty('Tap + to add props, costumes, gear…'));
}

const STATUS = { scouting: 'Scouting', confirmed: 'Confirmed', rejected: 'Rejected' };
function locationsView() {
  const order = { confirmed: 0, scouting: 1, rejected: 2 };
  const list = [...org('location')].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || (a.name || '').localeCompare(b.name || ''));
  const fees = list.filter((x) => x.status !== 'rejected').reduce((n, x) => n + num(x.fee), 0);
  return h('div', { class: 'org-body' },
    list.length ? summary([['Places', String(list.length)], ['Confirmed', String(list.filter((x) => x.status === 'confirmed').length)], ['Fees', money(fees)]]) : null,
    list.length ? h('ul', { class: 'org-list' }, list.map((x) => {
      const map = x.link || (x.address ? `https://maps.google.com/?q=${encodeURIComponent(x.address)}` : '');
      return h('li', { class: `org-row loc ${x.status || 'scouting'}`, onclick: () => openForm('location', x) },
        h('span', { class: 'org-dot', title: STATUS[x.status] || 'Scouting' }),
        h('span', { class: 'org-main' }, h('b', {}, x.name),
          h('small', {}, [STATUS[x.status] || 'Scouting', x.address].filter(Boolean).join(' · ')),
          x.note ? h('span', { class: 'org-note' }, x.note) : null),
        linkBtn(map, `Open map for ${x.name}`),
        x.fee ? h('span', { class: `org-amt${x.paid ? ' paid' : ''}` }, money(x.fee)) : null);
    })) : empty('Tap + to add places you’re scouting.'));
}

function castView() {
  const list = [...org('actor')].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const total = list.reduce((n, x) => n + num(x.fee), 0);
  const paid = list.filter((x) => x.paid).reduce((n, x) => n + num(x.fee), 0);
  return h('div', { class: 'org-body' },
    list.length ? summary([['Cast', String(list.length)], ['Payments', money(total)], ['Unpaid', money(total - paid), 'org-due']]) : null,
    list.length ? h('ul', { class: 'org-list' }, list.map((x) => h('li', { class: 'org-row', onclick: () => openForm('actor', x) },
      h('span', { class: 'chat-avatar org-avatar' }, (x.name || '?')[0].toUpperCase()),
      h('span', { class: 'org-main' }, h('b', {}, x.name),
        h('small', {}, [x.role, x.contact].filter(Boolean).join(' · ')),
        x.availability ? h('span', { class: 'org-note' }, x.availability) : null),
      linkBtn(x.link, `Open profile for ${x.name}`),
      x.fee ? h('span', { class: `org-amt${x.paid ? ' paid' : ''}` }, money(x.fee), x.paid ? h('small', { class: 'org-paid' }, 'Paid') : null) : null))) : empty('Tap + to add actors.'));
}

function budgetView() {
  const s = settings();
  const t = totals();
  const pct = t.budget > 0 ? Math.min(100, (t.planned / t.budget) * 100) : 0;
  const lines = [...org('expense')].sort((a, b) => (a.type === 'income') - (b.type === 'income') || (b.created || 0) - (a.created || 0));
  const setTotal = async () => {
    const { askText } = await import('./ui.js');
    const v = await askText({ title: 'Total budget', value: s.total ? String(s.total) : '', placeholder: `${symbol()} 0`, inputmode: 'decimal', ok: 'Save' });
    if (v === null) return;
    s.total = num(v);
    save();
  };
  const setCurrency = async (e) => {
    const v = await pick(e.currentTarget, CURRENCIES, s.currency || 'KRW');
    if (!v) return;
    s.currency = v;
    save();
  };
  return h('div', { class: 'org-body' },
    h('div', { class: 'org-budget-card' },
      h('div', { class: 'org-budget-top' },
        h('button', { class: 'org-budget-total', onclick: setTotal },
          h('small', {}, 'Budget'), h('b', { class: 'display' }, money(t.budget)),
          t.income ? h('small', {}, `incl. ${money(t.income)} income`) : null),
        h('button', { class: 'pill', onclick: setCurrency }, symbol())),
      h('div', { class: `org-bar${t.left < 0 ? ' over' : ''}` }, h('i', { style: `width:${pct}%` })),
      summary([['Planned', money(t.planned)], ['Spent', money(t.spent)], [t.left < 0 ? 'Over' : 'Left', money(Math.abs(t.left)), t.left < 0 ? 'org-over' : ''], ['Unpaid', money(t.unpaid), 'org-due']])),
    h('section', { class: 'org-group' },
      h('h3', { class: 'org-group-h' }, 'Breakdown'),
      h('ul', { class: 'org-list' }, t.groups.filter((g) => g.planned).map((g) => h('li', { class: 'org-row static' },
        h('span', { class: 'org-main' }, h('b', {}, g.label), h('small', {}, `Spent ${money(g.spent)}`)),
        h('span', { class: 'org-amt' }, money(g.planned))))),
      t.planned ? null : empty('Costs from Supplies, Locations and Cast add up here.')),
    h('section', { class: 'org-group' },
      h('h3', { class: 'org-group-h' }, 'Other lines'),
      lines.length ? h('ul', { class: 'org-list' }, lines.map((x) => h('li', { class: `org-row${x.type === 'income' ? ' income' : ''}`, onclick: () => openForm('expense', x) },
        x.type === 'income' ? h('span', { class: 'org-sign' }, '+') : markBtn(x.paid, `Paid: ${x.title}`, () => { x.paid = !x.paid; }),
        h('span', { class: 'org-main' }, h('b', {}, x.title), x.category ? h('small', {}, x.category) : null),
        h('span', { class: 'org-amt' }, money(x.amount))))) : empty('Tap + for food, transport, rentals — or income like a grant.')));
}

/* ---------- Shoot (shooting days) ---------- */
// A shooting day is one of the project's calendar events with a `shoot` part
// ({ location, scenes: [{ id, label }], cast: [actor id] }), so it also shows on the
// project calendar and timeline. Titles are "Shoot day N" in date order.

// Ties (same date and time) break by id, so every collaborator numbers the days the same.
const shootDays = () => cur().events.filter((e) => e.shoot).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')) || String(a.id).localeCompare(String(b.id)));
const dayNo = (ev) => shootDays().indexOf(ev) + 1;
function renumber() {
  let changed = false;
  shootDays().forEach((e, i) => { const t = `Shoot day ${i + 1}`; if (e.title !== t) { e.title = t; changed = true; } });
  return changed;
}
// Also after edits made elsewhere (e.g. a shoot day's date moved in the calendar editor).
onChange(() => { if (inFilm() && cur().events.some((e) => e.shoot) && renumber()) save(); });

// Scenes to choose from: the script's scene headings (numbered), else the Plot's cards.
function sceneOptions() {
  const blocks = docOf('script')?.body?.blocks || [];
  const out = [];
  let n = 0;
  let cur0 = null;
  for (const b of blocks) {
    if (b.t === 'scene') {
      n += 1;
      cur0 = b.x?.trim() ? { id: b.id, label: `${n}. ${b.x.trim()}`, chars: new Set() } : null;
      if (cur0) out.push(cur0);
    } else if (b.t === 'character' && cur0 && b.x?.trim()) {
      cur0.chars.add(b.x.replace(/\(.*\)/g, '').trim().toUpperCase());
    }
  }
  if (out.length) return out;
  for (const act of docOf('plot')?.body?.acts || []) {
    for (const c of act.cards || []) if (c.title?.trim()) out.push({ id: c.id, label: c.title.trim(), chars: new Set() });
  }
  return out;
}

const locName = (id) => org('location').find((x) => x.id === id) || null;
const actor = (id) => org('actor').find((x) => x.id === id) || null;
const mapOf = (loc) => (loc ? loc.link || (loc.address ? `https://maps.google.com/?q=${encodeURIComponent(loc.address)}` : '') : '');
const longDay = (key) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(parseKey(key));

function callSheet(ev) {
  const p = currentProject();
  const loc = locName(ev.shoot.location);
  const lines = [`${p?.name || 'Film'} — ${ev.title}`, `${longDay(ev.date)} · Call ${ev.start || '—'}${ev.end ? ` · Wrap ${ev.end}` : ''}`];
  if (loc) lines.push(`Location: ${loc.name}${loc.address ? `, ${loc.address}` : ''}${mapOf(loc) ? `\n${mapOf(loc)}` : ''}`);
  if (ev.shoot.scenes?.length) lines.push(`Scenes: ${ev.shoot.scenes.map((x) => x.label).join('; ')}`);
  const cast = (ev.shoot.cast || []).map(actor).filter(Boolean);
  if (cast.length) lines.push(`Cast: ${cast.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', ')}`);
  if (ev.notes) lines.push(`Notes: ${ev.notes}`);
  return lines.join('\n');
}

function openShootDay(item = null) {
  const isNew = !item;
  const draft = item ? { ...item, shoot: structuredClone(item.shoot) } : {
    date: todayKey(), start: '07:00', end: '19:00', notes: '', shoot: { location: null, scenes: [], cast: [] },
  };
  const date = h('input', { type: 'date', class: 'org-input', value: draft.date, 'aria-label': 'Date' });
  const call = h('input', { type: 'time', class: 'org-input', value: draft.start || '', 'aria-label': 'Call time' });
  const wrap = h('input', { type: 'time', class: 'org-input', value: draft.end || '', 'aria-label': 'Wrap time' });
  const notes = h('textarea', { class: 'notes', rows: '3', placeholder: 'Parking, meals, weather backup…', 'aria-label': 'Notes' });
  notes.value = draft.notes || '';

  const label = (text) => h('span', { class: 'select-label' }, text);
  const locLabel = label('');
  const sceneLabel = label('');
  const castLabel = label('');
  const paint = () => {
    locLabel.textContent = locName(draft.shoot.location)?.name || 'Choose';
    sceneLabel.textContent = draft.shoot.scenes.length ? `Sc ${draft.shoot.scenes.map((x) => x.label.split('.')[0]).join(', ')}` : 'Choose';
    const names = draft.shoot.cast.map(actor).filter(Boolean).map((a) => a.name);
    castLabel.textContent = names.length ? names.join(', ') : 'Choose';
  };
  paint();
  const chooseLoc = async (e) => {
    const list = org('location').filter((x) => x.status !== 'rejected');
    if (!list.length) { snack('Add places in Locations first.'); return; }
    const v = await pick(e.currentTarget, [['', 'None'], ...list.map((x) => [x.id, x.name])], draft.shoot.location || '');
    if (v === undefined) return;
    draft.shoot.location = v || null;
    paint();
  };
  const chooseScenes = async () => {
    const opts = sceneOptions();
    const known = new Map(opts.map((o) => [o.id, o]));
    const v = await pickMany(opts.map((o) => [o.id, o.label]), draft.shoot.scenes.map((x) => x.id),
      { title: 'Scenes', empty: 'Write scene headings in Write → Script (or cards in Plot) to pick them here.' });
    if (!v) return;
    draft.shoot.scenes = v.map((id) => ({ id, label: known.get(id).label }));
    // Actors whose role speaks in these scenes are added for you.
    const speaking = new Set(v.flatMap((id) => [...known.get(id).chars]));
    for (const a of org('actor')) {
      if (a.role && speaking.has(a.role.trim().toUpperCase()) && !draft.shoot.cast.includes(a.id)) draft.shoot.cast.push(a.id);
    }
    paint();
  };
  const chooseCast = async () => {
    const v = await pickMany(org('actor').map((a) => [a.id, a.name, a.role || '']), draft.shoot.cast,
      { title: 'Cast', empty: 'Add actors in Cast first.' });
    if (!v) return;
    draft.shoot.cast = v;
    paint();
  };
  const row = (name, el) => h('div', { class: 'field' }, h('span', {}, name), el);
  const btn = (lbl, fn) => h('button', { type: 'button', class: 'select-btn', onclick: fn }, lbl);

  const close = () => dialog.close();
  const collect = () => ({ date: date.value || todayKey(), start: call.value, end: wrap.value, notes: notes.value.trim() });
  const submit = (ev) => {
    ev.preventDefault();
    const v = collect();
    const data = { ...v, allDay: !v.start, start: v.start || '09:00', end: v.end || v.start || '10:00', shoot: draft.shoot };
    if (isNew) cur().events.push({ id: uid(), title: 'Shoot day', repeat: 'none', until: '', alert: 'none', important: false, ...data });
    else Object.assign(item, data);
    renumber();
    save();
    close();
  };
  const remove = async () => {
    if (!await ask({ title: `Delete ${item.title}?`, message: 'It’s also removed from the calendar.', ok: 'Delete', danger: true })) return;
    cur().events = cur().events.filter((x) => x !== item);
    renumber();
    save();
    close();
  };
  const copy = async () => {
    const text = callSheet({ ...item, ...collect(), title: item?.title || 'Shoot day', shoot: draft.shoot });
    try { await navigator.clipboard.writeText(text); snack('Call sheet copied — paste it in a chat.'); } catch { snack('Couldn’t copy on this phone.'); }
  };

  dialog.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'org-sheet-title' }, isNew ? 'Shoot day' : item.title),
      h('span', { class: 'spacer' }),
      isNew ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: remove }, icon(ICONS.trash)),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'fields' },
      row('Date', date), row('Call', call), row('Wrap', wrap),
      row('Location', btn(locLabel, chooseLoc)),
      row('Scenes', btn(sceneLabel, chooseScenes)),
      row('Cast', btn(castLabel, chooseCast))),
    notes,
    h('button', { type: 'button', class: 'pill shoot-copy', onclick: copy }, icon(ICONS.copy), 'Copy call sheet')));
  dialog.showModal(); // no auto-focus: the keyboard waits for a tap
}

function shootView() {
  const days = shootDays();
  const today = todayKey();
  const next = days.find((d) => d.date >= today);
  const card = (ev) => {
    const loc = locName(ev.shoot.location);
    const d = parseKey(ev.date);
    const cast = (ev.shoot.cast || []).map(actor).filter(Boolean);
    return h('li', { class: `shoot-card${ev.date < today ? ' past' : ''}`, onclick: () => openShootDay(ev) },
      h('span', { class: 'shoot-date' }, h('small', {}, fmt({ weekday: 'short' }).format(d)), h('b', { class: 'display' }, String(d.getDate())), h('small', {}, fmt({ month: 'short' }).format(d))),
      h('span', { class: 'org-main' },
        h('b', {}, `Day ${dayNo(ev)}${ev.allDay ? '' : ` · ${ev.start}${ev.end ? `–${ev.end}` : ''}`}`),
        loc ? h('small', {}, loc.name) : h('small', { class: 'muted' }, 'No location'),
        ev.shoot.scenes?.length ? h('span', { class: 'org-note' }, `Sc ${ev.shoot.scenes.map((x) => x.label.split('.')[0]).join(', ')}`) : null,
        cast.length ? h('span', { class: 'org-note' }, cast.map((a) => a.name).join(', ')) : null),
      linkBtn(mapOf(loc), `Open map for ${loc?.name || ''}`));
  };
  return h('div', { class: 'org-body' },
    days.length ? summary([['Days', String(days.length)], ['Next', next ? longDay(next.date) : '—', 'org-due'], ['Scenes', String(new Set(days.flatMap((d) => (d.shoot.scenes || []).map((x) => x.id))).size)]]) : null,
    days.length ? h('ul', { class: 'org-list shoot-list' }, days.map(card)) : empty('Tap + to plan a shooting day: date, call time, location, scenes and cast.'));
}

const VIEWS = { supply: suppliesView, location: locationsView, actor: castView, budget: budgetView, shoot: shootView };

export function renderOrganize(root) {
  const p = currentProject();
  if (!p || !cur().org) {
    root.replaceChildren(h('div', { class: 'settings organize-page' }, h('h1', { class: 'display' }, 'Organize'),
      h('p', { class: 'set-note' }, filmStatus() === 'missing' ? 'Film mode isn’t set up yet.' : 'Choose or create a project: tap the slate on the Calendar.')));
    return;
  }
  const kind = section === 'budget' ? 'expense' : section;
  const add = section === 'shoot' ? () => openShootDay() : () => openForm(kind);
  const addLabel = section === 'shoot' ? 'Add shooting day' : `Add ${FORMS[kind].title.toLowerCase()}`;
  // Keep the scroll position across redraws (e.g. after ticking an item off).
  const prevScroll = root.querySelector('.organize-page')?.scrollTop || 0;
  root.replaceChildren(h('div', { class: 'settings organize-page' },
    // The name, + and the section switch stay pinned while scrolling.
    h('div', { class: 'page-sticky' },
      h('div', { class: 'page-head' },
        h('h1', { class: 'display org-project' }, p.name),
        h('button', { class: 'icon-btn page-add', 'aria-label': addLabel, onclick: add }, icon(ICONS.plus))),
      h('div', { class: 'segmented org-tabs', role: 'radiogroup' }, SECTIONS.map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(k === section),
        onclick: () => { section = k; localStorage.setItem('planner.orgsection', k); renderOrganize(root); },
      }, label)))),
    orgNeedsSetup() ? h('p', { class: 'write-banner' }, 'Not saved to the project yet: run the Organize setup step in Supabase.') : null,
    VIEWS[section]()));
  const page = root.querySelector('.organize-page');
  if (page && prevScroll) page.scrollTop = prevScroll;
}
