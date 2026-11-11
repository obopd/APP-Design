// Tied to-dos ("do one of these"): doing any one covers the others for that day.
const { check, wait, browser, phone, inApp, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');
  const key = await p.evaluate(() => new Date().toLocaleDateString('sv'));
  await inApp(p, (s, c, k) => {
    s.state.categories.push({ id: 'g', name: 'Gym', parent: null, open: true, section: 'routine' });
    const R = (id, title) => ({ id, title, date: k, repeat: 'daily', until: '', doneOn: {}, category: 'g' });
    s.state.todos.push(R('pu', 'Push-Up'), R('wo', 'Work Out'), R('rn', 'Run'), R('st', 'Stretch'));
    s.save();
  }, key);
  await p.locator('.cal-rows button.today').click(); await wait(1200);

  // Tie Push-Up with Work Out and Run from the editor.
  await p.click('.todo-title:has-text("Push-Up")'); await wait(500);
  await p.click('#editor .tie-btn'); await wait(300);
  check('the tie list offers the other routines', await p.locator('.layer .menu-item').count() === 3);
  await p.click('.layer .menu-item:has-text("Work Out")'); await p.click('.layer .menu-item:has-text("Run")');
  await p.click('.layer .ask-btn.primary'); await wait(200);
  check('the field shows what it\'s tied to', /Work Out, Run/.test(await p.locator('#editor .tie-btn').innerText()));
  await p.click('#editor .ok'); await wait(700);
  const ties = await inApp(p, (s) => s.state.todos.map((t) => `${t.id}:${t.tie ? 'T' : '-'}`).join());
  check('three are tied, Stretch isn\'t', /pu:T/.test(ties) && /wo:T/.test(ties) && /rn:T/.test(ties) && /st:-/.test(ties), ties);
  check('they show together, joined by one line', await p.locator('.tie .todo').count() === 3 && await p.locator('.tie').count() === 1);
  check('the folder counts the tie once (2 open: tie + Stretch)', (await p.locator('.folder-count').first().innerText()) === '2');

  // Do one: the others are covered, the line lights up, the count drops.
  await p.click('.tie .todo:has-text("Run") .mark-btn'); await wait(400);
  check('doing one lights the line', await p.locator('.tie.met').count() === 1);
  check('…and the others fade (covered)', await p.locator('.tie .todo.covered').count() === 2);
  check('…and the count drops to 1', (await p.locator('.folder-count').first().innerText()) === '1');
  await p.click('.tie .todo:has-text("Run") .mark-btn'); await wait(400);
  check('undoing it uncovers them', await p.locator('.tie .todo.covered').count() === 0 && await p.locator('.tie.met').count() === 0);

  // Untie one: Work Out leaves; the other two stay tied.
  await p.click('.todo-title:has-text("Work Out")'); await wait(500);
  await p.click('#editor .tie-btn'); await wait(300);
  for (const n of ['Push-Up', 'Run']) await p.click(`.layer .menu-item:has-text("${n}")`);
  await p.click('.layer .ask-btn.primary'); await p.click('#editor .ok'); await wait(700);
  check('untying one leaves the others tied', await p.locator('.tie .todo').count() === 2 && !(await inApp(p, (s) => s.state.todos.find((t) => t.id === 'wo').tie)));

  // A to-do made with the first version (choices) becomes tied to-dos on load.
  await p.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem('planner.v1'));
    d.todos.push({ id: 'old', title: 'Dinner', date: k, repeat: 'none', done: true, choices: [{ id: 'a', label: 'Cook' }, { id: 'b', label: 'Eat out' }], picked: { [k]: 'b' } });
    localStorage.setItem('planner.v1', JSON.stringify(d));
  }, key);
  await p.reload(); await wait(1800);
  const conv = await inApp(p, (s) => s.state.todos.filter((t) => t.title === 'Cook' || t.title === 'Eat out').map((t) => `${t.title}:${t.done}:${!!t.tie}`).sort().join());
  check('old choices turn into tied to-dos (the picked one done)', conv === 'Cook:false:true,Eat out:true:true', conv);
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
