// Film mode "Organize" tab: Supplies · Locations · Cast · Budget for the chosen project.
// Entries are project items (film.js: cur().org[kind]), one row each, so collaborators
// can work on different entries at once; the budget adds everything up.
import { h, icon, ICONS } from './util.js';
import { cur, save, uid } from './store.js';
import { ask, pick } from './ui.js';
import { currentProject, filmStatus, orgNeedsSetup } from './film.js';

const SECTIONS = [['supply', 'Supplies'], ['location', 'Locations'], ['actor', 'Cast'], ['budget', 'Budget']];
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

const VIEWS = { supply: suppliesView, location: locationsView, actor: castView, budget: budgetView };

export function renderOrganize(root) {
  const p = currentProject();
  if (!p || !cur().org) {
    root.replaceChildren(h('div', { class: 'settings organize-page' }, h('h1', { class: 'display' }, 'Organize'),
      h('p', { class: 'set-note' }, filmStatus() === 'missing' ? 'Film mode isn’t set up yet.' : 'Choose or create a project: tap the slate on the Calendar.')));
    return;
  }
  const kind = section === 'budget' ? 'expense' : section;
  root.replaceChildren(h('div', { class: 'settings organize-page' },
    h('div', { class: 'page-head' },
      h('h1', { class: 'display org-project' }, p.name),
      h('button', { class: 'icon-btn page-add', 'aria-label': `Add ${FORMS[kind].title.toLowerCase()}`, onclick: () => openForm(kind) }, icon(ICONS.plus))),
    h('div', { class: 'segmented org-tabs', role: 'radiogroup' }, SECTIONS.map(([k, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(k === section),
      onclick: () => { section = k; localStorage.setItem('planner.orgsection', k); renderOrganize(root); },
    }, label))),
    orgNeedsSetup() ? h('p', { class: 'write-banner' }, 'Not saved to the project yet: run the Organize setup step in Supabase.') : null,
    VIEWS[section]()));
}
