// Zstandard decompression (RFC 8878), for Anki packages: newer Anki exports compress the
// collection with zstd, which browsers can't unpack themselves. Decoding only, no
// dictionaries; written from the RFC so the app keeps no outside code.

const MAGIC = 0xfd2fb528;

// Literal / match length codes → [baseline, extra bits] (RFC 8878 3.1.1.3.2.1).
const LL = [...Array.from({ length: 16 }, (_, i) => [i, 0]),
  [16, 1], [18, 1], [20, 1], [22, 1], [24, 2], [28, 2], [32, 3], [40, 3], [48, 4], [64, 6], [128, 7], [256, 8],
  [512, 9], [1024, 10], [2048, 11], [4096, 12], [8192, 13], [16384, 14], [32768, 15], [65536, 16]];
const ML = [...Array.from({ length: 32 }, (_, i) => [i + 3, 0]),
  [35, 1], [37, 1], [39, 1], [41, 1], [43, 2], [47, 2], [51, 3], [59, 3], [67, 4], [83, 4], [99, 5], [131, 7],
  [259, 8], [515, 9], [1027, 10], [2051, 11], [4099, 12], [8195, 13], [16387, 14], [32771, 15], [65539, 16]];
const LL_DEFAULT = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_DEFAULT = [1, 4, 3, 2, 2, 2, 2, 2, 2, ...Array(37).fill(1), -1, -1, -1, -1, -1, -1, -1];
const OF_DEFAULT = [1, 1, 1, 1, 1, 1, 2, 2, 2, ...Array(15).fill(1), -1, -1, -1, -1, -1];

const fail = (msg) => { throw new Error(`zstd: ${msg}`); };
const highBit = (n) => 31 - Math.clz32(n);

/* ---------- Bit readers ---------- */

// Forward, little-endian (FSE table descriptions).
class ForwardBits {
  constructor(src, start) { this.src = src; this.pos = start * 8; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i += 1, this.pos += 1) v += ((this.src[this.pos >> 3] >> (this.pos & 7)) & 1) * 2 ** i;
    return v;
  }
  peek(n) { const p = this.pos; const v = this.read(n); this.pos = p; return v; }
  get byte() { return (this.pos + 7) >> 3; }
}

// Backward (Huffman and FSE streams): starts at the end, after the final 1-bit marker.
class BackBits {
  constructor(src, start, end) {
    this.src = src;
    this.start = start * 8;
    const last = src[end - 1];
    if (!last) fail('bad stream end');
    this.pos = (end - 1) * 8 + highBit(last);
  }
  get(at, n) { // n (≤ 32) bits starting at bit `at` (zeros below the stream's start)
    if (!n) return 0;
    if (at < this.start) {
      let v = 0;
      for (let i = 0; i < n; i += 1) {
        const b = at + i;
        if (b >= this.start) v += ((this.src[b >> 3] >> (b & 7)) & 1) * 2 ** i;
      }
      return v;
    }
    const s = this.src;
    const i = at >> 3;
    const v = s[i] + (s[i + 1] || 0) * 256 + (s[i + 2] || 0) * 65536 + (s[i + 3] || 0) * 16777216 + (s[i + 4] || 0) * 4294967296;
    return Math.floor(v / 2 ** (at & 7)) % 2 ** n;
  }
  read(n) { if (!n) return 0; this.pos -= n; return this.get(this.pos, n); }
  peek(n) { return this.get(this.pos - n, n); }
  get overflowed() { return this.pos < this.start; }
  get done() { return this.pos === this.start; }
}

/* ---------- FSE ---------- */

