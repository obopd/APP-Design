// The app on a computer: mouse, keyboard, big and resized windows (Desktop Chrome).
// Each step checks the result; screenshots go to tests/out/desktop/.
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { MOCK, APP, sql, check, wait, done } = require('./helpers');

const OUT = path.join(__dirname, 'out', 'desktop');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } });
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const SUPABASE_URL='${MOCK}'; export const SUPABASE_ANON_KEY='anon';` }));
  const p = await ctx.newPage();
  const errs = []; const consoleErrs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrs.push(m.text()); });
  const shot = (n) => p.screenshot({ path: path.join(OUT, `${n}.png`) });
  const title = () => p.locator('#calendar .cal-title').innerText();

  // Sign in with the keyboard (Tab + Enter).
  await p.goto(APP);
  await p.click('input[type=email]'); await p.keyboard.type('a@x');
  await p.keyboard.press('Tab'); await p.keyboard.type('secret1'); await p.keyboard.press('Enter');
  await wait(1800);
  check('sign in with the keyboard (Tab, Enter)', await p.locator('#calendar').isVisible());
  await shot('01-month');

  // Calendar: arrows, keyboard, day view.
  const t0 = await title();
  await p.click('#calendar .cal-head button >> nth=-1'); await wait(500);
  const t1 = await title();
  await p.keyboard.press('ArrowLeft'); await wait(500);
  check('› and ← change the month', t1 !== t0 && await title() === t0, `${t0} → ${t1}`);
  await p.locator('.cal-rows .row').nth(2).locator('button').nth(3).click(); await wait(1000);
  check('clicking a date opens the day', await p.locator('#view-calendar.week-mode').count() === 1);
  await shot('02-day');
  await p.keyboard.press('ArrowRight'); await wait(800);
  check('→ moves to the next week in the day view', await p.locator('#view-calendar.week-mode').count() === 1);
  await p.keyboard.press('Escape'); await wait(1000);
  check('Esc goes back to the month', await p.locator('#view-calendar.month-mode').count() === 1);

  // To-do: add with Enter, check off, edit, Esc closes without saving.
  await p.locator('.cal-rows .row').nth(2).locator('button').nth(3).click(); await wait(1000);
  await p.click('.todo-section:not(.routines) .section-add:not(.section-folder)'); await wait(400);
  check('the editor opens without the keyboard focus jumping in', await p.evaluate(() => !document.activeElement?.matches('#editor input[type=text]')));
  await p.click('#editor input[type=text]'); await p.keyboard.type('Desk test to-do'); await p.keyboard.press('Enter'); await wait(600);
  check('Enter saves the to-do', await p.locator('.todo:has-text("Desk test to-do")').count() === 1);
  await p.click('.todo:has-text("Desk test to-do") .mark-btn'); await wait(300);
  check('clicking the mark checks it off', await p.locator('.todo.done:has-text("Desk test to-do")').count() === 1);
  await p.click('.todo:has-text("Desk test to-do") .todo-title'); await wait(400);
  await p.fill('#editor input[type=text]', 'Changed but cancelled'); await p.keyboard.press('Escape'); await wait(400);
  check('Esc closes the editor without saving', await p.locator('.todo:has-text("Changed but cancelled")').count() === 0 && !await p.locator('#editor').evaluate((d) => d.open));

  // Postpone with a mouse drag, columns divider drag, event by clicking an hour.
  await p.click('.todo:has-text("Desk test to-do") .mark-btn'); await wait(300); // not done again
  const row = await p.locator('.todo-row:has-text("Desk test to-do")').boundingBox();
  await p.mouse.move(row.x + row.width - 20, row.y + row.height / 2); await p.mouse.down();
  for (let x = 0; x <= 140; x += 20) { await p.mouse.move(row.x + row.width - 20 - x, row.y + row.height / 2); await wait(16); }
  await p.mouse.up(); await wait(400);
  check('dragging a to-do left with the mouse shows Tmrw / Date', await p.locator('.todo-row.open').count() === 1);
  await p.locator('.todo:has-text("Desk test to-do") .todo-act').first().click(); await wait(600);
  check('…and Tmrw postpones it', (await sql("select data from planner_data where user_id = '00000000-0000-0000-0000-00000000000a'")).length >= 0 && await p.locator('.todo:has-text("Desk test to-do")').count() === 0);
  const div = await p.locator('.divider').boundingBox();
  if (div) {
    await p.mouse.move(div.x + div.width / 2, div.y + 40); await p.mouse.down();
    await p.mouse.move(div.x + div.width / 2 + 700, div.y + 40, { steps: 10 }); await p.mouse.up(); await wait(500);
  }
  check('dragging the divider with the mouse stretches a column', !!div && await p.evaluate(() => document.querySelector('.columns')?.dataset.layout === 'todo'));
  await shot('03-stretched');
  const div2 = await p.locator('.divider').boundingBox();
  await p.mouse.move(div2.x + div2.width / 2, div2.y + 40); await p.mouse.down();
  await p.mouse.move(700, div2.y + 40, { steps: 10 }); await p.mouse.up(); await wait(500);
  check('…and dragging it back returns to the split', await p.evaluate(() => document.querySelector('.columns')?.dataset.layout === 'split'));
  await p.locator('.cal-rows .row').nth(2).locator('button').nth(3).click(); await wait(400);
  await p.locator('.cal-rows .row').nth(2).locator('button').nth(3).click(); await wait(1000);
  await p.mouse.wheel(0, 400); await wait(300);
  const hour = p.locator('.hour').nth(14);
  await hour.click({ position: { x: 120, y: 20 } }).catch(() => {}); await wait(500);
  const evOpen = await p.locator('#editor').evaluate((d) => d.open);
  if (evOpen) { await p.click('#editor input[type=text]'); await p.keyboard.type('Desk meeting'); await p.keyboard.press('Enter'); await wait(600); }
  check('clicking an empty hour adds an event', evOpen && await p.locator('.event:has-text("Desk meeting")').count() === 1);

  // Expanded grid, search, D-Day.
  await p.keyboard.press('Escape'); await wait(1000);
  await p.click('.grid-btn:visible'); await wait(900);
  const w1 = await p.locator('.expanded .cal-title').innerText();
  await p.keyboard.press('ArrowRight'); await wait(900);
  check('expanded week: → moves to the next week', w1 !== await p.locator('.expanded .cal-title').innerText());
  await shot('04-expanded-week');
  await p.click('.grid-btn:visible'); await wait(900); await shot('05-expanded-month');
  await p.click('.grid-btn:visible'); await wait(900);
  await p.click('#search-btn'); await wait(300); await p.click('.search-input'); await p.keyboard.type('desk'); await wait(200);
  check('search finds what you typed', (await p.locator('.search-row').count()) >= 1);
  await shot('06-search');
  await p.keyboard.press('Escape'); await wait(300);
  check('Esc closes search', await p.locator('.search-card').count() === 0);
  await p.click('.tab[data-view=dday]'); await wait(300);
  await p.click('#view-dday .page-add'); await wait(400);
  await p.click('#dday-sheet input[type=text]'); await p.keyboard.type('Premiere');
  await p.fill('#dday-sheet input[type=date]', '2027-03-01'); await p.keyboard.press('Enter'); await wait(500);
  check('a D-Day can be added', await p.locator('#view-dday :text("Premiere")').count() === 1);

  // Chat: Enter sends, Shift+Enter is a new line.
  await p.click('.tab[data-view=chat]'); await wait(500);
  await p.click('.chat-row >> nth=0'); await wait(800);
  await p.click('.composer-input'); await p.keyboard.type('Line one'); await p.keyboard.press('Shift+Enter'); await p.keyboard.type('line two');
  check('Shift+Enter makes a new line', (await p.inputValue('.composer-input')) === 'Line one\nline two');
  await p.keyboard.press('Enter'); await wait(1200);
  check('Enter sends the message', (await p.inputValue('.composer-input')) === '' && (await p.locator('.bubble').last().innerText()).includes('line two'));
  await shot('07-chat');
  await p.click('button[aria-label="Back to chats"]'); await wait(700);

  // Settings: theme switch.
  await p.click('.tab[data-view=settings]'); await wait(300);
  await p.click('.segmented button:has-text("Dark")'); await wait(400);
  check('switching to dark mode works', await p.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  await shot('08-settings-dark');

  // Film mode with the mouse: hold the logo, write, organize, preview.
  await p.click('.tab[data-view=calendar]'); await wait(500);
  const bx = await p.locator('#brand').boundingBox();
  await p.mouse.move(bx.x + 15, bx.y + 15); await p.mouse.down(); await wait(1000); await p.mouse.up(); await wait(1800);
  check('holding the logo with the mouse enters film mode', await p.evaluate(() => document.documentElement.classList.contains('film')));
  await p.click('.film-chip'); await p.click('.layer .new-group'); await p.click('.layer .ask-input'); await p.keyboard.type('Desk Film'); await p.keyboard.press('Enter'); await wait(2500);
  await shot('09-film-calendar');
  await p.click('.tab[data-view=write]'); await wait(300);
  await p.click('.write-tabs button:has-text("Script")'); await p.click('.write-head .pill:has-text("Edit")'); await wait(800);
  await p.locator('.screenplay.editing textarea.sp').first().click();
  await p.keyboard.type('INT. BUS - NIGHT'); await p.keyboard.press('Enter'); await p.keyboard.type('Rain on the windows.'); await p.keyboard.press('Enter');
  await p.keyboard.type('MIA'); await wait(300);
  await shot('10-script-edit');
  await p.click('.write-done'); await wait(1200);
  check('typing a script with the keyboard works', (await p.locator('.screenplay').innerText()).includes('Rain on the windows.'));
  await p.click('.tab[data-view=organize]'); await wait(300);
  await p.click('#view-organize .page-add'); await wait(300);
  await p.click('#org-sheet .title-row input'); await p.keyboard.type('Rain machine'); await p.keyboard.press('Enter'); await wait(500);
  check('adding a supply works', await p.locator('.org-row:has-text("Rain machine")').count() === 1);
  await p.click('.tab[data-view=preview]'); await wait(300);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#view-preview .page-add')]);
  await chooser.setFiles(path.join(OUT, '01-month.png')); await wait(3000);
  check('adding an image from the computer\'s file picker works', await p.locator('.pv-tile:not(.loading)').count() === 1);
  await p.click('.pv-tile'); await wait(500);
  await p.keyboard.press('Escape'); await wait(400);
  check('Esc closes the image viewer', !await p.locator('.pv-viewer').evaluate((d) => d.open));
  await shot('11-preview');

  // Window sizes: wide, narrow, resized while open.
  for (const [w, hgt] of [[1920, 1080], [1024, 700], [600, 800], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: hgt }); await wait(600);
    await p.click('.tab[data-view=calendar]'); await wait(600);
    const fit = await p.evaluate(() => {
      const c = document.getElementById('calendar').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, inside: c.left >= 0 && c.right <= innerWidth && c.width > 200 };
    });
    check(`window ${w}×${hgt}: calendar fits, nothing spills sideways`, !fit.overflow && fit.inside, JSON.stringify(fit));
    await shot(`12-window-${w}`);
  }

  check('no page errors', !errs.length, errs.slice(0, 3).join('; '));
  check('no console errors', !consoleErrs.length, consoleErrs.slice(0, 3).join('; '));
  await b.close(); await done();
})();
