// The moment of switching into / out of Film Production Mode, played over the whole screen.
// Enter (~1.4s): widescreen bars slide in, a big clapperboard snaps on and claps shut with a
// flash and a small shake, a title card flickers up, then the bars pull away from the app,
// already in film mode underneath. Exit (~0.8s): the bars close like curtains on "Cut.",
// then open onto the planner. Only transform / opacity animate. Reduced motion: no show.
import { h } from './util.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export const ENTER_MS = 1400;
export const ENTER_SWITCH_MS = 520; // the clap: the mode switches under the flash
export const EXIT_MS = 820;
export const EXIT_SWITCH_MS = 340; // the bars have closed

let playing = null;

function slate() {
  // The logo's clapperboard drawing, without its black tile.
  const src = document.querySelector('#brand .brand-slate');
  const svg = src.cloneNode(true);
  svg.removeAttribute('class');
  svg.setAttribute('class', 'cine-slate');
  svg.querySelector('rect').remove();
  svg.querySelector('.slate-arm').setAttribute('class', 'cine-arm');
  return svg;
}

function overlay(kind, title, sub) {
  return h('div', { class: `cine ${kind}`, 'aria-hidden': 'true' },
    h('div', { class: 'cine-dim' }),
    h('div', { class: 'cine-grain' }),
    h('div', { class: 'cine-bar top' }),
    h('div', { class: 'cine-bar bottom' }),
    h('div', { class: 'cine-stage' },
      kind === 'enter' ? slate() : null,
      h('p', { class: 'cine-title display' }, title),
      sub ? h('p', { class: 'cine-sub' }, sub) : null),
    h('div', { class: 'cine-flash' }));
}

/**
 * Plays the show and calls switchMode() at the right moment (under the flash / behind the
 * closed bars). Resolves when it's over. Without motion it just switches.
 */
export function playFilmSwitch(entering, switchMode, projectName = '') {
  if (reduced.matches || playing) { switchMode(); return Promise.resolve(); }
  const el = entering
    ? overlay('enter', 'Film mode', projectName || 'Roll camera')
    : overlay('exit', 'Cut.', '');
  document.body.append(el);
  document.body.classList.add('cine-on');
  playing = new Promise((resolve) => {
    setTimeout(switchMode, entering ? ENTER_SWITCH_MS : EXIT_SWITCH_MS);
    setTimeout(() => {
      el.remove();
      document.body.classList.remove('cine-on');
      playing = null;
      resolve();
    }, entering ? ENTER_MS : EXIT_MS);
  });
  return playing;
}