function readFseCounts(src, start, maxSymbol) {
  const br = new ForwardBits(src, start);
  const accuracy = br.read(4) + 5;
  let remaining = (1 << accuracy) + 1;
  let threshold = 1 << accuracy;
  let nbBits = accuracy + 1;
  const counts = [];
  while (remaining > 1 && counts.length <= maxSymbol) {
    const max = 2 * threshold - 1 - remaining;
    const low = br.peek(nbBits - 1);
    let value;
    if (low < max) { value = low; br.read(nbBits - 1); } else {
      value = br.read(nbBits);
      if (value >= threshold) value -= max;
    }
    const prob = value - 1;
    remaining -= Math.abs(prob);
    counts.push(prob);
    if (prob === 0) {
      for (;;) {
        const rep = br.read(2);
        for (let i = 0; i < rep; i += 1) counts.push(0);
        if (rep !== 3) break;
      }
    }
    while (remaining < threshold) { nbBits -= 1; threshold >>= 1; }
  }
  if (remaining !== 1) fail('bad FSE table');
  return { counts, accuracy, next: br.byte };
}

function buildFse(counts, accuracy) {
  const size = 1 << accuracy;
  const sym = new Uint16Array(size);
  const bits = new Uint8Array(size);
  const base = new Uint16Array(size);
  const next = [];
  let high = size - 1;
  counts.forEach((p, s) => {
    if (p === -1) { sym[high] = s; high -= 1; next[s] = 1; } else next[s] = p;
  });
  const step = (size >> 1) + (size >> 3) + 3;
  let pos = 0;
  counts.forEach((p, s) => {
    for (let i = 0; i < p; i += 1) {
      sym[pos] = s;
      do pos = (pos + step) & (size - 1); while (pos > high);
    }
  });
  for (let u = 0; u < size; u += 1) {
    const s = sym[u];
    const n = next[s]++;
    bits[u] = accuracy - highBit(n);
    base[u] = (n << bits[u]) - size;
  }
  return { sym, bits, base, accuracy };
}
const rleTable = (s) => ({ sym: new Uint16Array([s]), bits: new Uint8Array([0]), base: new Uint16Array([0]), accuracy: 0 });

/* ---------- Huffman (literals) ---------- */

function readHuffman(src, start) {
  const hb = src[start];
  let weights;
  let next;
  if (hb >= 128) {
    const n = hb - 127;
    weights = [];
    for (let i = 0; i < n; i += 1) {
      const byte = src[start + 1 + (i >> 1)];
      weights.push(i % 2 ? byte & 15 : byte >> 4);
    }
    next = start + 1 + ((n + 1) >> 1);
  } else {
    const end = start + 1 + hb;
    const { counts, accuracy, next: dataStart } = readFseCounts(src, start + 1, 255);
    if (accuracy > 6) fail('bad Huffman weights');
    const t = buildFse(counts, accuracy);
    const br = new BackBits(src, dataStart, end);
    let s1 = br.read(accuracy);
    let s2 = br.read(accuracy);
    weights = [];
    for (;;) {
      weights.push(t.sym[s1]);
      s1 = t.base[s1] + br.read(t.bits[s1]);
      if (br.overflowed) { weights.push(t.sym[s2]); break; }
      weights.push(t.sym[s2]);
      s2 = t.base[s2] + br.read(t.bits[s2]);
      if (br.overflowed) { weights.push(t.sym[s1]); break; }
      if (weights.length > 255) fail('too many Huffman weights');
    }
    next = end;
  }
  // The last weight is implied: the total must reach the next power of two.
  let total = 0;
  for (const w of weights) if (w) total += 1 << (w - 1);
  const maxBits = highBit(total) + 1;
  const left = (1 << maxBits) - total;
  if (left & (left - 1)) fail('bad Huffman tree');
  weights.push(highBit(left) + 1);
  const size = 1 << maxBits;
  const sym = new Uint8Array(size);
  const nb = new Uint8Array(size);
  let pos = 0;
  for (let w = 1; w <= maxBits; w += 1) {
    weights.forEach((wt, s) => {
      if (wt !== w) return;
      const span = 1 << (w - 1);
      sym.fill(s, pos, pos + span);
      nb.fill(maxBits + 1 - w, pos, pos + span);
      pos += span;
    });
  }
  return { table: { sym, nb, maxBits }, next };
}

