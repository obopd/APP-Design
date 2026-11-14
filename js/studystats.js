// Study mode's Stats tab, like Anki's: today, card counts, future due (forecast), reviews
// per day, intervals, true retention, hourly breakdown, answer buttons, and the FSRS
// memory spread (difficulty, stability, retrievability). Bars are inline SVG; tapping a bar
// shows its numbers under the chart.
import { h, fmt } from './util.js';
import { pick } from './ui.js';
import { cards as allCards, allReviews, deckTree, deckIds, getItem } from './study.js';
import { dayOf, dayStart, currentR } from './srs.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  kids.flat().forEach((k) => k && el.append(k));
  return el;
};

let scope = '';     // '' = all decks, else a deck id (with its subdecks)
let period = 30;    // days: 30 | 90 | 365
let rootEl = null;

const PERIODS = [[30, '1 month'], [90, '3 months'], [365, '1 year']];
const dayFmt = (day) => fmt({ month: 'short', day: 'numeric' }).format(new Date(dayStart(day)));

/**
 * A bar chart. bars: [{ label, parts: [values], note }]; colors: one CSS class per part.
 * Tapping a bar writes `note` into the caption line.
 */
function bars(list, classes, { caption = '', height = 96 } = {}) {
  const n = list.length || 1;
  const max = Math.max(1, ...list.map((b) => b.parts.reduce((x, y) => x + y, 0)));
  const w = 100 / n;
  const cap = h('p', { class: 'chart-cap' }, caption);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 100 ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': caption },
    list.map((b, i) => {
      let y = height;
      const g = s('g', { class: 'bar' });
      b.parts.forEach((v, j) => {
        const bh = (v / max) * (height - 4);
        if (bh <= 0) return;
        y -= bh;
        g.append(s('rect', { x: (i * w + w * 0.12).toFixed(3), y: y.toFixed(3), width: (w * 0.76).toFixed(3), height: bh.toFixed(3), class: classes[j] }));
      });
      // An invisible full-height target so thin bars are easy to tap.
      g.append(s('rect', { x: (i * w).toFixed(3), y: 0, width: w.toFixed(3), height, class: 'bar-hit', fill: 'transparent' }));
      g.addEventListener('click', () => {
        svg.querySelectorAll('.bar.on').forEach((x) => x.classList.remove('on'));
        g.classList.add('on');
        cap.textContent = b.note;
      });
      return g;
    }));
  return h('div', { class: 'chart-box' }, svg,
    h('div', { class: 'chart-axis' }, h('span', {}, list[0]?.label || ''), h('span', {}, list.at(-1)?.label || '')), cap);
}

const card = (title, ...kids) => h('section', { class: 'stat-card' }, h('h3', { class: 'section-label' }, title), ...kids);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const legend = (items) => h('p', { class: 'chart-legend' }, items.map(([cls, label]) => h('span', {}, h('i', { class: cls }), label)));

