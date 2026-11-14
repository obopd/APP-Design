// Study mode's card search, in Anki's syntax:
//
//   dog cat            both words, anywhere in the note        "a phrase"   exact phrase
//   dog or cat         either                                  -dog         not dog
//   (a or b) c         grouping                                d*g          * = anything
//   front:dog          in a field                              deck:French  deck and its subdecks
//   tag:verb           tag (and its tag::children)             note:Basic   note type
//   card:1 / card:Card 2                                       flag:1       red (0 none … 7)
//   is:new is:learn is:review is:due is:suspended is:buried is:leech
//   prop:ivl>=10  prop:due<=1  prop:lapses>3  prop:reps<5  prop:ease<2.5  prop:s>30  prop:d>7
//   added:7            added in the last 7 days                rated:1      answered today
//   rated:7:1          answered Again in the last 7 days       introduced:3 first seen ≤ 3 days ago
import { plain } from './cardtext.js';
import { dayOf } from './srs.js';

function tokenize(q) {
  const out = [];
  const re = /\s*(-\(|\(|\)|-?"[^"]*"|-?[^\s()"]+(?:"[^"]*")?)/g;
  let m;
  while ((m = re.exec(q))) out.push(m[1]);
  return out;
}

const wild = (s) => new RegExp(`^${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.')}$`, 'i');
const contains = (s) => new RegExp(s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.'), 'i');
const unquote = (s) => s.replace(/^"|"$/g, '');

const PROPS = {
  ivl: (c) => c.ivl || 0,
  due: (c, x) => (c.state === 'review' ? dayOf(c.due) - x.today : null),
  lapses: (c) => c.lapses || 0,
  reps: (c) => c.reps || 0,
  ease: (c) => c.ease || 0,
  s: (c) => c.S ?? null,
  d: (c) => c.D ?? null,
  pos: (c) => c.pos || 0,
};
const CMP = { '<=': (a, b) => a <= b, '>=': (a, b) => a >= b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '=': (a, b) => a === b };

// One search term → test(card, ctx). ctx: { note, type, deckPath, deckIds(name), reviews, today }.
function term(raw) {
  const neg = raw.startsWith('-') && raw.length > 1;
  const t = neg ? raw.slice(1) : raw;
  const test = termTest(t);
  return neg ? (c, x) => !test(c, x) : test;
}

function termTest(t) {
  if (t.startsWith('"')) {
    const re = contains(unquote(t));
    return (c, x) => re.test(x.text(c));
  }
  const i = t.indexOf(':');
  if (i <= 0) {
    const re = contains(t);
    return (c, x) => re.test(x.text(c));
  }
  const key = t.slice(0, i).toLowerCase();
  const val = unquote(t.slice(i + 1));
  switch (key) {
    case 'deck': {
      if (val === 'filtered') return (c, x) => !!x.deckOf(c)?.filtered;
      const re = wild(val);
      return (c, x) => x.deckPaths(c).some((p) => re.test(p));
    }
    case 'tag': {
      if (val === 'none') return (c, x) => !x.note(c)?.tags?.length;
      const re = wild(val);
      return (c, x) => (x.note(c)?.tags || []).some((tg) => re.test(tg) || tg.toLowerCase().startsWith(`${val.toLowerCase()}::`));
    }
    case 'note': { const re = wild(val); return (c, x) => re.test(x.type(c)?.name || ''); }
    case 'card': {
      if (/^\d+$/.test(val)) return (c) => c.ord === Number(val) - 1;
      const re = wild(val);
      return (c, x) => { const ty = x.type(c); return re.test(ty?.templates?.[ty.cloze ? 0 : c.ord]?.name || ''); };
    }
    case 'flag': return (c) => (c.flag || 0) === Number(val);
    case 'is': return isTest(val);
    case 'prop': {
      const m = val.match(/^([a-z]+)(<=|>=|!=|<|>|=)(-?[\d.]+)$/i);
      if (!m || !PROPS[m[1].toLowerCase()]) return () => false;
      const get = PROPS[m[1].toLowerCase()];
      const cmp = CMP[m[2]];
      const n = Number(m[3]);
      return (c, x) => { const v = get(c, x); return v != null && cmp(v, n); };
    }
    case 'added': {
      const n = Math.max(1, Number(val) || 1);
      return (c, x) => { const a = x.note(c)?.added; return !!a && dayOf(a) > x.today - n; };
    }
    case 'rated': {
      const [days, ease] = val.split(':').map(Number);
      const n = Math.max(1, days || 1);
      return (c, x) => x.reviews(c).some((r) => dayOf(r.at) > x.today - n && (!ease || r.rating === ease));
    }
    case 'introduced': {
      const n = Math.max(1, Number(val) || 1);
      return (c, x) => { const first = x.reviews(c)[0]; return !!first && dayOf(first.at) > x.today - n; };
    }
    case 'nid': return (c) => c.note === val;
    case 'cid': return (c) => c.id === val;
    default: {
      // field:value
      const re = wild(val);
      return (c, x) => {
        const n = x.note(c);
        const ty = x.type(c);
        const f = ty?.fields?.find((name) => name.toLowerCase() === key);
        return !!f && re.test(plain(n?.fields?.[f] || ''));
      };
    }
  }
}

function isTest(v) {
  switch (v.toLowerCase()) {
    case 'new': return (c) => c.state === 'new';
    case 'learn': return (c) => c.state === 'learn' || c.state === 'relearn';
    case 'review': return (c) => c.state === 'review' || c.state === 'relearn';
    case 'due': return (c, x) => !c.suspended && ((c.state === 'review' && dayOf(c.due) <= x.today) || ((c.state === 'learn' || c.state === 'relearn') && c.due <= x.now + 20 * 60_000));
    case 'suspended': return (c) => !!c.suspended;
    case 'buried': return (c, x) => c.buried === x.today;
    case 'leech': return (c, x) => (x.note(c)?.tags || []).includes('leech');
    case 'flagged': return (c) => !!c.flag;
    default: return () => false;
  }
}

// Recursive descent: or-groups of and-ed terms; parentheses group.
function parse(tokens) {
  let i = 0;
  const orExpr = () => {
    const parts = [andExpr()];
    while (i < tokens.length && /^or$/i.test(tokens[i])) { i += 1; parts.push(andExpr()); }
    return parts.length === 1 ? parts[0] : (c, x) => parts.some((p) => p(c, x));
  };
  const andExpr = () => {
    const parts = [];
    while (i < tokens.length && tokens[i] !== ')' && !/^or$/i.test(tokens[i])) {
      if (/^(and)$/i.test(tokens[i])) { i += 1; continue; }
      if (tokens[i] === '(' || tokens[i] === '-(') {
        const neg = tokens[i] === '-(';
        i += 1;
        const inner = orExpr();
        if (tokens[i] === ')') i += 1;
        parts.push(neg ? (c, x) => !inner(c, x) : inner);
      } else {
        parts.push(term(tokens[i]));
        i += 1;
      }
    }
    return (c, x) => parts.every((p) => p(c, x));
  };
  const fn = orExpr();
  return fn;
}

/**
 * Compile a search into test(card, ctx). Bad syntax never throws: it just matches less.
 * ctx comes from searchContext() in study.js callers.
 */
export function compileSearch(query) {
  const q = String(query || '').trim();
  if (!q) return () => true;
  try { return parse(tokenize(q)); } catch { return () => false; }
}
