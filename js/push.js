// Push notifications (Web Push; iOS 16.4+ with the app on the Home Screen).
//
// This device's push subscription is saved to the account (push_subscriptions, via the
// save_push_subscription function), and upcoming schedule alerts are uploaded as
// push_alerts. The Supabase function "push" (supabase/functions/push) sends them: chat
// messages, friend requests, project invites and shares right away (database triggers),
// alerts when due (checked every minute). Setup: supabase/push.sql.
import * as config from './config.js';
import { api, currentUser, isConfigured, onCloudChange } from './cloud.js';
import { state, onChange, occursOn } from './store.js';
import { addDays, dateKey, formatTime } from './util.js';
import { alertTime } from './reminders.js';

const KEY = 'planner.push'; // { endpoint, uid, sig } for this device
let status = 'idle'; // idle | on | missing | error
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full */ } };

export const pushSupported = () => isConfigured() && !!config.VAPID_PUBLIC_KEY
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushStatus = () => status;
/** True while this device gets the account's notifications from the server. */
export const pushActive = () => pushSupported() && Notification.permission === 'granted'
  && !!read().endpoint && read().uid === currentUser()?.id && status !== 'missing';

const isMissing = (e) => e.status === 404 || ['PGRST202', 'PGRST205', '42P01', '42883'].includes(e.code);

function keyBytes(b64url) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Ask for permission (must run from a tap) and subscribe this device. */
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') await subscribe();
  return result;
}

async function subscribe() {
  if (!currentUser()) return;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const me = currentUser().id;
  const saved = read();
  try {
    if (saved.endpoint !== j.endpoint || saved.uid !== me) {
      await api('/rest/v1/rpc/save_push_subscription', {
        method: 'POST', auth: true, body: { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth },
      });
      write({ endpoint: j.endpoint, uid: me, sig: '' });
    }
    status = 'on';
  } catch (e) {
    status = isMissing(e) ? 'missing' : 'error';
  }
}

/** On open / foreground: keep the subscription saved and the alerts current. */
export async function syncPush() {
  if (!pushSupported() || !currentUser()) return;
  if (Notification.permission === 'granted') {
    try { await subscribe(); } catch { /* iPhone may want a tap first: Settings → Alerts */ }
  }
  uploadAlerts();
}

/** Before signing out: this phone stops getting that account's notifications. */
export async function pushSignOut() {
  const saved = read();
  localStorage.removeItem(KEY);
  status = 'idle';
  if (!saved.endpoint || !pushSupported()) return;
  await api(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(saved.endpoint)}`, { method: 'DELETE', auth: true }).catch(() => {});
  try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); await sub?.unsubscribe(); } catch { /* ignore */ }
}

/* ---------- Schedule alerts (personal planner, next 30 days) ---------- */
// Refreshed whenever the app opens or the planner changes, so alerts keep coming for a
// month even if the app isn't opened.
const AHEAD_DAYS = 30;

function upcoming() {
  const now = Date.now();
  const out = [];
  for (let i = 0; i <= AHEAD_DAYS; i++) {
    const day = addDays(new Date(), i);
    const key = dateKey(day);
    for (const e of state.events) {
      if (!e.alert || e.alert === 'none' || !occursOn(e, key)) continue;
      const at = alertTime(e, key);
      if (at.getTime() < now + 30_000 || at.getTime() > now + AHEAD_DAYS * 86400_000) continue;
      const when = e.allDay ? (dateKey(at) === key ? 'Today' : 'Tomorrow') : formatTime(e.start);
      out.push({ fire_at: at.toISOString(), title: e.title || 'Event', body: `${when}${e.notes ? ` · ${e.notes}` : ''}`.slice(0, 200), tag: `${e.id}@${key}` });
    }
  }
  return out.sort((a, b) => a.fire_at.localeCompare(b.fire_at)).slice(0, 200);
}

let timer = 0;
async function uploadAlerts() {
  clearTimeout(timer);
  if (!pushSupported() || !currentUser() || status === 'missing') return;
  const list = upcoming();
  const sig = JSON.stringify(list);
  const saved = read();
  if (saved.alerts === sig && saved.alertsUid === currentUser().id) return;
  try {
    await api('/rest/v1/rpc/replace_push_alerts', { method: 'POST', auth: true, body: { p_alerts: list } });
    write({ ...read(), alerts: sig, alertsUid: currentUser().id });
  } catch (e) {
    if (isMissing(e)) status = 'missing';
  }
}

onChange(() => { clearTimeout(timer); timer = setTimeout(uploadAlerts, 3000); });
onCloudChange(() => { if (currentUser()) syncPush(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPush(); });
