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
  const mid = await editor.evaluate((d) => ({ open: d.hasAttribute('open'), closing: d.classList.contains('closing'), t: getComputedStyle(d).transform }));
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

  await p.click('#bell'); await wait(400);
  await p.click('#social-sheet button[aria-label=Close]'); await wait(60);
  await p.click('#bell'); await wait(500);
  check('reopening the bell sheet right after closing keeps it open', await p.locator('#social-sheet').evaluate((d) => d.hasAttribute('open') && !d.classList.contains('closing')));
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
  // The owner's choice: dissolve, with the slate clapping in the empty middle.
  await hold(p); await wait(650); // the logo flips at the switch, mid-dissolve
  check('the logo flips into the clapperboard (animated, not instant)', await p.evaluate(() => document.querySelector('#brand .brand-slate').getAnimations().length > 0));
  check('entering plays the dissolve with the slate in the middle', await p.locator('.fx-mark.fx-in .fx-mark-arm').count() === 1);
  await wait(1500);
  check('…then it\'s gone and film mode is on', await p.locator('.fx').count() === 0 && await p.evaluate(() => document.documentElement.classList.contains('film') && !document.body.className.includes('fx-')));
  await hold(p); await wait(200);
  check('leaving shows the calendar logo in the middle', await p.locator('.fx-mark.fx-out img.fx-mark-art').count() === 1);
  await wait(1500);
  check('…then film mode is off', await p.evaluate(() => !document.documentElement.classList.contains('film')));
  // Every candidate style plays, switches the mode under cover, and cleans up.
  for (const [style, total, at] of [['dip', 1150, 560], ['letterbox', 1250, 600], ['leak', 1350, 620], ['focus', 1100, 520], ['dissolve', 1400, 560]]) {
    const r = await p.evaluate(async ([style, at]) => {
      const c = await import('./js/cinema.js');
      let switched = 0; const t0 = performance.now();
      const done = c.playFilmSwitch(true, () => { switched = performance.now() - t0; }, 'Night Bus', style);
      const shown = !!document.querySelector('.fx') || document.body.classList.contains(`fx-${style}`);
      await done;
      return { shown, switched: Math.round(switched), clean: !document.querySelector('.fx') && !document.body.className.includes('fx-') };
    }, [style, at]);
    check(`${style}: plays, switches at ~${at}ms, cleans up`, r.shown && Math.abs(r.switched - at) < 120 && r.clean, JSON.stringify(r));
  }
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const quiet = await p.evaluate(async () => { const c = await import('./js/cinema.js'); let on = false; await c.playFilmSwitch(true, () => { on = true; }, '', 'dip'); return on && !document.querySelector('.fx'); });
  check('with Reduce Motion every style just switches', quiet);

  // Text isn't selectable (no blue highlight) except chat messages and typing fields.
  const sel = (q) => p.evaluate((q) => { const el = document.querySelector(q); return el && (getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect); }, q);
  check('ordinary text can\'t be selected', await sel('#calendar .cal-title') === 'none');
  check('chat bubbles and fields can', await p.evaluate(() => {
    const t = document.createElement('textarea'); const m = document.createElement('div'); m.className = 'bubble';
    document.body.append(t, m);
    const ok = [t, m].every((el) => (getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect) === 'text');
    t.remove(); m.remove(); return ok;
  }));
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
