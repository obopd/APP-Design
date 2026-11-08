// Folders in the day view: tap the name to edit, + adds a to-do inside, hold a to-do and
// drag it onto another folder (or the section heading) to move it.
const { check, wait, browser, phone, inApp, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');
  await inApp(p, (s) => {
    const key = s.state.todos.length >= 0 && new Date().toLocaleDateString('sv');
    s.state.categories.push({ id: 'fa', name: 'Biology', parent: null, open: true, color: null },
      { id: 'fb', name: 'Film', parent: null, open: true, color: null });
    s.state.todos.push({ id: 't1', title: 'Lab report', date: key, repeat: 'none', done: false, category: 'fa' },
      { id: 't2', title: 'Storyboard', date: key, repeat: 'none', done: false, category: 'fb' });
    s.save();
  });
  await p.locator('.cal-rows button.today').click(); await wait(1200);
  const cat = (id) => inApp(p, (s, c, i) => s.state.todos.find((t) => t.id === i).category, id);

  // Tap the folder name → its sheet opens (no keyboard), rename it.
  await p.click('.folder-name:has-text("Biology")'); await wait(500);
  check('tapping a folder name opens its sheet', await p.locator('#folder-sheet[open]').count() === 1);
  check('…without focusing the name field', await p.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
  check('…with delete and sub-folder buttons', await p.locator('#folder-sheet [aria-label="Delete folder"]').count() === 1
    && await p.locator('#folder-sheet [aria-label="New folder inside"]').count() === 1);
  await p.fill('#folder-sheet input[type=text]', 'Bio'); await p.click('#folder-sheet .ok'); await wait(700);
  check('renaming from the day view works', await p.locator('.folder-name:has-text("Bio")').count() === 1);

  // Tapping elsewhere on the folder still folds it.
  await p.click('.folder-head:has-text("Bio") .folder-toggle'); await wait(300);
  check('the arrow still folds the folder', await inApp(p, (s) => s.state.categories.find((c) => c.id === 'fa').open === false));
  await p.click('.folder-head:has-text("Bio") .folder-toggle'); await wait(300);

  // + next to the name adds a to-do in that folder.
  await p.click('.folder-head:has-text("Film") .folder-add'); await wait(600);
  check('+ next to a folder opens the editor', await p.locator('#editor[open], dialog[open]').count() >= 1);
  await p.click('#editor input[type=text]'); await p.keyboard.type('Shot list'); await p.keyboard.press('Enter'); await wait(700);
  check('…and the new to-do lands in that folder', await inApp(p, (s) => s.state.todos.find((t) => t.title === 'Shot list')?.category === 'fb'));

  // Hold and drag "Lab report" onto the Film folder.
  const drag = async (title, target) => {
    const from = await p.locator(`.todo-title:has-text("${title}")`).boundingBox();
    const to = await p.locator(target).first().boundingBox();
    await p.mouse.move(from.x + 20, from.y + from.height / 2); await p.mouse.down(); await wait(600);
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      await p.mouse.move(from.x + 20, from.y + from.height / 2 + ((to.y + to.height / 2) - (from.y + from.height / 2)) * (i / steps));
      await wait(30);
    }
    const lit = await p.locator('.drop-on').count();
    await p.mouse.up(); await wait(700);
    return lit;
  };
  const lit = await drag('Lab report', '.folder-head:has-text("Film")');
  check('the folder under the finger lights up', lit === 1);
  check('dropping on a folder moves the to-do there', await cat('t1') === 'fb');
  check('…with an Undo snack', await p.locator('.snack:has-text("Moved to Film")').count() === 1);
  check('letting go doesn\'t open the editor', await p.locator('dialog[open]').count() === 0);
  await p.click('.snack-btn'); await wait(500);
  check('Undo puts it back', await cat('t1') === 'fa');

  await drag('Storyboard', '.todo-section:not(.routines) .section-head');
  check('dropping on the To-do heading takes it out of the folder', await cat('t2') === null);

  // Reorder inside a folder: drop "Shot list" above "Storyboard"... (Film has Shot list; add two more)
  await inApp(p, (s) => {
    const key = new Date().toLocaleDateString('sv');
    s.state.todos.push({ id: 'r1', title: 'Alpha', date: key, repeat: 'none', done: false, category: 'fb' },
      { id: 'r2', title: 'Bravo', date: key, repeat: 'none', done: false, category: 'fb' },
      { id: 'r3', title: 'Charlie', date: key, repeat: 'none', done: false, category: 'fb' });
    s.save();
  });
  await wait(500);
  const titles = () => p.$$eval('.folder-head[data-drop="fb"] + ul > li.todo .todo-title', (els) => els.map((e) => e.firstChild.textContent));
  const before = await titles();
  // Drag Charlie onto the top half of the first row.
  await p.locator('.todo-title:has-text("Charlie")').scrollIntoViewIfNeeded(); await wait(200);
  const first = await p.locator('.folder-head[data-drop="fb"] + ul > li.todo').first().boundingBox();
  const ch = await p.locator('.todo-title:has-text("Charlie")').boundingBox();
  await p.mouse.move(ch.x + 20, ch.y + ch.height / 2); await p.mouse.down(); await wait(600);
  await p.mouse.move(ch.x + 20, first.y + 6, { steps: 8 }); await wait(150);
  check('a gap opens where it will land', await p.evaluate(() => document.querySelector('.folder-head[data-drop="fb"] + ul').firstElementChild?.matches('.todo-gap')));
  await p.mouse.up(); await wait(700);
  const after = await titles();
  check('dragging inside a folder reorders it', after[0] === 'Charlie' && after.length === before.length, `${before} → ${after}`);
  await p.reload(); await wait(1800);
  await p.locator('.cal-rows button.today').click(); await wait(1200);
  check('…and the order is kept', (await titles())[0] === 'Charlie');

  // Drop between two to-dos of another folder: lands there, in that folder.
  await p.evaluate(() => { const sc = document.querySelector('[data-scroll=todos]'); const h = document.querySelector('.folder-head[data-drop="fa"]'); sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 50; }); await wait(200);
  const bio = await p.locator('.folder-head[data-drop="fa"] + ul > li.todo').first().boundingBox();
  const br = await p.locator('.todo-title:has-text("Bravo")').boundingBox();
  await p.mouse.move(br.x + 20, br.y + br.height / 2); await p.mouse.down(); await wait(600);
  await p.mouse.move(br.x + 20, bio.y + bio.height - 4, { steps: 8 }); await wait(150);
  check('the gap opens below the row it will follow', await p.evaluate(() => document.querySelector('.folder-head[data-drop="fa"] + ul > li.todo')?.nextElementSibling?.matches('.todo-gap')));
  await p.mouse.up(); await wait(700);
  check('dropping between to-dos of another folder moves it there', await cat('r2') === 'fa');

  // A new folder exists on its own, without a to-do.
  await p.click('.todo-section:not(.routines) .section-folder'); await wait(500);
  check('making a folder doesn\'t focus the field', await p.evaluate(() => document.activeElement?.tagName !== 'INPUT'));
  await p.click('#folder-sheet input[type=text]'); await p.keyboard.type('Reading'); await p.click('#folder-sheet .ok'); await wait(700);
  check('a new folder doesn\'t open the to-do editor', await p.locator('#editor[open]').count() === 0);
  check('the empty folder shows in To-do', await p.locator('.todo-section:not(.routines) .folder-name:has-text("Reading")').count() === 1);
  check('…not in Routines', await p.locator('.routines .folder-name:has-text("Reading")').count() === 0);
  await p.locator('.cal-rows button').nth(10).click().catch(() => {}); await wait(900);
  check('…and on other days too', await p.locator('.todo-section:not(.routines) .folder-name:has-text("Reading")').count() === 1);
  await p.click('.routines .section-folder'); await wait(500);
  await p.click('#folder-sheet input[type=text]'); await p.keyboard.type('Gym'); await p.click('#folder-sheet .ok'); await wait(700);
  check('a routine folder shows empty in Routines', await p.locator('.routines .folder-name:has-text("Gym")').count() === 1
    && await p.locator('.todo-section:not(.routines) .folder-name:has-text("Gym")').count() === 0);
  await p.locator('.cal-rows button.today').click().catch(() => {}); await wait(900);

  // A quick tap still opens the editor; a short hold without moving does nothing.
  await p.click('.todo-title:has-text("Lab report")'); await wait(600);
  check('a normal tap still opens the to-do', await p.locator('dialog[open]').count() === 1);
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
