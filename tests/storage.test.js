// When the phone's storage for the app is full, saving the planner clears re-downloadable
// caches to make room instead of silently failing.
const { browser, phone, inApp, check, done } = require('./helpers');

(async () => {
  const b = await browser();
  const A = await phone(b, 'a@x');
  // Fill storage with a big "chat cache" until nothing more fits.
  const filled = await A.evaluate(() => {
    let chunk = 'x'.repeat(256 * 1024);
    let s = '';
    for (;;) {
      try { localStorage.setItem('planner.chat', s + chunk); s += chunk; } catch { if (chunk.length < 1024) break; chunk = chunk.slice(chunk.length / 2); }
    }
    return s.length;
  });
  await inApp(A, (s) => { s.state.todos.push({ id: 'big', title: 'Saved despite full storage', date: '2026-11-01', repeat: 'none', notes: 'n'.repeat(20000) }); s.save(); });
  const kept = await A.evaluate(() => JSON.parse(localStorage.getItem('planner.v1')).todos.some((t) => t.id === 'big'));
  const chatGone = await A.evaluate(() => localStorage.getItem('planner.chat') === null);
  check('planner still saves when storage is full', kept && chatGone, `filled ${(filled / 1e6).toFixed(1)} MB of cache first`);
  check('no page errors', !A.errors.length, A.errors.join('; '));
  await done(b);
})();
