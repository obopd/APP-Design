// The Home Screen icon badge counts only things waiting for you (unread chats + bell),
// not starred to-dos.
const { check, wait, browser, phone, inApp, sql, done } = require('./helpers');

const init = () => {
  window.__badge = [];
  navigator.setAppBadge = (n) => { window.__badge.push(n); return Promise.resolve(); };
  navigator.clearAppBadge = () => { window.__badge.push(0); return Promise.resolve(); };
};
const last = (p) => p.evaluate(() => window.__badge.at(-1) ?? 0);

(async () => {
  const b = await browser();
  const p = await phone(b, 'b@x', { init });
  await p.evaluate(() => document.querySelector('.layer .ask-btn')?.click()); await wait(300);
  await inApp(p, (s) => {
    const key = new Date().toLocaleDateString('sv');
    s.state.todos.push({ id: 'imp', title: 'Starred', date: key, repeat: 'none', important: true, done: false });
    s.save();
  });
  await wait(800);
  await p.click('#bell'); await wait(600); await p.keyboard.press('Escape'); await wait(600);
  check('a starred to-do doesn\'t put a number on the icon', await last(p) === 0, await p.evaluate(() => window.__badge.join(',')));

  await sql("insert into messages (chat_id, sender, body) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000000a', 'Hi')");
  for (let i = 0; i < 40 && await last(p) === 0; i += 1) await wait(250);
  check('an unread chat message shows on the icon', await last(p) >= 1, await last(p));

  await p.click('.tab[data-view="chat"]'); await wait(800);
  await p.locator('.chat-list li > *').first().click(); await wait(1500);
  check('reading it clears the icon', await last(p) === 0, await last(p));
  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
