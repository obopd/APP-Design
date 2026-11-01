// The "push" Edge Function, run in Node (a tiny Deno shim) against the mock (service role),
// sending to a fake phone that decrypts each push like a real browser would.
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 node --experimental-strip-types tests/push-function.test.mjs
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, 'package.json'));
const ece = require('http_ece');
const webpush = require('web-push');
const { sql, check, done } = require('./helpers.js');

// Keys + secret in the database Vault (like the owner's setup paste).
const vapid = webpush.generateVAPIDKeys();
await sql("delete from vault.secrets where name in ('push_url', 'push_secret', 'vapid_public', 'vapid_private')");
await sql("select vault.create_secret('http://localhost/push', 'push_url'), vault.create_secret('test-secret', 'push_secret'), vault.create_secret($1, 'vapid_public'), vault.create_secret($2, 'vapid_private')", [vapid.publicKey, vapid.privateKey]);

// Fake phone (web-push always uses https).
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.join(out, 'cert.pem'))) {
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${out}/key.pem -out ${out}/cert.pem -days 30 -subj "/CN=localhost" 2>/dev/null`);
}
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
const authSecret = crypto.randomBytes(16).toString('base64url');
const got = [];
const phoneServer = https.createServer({ key: fs.readFileSync(`${out}/key.pem`), cert: fs.readFileSync(`${out}/cert.pem`) }, (req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    if (req.url === '/gone') { res.writeHead(410); res.end(); return; }
    got.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()));
    res.writeHead(201); res.end();
  });
}).listen(54500);

// The function, with Deno shimmed and npm: mapped to the local package.
const env = { SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'service' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const src = fs.readFileSync(path.join(here, '../supabase/functions/push/index.ts'), 'utf8')
  .replace("'npm:web-push@3.6.7'", `'${require.resolve('web-push')}'`);
fs.writeFileSync(path.join(out, 'push-fn.mts'), src);
await import(path.join(out, 'push-fn.mts'));
const call = async (body, secret = 'test-secret') => {
  const r = await handler(new Request('http://x/push', { method: 'POST', headers: { 'x-push-secret': secret }, body: JSON.stringify(body) }));
  return [r.status, await r.text()];
};

const bob = '00000000-0000-0000-0000-00000000000b';
const pub = ecdh.getPublicKey().toString('base64url');
await sql('delete from push_subscriptions; delete from push_alerts');
await sql('insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $3, $4, $5), ($2, $3, $4, $5)', ['https://localhost:54500/bob', 'https://localhost:54500/gone', bob, pub, authSecret]);

check('wrong secret is refused', (await call({ users: [] }, 'nope'))[0] === 403);
await call({ users: [bob], title: '@alice', body: 'Shoot at 7?', tag: 'chat-1', view: 'chat' });
check('message arrives encrypted and decrypts', got.some((n) => n.title === '@alice' && n.body === 'Shoot at 7?' && n.view === 'chat'));
check('a phone that\'s gone is forgotten', (await sql('select endpoint from push_subscriptions')).length === 1);

got.length = 0;
await sql(`insert into push_alerts (user_id, fire_at, title, body, tag) values
  ($1, now() - interval '1 minute', 'Meeting', '10:00 AM', 'e1'), ($1, now() - interval '2 hours', 'Stale', '', 'e0'), ($1, now() + interval '1 hour', 'Later', '', 'e2')`, [bob]);
await call({ alerts: true });
check('due alert sent, stale one skipped', got.length === 1 && got[0].title === 'Meeting', got.map((n) => n.title).join(','));
check('future alert kept', (await sql('select title from push_alerts')).map((r) => r.title).join() === 'Later');

phoneServer.close();
await done();
process.exit(process.exitCode || 0);
