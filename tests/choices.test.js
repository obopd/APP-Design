// "Do one of these": a to-do with choices; doing any one checks it off (per day for routines).
const { check, wait, browser, phone, inApp, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');
  await p.locator('.cal-rows button.today').click(); await wait(1200);

  // Make one in the editor: "Exercise" with Push-Up / Run / Gym, as a daily routine.
  await p.click('.routines .section-add:not(.section-folder)'); await wait(500);
  check('the editor opens without the keyboard', await p.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
  await p.click('#editor input[aria-label="Title"]'); await p.keyboard.type('Exercise');
  await p.click('#editor [aria-label="Add choice"]'); await wait(150);
  check('+ Add gives two choice fields to start', await p.locator('#editor .choice-edit input').count() === 2);
  const inputs = p.locator('#editor .choice-edit input');
  await inputs.nth(0).fill('Push-Up'); await inputs.nth(1).fill('Run');
  await p.click('#editor [aria-label="Add choice"]'); await wait(150);
  await inputs.nth(2).fill('Gym');
  await p.click('#editor .ok'); await wait(700);
  const t = () => inApp(p, (s) => s.state.todos.find((x) => x.title === 'Exercise'));
  check('it saves three choices', (await t()).choices.map((c) => c.label).join() === 'Push-Up,Run,Gym');

  const row = '.todo:has-text("Exercise")';
  check('the choices show under the title', await p.locator(`${row} .choice`).count() === 3);
  await p.click(`${row} .choice:has-text("Run")`); await wait(500);
  const key = await p.evaluate(() => new Date().toLocaleDateString('sv'));
  let x = await t();
  check('doing one checks the to-do off', !!x.doneOn[key] && await p.locator(`${row}.done`).count() === 1);
  check('…and remembers which', x.picked[key] === x.choices[1].id && await p.locator(`${row} .choice.picked`).innerText() === 'Run');
  await p.click(`${row} .choice:has-text("Gym")`); await wait(500);
  x = await t();
  check('tapping another switches the pick (still done)', !!x.doneOn[key] && x.picked[key] === x.choices[2].id);
  await p.click(`${row} .choice:has-text("Gym")`); await wait(500);
  x = await t();
  check('tapping the picked one again undoes it', !x.doneOn[key] && !x.picked[key]);
  await p.click(`${row} .choice:has-text("Push-Up")`); await wait(400);
  await p.click(`${row} .mark-btn`); await wait(400);
  x = await t();
  check('unchecking with the mark clears the pick too', !x.doneOn[key] && !x.picked?.[key]);

  // Tomorrow it starts fresh (routine = per day).
  await inApp(p, (s, c, k) => { const y = s.state.todos.find((z) => z.title === 'Exercise'); s.pickChoice(y, k, y.choices[0].id); }, key);
  const tomorrowFresh = await inApp(p, (s) => { const y = s.state.todos.find((z) => z.title === 'Exercise'); const d = new Date(); d.setDate(d.getDate() + 1); const k = d.toLocaleDateString('sv'); return !s.isDone(y, k) && !s.pickedOn(y, k); });
  check('a routine starts fresh the next day', tomorrowFresh);

  // One-off to-do with choices.
  await inApp(p, (s, c, k) => { s.state.todos.push({ id: 'o', title: 'Dinner', date: k, repeat: 'none', done: false, choices: [{ id: 'a', label: 'Cook' }, { id: 'b', label: 'Eat out' }] }); s.save(); }, key);
  await wait(400);
  await p.click('.todo:has-text("Dinner") .choice:has-text("Eat out")'); await wait(400);
  check('a one-off to-do is done with its pick', await inApp(p, (s, c, k) => { const y = s.state.todos.find((z) => z.id === 'o'); return y.done && s.pickedOn(y, k) === 'b'; }, key));

  // Editing keeps the choices; removing one works.
  await p.click('.todo:has-text("Dinner") .todo-title'); await wait(500);
  check('editing shows the saved choices', await p.locator('#editor .choice-edit input').count() === 2);
  await p.locator('#editor .choice-edit [aria-label="Remove choice"]').nth(1).click();
  await p.click('#editor .ok'); await wait(500);
  check('a removed choice is gone', await inApp(p, (s) => s.state.todos.find((z) => z.id === 'o').choices.length) === 1);
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
