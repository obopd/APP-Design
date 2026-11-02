// Unfinished one-off to-dos move forward to today, day after day, until checked off.
const { chromium, devices } = require('playwright');
const { MOCK, check, wait, done } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: process.env.PW_TZ || 'Asia/Seoul' });
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const SUPABASE_URL='${MOCK}'; export const SUPABASE_ANON_KEY='anon';` }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.clock.install({ time: new Date('2026-11-01T10:00:00+09:00') });
  await p.goto('http://localhost:8765/');
  await p.fill('input[type=email]', 'c@x'); await p.fill('input[type=password]', 'secret1'); await p.click('.login-submit');
  await p.clock.runFor(2500);
  const run = (fn, arg) => p.evaluate(async ([src, arg]) => { const s = await import('./js/store.js'); return eval(src)(s, arg); }, [fn.toString(), arg]);
  await run((s) => {
    s.state.todos.push(
      { id: 'one', title: 'Write treatment', date: '2026-11-01', repeat: 'none', done: false },
      { id: 'later', title: 'Book camera', date: '2026-11-05', repeat: 'none', done: false },
      { id: 'daily', title: 'Stretch', date: '2026-11-01', repeat: 'daily', until: '', doneOn: {} },
      { id: 'fin', title: 'Done on time', date: '2026-11-01', repeat: 'none', done: true },
    );
    s.save();
  });
  await p.clock.runFor(2500);

  // Two days later.
  // (The test server can't refresh sign-in tokens, so keep the session valid across the jump.)
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('planner.auth')); a.expires_at = Date.now() + 30 * 86400000; localStorage.setItem('planner.auth', JSON.stringify(a)); });
  await p.clock.setSystemTime(new Date('2026-11-03T09:00:00+09:00'));
  const stamp = await run((s) => s.state.meta.updatedAt);
  await p.reload(); await p.clock.runFor(2500);
  const ids = (key) => run((s, k) => s.todosOn(k).map((t) => t.id).sort().join(','), key);
  check('an unfinished to-do moves to today (Nov 3)', (await ids('2026-11-03')).split(',').includes('one'));
  check('…and is no longer on its original day', !(await ids('2026-11-01')).split(',').includes('one'));
  check('a finished one stays on its day', (await ids('2026-11-01')).split(',').includes('fin') && !(await ids('2026-11-03')).split(',').includes('fin'));
  check('routines keep their own days', (await ids('2026-11-01')).includes('daily') && (await ids('2026-11-03')).includes('daily'));
  check('future to-dos stay in the future', !(await ids('2026-11-03')).includes('later') && (await ids('2026-11-05')).includes('later'));
  check('just opening the app changes nothing (no edit to sync)', await run((s) => s.state.meta.updatedAt) === stamp);

  await p.locator('.cal-rows button.today').click(); await p.clock.runFor(1200);
  const tag = await p.locator('.todo:has-text("Write treatment") .due-tag').innerText();
  check('it shows the day it came from, small and gray', /1/.test(tag) && /Nov|11/.test(tag), tag);

  // Check it off today: it stays on today from now on.
  await p.click('.todo:has-text("Write treatment") .mark-btn'); await p.clock.runFor(500);
  check('checking it off keeps it on the day it was done', await run((s) => { const t = s.state.todos.find((x) => x.id === 'one'); return t.done && t.date === '2026-11-03'; }));
  await p.clock.setSystemTime(new Date('2026-11-04T09:00:00+09:00'));
  check('…and it doesn\'t move any more', !(await ids('2026-11-04')).includes('one') && (await ids('2026-11-03')).includes('one'));
  check('no page errors', !errs.length, errs.join('; '));
  await b.close(); await done();
})();
