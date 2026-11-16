// Study mode's images, sounds and videos (from Anki decks or added to a card).
//
// Each file is kept on the phone (IndexedDB "media" store) so cards show it at once and
// offline, and uploaded to the account's private Storage bucket `study-media`
// (supabase/study.sql: `<user id>/<sha-256 of the name>.<ext>`, only its owner can read it),
// so other devices download it the first time a card needs it.
// Cards refer to files by name, like Anki: <img src="name.jpg"> and [sound:name.mp3].
import { h, icon, ICONS } from './util.js';
import { currentUser, isConfigured, uploadFile, signFiles } from './cloud.js';
import { mediaGet, mediaPut, mediaPending, studyStatus } from './study.js';

const BUCKET = 'study-media';
const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', heic: 'image/heic', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm',
};
const ext = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const typeOf = (name) => TYPES[ext(name)] || 'application/octet-stream';
export const isVideo = (name) => typeOf(name).startsWith('video/');

const urls = new Map();     // name → object URL (this session)
const waiting = new Map();  // name → Promise<url | null>
const listeners = new Set();
let upload = { done: 0, total: 0, running: false };
export const uploadState = () => upload;
export const onMediaChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

async function keyOf(name) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${currentUser().id}/${hex}${ext(name) ? `.${ext(name)}` : ''}`;
}

/** Save files on the phone ([{ name, blob }]); they upload in the background. */
export async function saveMedia(list) {
  const recs = list.map(({ name, blob }) => ({ name, blob: blob.type ? blob : new Blob([blob], { type: typeOf(name) }), uploaded: false }));
  await mediaPut(recs);
  recs.forEach((r) => { if (urls.has(r.name)) { URL.revokeObjectURL(urls.get(r.name)); urls.delete(r.name); } });
  uploadMedia();
}

// Not on the phone yet: ask the account for it (other device) and keep it here.
async function download(name) {
  if (!isConfigured() || !currentUser()) return null;
  try {
    const key = await keyOf(name);
    const signed = await signFiles(BUCKET, [key], 600);
    if (!signed[key]) return null;
    const res = await fetch(signed[key]);
    if (!res.ok) return null;
    const blob = new Blob([await res.arrayBuffer()], { type: typeOf(name) });
    await mediaPut([{ name, blob, uploaded: true }]);
    return blob;
  } catch { return null; }
}

/** An object URL for a media file, or null when it's nowhere to be found. */
export function mediaUrl(name) {
  if (urls.has(name)) return Promise.resolve(urls.get(name));
  if (waiting.has(name)) return waiting.get(name);
  const p = (async () => {
    const rec = await mediaGet(name);
    const blob = rec?.blob || await download(name);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(name, url);
    return url;
  })().finally(() => waiting.delete(name));
  waiting.set(name, p);
  return p;
}

/**
 * Fill a rendered card (or field editor): images get their pictures, sounds and videos get
 * players. `autoplay`: true = play the first sound, or a name = play that one (like Anki when
 * a card side appears).
 */
export function fillMedia(root, { autoplay = false } = {}) {
  let first = true;
  root.querySelectorAll('img[data-media]').forEach((img) => {
    if (img.src) return;
    img.classList.add('loading');
    mediaUrl(img.dataset.media).then((url) => {
      img.classList.remove('loading');
      if (url) img.src = url; else img.classList.add('missing');
    });
  });
  root.querySelectorAll('.snd[data-media]').forEach((slot) => {
    if (slot.childNodes.length) return;
    const name = slot.dataset.media;
    if (isVideo(name)) {
      const v = h('video', { class: 'card-video', controls: true, playsinline: true, preload: 'metadata' });
      slot.append(v);
      mediaUrl(name).then((url) => { if (url) v.src = url; });
      return;
    }
    const audio = new Audio();
    const btn = h('button', { type: 'button', class: 'snd-btn', 'aria-label': 'Play sound', onclick: (e) => {
      e.stopPropagation();
      mediaUrl(name).then((url) => { if (!url) return; if (audio.src !== url) audio.src = url; audio.currentTime = 0; audio.play().catch(() => {}); });
    } }, icon(ICONS.play));
    slot.append(btn);
    const auto = typeof autoplay === 'string' ? autoplay === name : autoplay && first;
    if (auto) { first = false; mediaUrl(name).then((url) => { if (url) { audio.src = url; audio.play().catch(() => {}); } }); }
  });
}

/** Upload files waiting on this phone (a few at a time; resumes on the next open). */
export async function uploadMedia() {
  if (upload.running || !isConfigured() || !currentUser() || studyStatus() === 'missing') return;
  const names = await mediaPending();
  if (!names.length) return;
  upload = { done: 0, total: names.length, running: true };
  notify();
  let stop = false;
  const next = async () => {
    while (!stop && names.length) {
      const name = names.shift();
      const rec = await mediaGet(name);
      if (!rec) continue;
      try {
        await uploadFile(BUCKET, await keyOf(name), rec.blob);
        await mediaPut([{ ...rec, uploaded: true }]);
      } catch (e) {
        if (e.status === 400 || e.status === 404) { stop = true; break; } // bucket not set up
        if (navigator.onLine === false) { stop = true; break; }
      }
      upload.done += 1;
      if (upload.done % 10 === 0 || !names.length) notify();
    }
  };
  await Promise.all([next(), next(), next()]);
  upload = { done: 0, total: 0, running: false };
  notify();
}

/** Pick a photo for a card: shrunk on the phone (≤1600px JPEG) and saved as media. */
export function pickImage() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      try {
        const url = URL.createObjectURL(file);
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const ht = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = h('canvas', { width: w, height: ht });
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, ht);
        ctx.drawImage(img, 0, 0, w, ht);
        URL.revokeObjectURL(url);
        const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
        const name = `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        await saveMedia([{ name, blob }]);
        resolve(name);
      } catch { resolve(null); }
    });
    input.click();
  });
}

window.addEventListener('online', () => uploadMedia());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') uploadMedia(); });
