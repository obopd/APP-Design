# Builds tests/db/new-format.apkg: an Anki 2.1.50+ style package (collection.anki21b =
# zstd-compressed schema-18 database with protobuf settings, plus the "please update"
# placeholder collection.anki2). Needs the "zstandard" Python module; the .apkg is committed.
import os, sqlite3, struct, sys, tempfile, time, zipfile
import zstandard

def varint(n):
    out = b''
    while True:
        b = n & 0x7f; n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n: return out
def fv(f, n): return varint(f << 3) + varint(n)
def fb(f, data): data = data.encode() if isinstance(data, str) else data; return varint(f << 3 | 2) + varint(len(data)) + data
def packed_floats(f, vals): return fb(f, b''.join(struct.pack('<f', v) for v in vals))

d = tempfile.mkdtemp()
path = os.path.join(d, 'c.db')
c = sqlite3.connect(path)
c.executescript('''
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table notetypes (id integer not null primary key, name text not null, mtime_secs integer not null, usn integer not null, config blob not null);
create table fields (ntid integer not null, ord integer not null, name text not null, config blob not null, primary key (ntid, ord)) without rowid;
create table templates (ntid integer not null, ord integer not null, name text not null, mtime_secs integer not null, usn integer not null,
  config blob not null, primary key (ntid, ord)) without rowid;
create table decks (id integer primary key not null, name text not null, mtime_secs integer not null, usn integer not null, common blob not null, kind blob not null);
create table deck_config (id integer primary key not null, name text not null, mtime_secs integer not null, usn integer not null, config blob not null);
''')
now = int(time.time()); crt = now - 200 * 86400
c.execute("insert into col values (1,?,?,?,18,0,0,0,'','','','','')", (crt, now, now))
# Note types: "MCAT Basic" (2 fields, 1 template) and "MCAT Cloze" (cloze)
c.execute('insert into notetypes values (?,?,?,0,?)', (900, 'MCAT Basic', now, fv(1, 0) + fb(3, '.card{}')))
c.execute('insert into notetypes values (?,?,?,0,?)', (901, 'MCAT Cloze', now, fv(1, 1)))
for ntid, ord_, name in [(900, 0, 'Front'), (900, 1, 'Back'), (901, 0, 'Text'), (901, 1, 'Extra')]:
    c.execute('insert into fields values (?,?,?,?)', (ntid, ord_, name, b''))
c.execute('insert into templates values (900,0,?,?,0,?)', ('Card 1', now, fb(1, '{{Front}}') + fb(2, '{{FrontSide}}<hr id=answer>{{Back}}')))
c.execute('insert into templates values (901,0,?,?,0,?)', ('Cloze', now, fb(1, '{{cloze:Text}}') + fb(2, '{{cloze:Text}}<br>{{Extra}}')))
# Decks (names use \x1f between levels) + one option group
c.execute("insert into decks values (1,'Default',?,0,x'',?)", (now, fb(1, fv(1, 1))))
c.execute("insert into decks values (77,?,?,0,x'',?)", ('MCAT\x1fBiology', now, fb(1, fv(1, 5))))
c.execute('insert into deck_config values (5,?,?,0,?)', ('MCAT', now, packed_floats(1, [1.0, 10.0, 60.0]) + packed_floats(2, [10.0]) + fv(9, 30) + fv(10, 300)))
# Notes + cards (one review card with FSRS memory, one new, two cloze)
words = [('Mitochondria <img src="mito.png">', 'Powerhouse of the <b>cell</b>'), ('Ribosome', 'Makes proteins')]
for i, (f, b) in enumerate(words):
    c.execute("insert into notes values (?,?,900,?,0,' bio ',?,?,0,0,'')", (5001 + i, f'g{i}', now, f + '\x1f' + b, f))
c.execute("insert into notes values (5009,'gz',901,?,0,'',?,'x',0,0,'')", (now, 'ATP is made by {{c1::ATP synthase}} in the {{c2::inner membrane}}\x1fbio'))
c.execute("insert into cards values (6001,5001,77,0,?,0,2,2,?,21,2500,6,0,0,0,0,0,?)", (now, 201, '{"s":24.2,"d":4.8}'))
c.execute("insert into cards values (6002,5002,77,0,?,0,0,0,3,0,0,0,0,0,0,0,0,'')", (now,))
c.execute("insert into cards values (6003,5009,77,0,?,0,0,0,4,0,0,0,0,0,0,0,0,'')", (now,))
c.execute("insert into cards values (6004,5009,77,1,?,0,0,-1,5,0,0,0,0,0,0,0,0,'')", (now,))
c.execute('insert into revlog values (?,6001,0,3,21,8,2500,7000,1)', ((now - 21 * 86400) * 1000,))
c.commit(); c.close()
# Placeholder old-format collection (what newer packages put next to the real one)
stub = os.path.join(d, 'stub.db')
s = sqlite3.connect(stub)
s.execute('create table col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text)')
s.execute('''insert into col values (1,0,0,0,11,0,0,0,'{}','{"1":{"name":"Basic","type":0,"flds":[{"name":"Front","ord":0}],"tmpls":[{"name":"Card 1","ord":0,"qfmt":"{{Front}}","afmt":"{{Front}}"}]}}','{"1":{"name":"Default","dyn":0,"conf":1}}','{}','{}')''')
s.execute('create table notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text)')
s.execute("insert into notes values (1,'x',1,0,0,'','Please update to the latest Anki version, then import the .colpkg/.apkg file again.','',0,0,'')")
s.commit(); s.close()
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'new-format.apkg')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    z.writestr('collection.anki2', open(stub, 'rb').read())
    z.writestr('collection.anki21b', zstandard.ZstdCompressor(level=3).compress(open(path, 'rb').read()))
    import zlib
    def png(w, h, rgb):
        raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
        chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    img = png(30, 20, (40, 120, 220))
    # MediaEntries { repeated MediaEntry entries = 1 } ; MediaEntry { name = 1, size = 2, sha1 = 3 }
    import hashlib
    entries = [fb(1, 'mito.png') + fv(2, len(img)) + fb(3, hashlib.sha1(img).digest()), fb(1, 'other.png') + fv(2, 3)]
    z.writestr('media', zstandard.ZstdCompressor().compress(b''.join(fb(1, e) for e in entries)))
    z.writestr('meta', b'\x08\x03')
    z.writestr('0', zstandard.ZstdCompressor().compress(img))
    z.writestr('1', os.urandom(200_000))  # a big file no card uses (not imported)
print(out, os.path.getsize(out))
