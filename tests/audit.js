// Walks every screen in light and dark mode and reports page errors, console errors,
// content wider than the screen and buttons smaller than a comfortable tap.
// Screenshots go to tests/out/audit/. Run after tests/start.sh: node tests/audit.js
const fs = require('fs');
const path = require('path');
const { browser, phone, inApp, filmProject, check, wait, done } = require('./helpers');

const OUT = path.join(__dirname, 'out', 'audit');
fs.mkdirSync(OUT, { recursive: true });

async function inspect(p, name, issues) {
  await wait(450);
  const found = await p.evaluate(() => {
    const W = innerWidth;
    const out = { wide: [], small: [] };
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
    const inScroller = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && a !== document.body && a !== document.documentElement) return true; } return false; };
    const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`;
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > W + 1 || r.left < -1) && !inScroller(el) && getComputedStyle(el).position !== 'fixed') out.wide.push(`${label(el)} (${Math.round(r.left)}..${Math.round(r.right)})`);
    }
    for (const el of document.querySelectorAll('button, a[href], input[type=checkbox], [role=button]')) {
      if (!visible(el) || el.closest('[hidden]') || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 28 || r.height < 28) out.small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { wide: [...new Set(out.wide)].slice(0, 8), small: [...new Set(out.small)].slice(0, 8) };
  });
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  if (found.wide.length) issues.push(`${name}: wider than screen → ${found.wide.join(', ')}`);
  if (found.small.length) issues.push(`${name}: small tap targets → ${found.small.join(', ')}`);
}

(async () => {
  const b = await browser();
  const issues = [];
  for (const theme of ['light', 'dark']) {
    const p = await phone(b, theme === 'light' ? 'a@x' : 'b@x');
    const consoleErrors = [];
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    await inApp(p, (s, c, t) => {
      s.state.settings.theme = t;
      const k = new Date().toISOString().slice(0, 10);
      s.state.todos.push({ id: 'a1', title: 'Read chapter 4 of a rather long book title that wraps', date: k, repeat: 'none', important: true, notes: '' },
        { id: 'a2', title: 'Stretch', date: k, repeat: 'daily', until: '', doneOn: {}, track: 'count', values: {} });
      s.state.events.push({ id: 'e1', title: 'Seminar', date: k, allDay: false, start: '10:00', end: '11:30', repeat: 'none', alert: '15', notes: '' });
      s.state.ddays.push({ id: 'd1', title: 'Graduation', date: k, yearly: false });
      s.save({ personal: true });
    }, theme);
    await p.reload(); await wait(1800);
    const shot = (n) => inspect(p, `${theme}-${n}`, issues);
    await shot('calendar-month');
    await p.locator('.cal-rows .row').nth(1).locator('button').nth(3).click();
    await shot('calendar-day');
    await p.click('#calendar .cal-title'); await wait(900);
    await p.click('.grid-btn:visible').catch(() => {}); await shot('calendar-expanded-week');
    await p.click('.grid-btn:visible').catch(() => {}); await shot('calendar-expanded-month');
    await p.click('.grid-btn:visible').catch(() => {}); await wait(1000);
    await p.click('#search-btn'); await p.fill('.search-input', 'e'); await shot('search'); await p.click('.search-cancel');
    await p.click('#bell').catch(() => {}); await shot('bell'); await p.keyboard.press('Escape');
    await p.click('.tab[data-view=dday]'); await shot('dday');
    await p.click('.tab[data-view=chat]'); await shot('chat-list');
    await p.click('.chat-row >> nth=0').catch(() => {}); await shot('chat-open');
    await p.click('button[aria-label="Back to chats"]').catch(() => {});
    await p.click('.tab[data-view=settings]'); await shot('settings');
    await p.click('.tab[data-view=calendar]'); await wait(300);
    await filmProject(p, theme === 'light' ? 'Vadiemens' : 'Night bus');
    await shot('film-calendar');
    await p.click('.tab[data-view=write]');
    for (const s of ['Theme', 'Characters', 'Plot', 'Script']) { await p.click(`.write-tabs button:has-text("${s}")`); await shot(`write-${s.toLowerCase()}`); }
    await p.click('.tab[data-view=organize]');
    for (const s of ['Supplies', 'Locations', 'Cast', 'Budget', 'Shoot']) { await p.click(`.org-tabs button:has-text("${s}")`); await shot(`organize-${s.toLowerCase()}`); }
    await p.click('#view-organize button.page-add'); await shot('organize-shoot-sheet'); await p.click('#org-sheet button[aria-label=Cancel]');
    await p.click('.tab[data-view=preview]'); await shot('preview-concept');
    await p.click('.pv-tabs button:has-text("Result")'); await shot('preview-result');
    await p.click('.tab[data-view=chat]'); await shot('film-chat');
    check(`${theme}: no page errors`, !p.errors.length, p.errors.join('; '));
    check(`${theme}: no console errors`, !consoleErrors.length, consoleErrors.slice(0, 3).join('; '));
    await p.ctx.close();
  }
  console.log(issues.length ? `\nLayout notes:\n- ${issues.join('\n- ')}` : '\nNo layout issues found.');
  await done(b);
})();
