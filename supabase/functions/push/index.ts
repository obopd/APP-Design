// Supabase Edge Function "push": sends Web Push notifications to the app's phones.
// Called only by the database (supabase/push.sql: triggers + the every-minute alert timer),
// which proves itself with the x-push-secret header. Deploy with "Verify JWT" turned off.
//
// No secrets to set here: the push secret and the notification (VAPID) keys live in the
// database's Vault, and push_settings() hands the keys over only for the right secret.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// Body: { users: [uuid], title, body, tag, view }  → every phone of those users
//       { alerts: true }                           → all due schedule alerts (then deleted)
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) ?? '';
const BASE = env('SUPABASE_URL').replace(/\/$/, '');
const KEY = env('SUPABASE_SERVICE_ROLE_KEY');

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Note = { title: string; body: string; tag?: string; view?: string };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Quoted: endpoints are URLs, and PostgREST needs quotes around values with . : , ( )
const inList = (ids: (string | number)[]) => `in.(${ids.map((x) => encodeURIComponent(`"${String(x).replace(/"/g, '')}"`)).join(',')})`;

async function subsOf(users: string[]): Promise<Sub[]> {
  if (!users.length) return [];
  return await rest(`push_subscriptions?select=endpoint,user_id,p256dh,auth&user_id=${inList(users)}`);
}

// Returns endpoints that are gone for good (the phone unsubscribed or reinstalled).
async function send(subs: Sub[], note: Note): Promise<string[]> {
  const gone: string[] = [];
  const payload = JSON.stringify(note);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
      else console.error('push failed', code, (e as Error).message);
    }
  }));
  return gone;
}

async function forget(endpoints: string[]) {
  if (endpoints.length) await rest(`push_subscriptions?endpoint=${inList(endpoints)}`, { method: 'DELETE' });
}

// The keys, only for the right secret (cached while this instance runs).
let keysFor = '';
async function authorize(secret: string) {
  if (!secret) return false;
  if (keysFor === secret) return true;
  const keys = await rest('rpc/push_settings', { method: 'POST', body: JSON.stringify({ p_secret: secret }) });
  if (!keys?.public || !keys?.private) return false;
  // The sender's contact (must be https: or mailto:): this project's address.
  webpush.setVapidDetails(BASE.startsWith('https://') ? BASE : 'https://supabase.com', keys.public, keys.private);
  keysFor = secret;
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !await authorize(req.headers.get('x-push-secret') ?? '').catch(() => false)) {
    return new Response('forbidden', { status: 403 });
  }
  const input = await req.json().catch(() => ({}));
  let sent = 0;
  const gone: string[] = [];

  if (Array.isArray(input.users)) {
    const subs = await subsOf(input.users);
    gone.push(...await send(subs, { title: String(input.title || 'Planner'), body: String(input.body || ''), tag: input.tag, view: input.view }));
    sent += subs.length;
  }

  if (input.alerts) {
    const now = encodeURIComponent(new Date().toISOString());
    const due = await rest(`push_alerts?select=id,user_id,fire_at,title,body,tag&fire_at=lte.${now}&order=fire_at&limit=500`);
    if (due.length) {
      // Claim them first so an overlapping run can't send them twice.
      await rest(`push_alerts?id=${inList(due.map((a: { id: number }) => a.id))}`, { method: 'DELETE' });
      const fresh = due.filter((a: { fire_at: string }) => Date.now() - Date.parse(a.fire_at) < 30 * 60_000); // skip ones >30 min late
      const subs = await subsOf([...new Set<string>(fresh.map((a: { user_id: string }) => a.user_id))]);
      for (const a of fresh) {
        const mine = subs.filter((s) => s.user_id === a.user_id);
        gone.push(...await send(mine, { title: a.title, body: a.body, tag: a.tag, view: 'calendar' }));
        sent += mine.length;
      }
    }
  }

  await forget([...new Set(gone)]);
  return Response.json({ sent, gone: gone.length });
});
