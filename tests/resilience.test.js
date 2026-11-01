// Sign-out leaves nothing personal on the phone; the app works offline and syncs after;
// minutes of being open (polling, live chat, film refresh) cause no errors or memory growth.
const { browser, phone, inApp, filmProject, sql, check, wait, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'a@x');

  // ---- Offline ----
  await wait(1500); // service worker installed and caching
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await wait(1200); // now controlled by the service worker
  await p.ctx.setOffline(true);
  await p.reload(); await wait(1500);
  check('opens offline (from the phone\'s cache)', await p.locator('#calendar .cal-title').count() === 1, p.errors.join('; '));
  await inApp(p, (s) => { s.state.todos.push({ id: 'off1', title: 'Written offline', date: '2026-11-01', repeat: 'none' }); s.save(); });
  await wait(2000);
  await p.click('.tab[data-view=settings]'); await wait(300);
  check('Settings says it will sync later', (await p.locator('.sync-line').innerText()).toLowerCase().includes('offline'));
  await p.ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(2500);
  const row = (await sql("select data from planner_data where user_id = '00000000-0000-0000-0000-00000000000a'"))[0]?.data;
  check('back online, the offline edit reaches the account', !!row && row.todos.some((t) => t.id === 'off1'));

  // ---- Open for a while (film mode, chat, preview) ----
  await p.click('.tab[data-view=calendar]'); await wait(300);
  await filmProject(p, 'Long Day');
  const heap = () => p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  const tabs = ['calendar', 'write', 'organize', 'preview', 'chat', 'settings'];
  for (let i = 0; i < 6; i++) await p.click(`.tab[data-view=${tabs[i]}]`).then(() => wait(300));
  await p.evaluate(() => window.gc && window.gc());
  const h0 = await heap();
  for (let round = 0; round < 12; round++) {
    for (const t of tabs) { await p.click(`.tab[data-view=${t}]`); await wait(250); }
    await wait(5000); // refresh timers (15s film, 60s social, chat) keep running
  }
  const h1 = await heap();
  const growMB = (h1 - h0) / 1048576;
  check('~2 minutes of use: no errors', !p.errors.length, p.errors.slice(0, 3).join('; '));
  check('…and memory stays flat', !h0 || growMB < 8, `${growMB.toFixed(1)} MB change`);

  // ---- Sign-out cleanup ----
  await p.click('.tab[data-view=settings]'); await wait(300);
  await p.click('.set-row button:has-text("Sign out")'); await p.click('.layer .ask-btn.primary'); await wait(1500);
  const left = await p.evaluate(() => Object.keys(localStorage).sort());
  const personal = ['planner.auth', 'planner.chat', 'planner.social', 'planner.filmdata', 'planner.syncbase', 'planner.previewurls', 'planner.push'];
  check('sign-out removes every personal cache', !left.some((k) => personal.includes(k)), left.join(', '));
  const planner = await p.evaluate(() => JSON.parse(localStorage.getItem('planner.v1') || '{}'));
  check('…and the planner itself', !(planner.todos || []).length && !(planner.events || []).length);
  check('…and leaves film mode', await p.evaluate(() => !document.documentElement.classList.contains('film')));
  check('the login page is showing', await p.locator('#view-login:not([hidden])').count() === 1);
  await done(b);
})();
