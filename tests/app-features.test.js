// Push sign-up on the phone, instant chat (Realtime), search, weekly backups, chat clean-up
// and the keep-awake ping.
const { browser, phone, inApp, sql, check, wait, done, MOCK } = require('./helpers');

// Headless Chromium has no push service: a stand-in subscription.
function fakePush() {
  window.Notification = class { static permission = 'default'; static async requestPermission() { this.permission = 'granted'; return 'granted'; } };
  window.PushManager = function PushManager() {};
  const sub = { endpoint: 'https://push.example/dev1', toJSON: () => ({ endpoint: 'https://push.example/dev1', keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: async () => { window.unsubscribed = true; return true; } };
  let has = false;
  const pm = { getSubscription: async () => (has ? sub : null), subscribe: async () => { has = true; return sub; } };
  navigator.serviceWorker.ready.then((reg) => Object.defineProperty(reg, 'pushManager', { value: pm }));
}

(async () => {
  const b = await browser();
  const A = await phone(b, 'a@x', { extraConfig: "export const VAPID_PUBLIC_KEY='BE9uZb2HfSjsbRDUYnrPuxISdvV_bz9Mwqm_WcV-ux-WnfUyBpca1U_FpEMOV8PZ765OgsYAgAcuhj0iJ6DL1WM';", init: fakePush });
  const B = await phone(b, 'b@x');

  // Push sign-up + alert upload
  await A.click('.tab[data-view=settings]'); await wait(300);
  await A.click('.set-row:has-text("Alerts") button'); await wait(1200);
  check('Alerts: Turn on → On, phone saved', (await A.locator('.set-row:has-text("Alerts")').innerText()).includes('On')
    && (await sql('select count(*)::int n from push_subscriptions'))[0].n === 1);
  await inApp(A, (s) => { const d = new Date(); d.setDate(d.getDate() + 1); s.state.events.push({ id: 'ev1', title: 'Camera test', date: d.toISOString().slice(0, 10), allDay: false, start: '10:00', end: '11:00', repeat: 'none', until: '', alert: '15', notes: '' }); s.save(); });
  await wait(4500);
  check('upcoming alert uploaded', (await sql("select count(*)::int n from push_alerts where title = 'Camera test'"))[0].n === 1);

  // Instant chat
  check('live connection up', await B.evaluate(async () => (await import('./js/live.js')).liveConnected()));
  await sql("insert into messages (chat_id, sender, body) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'Gaffer tape is in the van')");
  await wait(1200);
  check('chat badge lights up within ~1s', await B.locator('.tab[data-view=chat] .tab-badge').evaluate((n) => !n.hidden));
  await B.click('.tab[data-view=chat]'); await wait(500); await B.click('.chat-row >> nth=0'); await wait(900);
  await sql("insert into messages (chat_id, sender, body) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'Call time 7am')");
  await wait(1200);
  check('open chat shows the new message within ~1s', (await B.locator('.conv').innerText()).includes('Call time 7am'));

  // Search
  await inApp(A, (s) => { const d = new Date(); d.setDate(d.getDate() + 10); s.state.todos.push({ id: 'g1', title: 'Buy gaffer tape', date: d.toISOString().slice(0, 10), repeat: 'none', notes: '' }); s.save(); });
  await A.click('.tab[data-view=chat]'); await wait(800); await A.click('.tab[data-view=calendar]'); await wait(300);
  await A.click('#search-btn'); await wait(300);
  check('search opens without the keyboard', await A.evaluate(() => !document.activeElement?.classList.contains('search-input')));
  await A.fill('.search-input', 'gaffer'); await wait(200);
  const groups = await A.locator('.search-group').allInnerTexts();
  check('search finds the to-do and the chat message', groups.length === 2, groups.map((g) => g.split('\n')[0]).join(','));
  await A.click('.search-group:has-text("To-do") .search-row'); await wait(1200);
  check('a to-do result opens its day', await A.locator('#view-calendar.week-mode').count() === 1 && await A.locator('text=Buy gaffer tape').count() > 0);

  // Backups
  await inApp(A, (s, c) => c.syncNow());
  await sql('select public.planner_backup_run()'); await sql('select public.planner_backup_run()');
  check('weekly backup taken once per person', (await sql('select count(*)::int n from planner_backups'))[0].n === 2);
  check('only your own backups are visible', await B.evaluate(async () => (await (await import('./js/cloud.js')).api('/rest/v1/planner_backups?select=id', { auth: true })).length) === 1);
  await inApp(A, (s) => { s.state.todos = s.state.todos.filter((t) => t.id !== 'g1'); s.save(); });
  await A.click('.tab[data-view=settings]'); await wait(300);
  await A.click('.set-row:has-text("Weekly copies") button'); await wait(500);
  await A.locator('.layer .menu-item').first().click(); await wait(300);
  await A.click('.layer .ask-btn.primary'); await wait(500); await A.click('.layer .ask-btn'); await wait(300);
  check('restoring a weekly copy brings data back', await inApp(A, (s) => s.state.todos.some((t) => t.id === 'g1')));

  // Clean-up + ping
  await sql("update messages set created_at = now() - interval '400 days' where body = 'Gaffer tape is in the van'");
  await sql('select public.chat_cleanup_run()');
  check('messages older than a year are deleted', (await sql('select string_agg(body, \',\') b from messages'))[0].b === 'Call time 7am');
  const ping = await (await fetch(`${MOCK}/rest/v1/rpc/ping`, { method: 'POST', headers: { apikey: 'anon', 'Content-Type': 'application/json' }, body: '{}' })).json();
  check('keep-awake ping answers', ping === 'ok');

  // Sign-out removes this phone from push
  await A.click('.set-row button:has-text("Sign out")'); await A.click('.layer .ask-btn.primary'); await wait(1500);
  check('sign-out removes the push subscription', (await sql('select count(*)::int n from push_subscriptions'))[0].n === 0);
  check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].join('; '));
  await done(b);
})();
