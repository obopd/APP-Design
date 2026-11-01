// Login (email + password) and cloud backup/sync via Supabase, using its REST API
// directly (no SDK). Passwords never touch our storage: Supabase Auth checks them and
// returns tokens. The whole planner state is stored as one JSON row per user,
// protected by row-level security (supabase/setup.sql).
//
// Sync is last-write-wins on the whole document: each local save stamps
// state.meta.updatedAt; we remember the stamp of the last successful sync and
// compare it with the local and remote stamps.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { state, onChange, replaceAll, hasContent, clearData, storeItem } from './store.js';
import { ask } from './ui.js';

const AUTH_KEY = 'planner.auth';
const TABLE = 'planner_data';
const REQUEST_TIMEOUT = 12_000;

// { access_token, refresh_token, expires_at, user: { id, email }, lastSyncedAt }
let session = readSession();
let status = { state: 'idle', at: null, error: null }; // idle | syncing | synced | offline | error
const listeners = new Set();
let applyingRemote = false;
let pushTimer = null;
let running = null;

function readSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function persist() {
  if (session) storeItem(AUTH_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_KEY);
}
function notify() { listeners.forEach((fn) => fn()); }

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const currentUser = () => session?.user || null;
export const syncStatus = () => status;
export const onCloudChange = (fn) => listeners.add(fn);

function setStatus(next) {
  status = { ...status, ...next };
  notify();
}

/* ---------- HTTP ---------- */

