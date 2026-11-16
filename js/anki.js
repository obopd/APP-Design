// Import an Anki deck package (.apkg / .colpkg) into Study mode: decks, deck options,
// note types, notes, cards with their scheduling, and the review history.
//
// An .apkg is a zip with an SQLite database inside. No libraries: the zip is unpacked with
// the browser's DecompressionStream and the database is read by the small SQLite reader
// below (tables only: enough for Anki's notes / cards / revlog / col). Needs the file
// exported with "Support older Anki versions" ticked (newer packages are compressed with
// zstd, which browsers can't unpack); that case gets a clear message.
import { dayOf, dayStart, DEFAULT_PRESET } from './srs.js';
import { getItem, importBatch, decks as existingDecks, mediaHas, mediaPut } from './study.js';
import { typeOf, uploadMedia } from './studymedia.js';
import { mediaRefs, ioTemplates } from './cardtext.js';

/* ---------- Zip (read straight from the File: only the parts needed) ---------- */

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const slice = async (file, from, to) => new Uint8Array(await file.slice(from, to).arrayBuffer());

/**
 * { name: () => Promise<Uint8Array> } for every file in a zip. Reads the directory at the
 * end of the file, then only the entries asked for (a deck with its images can be hundreds
 * of MB; the cards are a small part of it).
 */
