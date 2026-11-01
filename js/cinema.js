// The moment of switching into / out of Film Production Mode.
//
// Several calm, cinematic styles exist; the owner picks one (FILM_TRANSITION). Until then
// the switch is just the logo flipping into a clapperboard ('flip', no full-screen effect).
// Every style animates only transform / opacity (focus also blur), lasts about a second,
// and switches the mode at its quietest, most covered moment. Reduced motion: no effect.
//
//   dip        fade to black and back up, like a cut in an edit
//   letterbox  thin widescreen bars glide in while the page dims, then glide away
//   leak       a warm light leak drifts across the screen (film photography)
//   focus      the page racks out of focus and back into focus
//   dissolve   the page eases back and fades; the new mode fades in from slightly closer
import { h } from './util.js';

export const FILM_TRANSITION = 'flip';

const STYLES = {
  dip: { total: 1150, at: 560 },
  letterbox: { total: 1250, at: 600 },
  leak: { total: 1350, at: 620 },
  focus: { total: 1100, at: 520, onPage: true },
  dissolve: { total: 1000, at: 450, onPage: true },
};
export const TRANSITIONS = Object.keys(STYLES);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let playing = null;

/**
 * Plays the chosen style and calls switchMode() at its covered moment; resolves when done.
 * With 'flip', reduced motion, or a show already running, it just switches.
 */
export function playFilmSwitch(entering, switchMode, title = '', style = FILM_TRANSITION) {
  const s = STYLES[style];
  if (!s || reduced.matches || playing) { switchMode(); return Promise.resolve(); }
  const dir = entering ? 'in' : 'out';
  let el = null;
  if (s.onPage) {
    document.body.classList.add('fx-page', `fx-${style}`, `fx-${dir}`);
  } else {
    el = h('div', { class: `fx fx-${style} fx-${dir}`, 'aria-hidden': 'true' },
      style === 'letterbox' ? [h('div', { class: 'fx-dim' }), h('div', { class: 'fx-bar top' }), h('div', { class: 'fx-bar bottom' })] : null,
      style === 'leak' ? [h('div', { class: 'fx-veil' }), h('div', { class: 'fx-glow a' }), h('div', { class: 'fx-glow b' })] : null,
      style === 'dip' && entering && title ? h('p', { class: 'fx-title display' }, title) : null);
    document.body.append(el);
  }
  document.body.classList.add('fx-on');
  playing = new Promise((resolve) => {
    setTimeout(switchMode, s.at);
    setTimeout(() => {
      el?.remove();
      document.body.classList.remove('fx-on', 'fx-page', `fx-${style}`, `fx-${dir}`);
      playing = null;
      resolve();
    }, s.total);
  });
  return playing;
}
