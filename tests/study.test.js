// Study mode (Anki-style flashcards): mode menu, notes & cards, review with FSRS, undo,
// bury / suspend / flag, deck options, custom study, browse search + bulk actions, stats,
// sync between two phones, and importing an Anki package.
const { execFileSync } = require('child_process');
const path = require('path');
const { check, wait, browser, phone, sql, done } = require('./helpers');

const S = (p, fn, arg) => p.evaluate(async ([src, a]) => {
  const s = await import('./js/study.js');
  // eslint-disable-next-line no-eval
  return eval(src)(s, a);
}, [fn.toString(), arg]);

async function toStudy(p) {
  const bx = await p.locator('#brand').boundingBox();
  await p.mouse.move(bx.x + 15, bx.y + 15); await p.mouse.down(); await wait(1100); await p.mouse.up(); await wait(400);
  await p.click('.layer .menu-item:has-text("Study")'); await wait(1800);
}
async function addNote(p, front, back, type) {
  await p.click('[aria-label="Add card"]'); await wait(400);
  if (type) { await p.click('#study-sheet .field:has-text("Type") .select-btn'); await p.click(`.layer .menu-item:has-text("${type}")`); await wait(200); }
  await p.locator('#study-sheet .field-edit').nth(0).click(); await p.keyboard.type(front);
  if (back != null) { await p.locator('#study-sheet .field-edit').nth(1).click(); await p.keyboard.type(back); }
  await p.click('#study-sheet .ok'); await wait(400);
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);
}

