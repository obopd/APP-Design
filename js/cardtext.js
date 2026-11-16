// Study mode's card text: note types (fields + card templates), Anki-style template
// rendering ({{Field}}, {{FrontSide}}, {{cloze:Text}}, {{type:Back}}, {{#Field}}…{{/Field}}),
// and a sanitizer that turns card HTML (typed here or imported from Anki) into safe DOM
// nodes: a fixed list of formatting tags, a few style properties, never scripts or handlers.
import { h } from './util.js';
import { hasMath, mathNodes, inMath } from './tex.js';

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
  {
    id: 'nt-io', name: 'Image Occlusion', cloze: true, io: { occl: 'Occlusion', image: 'Image' },
    fields: ['Occlusion', 'Image', 'Header', 'Back Extra', 'Comments'],
    templates: ioTemplates(['Occlusion', 'Image', 'Header', 'Back Extra']),
  },
];

/**
 * Card templates for image occlusion (Anki's field order: Occlusion, Image, Header, Back
 * Extra). The picture goes in .io-slot; occlusion.js covers it.
 */
export function ioTemplates([, image, header, extra]) {
  const head = header ? `{{#${header}}}<div class="io-header">{{${header}}}</div>{{/${header}}}` : '';
  const front = `${head}<div class="io-slot">{{${image}}}</div>`;
  return [{ name: 'Image Occlusion', front, back: `${front}${extra ? `{{#${extra}}}<div class="io-extra">{{${extra}}}</div>{{/${extra}}}` : ''}` }];
}

/* ---------- Plain text ---------- */

// HTML → plain text (search, duplicate check, lists). Uses an inert document.
const inert = typeof document !== 'undefined' ? document.implementation.createHTMLDocument('') : null;
export function plain(html) {
  if (!html) return '';
  if (!inert) return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const d = new DOMParser().parseFromString(`<body>${String(html).replace(/<br\s*\/?>/gi, ' ').replace(/\[sound:[^\]]+\]/g, ' ')}`, 'text/html');
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
  const src = String(text || '');
  return src.replace(CLOZE_RE, (all, num, answer, hint, at) => {
    const math = inMath(src, at); // inside a formula: Anki's \class{cloze}{…}
    if (Number(num) !== n) return answer;
    if (math) return back ? `\\class{cloze}{${answer}}` : `\\class{cloze}{[${hint ? `\\text{${hint}}` : '\\ldots'}]}`;
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

/* ---------- Media references ---------- */

const unescapeHtml = (v) => v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Add the media names some card HTML uses (<img src="…">, [sound:…]) to `into`. */
export function mediaRefs(html, into = new Set()) {
  for (const m of String(html || '').matchAll(/<img[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const v = unescapeHtml(m[1] ?? m[2] ?? m[3] ?? '');
    into.add(v);
    try { into.add(decodeURIComponent(v)); } catch { /* keep as is */ }
  }
  for (const m of String(html || '').matchAll(/\[sound:([^\]]+)\]/g)) into.add(unescapeHtml(m[1].trim()));
  return into;
}

/* ---------- Sanitizer: HTML string → safe DOM ---------- */

const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'br', 'div', 'p', 'span',
  'ul', 'ol', 'li', 'hr', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'small', 'big', 'mark', 'ruby', 'rt', 'rp', 'center', 'font', 'a']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'head', 'title', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'template', 'noscript']);
const STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-size', 'vertical-align']);
const SAFE_VALUE = /^[#(),.%\w\s-]+$/;
const CLASSES = new Set(['cloze', 'answer', 'typein', 'hint', 'snd', 'io-slot', 'io-header', 'io-extra']);
const OWN_NAME = /^-?[_a-zA-Z][\w-]{0,39}$/;
// A card's own media file (Anki style: a bare name), never a web address or data URL.
const mediaName = (src) => {
  const v = String(src || '').trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.includes('/')) return null;
  try { return decodeURIComponent(v); } catch { return v; }
};

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

function copy(node, into, opts) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      if ((opts.math || opts.card) && hasMath(n.nodeValue)) into.append(...mathNodes(n.nodeValue));
      else into.append(document.createTextNode(n.nodeValue));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (tag === 'img') {
      const name = mediaName(n.dataset?.media || n.getAttribute('src'));
      if (name) into.append(h('img', { class: 'card-img', 'data-media': name, alt: '' }));
      continue;
    }
    if (!TAGS.has(tag)) { copy(n, into, opts); continue; } // unknown wrapper: keep its text
    const el = document.createElement(tag === 'font' || tag === 'a' || tag === 'center' ? 'span' : tag);
    const style = cleanStyle(n.getAttribute('style'));
    const color = tag === 'font' && n.getAttribute('color');
    const styles = [style, color && SAFE_VALUE.test(color) ? `color:${color}` : '', tag === 'center' ? 'display:block;text-align:center' : ''].filter(Boolean).join(';');
    if (styles) el.setAttribute('style', styles);
    const given = `${n.getAttribute('class') || ''} ${n.dataset?.cls || ''}`.split(/\s+/).filter(Boolean);
    const cls = given.filter((c) => CLASSES.has(c));
    if (n.tagName === 'HR' && n.id === 'answer') cls.push('answer');
    // The deck's own classes / ids, for its note type's styling: on a card they're renamed
    // (x-name, xid-name) so they can't pick up the app's own styles; elsewhere they're only
    // kept aside (data-cls, data-xid) so saving a field doesn't lose them.
    const own = given.filter((c) => !CLASSES.has(c) && OWN_NAME.test(c));
    const id = n.getAttribute('id') || n.dataset?.xid || '';
    const ownId = OWN_NAME.test(id) && !(tag === 'hr' && id === 'answer') ? id : '';
    if (opts.card) {
      cls.push(...own.map((c) => `x-${c}`));
      if (ownId) cls.push(`xid-${ownId}`);
    } else {
      if (own.length) el.dataset.cls = own.join(' ');
      if (ownId) el.dataset.xid = ownId;
    }
    if (cls.length) el.className = cls.join(' ');
    if (tag === 'span' && n.dataset?.field && cls.includes('typein')) el.dataset.field = n.dataset.field;
    if (tag === 'span' && cls.includes('snd') && mediaName(n.dataset?.media)) el.dataset.media = mediaName(n.dataset.media);
    if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(n.getAttribute('colspan') || '')) el.setAttribute('colspan', n.getAttribute('colspan'));
    copy(n, el, opts);
    into.append(el);
  }
}

// [sound:name.mp3] → a player slot (filled by studymedia.js).
const soundSlots = (html) => String(html).replace(/\[sound:([^\]]+)\]/g, (all, name) => `<span class="snd" data-media="${esc(name.trim())}"></span>`);

/**
 * Safe DOM (a fragment) from card / field HTML. `card`: it's shown as a card (formulas drawn,
 * the deck's classes renamed for its styling); otherwise it's for the editor, which keeps the
 * TeX so it can be edited and saved.
 */
export function safeFragment(html, opts = {}) {
  const frag = document.createDocumentFragment();
  if (!html) return frag;
  const d = new DOMParser().parseFromString(`<body>${soundSlots(html)}`, 'text/html');
  copy(d.body, frag, opts);
  return frag;
}

/** Clean HTML string (for saving what was typed in a field). */
export function cleanHtml(html) {
  const box = document.createElement('div');
  box.append(safeFragment(html));
  // Media go back to Anki's form: <img src="name"> and [sound:name].
  box.querySelectorAll('img[data-media]').forEach((img) => {
    const clean = document.createElement('img');
    clean.setAttribute('src', img.dataset.media);
    img.replaceWith(clean);
  });
  box.querySelectorAll('.snd[data-media]').forEach((sp) => sp.replaceWith(document.createTextNode(`[sound:${sp.dataset.media}]`)));
  box.querySelectorAll('[data-cls]').forEach((el) => { el.className = `${el.className} ${el.dataset.cls}`.trim(); delete el.dataset.cls; });
  box.querySelectorAll('[data-xid]').forEach((el) => { el.id = el.dataset.xid; delete el.dataset.xid; });
  // Trailing empty lines from the editor aren't content.
  return box.innerHTML.replace(/(<br>|<div><br><\/div>)+$/g, '').trim();
}

/* ---------- Note type styling (Anki "Styling" CSS), made safe and scoped ---------- */

const CSS_PROPS = new Set(['color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'text-align', 'text-decoration', 'text-transform', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-width', 'border-style', 'border-radius', 'width', 'min-width', 'max-width', 'height', 'min-height',
  'max-height', 'display', 'vertical-align', 'list-style', 'list-style-type', 'opacity', 'text-shadow', 'box-shadow', 'gap',
  'justify-content', 'align-items', 'flex', 'flex-direction', 'flex-wrap', 'overflow-wrap', 'word-break', 'text-indent',
  'position', 'top', 'right', 'bottom', 'left', 'z-index', 'visibility', 'float', 'clear', 'object-fit']);
const DISPLAYS = new Set(['block', 'inline', 'inline-block', 'none', 'flex', 'inline-flex', 'grid', 'table', 'table-row', 'table-cell', 'list-item']);
// The card itself keeps the app's colours and font, so light / dark mode keep working.
const ROOT_SKIP = new Set(['color', 'background', 'background-color', 'font-family']);

function cleanDecls(body, root) {
  const out = [];
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).replace(/!important/gi, '').trim();
    if (!CSS_PROPS.has(prop) || (root && ROOT_SKIP.has(prop)) || !val) continue;
    if (/[{}<>\\@]|url\s*\(|expression|javascript|image-set|var\s*\(/i.test(val)) continue;
    if (prop === 'display' && !DISPLAYS.has(val.toLowerCase())) continue;
    // Placed within the card only (it's the frame for absolute positions; never fixed / sticky).
    if (prop === 'position' && !/^(static|relative|absolute)$/i.test(val)) continue;
    if (prop === 'z-index' && !/^\d$/.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.join(';');
}

// One selector → [scoped selector, isTheCardItself]; null when it isn't usable.
function scopeSelector(sel, scope) {
  if (!sel || /[{}<>\\@[\]"'`]|url\s*\(/i.test(sel)) return null;
  let s = sel;
  let dark = '';
  if (/\.night_?mode\b/i.test(s)) { dark = ':root[data-theme="dark"] '; s = s.replace(/\.night_?mode\b/gi, ''); }
  const parts = s.trim().split(/\s+/).filter(Boolean);
  while (parts.length && /^(html|body|#qa|\.card|\.mobile|\.iphone|\.ios)$/i.test(parts[0])) parts.shift();
  if (parts[0]) parts[0] = parts[0].replace(/^\.card(?=[.:#[])/i, '&');
  const rest = parts.join(' ')
    .replace(/\.(-?[_a-zA-Z][\w-]*)/g, (all, c) => (CLASSES.has(c) ? all : `.x-${c}`))
    .replace(/#(-?[_a-zA-Z][\w-]*)/g, '.xid-$1');
  if (!rest) return [`${dark}${scope}`, true];
  if (rest.startsWith('&')) return [`${dark}${scope}${rest.slice(1)}`, true];
  return [`${dark}${scope} ${rest}`, false];
}

/** A note type's CSS, kept to what's safe and limited to that type's cards (`scope`). */
export function scopedCss(css, scope) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{};]*;/gi, '');
  const out = [];
  for (let i = 0; i < src.length;) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth; j += 1) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; }
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith('@')) {
      // Screen-size rules are kept (their insides cleaned the same way); other @-rules aren't.
      if (/^@media[\s\w():,.-]*$/i.test(prelude) && !/\{/.test(prelude)) {
        const inner = scopedCss(body, scope);
        if (inner) out.push(`${prelude}{${inner}}`);
      }
      continue;
    }
    const sels = prelude.split(',').map((x) => scopeSelector(x.trim(), scope)).filter(Boolean);
    const rootSels = sels.filter(([, r]) => r).map(([x]) => x);
    const innerSels = sels.filter(([, r]) => !r).map(([x]) => x);
    const rootDecls = rootSels.length ? cleanDecls(body, true) : '';
    const innerDecls = innerSels.length ? cleanDecls(body, false) : '';
    if (rootDecls) out.push(`${rootSels.join(',')}{${rootDecls}}`);
    if (innerDecls) out.push(`${innerSels.join(',')}{${innerDecls}}`);
  }
  return out.join('\n');
}

// One <style> for all note types' styling; each type's cards carry its scope class.
const scopes = new Map(); // note type id → { n, css }
let styleEl = null;
/** The class that gives a card its note type's styling ('' when it has none). */
export function styleClass(type) {
  if (!type || !String(type.css || '').trim() || typeof document === 'undefined') return '';
  let s = scopes.get(type.id);
  if (!s) { s = { n: scopes.size + 1, css: null }; scopes.set(type.id, s); }
  if (s.css !== type.css) {
    s.css = type.css;
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'card-styles'; document.head.append(styleEl); }
    styleEl.textContent = [...scopes.values()].map((x) => scopedCss(x.css, `.rv-card.nts-${x.n}`)).join('\n');
  }
  return `nts-${s.n}`;
}
