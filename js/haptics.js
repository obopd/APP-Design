// Light haptic tick on button presses.
//
// iPhone Safari has no vibration API, but toggling an <input type="checkbox" switch>
// plays a system haptic. Newer iOS only does that for a *real* tap (a switch clicked
// by code stays silent). So when a finger touches a button, a transparent <label> for a
// hidden switch is placed exactly over it (outside the page content, so a re-render
// can't remove it mid-tap). The user's own tap lands on the label: we pass the click on
// to the button right away, and then the label flips the switch → iOS ticks.
// Android uses navigator.vibrate.
import { state } from './store.js';

const on = () => state.settings.haptics !== false;
const BUTTONS = 'button, [role="button"]';
const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Automated browsers (tests) check that clicks land on the element they aimed at, which
// the tap layer would fail; tests that want it set window.__hapticTest.
const automated = navigator.webdriver && !window.__hapticTest;

let hit = null; // { label, host, x, y }

function clear() {
  hit?.label.remove();
  hit = null;
}

function place(host, e) {
  clear();
  const r = host.getBoundingClientRect();
  const label = document.createElement('label');
  label.className = 'haptic-hit';
  label.setAttribute('aria-hidden', 'true');
  Object.assign(label.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  input.addEventListener('click', (ev) => ev.stopPropagation());
  label.append(input);
  label.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (host.isConnected && !host.disabled) host.click(); // still inside the real tap
    setTimeout(clear, 0); // after the label has flipped the switch
  });
  // Inside an open dialog the label must live in that dialog to be on top of it.
  (host.closest('dialog[open]') || document.body).append(label);
  hit = { label, host, x: e.clientX, y: e.clientY };
}

if (isApple && !automated) {
  document.addEventListener('pointerdown', (e) => {
    if (!on() || e.target.closest?.('.haptic-hit')) return;
    const host = e.target.closest?.(BUTTONS);
    if (host && !host.disabled) place(host, e); else clear();
  }, true);
  // A drag or scroll isn't a tap: take the label away so the gesture works normally.
  document.addEventListener('pointermove', (e) => {
    if (hit && Math.hypot(e.clientX - hit.x, e.clientY - hit.y) > 8) clear();
  }, true);
  document.addEventListener('pointercancel', clear, true);
  window.addEventListener('scroll', clear, true);
}

export function haptic() {
  if (on() && navigator.vibrate) navigator.vibrate(8);
}

// Android: a short vibration on any button-like tap (must run inside the user's gesture).
if (!isApple) {
  document.addEventListener('click', (e) => {
    if (e.target.closest(`${BUTTONS}, [role="checkbox"], [role="radio"], .switch`)) haptic();
  }, true);
}