(async () => {
  const b = await browser();
  const p = await phone(b, 'c@x');

  // Mode menu
  await toStudy(p);
  check('holding the logo offers Planner / Film / Study, and Study opens Decks', await p.evaluate(() => document.documentElement.classList.contains('study')) && !(await p.locator('#view-decks').isHidden()));
  check('the study dock shows Decks, Browse, Stats, Settings only',
    (await p.$$eval('.tab', (ts) => ts.filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.dataset.view))).join() === 'decks,browse,stats,settings');

  // Adding notes: Basic, reversed, cloze, type-in
  await p.click('[aria-label="Add card"]'); await wait(400);
  check('the add sheet opens without the keyboard', await p.evaluate(() => !document.activeElement?.matches('.field-edit')));
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);
  await addNote(p, 'bonjour', 'hello');
  await addNote(p, 'chien', 'dog', 'Basic (and reversed card)');
  await addNote(p, 'Paris is the {{c1::capital}} of {{c2::France}}', null, 'Cloze');
  await addNote(p, 'Capital of Japan?', 'Tokyo', 'Basic (type in the answer)');
  const counts = await S(p, (s) => ({ notes: s.notes().length, cards: s.cards().length, decks: s.decks().map((d) => d.name) }));
  check('Basic → 1 card, reversed → 2, cloze with c1 and c2 → 2, type-in → 1', counts.notes === 4 && counts.cards === 6, JSON.stringify(counts));
  check('a Default deck is made for the first card', counts.decks.join() === 'Default');

  // Duplicate check
  await p.click('[aria-label="Add card"]'); await wait(400);
  await p.click('#study-sheet .field:has-text("Type") .select-btn'); await p.click('.layer .menu-item span:text-is("Basic")'); await wait(200);
  await p.locator('#study-sheet .field-edit').nth(0).click(); await p.keyboard.type('bonjour'); await wait(200);
  check('the same first field warns "Duplicate"', await p.locator('#study-sheet .dupe-note').isVisible());
  await p.click('#study-sheet [aria-label="Close"]'); await wait(400);

  // Review
  await p.click('.deck-name:has-text("Default")'); await wait(300);
  check('the overview shows 6 new cards', (await p.locator('.ov-counts .n-new').innerText()) === '6');
  await p.click('.study-now'); await wait(500);
  check('the review page hides the dock', await p.evaluate(() => document.body.classList.contains('studying')));
  const front1 = await p.locator('.rv-card').innerText();
  await p.click('.rv-show'); await wait(300);
  const labels = await p.$$eval('.rv-btn small', (els) => els.map((e) => e.textContent));
  check('four buttons with their next intervals (1m · 6m · 10m · days)', labels.length === 4 && labels[0] === '1m' && labels[2] === '10m' && /d$/.test(labels[3]), labels.join(' '));
  await p.click('.rv-btn.r3'); await wait(300);
  check('Good on a new card moves to the next learning step', (await S(p, (s) => s.cards().filter((c) => c.state === 'learn').length)) === 1);
  check('…and logs the review', (await S(p, (s) => s.allReviews().length)) === 1);
  await p.click('[aria-label="Undo"]'); await wait(300);
  check('Undo puts the card back and removes the review', (await S(p, (s) => s.allReviews().length)) === 0 && (await p.locator('.rv-card').innerText()) === front1);

  // Answer everything Easy (sibling burying hides the other cards of a note)
  for (let i = 0; i < 12; i += 1) {
    if (!(await p.locator('.rv-show').count())) break;
    if (await p.locator('.typein-input').count()) await p.fill('.typein-input', 'Tokio');
    await p.click('.rv-show'); await wait(150);
    if (await p.locator('.typed').count()) {
      check('type-in shows the wrong answer and the right one', /Tokio/.test(await p.locator('.typed').innerText()) && /Tokyo/.test(await p.locator('.typed').innerText()));
    }
    await p.click('.rv-btn.r4'); await wait(200);
  }
  const after = await S(p, (s) => ({ review: s.cards().filter((c) => c.state === 'review').length, buried: s.cards().filter((c) => c.buried != null).length }));
  check('Easy sends cards to review; their sibling cards wait until tomorrow (buried)', after.review === 4 && after.buried === 2, JSON.stringify(after));
  check('done for today', await p.locator('.rv-done').count() === 1);
  await p.keyboard.press('Escape'); await wait(400);
  check('Esc closes the review page', !(await p.evaluate(() => document.body.classList.contains('studying'))));

  // Cloze rendering
  const cloze = await p.evaluate(async () => {
    const t = await import('./js/cardtext.js');
    const type = t.BUILTIN_TYPES.find((x) => x.cloze);
    const r = t.renderCard(type, { fields: { Text: 'A {{c1::b::hint}} c {{c2::d}}', 'Back Extra': '' }, tags: [] }, 0);
    return [t.plain(r.front), t.plain(r.back)];
  });
  check('cloze front hides c1 (shows its hint), back reveals it', cloze[0] === 'A [hint] c d' && cloze[1].startsWith('A b c d'), cloze.join(' | '));
  const safe = await p.evaluate(async () => {
    const t = await import('./js/cardtext.js');
    const box = document.createElement('div');
    box.append(t.safeFragment('<b onclick="x()">ok</b><script>bad()</script><img src=x onerror=alert(1)><a href="javascript:1">l</a><span style="color:red;background:url(x)">c</span>'));
    return box.innerHTML;
  });
  check('card HTML is cleaned (no scripts, handlers, links or style urls)', !/script|onclick|onerror|javascript|url\(/.test(safe) && /<b>ok<\/b>/.test(safe), safe);

  // Leech + FSRS / SM-2 numbers (pure scheduler)
  const sched = await p.evaluate(async () => {
    const s = await import('./js/srs.js');
    const now = Date.now();
    let c = { id: 'L', state: 'review', ivl: 10, S: 10, D: 5, last: now - 10 * 864e5, due: now, lapses: 7, reps: 20 };
    const r = s.answer(c, 1, { leechThreshold: 8, leechAction: 'suspend' }, now);
    const m = { id: 'M', state: 'review', ivl: 10, ease: 2.5, last: now - 10 * 864e5, due: now };
    const sm = [2, 3, 4].map((g) => s.answer(m, g, { scheduler: 'sm2' }, now).card.ivl);
    return { leech: r.leech, suspended: r.card.suspended, state: r.card.state, sm };
  });
  check('the 8th lapse makes a leech and suspends it', sched.leech && sched.suspended && sched.state === 'relearn');
  check('SM-2 intervals grow with ease (Hard < Good < Easy, Good ≈ 10 × 2.5)', sched.sm[0] < sched.sm[1] && sched.sm[1] < sched.sm[2] && Math.abs(sched.sm[1] - 25) <= 3, sched.sm.join(' '));

  // Deck options (closing the review leaves the deck's overview open)
  if (!(await p.locator('.ov-title').count())) { await p.click('.deck-name:has-text("Default")'); await wait(300); }
  await p.click('.ov-actions .pill:has-text("Options")'); await wait(400);
  await p.fill('#study-sheet input[aria-label="New cards per day"]', '5');
  await p.fill('#study-sheet input[aria-label="Learning steps"]', '30s 5m 1h');
  await p.click('#study-sheet .ok'); await wait(400);
  const preset = await S(p, (s) => s.presetOf(s.decks()[0].id));
  check('options save: 5 new a day, steps 30s 5m 1h', preset.newPerDay === 5 && preset.learnSteps.join() === '0.5,5,60', JSON.stringify(preset.learnSteps));

  // Custom study (filtered deck)
  await p.click('.ov-actions .pill:has-text("Custom study")'); await wait(300);
  await p.click('.layer .menu-item:has-text("All cards in this deck")'); await wait(500);
  check('custom study makes a session deck with the deck\'s cards', /Custom study session/.test(await p.locator('.ov-title').innerText()) && Number(await p.locator('.ov-counts .n-review').innerText()) >= 4);
  await p.click('.back-btn'); await wait(300);

  // Subdeck
  await p.click('.deck-name:has-text("Default")'); await wait(300);
  await p.click('[aria-label="More"]'); await p.click('.layer .menu-item:has-text("Add subdeck")');
  await p.fill('.layer .ask-input', 'Verbs'); await p.click('.layer .ask-btn.primary'); await wait(400);
  check('subdecks nest under their deck', (await S(p, (s) => s.deckPath(s.decks().find((d) => d.name === 'Verbs').id))) === 'Default::Verbs');
  await p.click('.back-btn'); await wait(300);

  // Browse: search syntax + bulk actions
  await p.click('.tab[data-view="browse"]'); await wait(400);
  const search = async (q) => { await p.fill('.browse-search', q); await p.press('.browse-search', 'Enter'); await wait(600); return p.locator('.browse-row').count(); };
  check('search "deck:Default" finds all 6 cards', (await search('deck:Default')) === 6);
  const cb = await search('chien or bonjour');
  check('"chien or bonjour" finds 3 (chien makes 2 cards)', cb === 3, `${cb}: ${(await p.locator('.browse-front').allInnerTexts()).join(' / ')}`);
  check('"-is:review" excludes review cards', (await search('-is:review')) === 2);
  check('"note:Cloze card:2" finds the second cloze', (await search('note:Cloze card:2')) === 1);
  check('"front:chie*" searches a field with a wildcard', (await search('front:chie*')) === 2);
  check('"prop:ivl>=1 is:review" works', (await search('prop:ivl>=1 is:review')) === 4);
  await search('deck:Default');
  await p.click('.pill:has-text("Select")'); await p.click('.link-btn:has-text("Select all")'); await wait(200);
  await p.click('.bulk-bar .pill'); await p.click('.layer .menu-item:has-text("Add tags")');
  await p.fill('.layer .ask-input', 'french'); await p.click('.layer .ask-btn.primary'); await wait(300);
  check('bulk: add a tag to every selected note', (await search('tag:french')) === 6);
  check('selection stays on after an action', await p.locator('.bulk-bar').count() === 1);
  await p.click('.bulk-bar .pill'); await p.click('.layer .menu-item:has-text("Suspend")'); await wait(300);
  check('bulk: suspend', (await search('is:suspended')) === 6);
  await p.click('.bulk-bar .pill'); await p.click('.layer .menu-item:has-text("Unsuspend")'); await wait(300);
  await p.click('.pill:has-text("Done")'); await wait(200);
  check('…and unsuspend', (await search('is:suspended')) === 0);

  // Stats
  await p.click('.tab[data-view="stats"]'); await wait(400);
  const statText = await p.locator('#view-stats').innerText();
  check('stats: today, cards, future due, reviews, intervals, retention, hourly, buttons',
    ['Today', 'Cards', 'Future due', 'Reviews', 'Intervals', 'True retention', 'Hourly breakdown', 'Answer buttons'].every((t) => statText.includes(t)) && /Studied \d+ cards?/.test(statText));
  check('stats charts draw bars', await p.locator('#view-stats svg.chart rect.c-review, #view-stats svg.chart rect.c-young, #view-stats svg.chart rect.c-mature').count() > 0);

  // Sync: rows on the server, private to the account; a second phone gets everything.
  await S(p, (s) => s.syncStudy());
  await wait(500);
  const rows = await sql("select kind, count(*)::int n from study_items i join auth.users u on u.id = i.user_id where u.email = 'c@x' and not deleted group by kind order by kind");
  const revs = await sql("select count(*)::int n from study_reviews r join auth.users u on u.id = r.user_id where u.email = 'c@x'");
  check('items and reviews are on the server', rows.find((r) => r.kind === 'card')?.n === 6 && revs[0].n === 4, JSON.stringify(rows));
  const other = await phone(b, 'a@x');
  const theirs = await other.evaluate(async () => {
    const { api } = await import('./js/cloud.js');
    return api('/rest/v1/study_items?select=id', { auth: true });
  });
  check('another account can\'t see them (RLS)', Array.isArray(theirs) && theirs.length === 0);
  const p2 = await phone(b, 'c@x');
  await toStudy(p2); await wait(1500);
  const two = await S(p2, (s) => ({ cards: s.cards().length, reviews: s.allReviews().length, decks: s.decks().length }));
  check('a second phone downloads the decks, cards and history', two.cards === 6 && two.reviews === 4 && two.decks >= 3, JSON.stringify(two));
  await S(p2, (s) => { const c = s.cards().find((x) => x.state === 'review'); s.setFlag([c], 4); return s.syncStudy(); });
  await S(p, (s) => s.syncStudy()); await wait(300);
  check('an edit on one phone reaches the other', (await S(p, (s) => s.cards().filter((c) => c.flag === 4).length)) === 1);

  // Anki import
  const apkg = path.join(__dirname, 'out', 'test.apkg');
  execFileSync('python3', [path.join(__dirname, 'db', 'make-apkg.py'), apkg]);
  await p.click('.tab[data-view="decks"]'); await wait(300);
  await p.setInputFiles('#apkg-input', apkg); await wait(1500);
  const msg = await p.locator('.layer .ask-message').innerText().catch(() => '');
  check('import reports what came in', /3 notes · 4 cards · 4 past reviews/.test(msg), msg);
  await p.click('.layer .ask-btn.primary'); await wait(300);
  const imp = await S(p, (s) => {
    const fr = s.decks().find((d) => d.name === 'French');
    const cs = s.cards().filter((c) => c.id.startsWith('anki-'));
    const rev = cs.find((c) => c.id === 'anki-c-2001');
    const sus = cs.find((c) => c.id === 'anki-c-2003');
    return {
      path: fr && s.deckPath(fr.id), preset: fr && s.presetOf(fr.id).newPerDay, steps: fr && s.presetOf(fr.id).learnSteps.join(),
      rev: rev && [rev.state, rev.ivl, rev.flag, rev.ease], susp: sus && [sus.suspended, sus.S, sus.D],
      tags: s.note('anki-n-1001').tags.join(), field: s.note('anki-n-1001').fields.Back,
      cloze: s.cards().filter((c) => c.note === 'anki-n-1003').length,
    };
  });
  check('Anki decks keep their nesting (Languages::French) and options', imp.path === 'Languages::French' && imp.preset === 15 && imp.steps === '2,15', JSON.stringify(imp));
  check('a review card keeps interval, ease and flag', imp.rev && imp.rev[0] === 'review' && imp.rev[1] === 10 && imp.rev[2] === 1 && imp.rev[3] === 2.5, JSON.stringify(imp.rev));
  check('a suspended card stays suspended with its FSRS memory', imp.susp && imp.susp[0] === true && imp.susp[1] === 31.5 && imp.susp[2] === 6.2, JSON.stringify(imp.susp));
  check('tags and formatted fields come in', imp.tags === 'verb,french' && imp.field === '<b>dog</b>' && imp.cloze === 2);
  await p.setInputFiles('#apkg-input', apkg); await wait(1500);
  const again = await p.locator('.layer .ask-message').innerText().catch(() => '');
  check('importing the same file again skips what\'s already here', /0 notes · 0 cards · 0 past reviews · 3 already here/.test(again), again);
  await p.click('.layer .ask-btn.primary'); await wait(300);
  // An imported card renders (its own template, hr id=answer)
  await p.click('.deck-name:has-text("Languages")'); await wait(300);
  await p.click('.study-now'); await wait(400);
  await p.click('.rv-show'); await wait(200);
  check('an imported card shows front and back', /chien|chat/.test(await p.locator('.rv-card').innerText()) && await p.locator('.rv-card hr.answer').count() === 1);
  await p.keyboard.press('Escape'); await wait(300);

  // Back to planner
  for (let i = 0; i < 3 && !(await p.locator('.mode-btn').count()); i += 1) { await p.click('.back-btn'); await wait(300); }
  await p.click('.mode-btn'); await p.click('.layer .menu-item:has-text("Planner")'); await wait(1800);
  check('the Decks logo switches back to the planner', !(await p.evaluate(() => document.documentElement.classList.contains('study'))) && !(await p.locator('#view-calendar').isHidden()));

  check('no page errors', ![...p.errors, ...p2.errors].length, [...p.errors, ...p2.errors].join('; '));
  await done(b);
})();