function huffStream(src, start, end, t, out, at, count) {
  const br = new BackBits(src, start, end);
  for (let i = 0; i < count; i += 1) {
    const idx = br.peek(t.maxBits);
    out[at + i] = t.sym[idx];
    br.pos -= t.nb[idx];
  }
  if (!br.done) fail('Huffman stream size mismatch');
}

/* ---------- Blocks ---------- */

function literals(src, p, st) {
  const b0 = src[p];
  const type = b0 & 3;
  const sf = (b0 >> 2) & 3;
  if (type < 2) {
    let size;
    let hdr;
    if (sf === 0 || sf === 2) { size = b0 >> 3; hdr = 1; } else if (sf === 1) { size = (b0 >> 4) + (src[p + 1] << 4); hdr = 2; } else { size = (b0 >> 4) + (src[p + 1] << 4) + (src[p + 2] << 12); hdr = 3; }
    if (type === 0) return { lit: src.subarray(p + hdr, p + hdr + size), next: p + hdr + size };
    return { lit: new Uint8Array(size).fill(src[p + hdr]), next: p + hdr + 1 };
  }
  let regen;
  let comp;
  let hdr;
  const h = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16);
  if (sf < 2) { hdr = 3; regen = (h >>> 4) & 0x3ff; comp = (h >>> 14) & 0x3ff; } else if (sf === 2) {
    hdr = 4; const v = h + src[p + 3] * 2 ** 24; regen = (v >>> 4) & 0x3fff; comp = Math.floor(v / 2 ** 18) & 0x3fff;
  } else {
    hdr = 5; const v = h + src[p + 3] * 2 ** 24 + src[p + 4] * 2 ** 32;
    regen = Math.floor(v / 16) % 2 ** 18; comp = Math.floor(v / 2 ** 22) % 2 ** 18;
  }
  const streams = sf === 0 ? 1 : 4;
  let q = p + hdr;
  const end = q + comp;
  if (type === 2) { const r = readHuffman(src, q); st.huff = r.table; q = r.next; } else if (!st.huff) fail('no Huffman table to repeat');
  const out = new Uint8Array(regen);
  if (streams === 1) huffStream(src, q, end, st.huff, out, 0, regen);
  else {
    const s1 = src[q] | (src[q + 1] << 8);
    const s2 = src[q + 2] | (src[q + 3] << 8);
    const s3 = src[q + 4] | (src[q + 5] << 8);
    const seg = (regen + 3) >> 2;
    let a = q + 6;
    const ends = [a + s1, a + s1 + s2, a + s1 + s2 + s3, end];
    for (let i = 0; i < 4; i += 1) {
      huffStream(src, a, ends[i], st.huff, out, i * seg, i < 3 ? seg : regen - 3 * seg);
      a = ends[i];
    }
  }
  return { lit: out, next: end };
}

function seqTable(src, p, mode, kind, st) {
  const [def, defAcc, max] = { ll: [LL_DEFAULT, 6, 35], of: [OF_DEFAULT, 5, 31], ml: [ML_DEFAULT, 6, 52] }[kind];
  if (mode === 0) { st[kind] = buildFse(def, defAcc); return p; }
  if (mode === 1) { st[kind] = rleTable(src[p]); return p + 1; }
  if (mode === 2) {
    const { counts, accuracy, next } = readFseCounts(src, p, max);
    st[kind] = buildFse(counts, accuracy);
    return next;
  }
  if (!st[kind]) fail('no table to repeat');
  return p;
}

