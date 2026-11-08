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
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
