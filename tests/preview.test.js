// Film mode Preview tab: concept images (upload, viewer, caption, reorder, delete,
// collaborator access) and the Result video.
const { browser, phone, filmProject, sql, check, wait, done, MOCK } = require('./helpers');

(async () => {
  const b = await browser();
  const A = await phone(b, 'a@x');
  await filmProject(A, 'Vadiemens');
  const tabs = await A.evaluate(() => [...document.querySelectorAll('.tab')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.dataset.view).join(' '));
  check('film dock has 6 tabs incl. Preview', tabs === 'calendar write organize preview chat settings', tabs);

  await A.click('.tab[data-view=preview]'); await wait(300);
  const shot = await A.screenshot(); // any picture will do
  await A.setInputFiles('input[type=file]', [1, 2, 3].map((i) => ({ name: `c${i}.png`, mimeType: 'image/png', buffer: shot })));
  await wait(3500);
  const files = await sql('select count(*)::int n, max(length(data))::int big from storage.objects');
  check('3 images uploaded (2 files each, shrunk)', await A.locator('.pv-tile:not(.loading)').count() === 3 && files[0].n === 6, `largest ${files[0].big} bytes`);

  await A.click('.pv-tile >> nth=0'); await wait(500);
  const st = await A.locator('.pv-stage').boundingBox();
  await A.mouse.move(st.x + 300, st.y + 200); await A.mouse.down();
  await A.mouse.move(st.x + 150, st.y + 200, { steps: 3 }); await A.mouse.move(st.x + 40, st.y + 200, { steps: 3 }); await A.mouse.up(); await wait(600);
  check('viewer swipes to the next image', await A.locator('.pv-count').innerText() === '2 / 3');
  await A.click('.pv-caption'); await A.fill('.layer .ask-input', 'Bus stop at dawn'); await A.click('.layer .ask-btn.primary'); await wait(1500);
  check('caption saved', (await sql("select count(*)::int n from project_items where kind = 'concept' and data->>'caption' = 'Bus stop at dawn'"))[0].n === 1);
  await A.click('button[aria-label="Move later"]'); await wait(400);
  check('reorder moves the image', await A.locator('.pv-count').innerText() === '3 / 3');
  await A.click('.pv-bar button[aria-label="Delete image"]'); await A.click('.layer .ask-btn.primary'); await wait(1500);
  check('delete removes item and files', await A.locator('.pv-tile').count() === 2 && (await sql('select count(*)::int n from storage.objects'))[0].n === 4);

  await A.click('.pv-tabs button:has-text("Result")'); await wait(300);
  await A.click('.pv-empty'); await A.fill('.layer .ask-input', 'hello'); await A.click('.layer .ask-btn.primary'); await wait(300);
  check('bad link is refused', (await A.locator('.layer .ask-message').innerText()).includes('YouTube'));
  await A.fill('.layer .ask-input', 'https://youtu.be/dQw4w9WgXcQ?t=1m5s'); await A.click('.layer .ask-btn.primary'); await wait(1500);
  const r = (await sql("select data from project_items where kind = 'result'"))[0]?.data || {};
  check('result link parsed (id + start)', r.video === 'dQw4w9WgXcQ' && r.start === 65);
  await A.click('.pv-play-btn'); await wait(400);
  const frame = await A.locator('.pv-player iframe').elementHandle();
  await A.evaluate(() => import('./js/film.js').then((m) => m.refreshFilm())); await wait(1500);
  check('a refresh doesn\'t restart the video', await frame.evaluate((n) => n.isConnected));
  await A.click('.tab[data-view=calendar]'); await wait(300);
  check('leaving the tab stops the video', await A.locator('.pv-player iframe').count() === 0);

  await A.click('.film-chip'); await A.click('.layer button:has-text("Invite")');
  await A.click('.layer .menu-item:has-text("bob")'); await A.click('.layer .ask-btn.primary'); await wait(2000);
  const B = await phone(b, 'b@x');
  await filmProject(B); await wait(1500);
  await B.click('.tab[data-view=preview]'); await B.click('.pv-tabs button:has-text("Concept")'); await wait(2000);
  const sizes = await B.evaluate(() => [...document.querySelectorAll('.pv-tile img')].map((i) => i.naturalWidth));
  check('collaborator sees the images', sizes.length === 2 && sizes.every((w) => w > 0), sizes.join(','));
  const path = (await sql("select data->>'thumb' t from project_items where kind = 'concept' limit 1"))[0].t;
  const res = await (await fetch(`${MOCK}/storage/v1/object/sign/concepts`, { method: 'POST', headers: { Authorization: 'Bearer tok-00000000-0000-0000-0000-00000000000c', 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 60, paths: [path] }) })).json();
  check('non-member can\'t open the images', !res[0].signedURL);
  check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].join('; '));
  await done(b);
})();