function compressedBlock(src, p, end, out, st) {
  const lit = literals(src, p, st);
  let q = lit.next;
  let nSeq = src[q];
  if (nSeq === 0) { q += 1; } else if (nSeq < 128) q += 1;
  else if (nSeq < 255) { nSeq = ((nSeq - 128) << 8) + src[q + 1]; q += 2; } else { nSeq = src[q + 1] + (src[q + 2] << 8) + 0x7f00; q += 3; }
  let litPos = 0;
  if (nSeq) {
    const modes = src[q]; q += 1;
    q = seqTable(src, q, modes >> 6, 'll', st);
    q = seqTable(src, q, (modes >> 4) & 3, 'of', st);
    q = seqTable(src, q, (modes >> 2) & 3, 'ml', st);
    const br = new BackBits(src, q, end);
    let sl = br.read(st.ll.accuracy);
    let so = br.read(st.of.accuracy);
    let sm = br.read(st.ml.accuracy);
    const rep = st.rep;
    for (let i = 0; i < nSeq; i += 1) {
      const ofCode = st.of.sym[so];
      const llCode = st.ll.sym[sl];
      const mlCode = st.ml.sym[sm];
      let ofv = 2 ** ofCode + br.read(ofCode);
      const ml = ML[mlCode][0] + br.read(ML[mlCode][1]);
      const ll = LL[llCode][0] + br.read(LL[llCode][1]);
      let offset;
      if (ofv > 3) { offset = ofv - 3; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; } else {
        if (ll === 0) ofv += 1;
        if (ofv === 1) offset = rep[0];
        else if (ofv === 2) { offset = rep[1]; rep[1] = rep[0]; rep[0] = offset; } else if (ofv === 3) { offset = rep[2]; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; } else { offset = rep[0] - 1; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; }
      }
      out.write(lit.lit.subarray(litPos, litPos + ll));
      litPos += ll;
      out.copy(offset, ml);
      if (i < nSeq - 1) {
        sl = st.ll.base[sl] + br.read(st.ll.bits[sl]);
        sm = st.ml.base[sm] + br.read(st.ml.bits[sm]);
        so = st.of.base[so] + br.read(st.of.bits[so]);
      }
    }
  }
  out.write(lit.lit.subarray(litPos));
}

// A growing output buffer (matches copy from what was already written).
class Out {
  constructor(size) { this.buf = new Uint8Array(size || 1 << 16); this.n = 0; }
  room(k) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  write(bytes) { this.room(bytes.length); this.buf.set(bytes, this.n); this.n += bytes.length; }
  copy(offset, len) {
    if (offset > this.n || offset < 1) fail('bad match offset');
    this.room(len);
    const b = this.buf;
    let from = this.n - offset;
    if (offset >= len) { b.copyWithin(this.n, from, from + len); this.n += len; return; }
    for (let i = 0; i < len; i += 1) b[this.n++] = b[from++];
  }
}

/** Decompress zstd data (one or more frames) into a Uint8Array. */
export function zstdDecompress(src) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let p = 0;
  let out = null;
  while (p + 4 <= src.length) {
    const magic = dv.getUint32(p, true);
    if ((magic & 0xfffffff0) === 0x184d2a50) { p += 8 + dv.getUint32(p + 4, true); continue; } // skippable frame
    if (magic !== MAGIC) fail('not zstd data');
    p += 4;
    const fhd = src[p]; p += 1;
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictFlag = fhd & 3;
    if (!single) p += 1; // window descriptor
    p += [0, 1, 2, 4][dictFlag];
    const fcsSize = fcsFlag === 0 ? single : [0, 2, 4, 8][fcsFlag];
    let fcs = 0;
    for (let i = 0; i < fcsSize; i += 1) fcs += src[p + i] * 2 ** (8 * i);
    if (fcsSize === 2) fcs += 256;
    p += fcsSize;
    if (!out) out = new Out(Math.min(fcs || 0, 1 << 30) || src.length * 4);
    const st = { rep: [1, 4, 8], huff: null, ll: null, of: null, ml: null };
    for (let last = 0; !last;) {
      const bh = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16);
      p += 3;
      last = bh & 1;
      const type = (bh >> 1) & 3;
      const size = bh >>> 3;
      if (type === 0) { out.write(src.subarray(p, p + size)); p += size; } else if (type === 1) {
        out.room(size); out.buf.fill(src[p], out.n, out.n + size); out.n += size; p += 1;
      } else if (type === 2) { compressedBlock(src, p, p + size, out, st); p += size; } else fail('reserved block type');
    }
    if (checksum) p += 4;
  }
  return out ? out.buf.subarray(0, out.n) : new Uint8Array(0);
}
