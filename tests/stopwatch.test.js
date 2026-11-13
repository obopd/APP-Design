// Routine stopwatch: start, pause (time is kept, session stays open), resume, stop.
const { check, wait, browser, phone, inApp, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');
  await inApp(p, (s) => {
    const key = new Date().toLocaleDateString('sv');
    s.state.todos.push({ id: 'w', title: 'MCAT Study', date: key, repeat: 'daily', until: '', doneOn: {}, track: 'time', values: {} });
    s.save();
  });
  await p.locator('.cal-rows button.today').click(); await wait(1200);
  const row = '.todo:has-text("MCAT Study")';
  const secs = () => inApp(p, (s) => { const t = s.state.todos.find((x) => x.id === 'w'); return Object.values(t.values || {})[0] || 0; });
  const timer = () => inApp(p, (s) => s.state.todos.find((x) => x.id === 'w').timer);
  // Pretend time passes by moving the start back.
  const ago = (ms) => inApp(p, (s, c, m) => { const t = s.state.todos.find((x) => x.id === 'w'); t.timer.start -= m; s.save(); }, ms);

  await p.click(`${row} [aria-label="Start stopwatch"]`); await wait(400);
  check('▶ starts it, with ⏸ and ■', await p.locator(`${row} [aria-label="Pause stopwatch"]`).count() === 1 && await p.locator(`${row} [aria-label="Stop stopwatch"]`).count() === 1);
  await ago(10 * 60000); await wait(1200);
  check('the time counts up', /10:0\d/.test(await p.locator(`${row} .track-pill`).innerText()), await p.locator(`${row} .track-pill`).innerText());

  await p.click(`${row} [aria-label="Pause stopwatch"]`); await wait(400);
  check('⏸ keeps the time so far', Math.abs(await secs() - 600) <= 2, await secs());
  check('…and the session stays open (paused)', (await timer())?.start === null);
  check('paused shows ▶ resume and ■', await p.locator(`${row} [aria-label="Resume stopwatch"]`).count() === 1 && await p.locator(`${row} .track-pill.paused`).count() === 1);
  const frozen = await p.locator(`${row} .track-pill`).innerText(); await wait(2200);
  check('a paused time doesn\'t move', await p.locator(`${row} .track-pill`).innerText() === frozen, frozen);

  await p.click(`${row} [aria-label="Resume stopwatch"]`); await wait(400);
  await ago(5 * 60000);
  await p.click(`${row} [aria-label="Stop stopwatch"]`); await wait(400);
  check('■ adds the resumed time and ends it', Math.abs(await secs() - 900) <= 3 && (await timer()) === null, await secs());
  check('after stop only ▶ start shows', await p.locator(`${row} [aria-label="Start stopwatch"]`).count() === 1 && await p.locator(`${row} [aria-label="Stop stopwatch"]`).count() === 0);

  await p.click(`${row} [aria-label="Start stopwatch"]`); await wait(300);
  await p.click(`${row} [aria-label="Pause stopwatch"]`); await wait(300);
  await p.click(`${row} [aria-label="Stop stopwatch"]`); await wait(300);
  check('stop while paused doesn\'t add extra time', Math.abs(await secs() - 900) <= 3, await secs());
  // Distance: pick it in the editor, enter how far you ran, see the total.
  await inApp(p, (s) => {
    const key = new Date().toLocaleDateString('sv');
    s.state.todos.push({ id: 'r', title: 'Run', date: key, repeat: 'daily', until: '', doneOn: {}, values: {} });
    s.save();
  });
  await wait(400);
  await p.click('.todo-title:has-text("Run")'); await wait(500);
  await p.click('#editor .field:has-text("Track") .select-btn'); await wait(300);
  await p.click('.layer .menu-item:has-text("Distance")'); await wait(200);
  await p.click('#editor .ok'); await wait(600);
  const run = '.todo:has-text("Run")';
  check('Distance shows a km pill', (await p.locator(`${run} .track-pill`).innerText()) === '0 km');
  await p.click(`${run} .track-pill`); await wait(300);
  await p.fill('.layer .ask-input', '5,2'); await p.click('.layer .ask-btn.primary'); await wait(400);
  check('entering 5,2 saves 5.2 km', (await p.locator(`${run} .track-pill`).innerText()) === '5.2 km'
    && await inApp(p, (s) => Object.values(s.state.todos.find((x) => x.id === 'r').values)[0]) === 5.2);
  await inApp(p, (s) => { const t = s.state.todos.find((x) => x.id === 'r'); t.values['2026-01-01'] = 3.15; s.save(); });
  await p.click('.stats-toggle'); await wait(300);
  check('stats add up the distance', /8\.35 km/.test(await p.locator('.routine-stats li:has-text("Run")').innerText()), await p.locator('.routine-stats li:has-text("Run")').innerText());
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
