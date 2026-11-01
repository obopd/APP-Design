// Organize → Shoot: plan a shooting day from the script's scenes, the cast and a location;
// it appears on the project calendar and the call sheet copies as text.
const { browser, phone, inApp, filmProject, sql, check, wait, done } = require('./helpers');

(async () => {
  const b = await browser();
  const A = await phone(b, 'a@x');
  await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8765' });
  await filmProject(A, 'Vadiemens');
  const pid = (await sql('select id from projects limit 1'))[0].id;
  await sql(`insert into project_docs (project_id, section, body) values ($1, 'script', $2) on conflict (project_id, section) do update set body = excluded.body`, [pid, JSON.stringify({ blocks: [
    { id: 's1', t: 'scene', x: 'INT. BUS DEPOT - NIGHT' }, { id: 'c1', t: 'character', x: 'MIA' }, { id: 'd1', t: 'dialogue', x: 'Last bus.' },
    { id: 's2', t: 'scene', x: 'EXT. ROOFTOP - DAWN' }, { id: 'c2', t: 'character', x: 'JONAS (V.O.)' }, { id: 'd2', t: 'dialogue', x: 'Hey.' },
  ] })]);
  await inApp(A, (s) => {
    s.cur().org.location.push({ id: 'l1', name: 'Old bus depot', status: 'confirmed', address: '12 Depot Rd' });
    s.cur().org.actor.push({ id: 'a1', name: 'Jane Kim', role: 'Mia' }, { id: 'a2', name: 'Leo Park', role: 'Jonas' }, { id: 'a3', name: 'Sam Lee', role: 'Driver' });
    s.save();
  });
  await A.evaluate(() => import('./js/film.js').then((m) => m.refreshFilm())); await wait(1500);

  await A.click('.tab[data-view=organize]'); await wait(300);
  await A.click('.org-tabs button:has-text("Shoot")'); await wait(300);
  check('empty Shoot section explains itself', (await A.locator('.org-empty').innerText()).includes('shooting day'));
  await A.click('button[aria-label="Add shooting day"]'); await wait(300);
  const d = new Date(); d.setDate(d.getDate() + 5);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await A.fill('#org-sheet input[aria-label=Date]', key);
  await A.fill('#org-sheet input[aria-label="Call time"]', '06:30');
  await A.click('#org-sheet .field:has-text("Location") .select-btn'); await A.click('.layer .menu-item:has-text("Old bus depot")'); await wait(200);
  await A.click('#org-sheet .field:has-text("Scenes") .select-btn'); await wait(200);
  check('scenes come from the script, numbered', (await A.locator('.layer .pick-name').allInnerTexts()).join('|') === '1. INT. BUS DEPOT - NIGHT|2. EXT. ROOFTOP - DAWN');
  await A.click('.layer .menu-item >> nth=0'); await A.click('.layer .menu-item >> nth=1'); await A.click('.layer .ask-btn.primary'); await wait(200);
  check('speaking actors are added from the scenes', (await A.locator('#org-sheet .field:has-text("Cast") .select-label').innerText()) === 'Jane Kim, Leo Park');
  await A.fill('#org-sheet textarea', 'Bring rain covers');
  await A.screenshot({ path: `${__dirname}/out/shoot-sheet.png` });
  await A.click('#org-sheet button[aria-label=Save]'); await wait(1500);
  const card = await A.locator('.shoot-card').innerText();
  check('day card shows time, place, scenes, cast', /Day 1 · 06:30–19:00/.test(card) && card.includes('Old bus depot') && card.includes('Sc 1, 2') && card.includes('Jane Kim, Leo Park'), card.replace(/\n/g, ' | '));
  const row = (await sql("select data from project_items where kind = 'event'"))[0]?.data || {};
  check('saved as a project event (syncs to collaborators)', row.title === 'Shoot day 1' && row.shoot?.location === 'l1' && row.date === key);
  await A.screenshot({ path: `${__dirname}/out/shoot-list.png` });

  // A second, earlier day renumbers both.
  await A.click('button[aria-label="Add shooting day"]'); await wait(300);
  const e = new Date(); e.setDate(e.getDate() + 2);
  await A.fill('#org-sheet input[aria-label=Date]', `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`);
  await A.click('#org-sheet button[aria-label=Save]'); await wait(600);
  check('days are numbered by date', (await A.locator('.shoot-card b:not(.display)').allInnerTexts()).map((t) => t.split(' ·')[0]).join(',') === 'Day 1,Day 2');

  await A.click('.shoot-card >> nth=1'); await wait(300);
  await A.click('.shoot-copy'); await wait(300);
  const text = await A.evaluate(() => navigator.clipboard.readText());
  check('call sheet copies as text', text.startsWith('Vadiemens — Shoot day 2') && text.includes('Call 06:30') && text.includes('Jane Kim (Mia)') && text.includes('Notes: Bring rain covers'), text.split('\n')[0]);
  await A.click('#org-sheet button[aria-label=Cancel]'); await wait(300);

  await A.click('.tab[data-view=calendar]'); await wait(300);
  await A.click('#search-btn'); await A.fill('.search-input', 'Shoot day 2'); await wait(200);
  await A.click('.search-group:has-text("Schedule") .search-row'); await wait(1200);
  check('the day is on the project calendar', await A.locator('.event:has-text("Shoot day 2")').count() === 1);
  check('no page errors', !A.errors.length, A.errors.join('; '));
  await done(b);
})();
