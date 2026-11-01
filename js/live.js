// Instant chat: a Supabase Realtime connection (WebSocket, Phoenix protocol, no SDK) that
// announces new / deleted chat messages the moment they happen. It only nudges: chat.js
// then fetches as usual, so polling stays the fallback (slower while this is connected).
// Realtime applies the messages table's RLS, so only a chat's members hear about it.
// Setup: supabase/maintenance.sql adds messages to the supabase_realtime publication.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { authToken, currentUser, isConfigured, onCloudChange } from './cloud.js';

const TOPIC = 'realtime:planner-chat';
let ws = null;
let joined = false;
let ref = 0;
let beat = 0;
let retry = 0;
let backoff = 1000;
let tokenSent = '';
const handlers = new Set();

export const onLiveMessage = (fn) => handlers.add(fn);
/** True while new messages arrive instantly. */
export const liveConnected = () => joined;

const send = (topic, event, payload) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
};

async function connect() {
  if (ws || !isConfigured() || !currentUser() || document.visibilityState !== 'visible' || !('WebSocket' in window)) return;
  let token;
  try { token = await authToken(); } catch { return; }
  if (ws) return;
  const url = `${SUPABASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    tokenSent = token;
    send(TOPIC, 'phx_join', {
      config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'messages' }] },
      access_token: token,
    });
    clearInterval(beat);
    beat = setInterval(async () => {
      send('phoenix', 'heartbeat', {});
      // Tokens last an hour: hand the fresh one over when it changes.
      try { const t = await authToken(); if (t !== tokenSent) { tokenSent = t; send(TOPIC, 'access_token', { access_token: t }); } } catch { /* signed out */ }
    }, 25_000);
  };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.topic !== TOPIC) return;
    // Joining answers with phx_reply; the database part confirms separately ("system").
    if (m.event === 'system' && m.payload?.extension === 'postgres_changes' && m.payload.status === 'ok' && !joined) {
      joined = true;
      backoff = 1000;
      handlers.forEach((fn) => fn(null)); // catch up on anything missed while connecting
    } else if ((m.event === 'phx_reply' || m.event === 'system') && m.payload?.status === 'error') {
      close(); // e.g. Realtime not set up: stay on polling, try again later
      backoff = 5 * 60_000;
      schedule();
    } else if (m.event === 'postgres_changes') {
      const d = m.payload?.data || {};
      const rec = d.record || d.old_record || {};
      handlers.forEach((fn) => fn(rec.chat_id || null));
    } else if (m.event === 'phx_close' || m.event === 'phx_error') {
      close();
      schedule();
    }
  };
  sock.onclose = () => { if (ws === sock) { close(); schedule(); } };
  sock.onerror = () => {};
}

function close() {
  clearInterval(beat);
  joined = false;
  const old = ws;
  ws = null;
  if (old && old.readyState <= 1) { try { old.close(); } catch { /* ignore */ } }
}

function schedule() {
  clearTimeout(retry);
  retry = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 5 * 60_000);
}

// Connected while the app is on screen and someone is signed in.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { backoff = 1000; connect(); } else close();
});
window.addEventListener('online', () => { backoff = 1000; connect(); });
onCloudChange(() => { if (currentUser()) connect(); else close(); });
connect();
