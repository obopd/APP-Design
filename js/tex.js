// Math in study cards: the TeX that Anki cards use (\( … \) inline, \[ … \] display)
// turned into MathML, which iPhone Safari draws natively. Elements are built one by one
// (createElementNS), never from HTML. A practical subset: fractions, powers / indices,
// roots, Greek letters, operators, arrows, accents, \text, \left…\right, matrices / cases,
// \class{cloze}{…} (cloze inside math, like Anki) and simple chemistry (\ce{H2O}).
// Anything it can't read is shown as the original TeX, never dropped.

const NS = 'http://www.w3.org/1998/Math/MathML';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  kids.flat().forEach((k) => k && e.append(typeof k === 'string' ? document.createTextNode(k) : k));
  return e;
};

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  ell: 'ℓ', hbar: 'ℏ', infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ',
};
const OPS = {
  cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔',
  rightleftharpoons: '⇌', longrightarrow: '⟶', mapsto: '↦', uparrow: '↑', downarrow: '↓', implies: '⟹', iff: '⟺',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', angle: '∠', perp: '⊥', parallel: '∥', mid: '∣',
  ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', degree: '°', therefore: '∴', because: '∵',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖',
};
const BIG = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', bigcup: '⋃', bigcap: '⋂', lim: 'lim', max: 'max', min: 'min', sup: 'sup', inf: 'inf' };
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'det', 'dim', 'gcd', 'deg', 'arg', 'ker', 'Pr']);
const SPACES = { ',': '0.17em', ':': '0.22em', ';': '0.28em', ' ': '0.25em', quad: '1em', qquad: '2em', '!': '-0.17em' };
const ACCENTS = { vec: '→', hat: '^', widehat: '^', bar: '¯', overline: '¯', tilde: '~', widetilde: '~', dot: '˙', ddot: '¨', overrightarrow: '→' };
const FONTS = { mathrm: 'normal', mathbf: 'bold', mathit: 'italic', mathsf: 'sans-serif', mathtt: 'monospace', mathcal: 'script', mathbb: 'double-struck', boldsymbol: 'bold', textbf: 'bold', textit: 'italic' };
const TEXTS = new Set(['text', 'textrm', 'mbox', 'textnormal', 'operatorname']);
const FENCES = { '(': '(', ')': ')', '[': '[', ']': ']', '\\{': '{', '\\}': '}', '|': '|', '.': '', '\\langle': '⟨', '\\rangle': '⟩', '\\|': '‖', '\\vert': '|', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉' };

// Commands whose {…} is text (or a name), kept exactly as typed: { raw } tokens.
const RAW = new Set([...TEXTS, 'ce', 'class', 'color', 'textcolor', 'begin', 'end']);

function tokenize(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\\') {
      const m = src.slice(i + 1).match(/^([a-zA-Z]+|.)/);
      if (!m) { i += 1; continue; }
      out.push(`\\${m[1]}`);
      i += 1 + m[1].length;
      if (/^[a-zA-Z]/.test(m[1])) while (src[i] === ' ') i += 1;
      if (RAW.has(m[1]) && src[i] === '{') {
        let depth = 0;
        let j = i;
        for (; j < src.length; j += 1) {
          if (src[j] === '\\') { j += 1; continue; }
          if (src[j] === '{') depth += 1;
          if (src[j] === '}') { depth -= 1; if (!depth) break; }
        }
        out.push({ raw: src.slice(i + 1, j) });
        i = j + 1;
      }
    } else if (/\s/.test(c)) i += 1;
    else if (/[0-9]/.test(c)) {
      const m = src.slice(i).match(/^[0-9]+(?:\.[0-9]+)?/);
      out.push(m[0]);
      i += m[0].length;
    } else { out.push(c); i += 1; }
  }
  return out;
}

