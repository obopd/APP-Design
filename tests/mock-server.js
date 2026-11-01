// Minimal PostgREST + GoTrue + Storage + Realtime stand-in over local Postgres with real RLS (tests only).
// Tokens are "tok-<user id>"; "Bearer service" acts as the service role (no RLS).
const http = require('http');
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', user: 'postgres', password: 'pg', database: 'planner' });
pool.on('error', () => {});
const TABLES = new Set(['planner_data', 'profiles', 'friendships', 'shares', 'share_checks', 'chats', 'chat_members', 'messages', 'projects', 'project_members', 'project_items', 'project_docs', 'push_subscriptions', 'push_alerts', 'planner_backups']);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('bad ident ' + s), { code: 'PGRST100' }); return `"${s}"`; };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function asUser(uid, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (uid === 'service') { const r = await c.query(sql, params); await c.query('commit'); return r; }
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const buf = Buffer.concat(chunks);
  const isJson = !(req.headers['content-type'] || '').startsWith('image/');
  const body = isJson ? buf.toString() : '';
  const json = body ? JSON.parse(body) : undefined;
  try {
    if (url.pathname === '/auth/v1/token') {
      const r = await pool.query('select id, email from auth.users where email = $1', [json.email]);
      if (!r.rows[0] || json.password !== 'secret1') return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      const u = r.rows[0];
      return send(res, 200, { access_token: 'tok-' + u.id, refresh_token: 'r', expires_in: 3600, user: u });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname.startsWith('/storage/v1/')) {
      const sp = url.pathname.slice('/storage/v1'.length);
      const suid = (req.headers.authorization || '').replace('Bearer tok-', '');
      let mm;
      if ((mm = sp.match(/^\/object\/sign\/([a-z]+)$/)) && req.method === 'POST') {
        const r = await asUser(suid, 'select name from storage.objects where bucket_id = $1 and name = any($2::text[])', [mm[1], json.paths]);
        const ok = new Set(r.rows.map((x) => x.name));
        return send(res, 200, json.paths.map((path) => (ok.has(path) ? { path, signedURL: `/object/sign/${mm[1]}/${path}?token=t` } : { path, error: 'Not found', signedURL: null })));
      }
      if ((mm = sp.match(/^\/object\/sign\/([a-z]+)\/(.+)$/)) && req.method === 'GET') {
        const r = await pool.query('select data from storage.objects where bucket_id = $1 and name = $2', [mm[1], mm[2]]);
        if (!r.rows[0]) return send(res, 404, {});
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' }); return res.end(r.rows[0].data);
      }
      if ((mm = sp.match(/^\/object\/([a-z]+)\/(.+)$/)) && req.method === 'POST') {
        const b = await pool.query('select 1 from storage.buckets where id = $1', [mm[1]]);
        if (!b.rows[0]) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
        await asUser(suid, 'insert into storage.objects (bucket_id, name, data) values ($1, $2, $3) on conflict (bucket_id, name) do update set data = excluded.data', [mm[1], mm[2], buf]);
        return send(res, 200, { Key: `${mm[1]}/${mm[2]}` });
      }
      if ((mm = sp.match(/^\/object\/([a-z]+)$/)) && req.method === 'DELETE') {
        const r = await asUser(suid, 'delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [mm[1], json.prefixes]);
        return send(res, 200, r.rows);
      }
      return send(res, 404, {});
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) {
      const ruid = req.headers.authorization === 'Bearer service' ? 'service' : (req.headers.authorization || '').replace('Bearer tok-', '');
      const names = Object.keys(json || {});
      const r = await asUser(ruid, `select ${ident(rpc[1])}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(',')}) as v`, names.map((n) => (typeof json[n] === 'object' ? JSON.stringify(json[n]) : json[n])));
      return send(res, 200, r.rows[0].v);
    }
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return send(res, 404, {});
    if (!TABLES.has(m[1])) return send(res, 404, { code: 'PGRST205', message: 'Could not find the table' });
    const table = ident(m[1]);
    const uid = req.headers.authorization === 'Bearer service' ? 'service' : (req.headers.authorization || '').replace('Bearer tok-', '');
    const where = []; const params = [];
    let select = '*'; let onConflict = null; let order = ''; let limit = '';
    for (const [k, v] of url.searchParams) {
      if (k === 'select') { select = v === '*' ? '*' : v.split(',').map(ident).join(','); continue; }
      if (k === 'on_conflict') { onConflict = v.split(',').map(ident); continue; }
      if (k === 'order') { const [c, dir] = v.split('.'); order = ` order by ${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}`; continue; }
      if (k === 'limit') { limit = ` limit ${parseInt(v, 10)}`; continue; }
      const [op, ...rest] = v.split('.'); const val = rest.join('.');
      if (op === 'eq') { params.push(val); where.push(`${ident(k)} = $${params.length}`); }
      else if (op === 'in') { params.push(val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))); where.push(`${ident(k)}::text = any($${params.length}::text[])`); }
      else if (['gt', 'lt', 'gte', 'lte'].includes(op)) { params.push(val); where.push(`${ident(k)} ${({ gt: '>', lt: '<', gte: '>=', lte: '<=' })[op]} $${params.length}`); }
      else throw Object.assign(new Error('op ' + op), { code: 'PGRST100' });
    }
    const w = where.length ? ' where ' + where.join(' and ') : '';
    const prefer = req.headers.prefer || '';
    let r;
    if (req.method === 'GET') r = await asUser(uid, `select ${select} from ${table}${w}${order}${limit}`, params);
    else if (req.method === 'DELETE') {
      const back = prefer.includes('return=representation');
      r = await asUser(uid, `delete from ${table}${w}${back ? ` returning ${select}` : ''}`, params);
      if (back) return send(res, 200, r.rows);
    }
    else if (req.method === 'PATCH') {
      const cols = Object.keys(json);
      const sets = cols.map((c, i) => `${ident(c)} = $${params.length + i + 1}`);
      r = await asUser(uid, `update ${table} set ${sets.join(',')}${w}${prefer.includes('return=representation') ? ' returning *' : ''}`, [...params, ...cols.map((c) => (typeof json[c] === 'object' && json[c] !== null ? JSON.stringify(json[c]) : json[c]))]);
      if (prefer.includes('return=representation')) return send(res, 200, r.rows);
    } else if (req.method === 'POST') {
      const rows = Array.isArray(json) ? json : [json];
      const cols = Object.keys(rows[0]);
      const vals = []; const ps = [];
      rows.forEach((row) => { vals.push('(' + cols.map((c) => { ps.push(typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c]); return `$${ps.length}`; }).join(',') + ')'); });
      let sql = `insert into ${table} (${cols.map(ident).join(',')}) values ${vals.join(',')}`;
      if (prefer.includes('merge-duplicates') && onConflict) sql += ` on conflict (${onConflict.join(',')}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(',')}`;
      if (prefer.includes('return=representation')) { sql += ' returning *'; r = await asUser(uid, sql, ps); return send(res, 201, r.rows); }
      r = await asUser(uid, sql, ps);
      return send(res, 201);
    }
    return send(res, 200, r.rows || []);
  } catch (e) {
    const status = e.code === '23505' ? 409 : e.code === '42501' ? 403 : 400;
    return send(res, status, { code: e.code, message: e.message });
  }
});
// Realtime stand-in: accepts the join, confirms, and relays message inserts (pg NOTIFY 'rt').
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
const socks = new Set();
wss.on('connection', (ws) => {
  socks.add(ws); ws.on('close', () => socks.delete(ws));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.event === 'phx_join') {
      ws.send(JSON.stringify({ ref: m.ref, topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [{ id: 1 }] } } }));
      ws.send(JSON.stringify({ ref: null, topic: m.topic, event: 'system', payload: { status: 'ok', extension: 'postgres_changes', message: 'Subscribed to PostgreSQL' } }));
      ws.topic = m.topic;
    }
  });
});
async function listen() {
  try {
    const c = await pool.connect();
    c.on('error', () => { try { c.release(true); } catch {} setTimeout(listen, 500); });
    await c.query('listen rt');
    c.on('notification', (n) => { for (const ws of socks) ws.send(JSON.stringify({ topic: ws.topic, event: 'postgres_changes', ref: null, payload: { data: { type: 'INSERT', record: JSON.parse(n.payload) } } })); });
  } catch { setTimeout(listen, 500); }
}
listen();
server.listen(54321, () => console.log('mock on 54321'));
