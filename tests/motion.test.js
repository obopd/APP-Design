// Sheets slide away and can be dragged down to close; tabs fade in.
const { browser, phone, check, wait, done } = require('./helpers');

(async () => {
  const b = await browser();
  const p = await phone(b, 'a@x');
  const editor = p.locator('#editor');
  const isOpen = () => editor.evaluate((d) => d.open);
  const openEditor = async () => {
    await p.locator('.cal-rows .row').nth(1).locator('button').nth(3).click(); await wait(900);
    await p.click('.todo-section:not(.routines) .section-add:not(.section-folder)'); await wait(400);
  };

  await openEditor();
  check('editor opens', await isOpen());
  await p.click('#editor button[aria-label=Cancel], #editor button[aria-label=Close]');
  await wait(60);
  const mid = await editor.evaluate((d) => ({ open: d.open, closing: d.classList.contains('closing'), t: getComputedStyle(d).transform }));
  check('close slides the sheet away (not instant)', mid.open && mid.closing && mid.t !== 'none', mid.t);
  await wait(300);
  check('…and then it is closed', !await isOpen());

  await p.click('.todo-section:not(.routines) .section-add:not(.section-folder)'); await wait(400);
  const head = await p.locator('#editor .grabber').boundingBox();
  await p.mouse.move(head.x + head.width / 2, head.y + 2); await p.mouse.down();
  for (let y = 8; y <= 40; y += 8) { await p.mouse.move(head.x + head.width / 2, head.y + y); await wait(30); }
  await p.mouse.up(); await wait(350);
  const st = await editor.evaluate((d) => ({ open: d.open, t: d.style.transform, cls: d.className }));
  check('a short drag springs back', st.open && !st.t, JSON.stringify(st));
  await p.mouse.move(head.x + head.width / 2, head.y + 2); await p.mouse.down();
  await p.mouse.move(head.x + head.width / 2, head.y + 260, { steps: 8 }); await p.mouse.up(); await wait(400);
  check('a long drag down closes it', !await isOpen());

  await p.click('.todo-section:not(.routines) .section-add:not(.section-folder)'); await wait(400);
  await p.click('#editor button[aria-label=Cancel], #editor button[aria-label=Close]'); await wait(80);
  await p.click('.todo-section:not(.routines) .section-add:not(.section-folder)'); await wait(400);
  check('reopening while it slides away keeps it open', await isOpen() && !await editor.evaluate((d) => d.classList.contains('closing')));
  await p.keyboard.press('Escape'); await wait(300);

  await p.click('.tab[data-view=settings]');
  check('a new tab fades in', await p.locator('#view-settings.view-enter').count() === 1);
  // Entering film mode plays the clapperboard show, then leaves film mode switched on.
  await p.click('.tab[data-view=calendar]'); await wait(300);
  await p.click('#calendar .cal-title').catch(() => {}); await wait(900);
  const hold = async (page) => {
    const bx = await page.locator('#brand').boundingBox();
    await page.mouse.move(bx.x + 15, bx.y + 15); await page.mouse.down(); await wait(1000); await page.mouse.up();
  };
  await hold(p); await wait(200);
  check('entering shows the clapperboard show', await p.locator('.cine.enter .cine-slate').count() === 1);
  await wait(1500);
  check('…then it\'s gone and film mode is on', await p.locator('.cine').count() === 0 && await p.evaluate(() => document.documentElement.classList.contains('film')));
  await hold(p); await wait(200);
  check('leaving plays the "Cut." curtains', (await p.locator('.cine.exit .cine-title').innerText()) === 'Cut.');
  await wait(1000);
  check('…then film mode is off', await p.locator('.cine').count() === 0 && await p.evaluate(() => !document.documentElement.classList.contains('film')));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await hold(p); await wait(150);
  check('with Reduce Motion it switches without the show', await p.locator('.cine').count() === 0 && await p.evaluate(() => document.documentElement.classList.contains('film')));

  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
