// Study mode extras: formulas, note types (fields, card types, templates, safe styling),
// image occlusion (drawn here and imported from Anki) and deleting notes cleaning up their
// pictures on the phone and in the account.
const { execFileSync } = require('child_process');
const path = require('path');
const { check, wait, browser, phone, sql, done, chooseMode } = require('./helpers');

const S = (p, fn, arg) => p.evaluate(async ([src, a]) => {
  const s = await import('./js/study.js');
  // eslint-disable-next-line no-eval
  return eval(src)(s, a);
}, [fn.toString(), arg]);
const askOk = async (p) => { await p.click('.layer .ask-btn.primary'); await wait(300); };
const askFill = async (p, text) => { await p.fill('.layer .ask-input', text); await askOk(p); };
const menu = async (p, label) => { await p.click(`.layer .menu-item:has-text("${label}")`); await wait(300); };
const study = async (p, deckName) => {
  await p.click(`.deck-name:text-is("${deckName}")`); await wait(300);
  await p.click('.study-now'); await wait(600);
};
const leaveReview = async (p) => {
  await p.keyboard.press('Escape'); await wait(300);
  for (let i = 0; i < 3 && await p.locator('.back-btn').count(); i += 1) { await p.click('.back-btn'); await wait(250); }
};

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');
  await chooseMode(p, 'Study'); await wait(1800);

  // A deck made just before the app closes is still there when it opens again (its upload
  // hadn't happened yet).
  await p.click('[aria-label="New deck"]'); await wait(300);
  await p.fill('.layer .ask-input', 'Quick'); await p.click('.layer .ask-btn.primary'); await wait(300);
  await p.reload(); await wait(2500);
  check('a new deck survives closing and reopening the app at once', await p.locator('.deck-name:text-is("Quick")').count() === 1);
  await wait(2000);
  check('…and then reaches the account', (await sql("select count(*)::int n from study_items where kind = 'deck' and data->>'name' = 'Quick'"))[0].n === 1);

  // ---------- Formulas ----------
  await S(p, (s) => {
    const d = s.addDeck('Math');
    s.addNote('nt-basic', { Front: 'What is \\(\\frac{a}{b}\\)?', Back: '\\[\\sqrt{x^2+1}\\]' }, '', d.id);
    s.addNote('nt-cloze', { Text: 'Area: \\(\\pi {{c1::r^2}}\\)', 'Back Extra': '' }, '', d.id);
  });
  await p.click('.tab[data-view="decks"]'); await wait(300);
  await study(p, 'Math');
  check('a formula on a card is drawn (a real fraction, not the TeX)', await p.locator('.rv-card math mfrac').count() === 1 && !/\\frac/.test(await p.locator('.rv-card').innerText()));
  await p.click('.rv-show'); await wait(200);
  check('a display formula on the back (square root, own line)', await p.locator('.rv-card math[display="block"] msqrt').count() === 1);
  await p.click('.rv-btn.r3'); await wait(400);
  const clozeFront = await p.locator('.rv-card .tex-cloze').textContent().catch(() => '');
  check('a cloze inside a formula is hidden on the front', clozeFront && !/r/.test(clozeFront), clozeFront);
  await p.click('.rv-show'); await wait(200);
  check('…and shown on the back', /r/.test(await p.locator('.rv-card .tex-cloze').textContent().catch(() => '')));
  await leaveReview(p);

  // ---------- Note types ----------
  await p.click('[aria-label="Add card"]'); await wait(400);
  await p.click('#study-sheet [aria-label="Note types"]'); await wait(500);
  check('the add sheet’s Note types button opens the current type', /Basic/.test(await p.locator('#nt-sheet .sheet-title').innerText()) && await p.locator('#nt-sheet .nt-name:text-is("Front")').count() === 1);
  check('…without the keyboard', await p.evaluate(() => !document.activeElement?.matches('textarea, input, [contenteditable]')));
  await p.click('#nt-sheet [aria-label="Note types"]'); await wait(300);
  await p.click('#nt-sheet [aria-label="Add note type"]'); await wait(200);
  await menu(p, 'Copy of Basic');
  await askFill(p, 'Vocab'); await wait(300);
  const vocab = await S(p, (s) => s.noteTypes().find((t) => t.name === 'Vocab')?.id);
  check('a new note type is a copy of another', !!vocab && /Vocab/.test(await p.locator('#nt-sheet .sheet-title').innerText()));
  await S(p, (s, id) => s.addNote(id, { Front: 'gato', Back: 'cat' }, '', s.addDeck('Words').id), vocab);

  await p.click('#nt-sheet [aria-label="Add field"]'); await wait(200);
  await askFill(p, 'Example');
  await p.click('#nt-sheet .nt-row:has(.nt-name:text-is("Back"))'); await wait(200);
  await menu(p, 'Rename');
  await p.fill('.layer .ask-input', 'Meaning'); await askOk(p);
  const t1 = await S(p, (s, id) => ({ t: s.noteType(id), n: s.notesOfType(id)[0] }), vocab);
  check('fields can be added and renamed', t1.t.fields.join() === 'Front,Meaning,Example', t1.t.fields.join());
  check('renaming a field updates the templates and every note', /\{\{Meaning\}\}/.test(t1.t.templates[0].back) && t1.n.fields.Meaning === 'cat' && !('Back' in t1.n.fields));
  await p.click('#nt-sheet .nt-row:has(.nt-name:text-is("Front"))'); await wait(200);
  await menu(p, 'Rename');
  await p.fill('.layer .ask-input', 'Meaning'); await askOk(p);
  check('a field name that’s taken is refused', /taken|Another field/.test(await p.locator('.layer .ask-message').innerText()));
  await askOk(p);

  await p.click('#nt-sheet [aria-label="Add card type"]'); await wait(200);
  check('adding a card type says how many cards it makes', /1 new card/.test(await p.locator('.layer .ask-message').innerText()));
  await askOk(p); await wait(300);
  check('…and makes them', (await S(p, (s, id) => s.cardsOfNote(s.notesOfType(id)[0].id).map((c) => c.ord).sort().join(), vocab)) === '0,1');
  // Card 2's template and the type's styling, with a preview
  await p.fill('#nt-sheet .nt-code', '<div class="word">{{Meaning}}</div><script>window.__ran = 1</script>'); await wait(400);
  check('the preview shows a real note', /cat/.test(await p.locator('#nt-sheet .nt-preview').innerText()));
  await p.click('#nt-sheet .nt-tabs [data-v="css"]'); await wait(200);
  await p.fill('#nt-sheet .nt-code', '.card { font-size: 26px; color: red } .word { color: rgb(0, 128, 0); position: fixed; background: url(http://example.com/x.png) } @import url("http://example.com/x.css");'); await wait(500);
  check('styling shows in the preview', await p.evaluate(() => getComputedStyle(document.querySelector('#nt-sheet .nt-preview .x-word')).color) === 'rgb(0, 128, 0)');
  await p.click('#nt-sheet [aria-label="Save"]'); await wait(400);
  const css = await p.evaluate(() => document.getElementById('card-styles').textContent);
  check('only safe styling is used, and only for this type’s cards', /\.rv-card\.nts-\d+ \.x-word\{color:rgb\(0, 128, 0\)\}/.test(css) && !/fixed|url\(|@import|example\.com/.test(css) && !/nts-\d+\{[^}]*color/.test(css), css);
  await p.click('#nt-sheet [aria-label="Note types"]'); await wait(300);
  await p.click('#nt-sheet [aria-label="Close"]'); await wait(500);
  await p.click('#study-sheet .field:has-text("Type") .select-btn'); await wait(200);
  check('the add sheet lists the new type', await p.locator('.layer .menu-item:has-text("Vocab")').count() === 1);
  await p.keyboard.press('Escape'); await wait(200);
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);

  // Review: the card uses its template and styling; its script never runs.
  await S(p, (s, id) => s.cardsOfNote(s.notesOfType(id)[0].id).filter((c) => c.ord === 0).forEach((c) => s.setSuspended([c], true)), vocab);
  await study(p, 'Words');
  const styled = await p.evaluate(() => {
    const w = document.querySelector('.rv-card .x-word');
    return w && { color: getComputedStyle(w).color, pos: getComputedStyle(w).position, size: getComputedStyle(document.querySelector('.rv-card')).fontSize, script: !!document.querySelector('.rv-card script'), ran: !!window.__ran };
  });
  check('a card shows its note type’s template and styling', styled && styled.color === 'rgb(0, 128, 0)' && styled.size === '26px' && styled.pos === 'static', JSON.stringify(styled));
  check('scripts in templates never run', styled && !styled.script && !styled.ran);
  await leaveReview(p);

  // Deleting a card type deletes its cards; deleting the note type deletes its notes.
  await p.click('[aria-label="Add card"]'); await wait(300);
  await p.click('#study-sheet .field:has-text("Type") .select-btn'); await menu(p, 'Vocab');
  await p.click('#study-sheet [aria-label="Note types"]'); await wait(400);
  await p.click('#nt-sheet .nt-row:has-text("Card 2")'); await wait(300);
  await p.click('#nt-sheet [aria-label="More"]'); await menu(p, 'Delete card type');
  check('deleting a card type says what goes', /1 card/.test(await p.locator('.layer .ask-message').innerText()));
  await askOk(p);
  check('…and deletes those cards', (await S(p, (s, id) => s.cardsOfNote(s.notesOfType(id)[0].id).map((c) => c.ord).join(), vocab)) === '0');
  await p.click('#nt-sheet [aria-label="More"]'); await menu(p, 'Delete note type');
  await askOk(p);
  check('deleting a note type deletes its notes', (await S(p, (s, id) => [s.notesOfType(id).length, s.noteTypes().some((t) => t.id === id)].join(), vocab)) === '0,false');
  await p.click('#nt-sheet [aria-label="Close"]'); await wait(400);
  check('the add sheet falls back to Basic', /Basic/.test(await p.locator('#study-sheet .field:has-text("Type") .select-btn').innerText()));
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);

  // ---------- Image occlusion ----------
  await S(p, (s) => s.addDeck('Anatomy'));
  await p.click('.deck-name:text-is("Anatomy")'); await wait(300);
  await p.click('.ov-actions .pill:has-text("Add")'); await wait(400);
  await p.click('#study-sheet .field:has-text("Type") .select-btn'); await menu(p, 'Image Occlusion');
  const names = await p.$$eval('#study-sheet .note-field-name', (els) => els.map((e) => e.textContent).join());
  check('an image occlusion note shows a picture area and its other fields', await p.locator('#study-sheet .io-pick').count() === 1 && names === 'Header,Back Extra,Comments', names);
  await p.click('#study-sheet .ok'); await wait(200);
  check('saving with no picture explains what to do', /picture/i.test(await p.locator('.layer .ask-title').innerText()));
  await askOk(p);
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#study-sheet .io-pick')]);
  await chooser.setFiles(path.join(__dirname, '..', 'icons', 'icon-512.png')); await wait(1500);
  const r = await p.locator('#study-sheet .io-img').boundingBox();
  const drag = async (x1, y1, x2, y2) => {
    await p.mouse.move(r.x + r.width * x1, r.y + r.height * y1); await p.mouse.down();
    await p.mouse.move(r.x + r.width * (x1 + x2) / 2, r.y + r.height * (y1 + y2) / 2, { steps: 3 });
    await p.mouse.move(r.x + r.width * x2, r.y + r.height * y2, { steps: 3 }); await p.mouse.up(); await wait(150);
  };
  await drag(0.1, 0.1, 0.4, 0.3);
  await drag(0.5, 0.5, 0.9, 0.7);
  await drag(0.2, 0.75, 0.35, 0.95);
  check('dragging on the picture draws numbered boxes', await p.locator('#study-sheet .io-edit-shape').count() === 3 && await p.locator('#study-sheet .io-n').last().innerText() === '3');
  await p.mouse.click(r.x + r.width * 0.27, r.y + r.height * 0.85); await wait(150);
  check('tapping a box picks it', await p.locator('#study-sheet .io-edit-shape.picked').count() === 1);
  await p.click('#study-sheet .io-del'); await wait(150);
  await p.click('#study-sheet .io-mode [data-v="one"]');
  await p.locator('#study-sheet .field-edit').nth(0).click(); await p.keyboard.type('Logo');
  await p.click('#study-sheet .ok'); await wait(400);
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);
  const io1 = await S(p, (s) => {
    const n = s.notes().find((x) => x.type === 'nt-io');
    return n && { occl: n.fields.Occlusion, image: n.fields.Image, header: n.fields.Header, cards: s.cardsOfNote(n.id).map((c) => c.ord).sort().join(), ids: s.cardsOfNote(n.id).map((c) => c.id) };
  });
  check('it saves in Anki’s format: one cloze per box, the picture as <img>', io1
    && /^\{\{c1::image-occlusion:rect:left=\.1:top=\.1:width=\.3:height=\.2\}\}<br>\{\{c2::image-occlusion:rect:left=\.5:top=\.5:width=\.4:height=\.2\}\}$/.test(io1.occl)
    && /^<img src="photo-[a-z0-9-]+\.jpg">$/.test(io1.image) && io1.header === 'Logo', JSON.stringify(io1));
  check('each box is one card (the deleted box makes none)', io1?.cards === '0,1');
  await p.click('.study-now'); await wait(1200);
  check('front: only the box asked is covered (hide one)', await p.locator('.rv-card .io-asked').count() === 1 && await p.locator('.rv-card .io-other').count() === 0 && /Logo/.test(await p.locator('.rv-card').innerText()));
  await p.screenshot({ path: path.join(__dirname, 'out', 'io-front.png') });
  await p.click('.rv-show'); await wait(500);
  check('back: the box asked is uncovered', await p.locator('.rv-card .io-shown').count() === 1 && await p.locator('.rv-card .io-asked').count() === 0);
  // Edit the note: the boxes come back; a new one gets the next number and old cards keep theirs.
  await p.click('[aria-label="Card menu"]'); await menu(p, 'Edit note'); await wait(800);
  check('editing shows the picture with its boxes', await p.locator('#study-sheet .io-edit-shape').count() === 2);
  const r2 = await p.locator('#study-sheet .io-img').boundingBox();
  await p.mouse.move(r2.x + r2.width * 0.1, r2.y + r2.height * 0.6); await p.mouse.down();
  await p.mouse.move(r2.x + r2.width * 0.2, r2.y + r2.height * 0.7, { steps: 3 }); await p.mouse.move(r2.x + r2.width * 0.3, r2.y + r2.height * 0.9, { steps: 3 }); await p.mouse.up(); await wait(150);
  await p.click('#study-sheet .io-mode [data-v="all"]');
  await p.click('#study-sheet .ok'); await wait(500);
  const io2 = await S(p, (s) => {
    const n = s.notes().find((x) => x.type === 'nt-io');
    return { occl: n.fields.Occlusion, cards: s.cardsOfNote(n.id).map((c) => `${c.id}:${c.ord}`) };
  });
  check('a box added later is card 3; the first two keep their cards', io2.cards.length === 3 && io1.ids.every((id) => io2.cards.some((x) => x.startsWith(id))) && /c3::image-occlusion:rect:left=\.1:top=\.6/.test(io2.occl), JSON.stringify(io2));
  check('“Hide all” marks every box (oi=1)', (io2.occl.match(/:oi=1\}\}/g) || []).length === 3);
  await leaveReview(p);

  // Anki's format: ellipses, polygons, old pixel positions, labels ignored; saved as they were.
  const parsed = await p.evaluate(async () => {
    const o = await import('./js/occlusion.js');
    const shapes = o.parseOcclusions('{{c1::image-occlusion:ellipse:left=.5:top=.5:rx=.1:ry=.2:oi=1}}<br>{{c2::image-occlusion:polygon:points=.1,.1 .3,.1 .2,.4}}'
      + '<br>{{c3::image-occlusion:rect:left=20:top=10:width=40:height=30}}<br>{{c4::image-occlusion:text:left=.1:top=.1:text=Hi}}');
    return { list: shapes.map((s) => `${s.n}${s.kind}:${s.left},${s.top},${s.width.toFixed(2)},${s.height.toFixed(2)}`).join(' '), again: o.occlusionText(shapes, false) };
  });
  check('Anki shapes are read: ellipse, polygon, pixel boxes (labels skipped)', parsed.list === '1ellipse:0.5,0.5,0.20,0.40 2polygon:0.1,0.1,0.20,0.30 3rect:20,10,40.00,30.00', parsed.list);
  check('…and written back unchanged', parsed.again === '{{c1::image-occlusion:ellipse:left=.5:top=.5:rx=.1:ry=.2}}<br>{{c2::image-occlusion:polygon:points=.1,.1 .3,.1 .2,.4}}<br>{{c3::image-occlusion:rect:left=20:top=10:width=40:height=30}}', parsed.again);

  // Importing Anki's own image occlusion notes
  const apkg = path.join(__dirname, 'out', 'io.apkg');
  execFileSync('python3', [path.join(__dirname, 'db', 'make-apkg.py'), apkg, '--io']);
  await p.setInputFiles('#apkg-input', apkg); await wait(1800);
  await askOk(p);
  const imp = await S(p, (s) => {
    const t = s.noteType('anki-t-333');
    return { io: t.io, tpl: t.templates[0].front, cards: s.cardsOfNote('anki-n-1004').map((c) => c.ord).sort().join() };
  });
  check('Anki image occlusion notes are recognised (their script template is replaced)', imp.io?.occl === 'Occlusion' && imp.io?.image === 'Image' && /io-slot/.test(imp.tpl) && !/script/.test(imp.tpl) && imp.cards === '0,1', JSON.stringify(imp));
  const card2 = await p.evaluate(async () => {
    const s = await import('./js/study.js');
    const { renderCard, safeFragment } = await import('./js/cardtext.js');
    const { paintOcclusion } = await import('./js/occlusion.js');
    const { fillMedia } = await import('./js/studymedia.js');
    const t = s.noteType('anki-t-333');
    const n = s.note('anki-n-1004');
    const face = document.createElement('div');
    face.className = 'rv-card';
    face.append(safeFragment(renderCard(t, n, 1).front, { card: true }));
    paintOcclusion(face, t, n, 1, false);
    fillMedia(face);
    document.body.append(face);
    await new Promise((ok) => setTimeout(ok, 800));
    const out = { asked: face.querySelectorAll('.io-asked').length, other: face.querySelectorAll('.io-other').length, text: face.innerText, img: face.querySelector('img')?.naturalWidth };
    face.remove();
    return out;
  });
  check('an imported card covers its picture (card 2 = ellipse + polygon asked, box 1 covered)', card2.asked === 2 && card2.other === 1 && card2.img === 40 && !/image-occlusion/.test(card2.text) && /The heart/.test(card2.text), JSON.stringify(card2));

  // ---------- Deleting notes cleans up their pictures ----------
  await p.evaluate(async () => { const m = await import('./js/studymedia.js'); await m.uploadMedia(); });
  await wait(1500);
  const filesSql = "select count(*)::int as n from storage.objects o join auth.users u on split_part(o.name, '/', 1) = u.id::text where bucket_id = 'study-media' and u.email = 'c@x'";
  const before = (await sql(filesSql))[0].n;
  // (Files added in the last 10 minutes are kept, so these are made to look older.)
  await p.evaluate(async () => {
    const s = await import('./js/study.js');
    const old = [];
    for (const name of ['cat pic.png', 'meow.mp3']) { const r = await s.mediaGet(name); if (r) old.push({ ...r, added: 0 }); }
    await s.mediaPut(old);
    s.deleteNotes(['anki-n-1002']);
  });
  await wait(5500); // cleanup runs a few seconds after notes change
  const after = await p.evaluate(async () => {
    const s = await import('./js/study.js');
    return [...await s.mediaHas(['cat pic.png', 'meow.mp3', 'heart.png'])].sort().join();
  });
  const left = (await sql(filesSql))[0].n;
  check('deleting a note removes the pictures and sounds only it used (on the phone)', after === 'heart.png', after);
  check('…and in the account', before >= 3 && left === before - 2, `${before} → ${left}`);

  // Dark mode look
  await p.evaluate(async () => { const st = await import('./js/store.js'); st.state.settings.theme = 'dark'; (await import('./js/settings.js')).applyTheme(); });
  await p.click('[aria-label="Add card"]'); await wait(300);
  await p.click('#study-sheet [aria-label="Note types"]'); await wait(400);
  await p.screenshot({ path: path.join(__dirname, 'out', 'note-types-dark.png') });
  await p.click('#nt-sheet [aria-label="Note types"]'); await wait(300);
  await p.click('#nt-sheet [aria-label="Close"]'); await wait(400);
  await p.click('#study-sheet [aria-label="Close"]'); await wait(300);

  check('no page errors', !p.errors.length, p.errors.join('; '));
  await done(b);
})();