async function unzip(file) {
  const size = file.size;
  const tailFrom = Math.max(0, size - 65557 - 20);
  const tail = await slice(file, tailFrom, size);
  const tdv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tdv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This isn’t an Anki package (.apkg).');
  let count = tdv.getUint16(eocd + 10, true);
  let cdSize = tdv.getUint32(eocd + 12, true);
  let cd = tdv.getUint32(eocd + 16, true);
  if (cd === 0xffffffff || count === 0xffff) { // Zip64
    const loc = eocd - 20;
    if (loc >= 0 && tdv.getUint32(loc, true) === 0x07064b50) {
      const at = Number(tdv.getBigUint64(loc + 8, true));
      const rec = new DataView((await slice(file, at, at + 56)).buffer);
      count = Number(rec.getBigUint64(32, true));
      cdSize = Number(rec.getBigUint64(40, true));
      cd = Number(rec.getBigUint64(48, true));
    }
  }
  const dir = await slice(file, cd, cd + cdSize);
  const dv = new DataView(dir.buffer);
  const dec = new TextDecoder();
  const files = {};
  for (let n = 0, p = 0; n < count && p + 46 <= dir.length; n += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = dec.decode(dir.subarray(p + 46, p + 46 + nameLen));
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8;
        if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (local === 0xffffffff) local = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    files[name] = async () => {
      const head = new DataView((await slice(file, local, local + 30)).buffer);
      const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      const data = await slice(file, start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error('Unsupported zip compression.');
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------- SQLite (read-only, tables) ---------- */

function sqlite(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (new TextDecoder().decode(u8.subarray(0, 15)) !== 'SQLite format 3') throw new Error('The package’s database couldn’t be read.');
  let pageSize = dv.getUint16(16);
  if (pageSize === 1) pageSize = 65536;
  const usable = pageSize - u8[20];
  const dec = new TextDecoder();
  const page = (n) => (n - 1) * pageSize;

  const varint = (p) => {
    let v = 0n;
    for (let i = 0; i < 9; i += 1) {
      const b = u8[p + i];
      if (i === 8) return [(v << 8n) | BigInt(b), p + 9];
      v = (v << 7n) | BigInt(b & 0x7f);
      if (!(b & 0x80)) return [v, p + i + 1];
    }
    return [v, p + 9];
  };
  const vnum = (p) => { const [v, q] = varint(p); return [Number(v), q]; };

  // The full payload of a cell (following overflow pages).
  // Table leaves keep up to usable-35 bytes on the page; index pages less.
  const payload = (p, size, index = false) => {
    const maxLocal = index ? Math.floor(((usable - 12) * 64) / 255) - 23 : usable - 35;
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    if (size <= maxLocal) return u8.subarray(p, p + size);
    let local = minLocal + ((size - minLocal) % (usable - 4));
    if (local > maxLocal) local = minLocal;
    const out = new Uint8Array(size);
    out.set(u8.subarray(p, p + local));
    let filled = local;
    let next = dv.getUint32(p + local);
    while (next && filled < size) {
      const base = page(next);
      const take = Math.min(usable - 4, size - filled);
      out.set(u8.subarray(base + 4, base + 4 + take), filled);
      filled += take;
      next = dv.getUint32(base);
    }
    return out;
  };

  const record = (buf) => {
    const rdv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let [hsize, p] = (() => { let v = 0; let i = 0; for (; i < 9; i += 1) { const b = buf[i]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) break; } return [v, i + 1]; })();
    const types = [];
    while (p < hsize) {
      let v = 0;
      for (let i = 0; i < 9; i += 1) { const b = buf[p]; p += 1; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) break; }
      types.push(v);
    }
    let q = hsize;
    return types.map((t) => {
      if (t === 0) return null;
      if (t === 8) return 0;
      if (t === 9) return 1;
      if (t >= 1 && t <= 6) {
        const len = [0, 1, 2, 3, 4, 6, 8][t];
        let v = 0n;
        for (let i = 0; i < len; i += 1) v = (v << 8n) | BigInt(buf[q + i]);
        if (buf[q] & 0x80) v -= 1n << BigInt(len * 8);
        q += len;
        return Number(v);
      }
      if (t === 7) { const v = rdv.getFloat64(q); q += 8; return v; }
      const len = Math.floor((t - (t % 2 ? 13 : 12)) / 2);
      const bytes = buf.subarray(q, q + len);
      q += len;
      return t % 2 ? dec.decode(bytes) : bytes;
    });
  };

  // Every row of a table b-tree: [rowid, values] (pages 13 / 5). WITHOUT ROWID tables are
  // index b-trees (pages 10 / 2) whose records are the rows: [null, values].
  const rows = (root) => {
    const out = [];
    const walk = (n) => {
      const base = page(n);
      const hdr = n === 1 ? base + 100 : base;
      const type = u8[hdr];
      const cellsN = dv.getUint16(hdr + 3);
      const interior = type === 5 || type === 2;
      const ptrs = hdr + (interior ? 12 : 8);
      for (let i = 0; i < cellsN; i += 1) {
        const cell = base + dv.getUint16(ptrs + i * 2);
        if (type === 13) {
          const [size, a] = vnum(cell);
          const [rowid, b] = vnum(a);
          out.push([rowid, record(payload(b, size))]);
        } else if (type === 5) walk(dv.getUint32(cell));
        else if (type === 10) {
          const [size, a] = vnum(cell);
          out.push([null, record(payload(a, size, true))]);
        } else if (type === 2) {
          walk(dv.getUint32(cell));
          const [size, a] = vnum(cell + 4);
          out.push([null, record(payload(a, size, true))]);
        }
      }
      if (interior) walk(dv.getUint32(hdr + 8));
    };
    walk(root);
    return out;
  };

  const master = rows(1).map(([, v]) => ({ type: v[0], name: v[1], root: v[3], sql: v[4] }));
  return {
    has: (name) => master.some((m) => m.type === 'table' && m.name === name),
    /** Rows as objects; an INTEGER PRIMARY KEY column takes the rowid. */
    table(name) {
      const m = master.find((x) => x.type === 'table' && x.name === name);
      if (!m) return [];
      // Anki's own table definitions carry comments ("guid text not null, /* 1 */").
      const sqlText = m.sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      const cols = sqlText.slice(sqlText.indexOf('(') + 1, sqlText.lastIndexOf(')'))
        .split(/,(?![^(]*\))/).map((c) => c.trim()).filter((c) => !/^(primary|unique|check|foreign|constraint)\b/i.test(c));
      const names = cols.map((c) => c.split(/\s+/)[0].replace(/["`[\]]/g, ''));
      const pk = /without\s+rowid/i.test(sqlText) ? -1 : cols.findIndex((c) => /^\S+\s+integer\b.*\bprimary\s+key\b/i.test(c));
      return rows(m.root).map(([rowid, vals]) => {
        const o = {};
        names.forEach((nm, i) => { o[nm] = i === pk && vals[i] == null ? rowid : vals[i]; });
        return o;
      });
    },
  };
}

/* ---------- Anki → Study mode ---------- */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mins = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr.map(Number).filter((x) => x > 0) : fallback);

/**
 * Import an .apkg File. Returns { decks, notes, cards, reviews, skipped }.
 * Notes already imported before (same Anki id) are skipped.
 */
export async function importApkg(file, { onProgress = () => {} } = {}) {
  const files = await unzip(file);
  // Newest Anki (2.1.50+): zstd-compressed collection; the plain collection.anki2 next to it
  // is only a "please update Anki" placeholder.
  let bytes;
  const { zstdDecompress } = await import('./zstd.js');
  if (files['collection.anki21b']) {
    bytes = zstdDecompress(await files['collection.anki21b']());
  } else if (files['collection.anki21'] || files['collection.anki2']) {
    bytes = await (files['collection.anki21'] || files['collection.anki2'])();
  } else throw new Error('No Anki collection found in this file.');
  const db = sqlite(bytes);
  const col = db.table('col')[0];
  if (!col) throw new Error('The package’s database couldn’t be read.');
  const legacy = col.models && col.models !== '{}';
  const { models, decks: ankiDecks, dconf } = legacy
    ? { models: JSON.parse(col.models), decks: JSON.parse(col.decks || '{}'), dconf: JSON.parse(col.dconf || '{}') }
    : modernSchema(db);
  const crtDay = dayOf((col.crt || 0) * 1000);
  const items = [];
  const out = { decks: 0, notes: 0, cards: 0, reviews: 0, skipped: 0 };

  // Deck option groups → presets.
  const presetId = {};
  for (const [id, c] of Object.entries(dconf)) {
    const pid = `anki-p-${id}`;
    presetId[id] = pid;
    if (getItem(pid)) continue;
    items.push({
      id: pid, kind: 'preset', ...DEFAULT_PRESET,
      name: c.name ? `${c.name} (Anki)` : 'Anki',
      newPerDay: c.new?.perDay ?? DEFAULT_PRESET.newPerDay,
      reviewsPerDay: c.rev?.perDay ?? DEFAULT_PRESET.reviewsPerDay,
      learnSteps: mins(c.new?.delays, DEFAULT_PRESET.learnSteps),
      relearnSteps: mins(c.lapse?.delays, DEFAULT_PRESET.relearnSteps),
      graduatingIvl: c.new?.ints?.[0] ?? 1,
      easyIvl: c.new?.ints?.[1] ?? 4,
      startEase: (c.new?.initialFactor || 2500) / 1000,
      easyBonus: c.rev?.ease4 ?? 1.3,
      hardFactor: c.rev?.hardFactor ?? 1.2,
      maxIvl: c.rev?.maxIvl ?? 36500,
      leechThreshold: c.lapse?.leechFails ?? 8,
      leechAction: c.lapse?.leechAction === 1 ? 'tag' : 'suspend',
      retention: clamp(c.desiredRetention || 0.9, 0.7, 0.99),
      scheduler: 'fsrs',
    });
  }

  // Decks: "A::B" names become nested decks; filtered (dyn) decks are left out.
  const deckByPath = new Map(existingDecks().filter((d) => !d.filtered).map((d) => [pathOf(d), d.id]));
  function pathOf(d) {
    const parts = [];
    for (let x = d, i = 0; x && i < 20; x = getItem(x.parent), i += 1) parts.unshift(x.name);
    return parts.join('::');
  }
  const ensureDeck = (path, conf) => {
    const parts = path.split('::');
    let parent = null;
    let id = null;
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join('::');
      id = deckByPath.get(p);
      if (!id) {
        id = `anki-d-${hash(p)}`;
        const preset = i === parts.length - 1 && conf != null ? presetId[conf] || null : null;
        if (!getItem(id)) { items.push({ id, kind: 'deck', name, parent, preset }); out.decks += 1; }
        deckByPath.set(p, id);
      }
      parent = id;
    });
    return id;
  };
  const deckId = {};
  for (const [id, d] of Object.entries(ankiDecks)) {
    if (d.dyn) continue;
    deckId[id] = () => ensureDeck(String(d.name).replace(/\x1f/g, '::'), d.conf);
  }
  const deckFor = (did, odid) => {
    const key = odid && deckId[odid] ? odid : did;
    const fn = deckId[key] || deckId[Object.keys(deckId)[0]];
    return fn ? fn() : ensureDeck('Imported', null);
  };

  // Note types.
  const typeId = {};
  for (const [id, m] of Object.entries(models)) {
    const tid = `anki-t-${id}`;
    const fields = m.flds.slice().sort((a, b) => a.ord - b.ord).map((f) => f.name);
    typeId[id] = { id: tid, fields, cloze: m.type === 1 };
    const templates = m.tmpls.slice().sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt }));
    // Anki's image occlusion (its templates draw with a script, which never runs here): the
    // same fields with this app's templates, so occlusion.js covers the picture.
    const io = m.type === 1 && fields.length >= 2 && templates.some((t) => /image-occlusion|imageOcclusion/.test(`${t.front}${t.back}`))
      ? { occl: fields[0], image: fields[1] } : null;
    const had = getItem(tid);
    if (had) {
      if (io && !had.io) items.push({ ...had, io, templates: ioTemplates(fields) }); // imported before this was understood
      continue;
    }
    items.push({ id: tid, kind: 'notetype', name: m.name, cloze: m.type === 1, css: m.css || '', fields, ...(io ? { io } : {}), templates: io ? ioTemplates(fields) : templates });
  }

  // Notes.
  const noteId = {};
  const noteRows = db.table('notes');
  for (const n of noteRows) {
    const nid = `anki-n-${n.id}`;
    noteId[n.id] = nid;
    if (getItem(nid)) { out.skipped += 1; continue; }
    const t = typeId[n.mid];
    if (!t) continue;
    const vals = String(n.flds || '').split('\x1f');
    items.push({
      id: nid, kind: 'note', type: t.id,
      fields: Object.fromEntries(t.fields.map((f, i) => [f, vals[i] || ''])),
      tags: String(n.tags || '').trim().split(/\s+/).filter(Boolean),
      added: Number(n.id) > 1e11 ? Math.round(Number(n.id)) : Date.now(), // Anki note ids are creation times (ms)
    });
    out.notes += 1;
  }

  // Cards with their scheduling.
  const cardId = {};
  const cardRows = db.table('cards');
  for (const c of cardRows) {
    const cid = `anki-c-${c.id}`;
    cardId[c.id] = cid;
    if (getItem(cid) || !noteId[c.nid] || getItem(noteId[c.nid])) continue;
    let extra = {};
    try { extra = c.data ? JSON.parse(c.data) : {}; } catch { extra = {}; }
    const card = {
      id: cid, kind: 'card', note: noteId[c.nid], ord: c.ord, deck: deckFor(String(c.did), c.odid ? String(c.odid) : null),
      reps: c.reps || 0, lapses: c.lapses || 0, flag: (c.flags || 0) & 7, state: 'new', pos: 0, due: 0,
    };
    if (c.queue === -1) card.suspended = true;
    const ease = (c.factor || 2500) / 1000;
    if (c.type === 0) {
      card.pos = c.due || 0;
    } else if (c.type === 2) {
      card.state = 'review';
      card.ivl = Math.max(1, c.ivl || 1);
      const dueDay = crtDay + (c.odid ? c.odue : c.due);
      card.due = dayStart(dueDay);
      card.ease = ease;
      card.last = dayStart(dueDay - card.ivl);
    } else {
      card.state = c.type === 3 ? 'relearn' : 'learn';
      card.step = 0;
      card.ivl = c.ivl > 0 ? c.ivl : 0;
      card.ease = ease;
      card.due = c.queue === 3 ? dayStart(crtDay + c.due) : (c.due || 0) * 1000;
    }
    if (card.state !== 'new') {
      // FSRS memory: Anki's own when it used FSRS, else estimated from interval and ease.
      card.S = extra.s ?? Math.max(1, card.ivl || 1);
      card.D = extra.d ?? clamp(10 - ((ease - 1.3) / 1.2) * 5, 1, 10);
      card.last = card.last || Date.now();
    }
    items.push(card);
    out.cards += 1;
  }

  // Review history.
  const reviews = [];
  const firstSeen = new Set();
  const revlog = db.table('revlog').sort((a, b) => a.id - b.id);
  for (const r of revlog) {
    const cid = cardId[r.cid];
    if (!cid || r.type === 4 || !(r.ease >= 1 && r.ease <= 4)) continue;
    const state = r.type === 0 ? (firstSeen.has(cid) ? 'learn' : 'new') : r.type === 2 ? 'relearn' : 'review';
    firstSeen.add(cid);
    reviews.push({
      id: `anki-r-${r.id}-${r.cid}`, card: cid, at: Number(r.id), rating: r.ease, state,
      ivl: r.ivl > 0 ? r.ivl : 0, lastIvl: r.lastIvl > 0 ? r.lastIvl : 0, time: Math.min(r.time || 0, 600000),
    });
  }
  // Only the history of cards that came in now (a second import doesn't double it).
  const added = new Set(items.filter((x) => x.kind === 'card').map((x) => x.id));
  const fresh = reviews.filter((r) => added.has(r.card));
  out.reviews = fresh.length;
  // Images / sounds the cards use (also for notes imported before, so a second import of
  // the same deck fills in what's missing).
  out.media = await importMedia(files, noteRows, models, zstdDecompress, onProgress);
  if (!out.notes && !out.cards && !out.skipped) {
    // Nothing usable came out: say what was found so it can be looked into.
    throw new Error(`No cards could be read from this file (found ${noteRows.length} notes, ${cardRows.length} cards, ${Object.keys(models).length} note types).`);
  }
  await importBatch(items, fresh);
  return out;
}

