// D-Day tab: countdowns to birthdays, graduation… ("D-12", "D-Day", "D+30").
import { h, icon, ICONS, parseKey, todayKey } from './util.js';
import { state, save, uid, ddayTarget, ddayDiff } from './store.js';
import { ask } from './ui.js';

const dialog = document.getElementById('dday-sheet');

export const ddayLabel = (diff) => (diff === 0 ? 'D-Day' : diff > 0 ? `D-${diff}` : `D+${-diff}`);

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// "58th" for yearly D-Days whose start year is known, else null.
function nthOf(d, targetKey) {
  const year = parseKey(targetKey).getFullYear();
  const startYear = parseKey(d.date).getFullYear();
  return d.yearly && year > startYear ? ordinal(year - startYear) : null;
}

// Shown above the calendar on the starting screen when a D-Day is today. Several
// D-Days form a sideways row: the centered one is solid, neighbours peek in faded.
// The row is moved with a transform and our own swipe handling (not native scroll),
// because iOS Safari handled the scroll-snap version unreliably. Returns the count.
let placeCurrent = null;
window.addEventListener('resize', () => placeCurrent && placeCurrent(false));

export function renderTodayDdays(root, onOpen) {
  const today = todayKey();
  const hits = state.ddays.filter((d) => ddayDiff(d, today) === 0);
  if (!hits.length) { root.replaceChildren(); placeCurrent = null; return 0; }

  let index = 0;
  let dragged = false;
  const items = hits.map((d, i) => h('button', {
    class: 'tdd-item',
    onclick: () => {
      if (dragged) return;
      if (i === index) onOpen();
      else { index = i; place(true); } // tapping a faded neighbour brings it to the center
    },
  },
  h('span', { class: 'tdd-title display' }, d.title),
  nthOf(d, today) ? h('span', { class: 'tdd-sub' }, nthOf(d, today)) : null));
  const track = h('div', { class: 'tdd-track' }, items);
  const viewport = h('div', { class: 'tdd-viewport', 'aria-label': 'Today’s D-Days' }, track);

  let offset = 0;
  const setOffset = (x, animate) => {
    offset = x;
    track.style.transition = animate ? '' : 'none';
    track.style.transform = `translateX(${x}px)`;
  };
  // Center items[index] in the viewport, measured from the real layout.
  function place(animate) {
    const el = items[index];
    setOffset(viewport.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2), animate);
    items.forEach((it, i) => it.classList.toggle('active', i === index));
  }

  // Swipe: follow the finger, then snap to the next/previous D-Day.
  let start = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (items.length < 2) return;
    start = { x: e.clientX, y: e.clientY, base: offset, id: e.pointerId };
    dragged = false;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    if (!dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      dragged = true;
      viewport.setPointerCapture(e.pointerId);
    }
    if (dragged) setOffset(start.base + dx, false);
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    start = null;
    if (!dragged) return;
    if (dx < -40 && index < items.length - 1) index += 1;
    else if (dx > 40 && index > 0) index -= 1;
    place(true);
    setTimeout(() => { dragged = false; }, 0); // swallow the click that ends a swipe
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  root.replaceChildren(h('div', { class: 'today-dday' }, h('span', { class: 'tdd-label' }, 'D-Day'), viewport));
  placeCurrent = place;
  place(false);
  // Re-center once layout settles and the display font has loaded (it changes text widths).
  requestAnimationFrame(() => place(false));
  if (document.fonts) document.fonts.ready.then(() => { if (placeCurrent === place) place(false); });
  return hits.length;
}

function row(d) {
  const target = ddayTarget(d);
  const diff = ddayDiff(d);
  const date = parseKey(target);
  const nth = nthOf(d, target);
  const when = date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
  return h('li', {},
    h('button', { class: `dday-row${diff === 0 ? ' today' : ''}`, onclick: () => openDdaySheet(d) },
      h('span', { class: 'dday-main' },
        h('span', { class: 'dday-title' }, d.title),
        h('span', { class: 'dday-sub' }, [when, d.yearly ? '↻' : null, nth].filter(Boolean).join(' · '))),
      h('span', { class: 'dday-count display' }, ddayLabel(diff))));
}

export function renderDdays(root) {
  const today = todayKey();
  const withDiff = state.ddays.map((d) => ({ d, diff: ddayDiff(d, today) }));
  const upcoming = withDiff.filter((x) => x.diff >= 0).sort((a, b) => a.diff - b.diff);
  const since = withDiff.filter((x) => x.diff < 0).sort((a, b) => b.diff - a.diff);

  root.replaceChildren(h('div', { class: 'settings dday' },
    h('div', { class: 'page-head' },
      h('h1', { class: 'display' }, 'D-Day'),
      h('button', { class: 'icon-btn page-add', 'aria-label': 'Add D-Day', onclick: () => openDdaySheet() }, icon(ICONS.plus))),
    upcoming.length ? h('ul', { class: 'dday-list' }, upcoming.map((x) => row(x.d))) : null,
    since.length ? h('div', {},
      h('h3', { class: 'section-label' }, 'Since'),
      h('ul', { class: 'dday-list' }, since.map((x) => row(x.d)))) : null,
    state.ddays.length ? null : h('p', { class: 'set-note dday-empty' }, 'Tap + to add a birthday, graduation…'),
  ));
}

/** openDdaySheet(dday?) — create a new D-Day, or edit/delete an existing one. */
export function openDdaySheet(dday = null) {
  const title = h('input', {
    type: 'text', maxlength: '60', value: dday ? dday.title : '', placeholder: 'e.g. Mom’s birthday',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Title',
  });
  const date = h('input', { type: 'date', value: dday ? dday.date : todayKey(), required: true, 'aria-label': 'Date' });
  const yearly = h('input', { type: 'checkbox', class: 'switch', checked: dday ? !!dday.yearly : false });
  const close = () => dialog.close();

  const submit = (ev) => {
    ev.preventDefault();
    const text = title.value.trim();
    if (!text || !date.value) { (text ? date : title).focus(); return; }
    const data = { title: text, date: date.value, yearly: yearly.checked };
    if (dday) Object.assign(dday, data);
    else state.ddays.push({ id: uid(), ...data });
    save({ personal: true });
    close();
  };

  const remove = async () => {
    if (!await ask({ title: `Delete “${dday.title}”?`, ok: 'Delete', danger: true })) return;
    state.ddays = state.ddays.filter((x) => x !== dday);
    save({ personal: true });
    close();
  };

  dialog.replaceChildren(h('form', { novalidate: true, onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      dday ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: remove }, icon(ICONS.trash)) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Save' }, icon(ICONS.check))),
    h('div', { class: 'title-row' }, title),
    h('div', { class: 'fields' },
      h('label', { class: 'field' }, h('span', {}, 'Date'), date),
      h('label', { class: 'field' }, h('span', {}, 'Every year'), yearly)),
    h('p', { class: 'set-note dday-hint' }, 'For birthdays, use the birth date with “Every year” on.'),
  ));
  dialog.showModal();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
