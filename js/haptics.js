// Light haptic tick on button presses.
//
// iPhone Safari has no vibration API, but since iOS 18 toggling an
// <input type="checkbox" switch> gives a system haptic. So we keep one hidden
// switch and click its label on every press. Android uses navigator.vibrate.
import { state } from './store.js';

let label = null;

function ensureSwitch() {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'haptic-switch';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  label.className = 'haptic-switch';
  label.append(input);
  document.body.append(label);
  return label;
}

export function haptic() {
  if (state.settings.haptics === false) return;
  if (navigator.vibrate) { navigator.vibrate(8); return; }
  ensureSwitch().click();
}

// Any button-like tap gets a tick (must run inside the user's gesture).
document.addEventListener('click', (e) => {
  if (e.target.closest('.haptic-switch')) return;
  if (e.target.closest('button, [role="button"], [role="checkbox"], [role="radio"], .switch, select')) haptic();
}, true);