/* ---------- Media ---------- */

const isZstd = (b) => b && b.length > 3 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

async function importMedia(files, noteRows, models, zstd, onProgress) {
  if (!files.media) return 0;
  // Zip entry ("0", "1", …) → file name. Older packages: JSON; newest: zstd + protobuf.
  const raw = await files.media();
  const byName = new Map();
  if (isZstd(raw)) {
    (pb(zstd(raw))[1] || []).forEach((entry, i) => {
      const e = pb(entry);
      const name = pbText(e[1]?.[0]);
      if (name) byName.set(name, String(e[255]?.[0] ?? i));
    });
  } else {
    try { Object.entries(JSON.parse(new TextDecoder().decode(raw)) || {}).forEach(([zipName, name]) => byName.set(name, zipName)); } catch { return 0; }
  }
  if (!byName.size) return 0;
  // What the cards use: <img src="…"> and [sound:…] in notes, plus files the templates use.
  const used = new Set();
  const scan = (html) => mediaRefs(html, used);
  noteRows.forEach((n) => scan(n.flds));
  Object.values(models).forEach((m) => (m.tmpls || []).forEach((t) => { scan(t.qfmt); scan(t.afmt); }));
  const wanted = [...used].filter((n) => byName.has(n));
  const have = await mediaHas(wanted);
  const todo = wanted.filter((n) => !have.has(n));
  let done = 0;
  let batch = [];
  for (const name of todo) {
    const entry = files[byName.get(name)];
    if (entry) {
      let data = await entry();
      if (isZstd(data)) data = zstd(data);
      batch.push({ name, blob: new Blob([data], { type: typeOf(name) }), uploaded: false });
    }
    done += 1;
    if (batch.length >= 25 || done === todo.length) {
      await mediaPut(batch);
      batch = [];
      onProgress(done, todo.length);
    }
  }
  if (todo.length) uploadMedia();
  return todo.length;
}

