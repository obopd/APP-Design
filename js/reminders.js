// Alerts and the home-screen icon badge.
//
// Limits of a web app on iPhone: notifications need iOS 16.4+ and the app added to
// the Home Screen. There is no way to schedule a local notification in advance, so
// alerts fire from timers that only run while the app is open or recently used.
import { addDays, dateKey, todayKey, toMinutes, formatTime } from './util.js';
import { eventsOn, todosOn, isDone } from './store.js';

let timers = [];
const fired = new Set(JSON.parse(sessionStorage.getItem('planner.fired') || '[]'));

export const notificationsSupported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  refreshReminders();
  return result;
}

function alertTime(event, key) {
  const [y, m, d] = key.split('-').map(Number);
  const base = event.allDay ? 9 * 60 : toMinutes(event.start);
  return new Date(y, m - 1, d, 0, base - Number(event.alert));
}

async function fire(event, key, showToast) {
  const id = `${event.id}@${key}`;
  if (fired.has(id)) return;
  fired.add(id);
  sessionStorage.setItem('planner.fired', JSON.stringify([...fired]));

  const when = event.allDay ? (key === todayKey() ? 'Today' : 'Tomorrow') : formatTime(event.start);
  const body = `${when}${event.notes ? ` · ${event.notes}` : ''}`;
  if (notificationsSupported() && Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(event.title, { body, tag: id, icon: 'icons/icon-192.png' });
  }
  if (document.visibilityState === 'visible') showToast(event.title, body);
}

// Badge = today's important, unfinished items. Shown on the Home Screen icon (iOS 16.4+).
function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const key = todayKey();
  const count = eventsOn(key).filter((e) => e.important).length
    + todosOn(key).filter((t) => t.important && !isDone(t, key)).length;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}

let toastFn = () => {};
export function setToast(fn) { toastFn = fn; }

// Re-plan all timers for alerts due in the next 48 hours.
export function refreshReminders() {
  timers.forEach(clearTimeout);
  timers = [];
  updateBadge();

  const now = Date.now();
  const horizon = now + 48 * 3600 * 1000;
  // Alerts can be up to 1 day before, so scan today through 3 days ahead.
  for (let i = 0; i <= 3; i++) {
    const key = dateKey(addDays(new Date(), i));
    for (const event of eventsOn(key)) {
      if (!event.alert || event.alert === 'none') continue;
      const at = alertTime(event, key).getTime();
      if (at > horizon) continue;
      // Just missed (app was closed)? Still show it if within the last 15 minutes.
      if (at <= now) {
        if (now - at < 15 * 60 * 1000) fire(event, key, toastFn);
        continue;
      }
      timers.push(setTimeout(() => fire(event, key, toastFn), at - now));
    }
  }
}