export async function api(path, { method = 'GET', body, auth = false, token = null, headers = {}, timeout = REQUEST_TIMEOUT } = {}) {
  const raw = body instanceof Blob; // file uploads (Storage) are sent as they are
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': raw ? body.type : 'application/json', ...headers };
  if (token || auth) h.Authorization = `Bearer ${token || await accessToken()}`;
  // Patchy mobile networks can leave a request hanging forever, which would block
  // every later sync; give up after REQUEST_TIMEOUT so the next attempt can run.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  let text;
  try {
    res = await fetch(SUPABASE_URL.replace(/\/$/, '') + path, {
      method, headers: h, body: body === undefined || raw ? body : JSON.stringify(body), signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'No response. Check your connection.' : 'Could not connect. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.error_description || data.message || data.error)) || `Error ${res.status}`;
    const code = (data && (data.error_code || data.code)) || '';
    const err = new Error(friendly(String(code), msg, res.status));
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return data;
}

// Supabase Auth errors → plain messages. Match on error_code first (stable), then text.
function friendly(code, msg, status) {
  const m = `${code} ${msg}`.toLowerCase();
  if (m.includes('invalid_credentials') || m.includes('invalid login')) return 'Wrong email or password.';
  if (m.includes('email_not_confirmed') || m.includes('email not confirmed')) return 'Please confirm your email first (check your inbox and spam).';
  if (m.includes('user_already_exists') || m.includes('email_exists') || m.includes('already registered')) return 'That email already has an account. Sign in instead.';
  if (m.includes('weak_password') || m.includes('password should')) return 'Password must be at least 6 characters.';
  if (m.includes('email_address_invalid') || m.includes('invalid format') || m.includes('unable to validate email')) return 'That email address doesn’t look right.';
  if (m.includes('signup_disabled') || m.includes('signups not allowed')) return 'New accounts are turned off right now.';
  // The free email sender allows only a few emails per hour for the whole project.
  if (m.includes('over_email_send_rate_limit') || m.includes('email rate limit')) return 'We can’t send emails right now (hourly limit reached). Please try again later.';
  if (m.includes('over_request_rate_limit') || m.includes('rate limit') || status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (status >= 500) return 'The server had a problem. Please try again in a moment.';
  return msg;
}

/* ---------- Storage (film mode's concept images; policies in supabase/film.sql) ---------- */

const storageBase = () => SUPABASE_URL.replace(/\/$/, '') + '/storage/v1';
export const uploadFile = (bucket, path, blob) => api(`/storage/v1/object/${bucket}/${path}`, {
  method: 'POST', auth: true, body: blob, timeout: 60_000, headers: { 'cache-control': '31536000', 'x-upsert': 'true' },
});
/** Signed links (valid `seconds`) for private files: { path: url }. */
export async function signFiles(bucket, paths, seconds) {
  const list = await api(`/storage/v1/object/sign/${bucket}`, { method: 'POST', auth: true, body: { expiresIn: seconds, paths } });
  return Object.fromEntries((list || []).filter((x) => x.signedURL).map((x) => [x.path, storageBase() + x.signedURL]));
}
export const removeFiles = (bucket, paths) => (paths.length
  ? api(`/storage/v1/object/${bucket}`, { method: 'DELETE', auth: true, body: { prefixes: paths } }) : Promise.resolve());

/* ---------- Auth ---------- */

function setSession(data, user = data.user) {
  session = {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    user: { id: user.id, email: user.email },
  };
  persist();
}

/** A valid access token (refreshed when close to expiring). */
export async function authToken() { return accessToken(); }

async function accessToken() {
  if (!session) throw new Error('Not signed in');
  if (session.expires_at - 60_000 < Date.now()) {
    try {
      const data = await api('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh_token },
      });
      setSession(data);
    } catch (e) {
      if (e.status === 400 || e.status === 401) { session = null; persist(); notify(); }
      throw e;
    }
  }
  return session.access_token;
}

const redirectTo = () => location.origin + location.pathname;

/** Returns 'signed-in', or 'confirm-email' when Supabase requires email confirmation. */
export async function signUp(email, password) {
  const data = await api(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo())}`, {
    method: 'POST', body: { email, password },
  });
  if (data && data.access_token) {
    setSession(data);
    await afterSignIn();
    return 'signed-in';
  }
  // With "Confirm email" on, Supabase answers an already-registered email with a fake
  // user that has no identities (so it doesn't reveal who has accounts).
  if (data && Array.isArray(data.identities) && data.identities.length === 0) {
    throw new Error('That email already has an account. Sign in instead (or use “Forgot password?”).');
  }
  return 'confirm-email';
}

export async function signIn(email, password) {
  const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  session = null;
  setSession(data);
  await afterSignIn();
}

// True when local edits haven't reached the account yet.
export const hasUnsyncedChanges = () => !!session && (state.meta?.updatedAt || 0) > (session.lastSyncedAt || 0);

// Signing out also clears the planner from this device (accounts are required, and
// another person may sign in here next). Callers sync first and warn about unsynced edits.
export async function signOut() {
  clearTimeout(pushTimer);
  if (session) {
    try { await api('/auth/v1/logout', { method: 'POST', auth: true }); } catch { /* still sign out locally */ }
  }
  session = null;
  persist();
  localStorage.removeItem(BASE_KEY);
  applyingRemote = true;
  try { clearData(); } finally { applyingRemote = false; }
  setStatus({ state: 'idle', at: null, error: null });
}

export async function sendPasswordReset(email) {
  await api(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo())}`, { method: 'POST', body: { email } });
}

export async function setNewPassword(password) {
  await api('/auth/v1/user', { method: 'PUT', auth: true, body: { password } });
}

/**
 * Links from Supabase emails (confirm sign-up, reset password) come back with
 * #access_token=…&type=… in the URL. Returns the link type, or null.
 */
export async function handleAuthRedirect() {
  if (!isConfigured() || !location.hash.includes('access_token=')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const token = params.get('access_token');
  const user = await api('/auth/v1/user', { token });
  setSession({
    access_token: token,
    refresh_token: params.get('refresh_token'),
    expires_in: params.get('expires_in'),
  }, user);
  const type = params.get('type');
  if (type !== 'recovery') await afterSignIn();
  else notify();
  return type;
}

/* ---------- Sync ---------- */
//
// Two devices can both change the planner before they sync. Each device keeps a copy of
// what it last synced (the "base"); when both sides changed, every to-do / event / folder /
// D-Day is compared with the base and the changes from both sides are combined, field by
// field (a check-off on one phone and a new to-do on the other both survive). Only the
// same field changed on both sides falls back to the newer edit. An item deleted on one
// side but edited on the other is kept. Writes are conditional on the row being unchanged
// since it was read, so two phones pushing at the same moment re-merge instead of overwriting.

const BASE_KEY = 'planner.syncbase';
function readBase() {
  try {
    const b = JSON.parse(localStorage.getItem(BASE_KEY));
    if (b && b.uid === session?.user?.id) return b.data;
  } catch { /* none */ }
  return null;
}
function writeBase(data) {
  try { localStorage.setItem(BASE_KEY, JSON.stringify({ uid: session.user.id, data })); } catch { /* storage full */ }
}

const LISTS = ['todos', 'events', 'categories', 'ddays'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge3(base, mine, theirs, mineWins) {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(isObj(base) ? base[k] : undefined, mine[k], theirs[k], mineWins);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return mineWins ? mine : theirs;
}

function mergeList(base = [], mine = [], theirs = [], mineWins) {
  const b = new Map(base.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  const out = [];
  const pick = (id, m, th) => {
    const was = b.get(id);
    // Deleted on one side, changed on the other: keep it (never lose an edit).
    if (!m && th) return same(th, was) ? undefined : th;
    if (m && !th) return !was || !same(m, was) ? m : undefined;
    return merge3(was, m, th, mineWins);
  };
  for (const m of mine) { const v = pick(m.id, m, t.get(m.id)); if (v) out.push(v); }
  const mineIds = new Set(mine.map((x) => x.id));
  for (const th of theirs) { if (!mineIds.has(th.id)) { const v = pick(th.id, undefined, th); if (v) out.push(v); } }
  return out;
}

/** Combine this device's planner with the account's, using the last synced copy as the base. */
export function mergeStates(base, mine, theirs, mineWins) {
  base ||= {}; // no base yet: nothing is treated as deleted
  const out = merge3(base, mine, theirs, mineWins);
  LISTS.forEach((k) => { out[k] = mergeList(base[k], mine[k], theirs[k], mineWins); });
  return out;
}

async function pullRemote() {
  const rows = await api(`/rest/v1/${TABLE}?select=data,updated_at`, { auth: true });
  return rows && rows[0] ? rows[0] : null;
}

class Conflict extends Error {}

// expect: the row's updated_at when it was read (write only if nobody wrote since).
async function pushLocal(expect = null) {
  const at = state.meta?.updatedAt || Date.now();
  const data = JSON.parse(JSON.stringify(state));
  const updatedAt = new Date(at).toISOString();
  if (expect) {
    const rows = await api(`/rest/v1/${TABLE}?user_id=eq.${session.user.id}&updated_at=eq.${encodeURIComponent(expect)}`, {
      method: 'PATCH', auth: true, headers: { Prefer: 'return=representation' }, body: { data, updated_at: updatedAt },
    });
    if (!rows || !rows.length) throw new Conflict('changed meanwhile');
  } else {
    await api(`/rest/v1/${TABLE}?on_conflict=user_id`, {
      method: 'POST', auth: true,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { user_id: session.user.id, data, updated_at: updatedAt },
    });
  }
  session.lastSyncedAt = at;
  persist();
  writeBase(data);
}

function applyRemote(data) {
  applyingRemote = true;
  try { replaceAll(data, { touch: false }); } finally { applyingRemote = false; }
  session.lastSyncedAt = data.meta?.updatedAt || 0;
  persist();
  writeBase(data);
}

const remoteStamp = (row) => row.data?.meta?.updatedAt || Date.parse(row.updated_at) || 0;

// First sign-in on this device: decide between this phone's data and the account's.
async function afterSignIn() {
  notify();
  setStatus({ state: 'syncing', error: null });
  try {
    const remote = await pullRemote();
    if (!remote) {
      await pushLocal();
    } else if (!hasContent()) {
      applyRemote(remote.data);
    } else if (!hasContent(remote.data)) {
      await pushLocal();
    } else if (await ask({
      title: 'Which planner to keep?',
      message: 'Your account already has saved data, and so does this phone.',
      ok: 'Use account’s', cancel: 'Keep this phone’s',
    })) {
      applyRemote(remote.data);
    } else {
      await pushLocal();
    }
    setStatus({ state: 'synced', at: Date.now() });
  } catch (e) {
    setStatus(navigator.onLine ? { state: 'error', error: e.message } : { state: 'offline' });
  }
}

async function syncOnce() {
  const remote = await pullRemote();
  const last = session.lastSyncedAt || 0;
  const localAt = state.meta?.updatedAt || 0;
  if (!remote) { await pushLocal(); return; }
  const remoteAt = remoteStamp(remote);
  const localChanged = localAt > last;
  const remoteChanged = remoteAt > last;
  if (!localChanged) { if (remoteChanged) applyRemote(remote.data); return; }
  if (!remoteChanged || (state.meta?.replacedAt || 0) > last) { await pushLocal(remote.updated_at); return; }
  // Both changed: combine, show the result here, then send it.
  const merged = mergeStates(readBase(), JSON.parse(JSON.stringify(state)), remote.data, localAt > remoteAt);
  merged.meta = { ...merged.meta, updatedAt: Math.max(Date.now(), localAt, remoteAt) + 1 };
  delete merged.meta.replacedAt;
  applyingRemote = true;
  try { replaceAll(merged, { touch: false }); } finally { applyingRemote = false; }
  await pushLocal(remote.updated_at);
}

async function runSync() {
  try {
    if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
    setStatus({ state: 'syncing', error: null });
    for (let i = 0; ; i++) {
      try { await syncOnce(); break; } catch (e) { if (!(e instanceof Conflict) || i >= 3) throw e; }
    }
    setStatus({ state: 'synced', at: Date.now() });
  } catch (e) {
    setStatus(navigator.onLine ? { state: 'error', error: e.message } : { state: 'offline' });
  }
}

/** Pull/push as needed. Safe to call any time; concurrent calls share one run. */
export function syncNow() {
  if (!isConfigured() || !session) return Promise.resolve();
  // .finally runs after `running` is assigned, even when runSync returns immediately.
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

// Local edits → push shortly after (batched while you're typing/tapping).
onChange(() => {
  if (applyingRemote || !session || !isConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 1500);
});

window.addEventListener('online', () => syncNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
});
