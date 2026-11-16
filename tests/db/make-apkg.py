# Builds a small Anki package (legacy "Support older Anki versions" format) for the import test.
import json, sqlite3, sys, tempfile, time, zipfile, os
out = sys.argv[1]
d = tempfile.mkdtemp()
db = os.path.join(d, 'collection.anki21')
c = sqlite3.connect(db)
c.executescript('''
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (
    id              integer primary key,   /* 0 */
    guid            text not null,         /* 1 */
    mid             integer not null,      /* 2 */
    mod             integer not null,      /* 3 */
    usn             integer not null,      /* 4 */
    tags            text not null,         /* 5 */
    flds            text not null,         /* 6 */
    sfld            integer not null,      /* 7 */
    csum            integer not null,      /* 8 */
    flags           integer not null,      /* 9 */
    data            text not null          /* 10 */
);
CREATE TABLE cards (
    id              integer primary key,   /* 0 */
    nid             integer not null,      /* 1 */
    did             integer not null,      /* 2 */
    ord             integer not null,      /* 3 */
    mod             integer not null,      /* 4 */
    usn             integer not null,      /* 5 */
    type            integer not null,      /* 6 */
    queue           integer not null,      /* 7 */
    due             integer not null,      /* 8 */
    ivl             integer not null,      /* 9 */
    factor          integer not null,      /* 10 */
    reps            integer not null,      /* 11 */
    lapses          integer not null,      /* 12 */
    left            integer not null,      /* 13 */
    odue            integer not null,      /* 14 */
    odid            integer not null,      /* 15 */
    flags           integer not null,      /* 16 */
    data            text not null          /* 17 */
);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
''')
now = int(time.time())
crt = now - 100 * 86400
models = {
  '111': {'name': 'Basic', 'type': 0, 'flds': [{'name': 'Front', 'ord': 0}, {'name': 'Back', 'ord': 1}],
          'tmpls': [{'name': 'Card 1', 'ord': 0, 'qfmt': '{{Front}}', 'afmt': '{{FrontSide}}<hr id=answer>{{Back}}'}], 'css': ''},
  '222': {'name': 'Cloze', 'type': 1, 'flds': [{'name': 'Text', 'ord': 0}, {'name': 'Extra', 'ord': 1}],
          'tmpls': [{'name': 'Cloze', 'ord': 0, 'qfmt': '{{cloze:Text}}', 'afmt': '{{cloze:Text}}<br>{{Extra}}'}], 'css': ''},
}
decks = {'1': {'name': 'Default', 'dyn': 0, 'conf': 1}, '50': {'name': 'Languages\x1fFrench', 'dyn': 0, 'conf': 7}}
dconf = {'1': {'name': 'Default', 'new': {'perDay': 20, 'delays': [1, 10], 'ints': [1, 4], 'initialFactor': 2500},
               'rev': {'perDay': 200, 'ease4': 1.3, 'maxIvl': 36500}, 'lapse': {'delays': [10], 'leechFails': 8, 'leechAction': 0}},
         '7': {'name': 'Languages', 'new': {'perDay': 15, 'delays': [2, 15], 'ints': [1, 4], 'initialFactor': 2500},
               'rev': {'perDay': 150, 'ease4': 1.3, 'maxIvl': 36500}, 'lapse': {'delays': [5], 'leechFails': 6, 'leechAction': 1}}}
c.execute('insert into col values (1,?,?,?,11,0,0,0,?,?,?,?,?)', (crt, now, now, '{}', json.dumps(models), json.dumps(decks), json.dumps(dconf), '{}'))
c.execute("insert into notes values (1001,'g1',111,?,0,' verb french ',?,'chien',0,0,'')", (now, 'chien\x1f<b>dog</b>'))
c.execute("insert into notes values (1002,'g2',111,?,0,'',?,'chat',0,0,'')", (now, 'chat<img src=\"cat%20pic.png\">\x1fcat [sound:meow.mp3]'))
c.execute("insert into notes values (1003,'g3',222,?,0,'',?,'x',0,0,'')", (now, 'Paris is the {{c1::capital}} of {{c2::France}}\x1fgeo'))
# review card due today, a new card, a suspended card, two cloze cards
c.execute("insert into cards values (2001,1001,50,0,?,0,2,2,?,10,2500,5,1,0,0,0,1,'')", (now, 100))
c.execute("insert into cards values (2002,1002,50,0,?,0,0,0,7,0,0,0,0,0,0,0,0,'')", (now,))
c.execute("insert into cards values (2003,1003,1,0,?,0,2,-1,?,30,2300,8,0,0,0,0,0,'{\"s\":31.5,\"d\":6.2}')", (now, 120))
c.execute("insert into cards values (2004,1003,1,1,?,0,0,0,8,0,0,0,0,0,0,0,0,'')", (now,))
for i, (cid, ease) in enumerate([(2001, 3), (2001, 3), (2001, 1), (2003, 4)]):
    c.execute('insert into revlog values (?,?,0,?,?,?,2500,5000,?)', ((now - (10 - i) * 86400) * 1000, cid, ease, 5, 1, 1))
c.commit(); c.close()
import struct, zlib
def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(db, 'collection.anki21')
    z.writestr('media', json.dumps({'0': 'cat pic.png', '1': 'meow.mp3', '2': 'unused.png'}))
    z.writestr('0', png(24, 16, (200, 40, 40)))
    z.writestr('1', b'ID3fake-mp3-bytes')
    z.writestr('2', png(4, 4, (0, 0, 0)))
print(out)