export function renderStats(root) {
  rootEl = root;
  const now = Date.now();
  const today = dayOf(now);
  const ids = scope ? new Set(deckIds(scope)) : null;
  const cs = allCards().filter((c) => !ids || ids.has(c.deck));
  const cardIds = new Set(cs.map((c) => c.id));
  const rs = allReviews().filter((r) => cardIds.has(r.card) || (!ids && !getItem(r.card)));
  const from = today - period + 1;
  const inPeriod = rs.filter((r) => dayOf(r.at) >= from);

  // Today
  const todays = rs.filter((r) => dayOf(r.at) === today);
  const mins = Math.round(todays.reduce((a, r) => a + (r.time || 0), 0) / 60000);
  const again = todays.filter((r) => r.rating === 1).length;
  const todayLine = todays.length
    ? `Studied ${todays.length} card${todays.length === 1 ? '' : 's'} in ${mins} min · Again ${again} (${pct(todays.length - again, todays.length)} correct)`
    : 'No cards studied today.';

  // Counts
  const count = { new: 0, learn: 0, young: 0, mature: 0, suspended: 0 };
  for (const c of cs) {
    if (c.suspended) count.suspended += 1;
    else if (c.state === 'new') count.new += 1;
    else if (c.state !== 'review') count.learn += 1;
    else if ((c.ivl || 0) >= 21) count.mature += 1;
    else count.young += 1;
  }
  const totalCards = cs.length || 1;

  // Future due (next 30 days; day 0 includes overdue)
  const fdays = 30;
  const due = Array.from({ length: fdays }, () => [0, 0]);
  for (const c of cs) {
    if (c.suspended || c.state === 'new') continue;
    const d = Math.max(0, dayOf(c.due) - today);
    if (d < fdays) due[d][(c.ivl || 0) >= 21 ? 1 : 0] += 1;
  }
  const dueTotal = due.reduce((a, [x, y]) => a + x + y, 0);
  const forecast = bars(due.map(([y, m], i) => ({
    label: i === 0 ? 'Today' : `+${i}d`, parts: [y, m],
    note: `${i === 0 ? 'Today (with overdue)' : dayFmt(today + i)}: ${y + m} due (${y} young, ${m} mature)`,
  })), ['c-young', 'c-mature'], { caption: `${dueTotal} due in the next ${fdays} days · ${due[0][0] + due[0][1]} today` });

  // Reviews per day
  const byDay = new Map();
  for (const r of inPeriod) {
    const d = dayOf(r.at);
    const row = byDay.get(d) || [0, 0, 0, 0];
    row[{ new: 0, learn: 1, review: 2, relearn: 3 }[r.state] ?? 2] += 1;
    byDay.set(d, row);
  }
  const step = period > 120 ? 7 : 1; // a year: one bar a week
  const revBars = [];
  for (let d = from; d <= today; d += step) {
    const sum = [0, 0, 0, 0];
    for (let k = 0; k < step; k += 1) (byDay.get(d + k) || [0, 0, 0, 0]).forEach((v, j) => { sum[j] += v; });
    const tot = sum.reduce((a, b) => a + b, 0);
    revBars.push({ label: dayFmt(d), parts: sum, note: `${step > 1 ? `Week of ${dayFmt(d)}` : dayFmt(d)}: ${tot} reviews (${sum[0]} new, ${sum[1]} learning, ${sum[2]} review, ${sum[3]} relearning)` });
  }
  const studiedDays = new Set(inPeriod.map((r) => dayOf(r.at))).size;

  // Intervals
  const buckets = [[1, '1d'], [3, '3d'], [7, '1w'], [14, '2w'], [30, '1mo'], [90, '3mo'], [180, '6mo'], [365, '1y'], [Infinity, '1y+']];
  const ivlCounts = buckets.map(() => 0);
  const reviewCards = cs.filter((c) => c.state === 'review' && !c.suspended);
  for (const c of reviewCards) ivlCounts[buckets.findIndex(([max]) => (c.ivl || 0) <= max)] += 1;
  const avgIvl = reviewCards.length ? Math.round(reviewCards.reduce((a, c) => a + (c.ivl || 0), 0) / reviewCards.length) : 0;

  // True retention: review answers (not learning), passed = not Again.
  const ret = (days, mature) => {
    const list = rs.filter((r) => r.state === 'review' && dayOf(r.at) > today - days && ((r.lastIvl || 0) >= 21) === mature);
    return [list.filter((r) => r.rating > 1).length, list.length];
  };
  const retRow = (label, days) => {
    const [yp, yt] = ret(days, false);
    const [mp, mt] = ret(days, true);
    return h('tr', {}, h('td', {}, label), h('td', {}, pct(yp, yt), h('small', {}, ` ${yt}`)), h('td', {}, pct(mp, mt), h('small', {}, ` ${mt}`)), h('td', {}, pct(yp + mp, yt + mt)));
  };

  // Hourly breakdown (period)
  const hours = Array.from({ length: 24 }, () => [0, 0]);
  for (const r of inPeriod) { const hr = new Date(r.at).getHours(); hours[hr][0] += 1; if (r.rating > 1) hours[hr][1] += 1; }
  const hourFmt = (hr) => fmt({ hour: 'numeric' }).format(new Date(2000, 0, 1, hr));

  // Answer buttons (period)
  const btn = [0, 0, 0, 0];
  inPeriod.forEach((r) => { btn[r.rating - 1] += 1; });
  const btnTotal = btn.reduce((a, b) => a + b, 0);

  // FSRS memory
  const withS = reviewCards.filter((c) => c.S != null);
  const hist = (vals, edges, fmtLabel) => {
    const out = edges.map(() => 0);
    vals.forEach((v) => { const i = edges.findIndex((e) => v <= e); out[i < 0 ? edges.length - 1 : i] += 1; });
    return bars(out.map((v, i) => ({ label: fmtLabel(i), parts: [v], note: `${fmtLabel(i)}: ${v} card${v === 1 ? '' : 's'}` })), ['c-review']);
  };
  const dVals = withS.map((c) => ((c.D - 1) / 9) * 100);
  const rVals = withS.map((c) => (currentR(c, now) || 0) * 100);
  const sVals = withS.map((c) => c.S);
  const sEdges = [1, 3, 7, 14, 30, 90, 180, 365, 1e9];
  const sNames = ['1d', '3d', '1w', '2w', '1mo', '3mo', '6mo', '1y', '1y+'];

  const scopeBtn = h('button', { class: 'pill', onclick: async (e) => {
    const v = await pick(e.currentTarget, [['', 'All decks'], ...deckTree().filter(({ deck: d }) => !d.filtered).map(({ deck: d, depth }) => [d.id, `${' '.repeat(depth * 2)}${d.name}`])], scope);
    if (v !== undefined) { scope = v; renderStats(root); }
  } }, scope ? (deckTree().find(({ deck: d }) => d.id === scope)?.deck.name || 'All decks') : 'All decks');
  const periodBtn = h('div', { class: 'segmented', role: 'radiogroup' }, PERIODS.map(([v, label]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(v === period), onclick: () => { period = v; renderStats(root); },
  }, label)));

  root.replaceChildren(h('div', { class: 'settings study-page stats' },
    h('div', { class: 'page-head' }, h('h1', { class: 'display' }, 'Stats'), scopeBtn),
    periodBtn,
    card('Today', h('p', { class: 'stat-line' }, todayLine)),
    card('Cards',
      h('div', { class: 'stack-bar' }, [['c-new', count.new], ['c-learn', count.learn], ['c-young', count.young], ['c-mature', count.mature], ['c-susp', count.suspended]]
        .map(([cls, v]) => (v ? h('i', { class: cls, style: `flex:${v}` }) : null))),
      h('ul', { class: 'stat-grid' }, [['c-new', 'New', count.new], ['c-learn', 'Learning', count.learn], ['c-young', 'Young', count.young], ['c-mature', 'Mature', count.mature], ['c-susp', 'Suspended', count.suspended]]
        .map(([cls, label, v]) => h('li', {}, h('i', { class: cls }), label, h('b', {}, String(v)), h('small', {}, pct(v, totalCards)))))),
    card('Future due', forecast, legend([['c-young', 'Young'], ['c-mature', 'Mature (21d+)']])),
    card('Reviews', bars(revBars, ['c-new', 'c-learn', 'c-review', 'c-relearn'], {
      caption: `${inPeriod.length} reviews · studied ${studiedDays} of ${period} days · ${Math.round(inPeriod.length / Math.max(1, period))} a day on average`,
    }), legend([['c-new', 'New'], ['c-learn', 'Learning'], ['c-review', 'Review'], ['c-relearn', 'Relearning']])),
    card('Intervals', bars(buckets.map(([, label], i) => ({ label, parts: [ivlCounts[i]], note: `Up to ${label}: ${ivlCounts[i]} cards` })), ['c-review'], {
      caption: `Average interval ${avgIvl} day${avgIvl === 1 ? '' : 's'}`,
    })),
    card('True retention',
      h('table', { class: 'stat-table' },
        h('thead', {}, h('tr', {}, ['', 'Young', 'Mature', 'Total'].map((t) => h('th', {}, t)))),
        h('tbody', {}, retRow('Today', 1), retRow('Week', 7), retRow('Month', 30), retRow('Year', 365))),
      h('p', { class: 'set-note' }, 'Share of review answers that weren’t Again.')),
    card('Hourly breakdown', bars(hours.map(([n, ok], hr) => ({ label: hourFmt(hr), parts: [n], note: `${hourFmt(hr)}: ${n} reviews, ${pct(ok, n)} correct` })), ['c-review'], {
      caption: (() => { const best = hours.map(([n, ok], hr) => ({ hr, n, r: n >= 5 ? ok / n : -1 })).sort((a, b) => b.r - a.r)[0]; return best && best.r >= 0 ? `Best hour: ${hourFmt(best.hr)} (${Math.round(best.r * 100)}% correct)` : 'Tap a bar for its numbers.'; })(),
    })),
    card('Answer buttons', h('ul', { class: 'stat-grid buttons' }, ['Again', 'Hard', 'Good', 'Easy'].map((label, i) => h('li', {},
      h('i', { class: `ans-dot r${i + 1}` }), label, h('b', {}, String(btn[i])), h('small', {}, pct(btn[i], btnTotal)))))),
    withS.length ? card('Memory (FSRS)',
      h('p', { class: 'set-note' }, 'Difficulty'), hist(dVals, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], (i) => `${i * 10}–${i * 10 + 10}%`),
      h('p', { class: 'set-note' }, 'Stability (days until recall drops to 90%)'), hist(sVals, sEdges, (i) => sNames[i]),
      h('p', { class: 'set-note' }, `Retrievability (chance of recalling now) · average ${Math.round(rVals.reduce((a, b) => a + b, 0) / rVals.length)}%`),
      hist(rVals, [50, 60, 70, 80, 85, 90, 95, 100], (i) => ['<50%', '50–60%', '60–70%', '70–80%', '80–85%', '85–90%', '90–95%', '95%+'][i])) : null));
}

export const redrawStats = () => { if (rootEl && !rootEl.hidden) renderStats(rootEl); };
