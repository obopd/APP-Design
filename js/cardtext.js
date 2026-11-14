// Study mode's card text: note types (fields + card templates), Anki-style template
// rendering ({{Field}}, {{FrontSide}}, {{cloze:Text}}, {{type:Back}}, {{#Field}}…{{/Field}}),
// and a sanitizer that turns card HTML (typed here or imported from Anki) into safe DOM
// nodes: a fixed list of formatting tags, a few style properties, never scripts or handlers.
import { h } from './util.js';

/* ---------- Built-in note types ---------- */

const FRONT_BACK = '{{FrontSide}}<hr class="answer">';
export const BUILTIN_TYPES = [
  {
    id: 'nt-basic', name: 'Basic', fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', front: '{{Front}}', back: `${FRONT_BACK}{{Back}}` }],
  },
  {
    id: 'nt-reversed', name: 'Basic (and reversed card)', fields: ['Front', 'Back'],
    templates: [
      { name: 'Card 1', front: '{{Front}}', back: `${FRONT_BACK}{{Back}}` },
      { name: 'Card 2', front: '{{Back}}', back: `${FRONT_BACK}{{Front}}` },
    ],
  },
  {
    id: 'nt-optrev', name: 'Basic (optional reversed card)', fields: ['Front', 'Back', 'Add Reverse'],
    templates: [
      { name: 'Card 1', front: '{{Front}}', back: `${FRONT_BACK}{{Back}}` },
      { name: 'Card 2', front: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', back: `${FRONT_BACK}{{Front}}` },
    ],
  },
  {
    id: 'nt-typein', name: 'Basic (type in the answer)', fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', front: '{{Front}}<br>{{type:Back}}', back: '{{Front}}<hr class="answer">{{type:Back}}' }],
  },
  {
    id: 'nt-cloze', name: 'Cloze', cloze: true, fields: ['Text', 'Back Extra'],
    templates: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>{{Back Extra}}' }],
  },
];

/* ---------- Plain text ---------- */

// HTML → plain text (search, duplicate check, lists). Uses an inert document.
const inert = typeof document !== 'undefined' ? document.implementation.createHTMLDocument('') : null;
export function plain(html) {
  if (!html) return '';
  if (!inert) return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const d = new DOMParser().parseFromString(`<body>${String(html).replace(/<br\s*\/?>/gi, ' ')}`, 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/* ---------- Cloze ---------- */

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
/** The cloze numbers a text uses: "{{c1::a}} {{c2::b}}" → [1, 2]. */
export function clozeNumbers(text) {
  const set = new Set();
  for (const m of String(text || '').matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function renderCloze(text, n, back) {
  return String(text || '').replace(CLOZE_RE, (all, num, answer, hint) => {
    if (Number(num) !== n) return answer;
    if (back) return `<span class="cloze">${answer}</span>`;
    return `<span class="cloze">[${hint ? esc(hint) : '…'}]</span>`;
  });
}

/* ---------- Templates ---------- */

/**
 * Which cards a note makes: [{ ord }] — one per template whose front isn't empty,
 * or one per cloze number for cloze types.
 */
export function cardOrds(type, fields) {
  if (type.cloze) {
    const nums = new Set();
    type.fields.forEach((f) => clozeNumbers(fields[f]).forEach((n) => nums.add(n)));
    return [...nums].map((n) => n - 1);
  }
  return type.templates.map((t, i) => (plain(fill(t.front, fields, {})) ? i : -1)).filter((i) => i >= 0);
}

// {{#F}}…{{/F}} shows when F has text; {{^F}}…{{/F}} when it's empty.
function sections(tpl, fields) {
  let out = tpl;
  for (let guard = 0; guard < 20; guard += 1) {
    const m = out.match(/\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/);
    if (!m) break;
    const has = !!plain(fields[m[2]] || '');
    out = out.replace(m[0], (m[1] === '#') === has ? m[3] : '');
  }
  return out;
}

// Fill a template. ctx: { cloze: n (1-based), back, front (rendered front), tags, deck, type, card }.
function fill(tpl, fields, ctx) {
  return sections(tpl, fields).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, keyRaw) => {
    const key = keyRaw.trim();
    if (key === 'FrontSide') return ctx.front || '';
    if (key === 'Tags') return esc((ctx.tags || []).join(' '));
    if (key === 'Deck') return esc(ctx.deck || '');
    if (key === 'Subdeck') return esc((ctx.deck || '').split('::').pop());
    if (key === 'Type') return esc(ctx.type || '');
    if (key === 'Card') return esc(ctx.card || '');
    const parts = key.split(':');
    const name = parts.pop();
    const mods = parts;
    let v = fields[name];
    if (v == null) return '';
    if (mods.includes('cloze')) v = renderCloze(v, ctx.cloze || 1, !!ctx.back);
    if (mods.includes('type')) return `<span class="typein" data-field="${esc(name)}"></span>`;
    if (mods.includes('text')) v = esc(plain(v));
    if (mods.includes('hint')) return `<span class="hint">${v}</span>`;
    return v;
  });
}

/** Front and back HTML of one card. */
export function renderCard(type, note, ord, extra = {}) {
  const t = type.cloze ? type.templates[0] : type.templates[ord] || type.templates[0];
  const ctx = { cloze: ord + 1, tags: note.tags, deck: extra.deck, type: type.name, card: t.name };
  const front = fill(t.front, note.fields, { ...ctx, back: false });
  const back = fill(t.back, note.fields, { ...ctx, back: true, front: type.cloze ? fill(t.front, note.fields, { ...ctx, back: true }) : front });
  // The answer for a type-in card: the field's plain text (for a cloze, this card's answers).
  const typeField = (t.front.match(/\{\{\s*type:(?:cloze:)?([^}]+?)\s*\}\}/) || [])[1];
  let expected = null;
  if (typeField) {
    const v = note.fields[typeField.trim()] || '';
    expected = type.cloze
      ? [...String(v).matchAll(CLOZE_RE)].filter((m) => Number(m[1]) === ord + 1).map((m) => plain(m[2])).join(', ')
      : plain(v);
  }
  return { front, back, expected };
}

/* ---------- Sanitizer: HTML string → safe DOM ---------- */

const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'br', 'div', 'p', 'span',
  'ul', 'ol', 'li', 'hr', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'small', 'big', 'mark', 'ruby', 'rt', 'rp', 'center', 'font', 'a']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'head', 'title', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'template', 'noscript']);
const STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-size', 'vertical-align']);
const SAFE_VALUE = /^[#(),.%\w\s-]+$/;
const CLASSES = new Set(['cloze', 'answer', 'typein', 'hint']);

function cleanStyle(style) {
  const out = [];
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (STYLE_PROPS.has(prop) && SAFE_VALUE.test(val) && !/url|expression/i.test(val)) out.push(`${prop}:${val}`);
  }
  return out.join(';');
}

function copy(node, into) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { into.append(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (tag === 'img') { into.append(h('span', { class: 'media-missing', title: 'Image (coming in the next update)' }, '🖼')); continue; }
    if (!TAGS.has(tag)) { copy(n, into); continue; } // unknown wrapper: keep its text
    const el = document.createElement(tag === 'font' || tag === 'a' || tag === 'center' ? 'span' : tag);
    const style = cleanStyle(n.getAttribute('style'));
    const color = tag === 'font' && n.getAttribute('color');
    const styles = [style, color && SAFE_VALUE.test(color) ? `color:${color}` : '', tag === 'center' ? 'display:block;text-align:center' : ''].filter(Boolean).join(';');
    if (styles) el.setAttribute('style', styles);
    const cls = (n.getAttribute('class') || '').split(/\s+/).filter((c) => CLASSES.has(c));
    if (n.tagName === 'HR' && n.id === 'answer') cls.push('answer');
    if (cls.length) el.className = cls.join(' ');
    if (tag === 'span' && n.dataset?.field && cls.includes('typein')) el.dataset.field = n.dataset.field;
    if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(n.getAttribute('colspan') || '')) el.setAttribute('colspan', n.getAttribute('colspan'));
    copy(n, el);
    into.append(el);
  }
}

/** Safe DOM (a fragment) from card / field HTML. */
export function safeFragment(html) {
  const frag = document.createDocumentFragment();
  if (!html) return frag;
  const d = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
  copy(d.body, frag);
  return frag;
}

/** Clean HTML string (for saving what was typed in a field). */
export function cleanHtml(html) {
  const box = document.createElement('div');
  box.append(safeFragment(html));
  // Trailing empty lines from the editor aren't content.
  return box.innerHTML.replace(/(<br>|<div><br><\/div>)+$/g, '').trim();
}
