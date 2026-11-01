// Shared bits for the tests: phones (Playwright, iPhone 13), SQL as the database owner,
// and PASS / FAIL lines (any FAIL makes the process exit with code 1).
const { chromium, devices } = require('playwright');
const { Pool } = require('pg');

const APP = 'http://localhost:8765/';
const MOCK = 'http://localhost:54321';
const db = new Pool({ host: '127.0.0.1', user: 'postgres', password: 'pg', database: 'planner' });
db.on('error', () => {});

/** Run SQL as the owner (no RLS); returns the rows. */
const sql = async (text, params) => (await db.query(text, params)).rows;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
  if (!ok) { failed += 1; process.exitCode = 1; }
}

async function browser() { return chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] }); }

/** A signed-in phone. extraConfig adds exports to js/config.js (e.g. a VAPID key). */
async function phone(b, email, { extraConfig = '', init = null } = {}) {
  // PW_DEVICE / PW_TZ / PW_LOCALE run the same tests as another phone, time zone or language.
  const ctx = await b.newContext({
    ...devices[process.env.PW_DEVICE || 'iPhone 13'],
    ...(process.env.PW_TZ ? { timezoneId: process.env.PW_TZ } : {}),
    ...(process.env.PW_LOCALE ? { locale: process.env.PW_LOCALE } : {}),
  });
  await ctx.route('**/js/config.js', (r) => r.fulfill({
    contentType: 'text/javascript',
    body: `export const SUPABASE_URL='${MOCK}'; export const SUPABASE_ANON_KEY='anon'; ${extraConfig}`,
  }));
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(APP);
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', 'secret1');
  await p.click('.login-submit');
  await p.waitForTimeout(1800);
  const keep = p.locator('.layer .ask-btn.primary'); // "Which planner to keep?" on a second phone
  if (await keep.count()) { await keep.click(); await p.waitForTimeout(500); }
  p.ctx = ctx;
  return p;
}

/** Run fn(storeModule, cloudModule, arg) inside the page. */
const inApp = (p, fn, arg) => p.evaluate(async ([src, a]) => {
  const s = await import('./js/store.js');
  const c = await import('./js/cloud.js');
  // eslint-disable-next-line no-eval
  return eval(src)(s, c, a);
}, [fn.toString(), arg]);

/** Press and hold the logo (film mode), then create a project. */
async function filmProject(p, name) {
  const bx = await p.locator('#brand').boundingBox();
  await p.mouse.move(bx.x + 15, bx.y + 15);
  await p.mouse.down(); await p.waitForTimeout(1100); await p.mouse.up(); await p.waitForTimeout(900);
  if (!name) return;
  await p.click('.film-chip'); await p.click('.layer .new-group');
  await p.fill('.layer .ask-input', name); await p.click('.layer .ask-btn.primary');
  await p.waitForTimeout(2500);
}

async function done(b) {
  if (b) await b.close();
  await db.end();
  console.log(failed ? `\n${failed} failed` : '\nall passed');
}

module.exports = { APP, MOCK, sql, wait, check, browser, phone, inApp, filmProject, done };
