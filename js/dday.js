// D-Day tab: countdowns to birthdays, graduation… ("D-12", "D-Day", "D+30").
import { h, icon, ICONS, parseKey, todayKey } from './util.js';
import { state, save, uid, ddayTarget, ddayDiff } from './store.js';

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
// D-Days form a sideways snap row: the centered one is solid, the next peeks in faded.
// Returns how many D-Days are shown.
export function renderTodayDdays(root, onOpen) {
  const today = todayKey();
  const hits = state.ddays.filter((d) => ddayDiff(d, today) === 0);
  if (!hits.length) { root.replaceChildren(); return 0; }

  const items = hits.map((d, i) => h('button', { class: `tdd-item${i === 0 ? ' active' : ''}`, onclick: onOpen },
    h('span', { class: 'tdd-title display' }, d.title),
    nthOf(d, today) ? h('span', { class: 'tdd-sub' }, nthOf(d, today)) : null));
  const track = h('div', { class: 'tdd-track', 'aria-label': 'Today’s D-Days' }, items);

  // Whichever item is nearest the middle is the active (fully visible) one.
  let frame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = items[0];
      for (const el of items) {
        if (Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - mid)) best = el;
      }
      items.forEach((el) => el.classList.toggle('active', el === best));
    });
  }, { passive: true });

  root.replaceChildren(h('div', { class: 'today-dday' },
    h('span', { class: 'tdd-label' }, 'D-Day'), track));
  // Start with the first D-Day centered (the row's 50% padding would otherwise leave it right of center).
  track.scrollLeft = items[0].offsetLeft - (track.clientWidth - items[0].offsetWidth) / 2;
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
    h('h1', { class: 'display' }, 'D-Day'),
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
    save();
    close();
  };

  const remove = () => {
    if (!confirm(`Delete “${dday.title}”?`)) return;
    state.ddays = state.ddays.filter((x) => x !== dday);
    save();
    close();
  };

  dialog.replaceChildren(h('form', { onsubmit: submit },
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
  if (!dday) title.focus();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