// \ce{H2O}, \ce{2H2 + O2 -> 2H2O}, \ce{SO4^2-}: a small subset of mhchem, written as TeX.
function chem(s) {
  return s
    .replace(/<=>/g, ' \\rightleftharpoons ').replace(/<->/g, ' \\leftrightarrow ').replace(/->/g, ' \\rightarrow ').replace(/<-/g, ' \\leftarrow ')
    .replace(/\^\{?([0-9]*[+-])\}?/g, '^{$1}')
    .replace(/([A-Za-z)\]])([0-9]+)/g, '$1_{$2}')
    .replace(/(^|[\s+])([0-9]+)(?=[A-Z(])/g, '$1$2\\,')
    .replace(/([A-Z][a-z]?)/g, '\\mathrm{$1}');
}

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  done() { return this.i >= this.t.length; }

  // A run of items until `}`, `\right`, `&`, `\\` or `\end`.
  list(stopAt = []) {
    const kids = [];
    while (!this.done()) {
      const k = this.peek();
      if (k === '}' || k === '\\right' || k === '\\end' || stopAt.includes(k)) break;
      const a = this.scripted();
      if (a) kids.push(a);
    }
    return kids;
  }
  row(kids) { return kids.length === 1 ? kids[0] : el('mrow', {}, kids); }
  group() { // {…} or a single atom
    if (this.peek() === '{') {
      this.next();
      const kids = this.list();
      if (this.peek() === '}') this.next();
      return this.row(kids);
    }
    return this.atom() || el('mrow');
  }
  rawGroup() { // the text inside {…}, unparsed
    if (this.peek() && typeof this.peek() === 'object') return this.next().raw;
    if (this.peek() !== '{') return String(this.next() || '');
    this.next();
    let depth = 1;
    let out = '';
    while (!this.done()) {
      const k = this.next();
      if (k === '{') depth += 1;
      if (k === '}') { depth -= 1; if (!depth) break; }
      out += k.startsWith('\\') && /[a-zA-Z]$/.test(k) ? `${k} ` : k;
    }
    return out;
  }
  scripted() {
    const pk = this.peek();
    const isBig = typeof pk === 'string' && pk.startsWith('\\') && !!BIG[pk.slice(1)];
    let base = this.atom();
    if (!base) return null;
    let sub = null;
    let sup = null;
    while (this.peek() === '_' || this.peek() === '^' || this.peek() === "'") {
      const k = this.next();
      if (k === "'") { sup = el('mo', {}, '′'); continue; }
      if (k === '_') sub = this.group(); else sup = this.group();
    }
    if (sub && sup) base = el(isBig ? 'munderover' : 'msubsup', {}, base, sub, sup);
    else if (sub) base = el(isBig ? 'munder' : 'msub', {}, base, sub);
    else if (sup) base = el(isBig ? 'mover' : 'msup', {}, base, sup);
    return base;
  }
  atom() {
    const k = this.next();
    if (k == null) return null;
    if (typeof k === 'object') return el('mtext', {}, k.raw);
    if (k === '{') { this.i -= 1; return this.group(); }
    if (/^[0-9]/.test(k)) return el('mn', {}, k);
    if (/^[a-zA-Z]$/.test(k)) return el('mi', {}, k);
    if (k === '-') return el('mo', {}, '−');
    if (k === '~') return el('mspace', { width: '0.25em' });
    if (!k.startsWith('\\')) return el('mo', {}, k);
    const name = k.slice(1);
    if (SPACES[name]) return el('mspace', { width: SPACES[name] });
    if (GREEK[name]) return el(/^[A-Z]/.test(name) ? 'mi' : 'mi', { mathvariant: /^[A-Z]/.test(name) ? 'normal' : null }, GREEK[name]);
    if (OPS[name]) return el('mo', {}, OPS[name]);
    if (BIG[name]) return el(name.length > 3 || ['lim', 'max', 'min', 'sup', 'inf'].includes(name) ? 'mi' : 'mo', { largeop: 'true', movablelimits: 'true' }, BIG[name]);
    // cos θ: a thin space before, and the invisible "function of" sign after (browsers space it).
    if (FUNCS.has(name)) return el('mrow', {}, el('mspace', { width: '0.17em' }), el('mi', { mathvariant: 'normal' }, name), el('mo', {}, '\u2061'));
    if ('{}%$&#_'.includes(name)) return el('mo', {}, name);
    if (name === '\\') return el('mspace', { linebreak: 'newline' });
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return el('mfrac', {}, this.group(), this.group());
    if (name === 'binom') return el('mrow', {}, el('mo', {}, '('), el('mfrac', { linethickness: '0' }, this.group(), this.group()), el('mo', {}, ')'));
    if (name === 'sqrt') {
      if (this.peek() === '[') {
        this.next();
        const idx = this.list([']']);
        if (this.peek() === ']') this.next();
        return el('mroot', {}, this.group(), this.row(idx));
      }
      return el('msqrt', {}, this.group());
    }
    if (ACCENTS[name]) return el('mover', { accent: 'true' }, this.group(), el('mo', { stretchy: name.startsWith('wide') || name === 'overline' || name === 'overrightarrow' ? 'true' : 'false' }, ACCENTS[name]));
    if (name === 'underline') return el('munder', {}, this.group(), el('mo', {}, '_'));
    if (name === 'overset' || name === 'stackrel') { const top = this.group(); return el('mover', {}, this.group(), top); }
    if (name === 'underset') { const bot = this.group(); return el('munder', {}, this.group(), bot); }
    if (TEXTS.has(name)) return el(name === 'operatorname' ? 'mi' : 'mtext', name === 'operatorname' ? { mathvariant: 'normal' } : {}, this.rawGroup().replace(/\\([{}%$&#_ ])/g, '$1'));
    if (FONTS[name]) {
      const g = this.group();
      g.querySelectorAll?.('mi').forEach((x) => x.setAttribute('mathvariant', FONTS[name]));
      if (g.tagName === 'mi') g.setAttribute('mathvariant', FONTS[name]);
      return g;
    }
    if (name === 'class') { const cls = this.rawGroup(); const g = el('mrow', { class: /^[\w-]+$/.test(cls) ? `tex-${cls}` : null }, this.group()); return g; }
    if (name === 'color' || name === 'textcolor') {
      const c = this.rawGroup();
      const ok = /^#?[\w]+$/.test(c);
      return el('mstyle', { mathcolor: ok ? c : null }, name === 'textcolor' ? this.group() : this.row(this.list()));
    }
    if (name === 'ce') return new Parser(tokenize(chem(this.rawGroup()))).math();
    if (name === 'left') {
      const open = this.fence();
      const inner = this.list();
      if (this.peek() === '\\right') this.next();
      const close = this.fence();
      return el('mrow', {}, open ? el('mo', { stretchy: 'true' }, open) : null, ...inner, close ? el('mo', { stretchy: 'true' }, close) : null);
    }
    if (name === 'begin') return this.env(this.rawGroup());
    if (['displaystyle', 'textstyle', 'limits', 'nolimits', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr'].includes(name)) return null;
    return el('mtext', { class: 'tex-unknown' }, k);
  }
  fence() {
    const k = this.next() || '.';
    return FENCES[k] ?? k;
  }
  env(name) {
    const rows = [];
    let cells = [];
    for (;;) {
      cells.push(el('mtd', {}, this.row(this.list(['&', '\\\\']))));
      const k = this.next();
      if (k === '&') continue;
      rows.push(el('mtr', {}, cells));
      cells = [];
      if (k === '\\\\') continue;
      if (k === '\\end') this.rawGroup();
      break;
    }
    const table = el('mtable', { columnalign: name.startsWith('align') || name === 'cases' ? 'left' : null }, rows);
    const fence = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], vmatrix: ['|', '|'], Bmatrix: ['{', '}'], cases: ['{', ''] }[name.replace('*', '')];
    return fence ? el('mrow', {}, el('mo', {}, fence[0]), table, fence[1] ? el('mo', {}, fence[1]) : null) : table;
  }
  math() { return this.row(this.list()); }
}

/** A <math> element for some TeX, or null when it can't be read. */
export function texToMathML(tex, display = false) {
  try {
    const p = new Parser(tokenize(String(tex)));
    const body = p.math();
    return el('math', { display: display ? 'block' : 'inline' }, body);
  } catch {
    return null;
  }
}

// \( … \), \[ … \] (and Anki's [$] … [/$], [$$] … [/$$]) inside a piece of text.
const MATH_RE = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\[\$\$\]([\s\S]+?)\[\/\$\$\]|\[\$\]([\s\S]+?)\[\/\$\]/g;
export function hasMath(text) {
  MATH_RE.lastIndex = 0;
  const found = MATH_RE.test(text);
  MATH_RE.lastIndex = 0;
  return found;
}

/** Text → [text and <math> nodes]. */
export function mathNodes(text) {
  const out = [];
  let last = 0;
  MATH_RE.lastIndex = 0;
  for (const m of text.matchAll(MATH_RE)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const display = m[2] != null || m[3] != null;
    const node = texToMathML(m[1] ?? m[2] ?? m[3] ?? m[4], display);
    out.push(node || document.createTextNode(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** Where cloze deletions sit inside math, Anki marks them with \class{cloze}{…}. */
export function inMath(text, index) {
  MATH_RE.lastIndex = 0;
  for (const m of String(text).matchAll(MATH_RE)) {
    if (index > m.index && index < m.index + m[0].length) return true;
  }
  return false;
}