/* ---------- Newer Anki collections (schema 18): settings live in protobuf blobs ---------- */

// Minimal protobuf reader: { fieldNumber: [values] } (varints as numbers, bytes as Uint8Array,
// 32-bit as float).
function pb(buf) {
  const out = {};
  if (!buf || !buf.length) return out;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  const varint = () => {
    let v = 0;
    for (let mul = 1; p < buf.length; mul *= 128) {
      const b = buf[p++];
      v += (b & 0x7f) * mul;
      if (!(b & 0x80)) break;
    }
    return v;
  };
  while (p < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wt = key & 7;
    let v;
    if (wt === 0) v = varint();
    else if (wt === 1) { v = dv.getFloat64(p, true); p += 8; } else if (wt === 2) { const n = varint(); v = buf.subarray(p, p + n); p += n; } else if (wt === 5) { v = dv.getFloat32(p, true); p += 4; } else break;
    (out[field] ||= []).push(v);
  }
  return out;
}
const pbText = (v) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : '');
const floats = (vals) => (vals || []).flatMap((v) => {
  if (!(v instanceof Uint8Array)) return [v];
  const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
  return Array.from({ length: v.length >> 2 }, (_, i) => dv.getFloat32(i * 4, true));
});

// The same shapes the older JSON columns had, built from the newer tables.
function modernSchema(db) {
  if (!db.has('notetypes')) throw new Error('This Anki file’s format isn’t supported.');
  const fields = db.table('fields');
  const templates = db.table('templates');
  const models = {};
  for (const nt of db.table('notetypes')) {
    const conf = pb(nt.config);
    models[nt.id] = {
      name: nt.name,
      type: conf[1]?.[0] === 1 ? 1 : 0,
      css: pbText(conf[3]?.[0]),
      flds: fields.filter((f) => f.ntid === nt.id).map((f) => ({ name: f.name, ord: f.ord })),
      tmpls: templates.filter((t) => t.ntid === nt.id).map((t) => {
        const tc = pb(t.config);
        return { name: t.name, ord: t.ord, qfmt: pbText(tc[1]?.[0]), afmt: pbText(tc[2]?.[0]) };
      }),
    };
  }
  const decks = {};
  for (const d of db.table('decks')) {
    const kind = pb(d.kind);
    const normal = kind[1]?.[0];
    decks[d.id] = { name: d.name, dyn: normal ? 0 : 1, conf: normal ? pb(normal)[1]?.[0] ?? 1 : 1 };
  }
  // Deck options: only the settings whose places are certain; the rest keep defaults.
  const ok = (n, lo, hi) => (Number.isFinite(n) && n >= lo && n <= hi ? n : undefined);
  const dconf = {};
  for (const c of db.has('deck_config') ? db.table('deck_config') : []) {
    const conf = pb(c.config);
    const steps = (f) => { const v = floats(conf[f]).filter((x) => x > 0 && x < 1e6); return v.length ? v : undefined; };
    dconf[c.id] = {
      name: c.name,
      new: { perDay: ok(conf[9]?.[0], 0, 9999), delays: steps(1) },
      rev: { perDay: ok(conf[10]?.[0], 0, 99999) },
      lapse: { delays: steps(2) },
    };
  }
  return { models, decks, dconf };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
