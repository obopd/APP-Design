// Film mode "Preview" tab: Concept (illustrations / reference images to visualize the film)
// and Result (the finished film's YouTube link, played right in the app).
//
// Images are shrunk on the phone (≈1600px JPEG + a small thumbnail) and uploaded to the
// private Storage bucket "concepts" under <project id>/ — only project members can read
// or change them (supabase/film.sql). Each image's details are a project item (kind
// 'concept'); the result is one item (kind 'result', id 'result').
import { h, icon, ICONS } from './util.js';
import { cur, save, uid } from './store.js';
import { ask, tell, askText } from './ui.js';
import { currentProject, filmStatus, needsSetup } from './film.js';
import { uploadFile, signFiles, removeFiles, onCloudChange, currentUser } from './cloud.js';

const BUCKET = 'concepts';
const SECTIONS = [['concept', 'Concept'], ['result', 'Result']];
let section = localStorage.getItem('planner.previewsection') === 'result' ? 'result' : 'concept';
let root = null;
let shownSig = '';
let uploading = []; // { id, url } tiles shown while their images upload

const org = (kind) => cur().org?.[kind] || [];
// Order: the one set by the viewer's arrows, else when added.
const rank = (x) => x.order ?? x.created ?? 0;
const concepts = () => [...org('concept')].sort((a, b) => rank(a) - rank(b));

/* ---------- Signed links to private images (cached so the browser cache can be reused) ---------- */

const URL_KEY = 'planner.previewurls';
// Short-lived, so someone removed from a project soon can't open its images any more.
const SIGN_SECONDS = 2 * 3600;
let urls = (() => { try { return JSON.parse(localStorage.getItem(URL_KEY)) || {}; } catch { return {}; } })();
const freshUrl = (path) => { const u = urls[path]; return u && u[1] - Date.now() > 15 * 60_000 ? u[0] : null; };
let signing = null;
const wanted = new Set();

onCloudChange(() => { if (!currentUser()) { localStorage.removeItem(URL_KEY); urls = {}; imgs.clear(); } });

function needUrl(path) {
  wanted.add(path);
  signing ||= Promise.resolve().then(async () => {
    const paths = [...wanted];
    wanted.clear();
    try {
      const got = await signFiles(BUCKET, paths, SIGN_SECONDS);
      const exp = Date.now() + SIGN_SECONDS * 1000;
      Object.entries(got).forEach(([p, u]) => { urls[p] = [u, exp]; });
      Object.keys(urls).forEach((p) => { if (urls[p][1] < Date.now()) delete urls[p]; });
      try { localStorage.setItem(URL_KEY, JSON.stringify(urls)); } catch { /* storage full */ }
      Object.keys(got).forEach((p) => { const img = imgs.get(p); if (img && !img.src) img.src = got[p]; });
    } catch { /* offline: images fill in next time */ }
    signing = null;
    if (wanted.size) needUrl([...wanted][0]);
  });
}

// One <img> per file, reused across redraws so pictures never flash.
const imgs = new Map();
function imageFor(path, cls = '') {
  let img = imgs.get(path);
  if (!img) {
    img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
    imgs.set(path, img);
  }
  img.className = cls;
  if (!img.src) { const u = freshUrl(path); if (u) img.src = u; else needUrl(path); }
  return img;
}

/* ---------- Adding images ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image the phone can open.')); };
    img.src = url;
  });
}
function shrink(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const ht = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = h('canvas', { width: w, height: ht });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent drawings get a white page, not black
  ctx.fillRect(0, 0, w, ht);
  ctx.drawImage(img, 0, 0, w, ht);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that image.'))), 'image/jpeg', quality));
}

const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
document.body.append(picker);
picker.addEventListener('change', () => {
  const files = [...picker.files];
  picker.value = '';
  files.forEach(addImage);
});

async function addImage(file) {
  const p = currentProject();
  if (!p) return;
  const id = uid();
  const tile = { id, url: '' };
  uploading.push(tile);
  redraw();
  try {
    const { img, url } = await loadImage(file);
    tile.url = url;
    redraw();
    const [full, thumb] = await Promise.all([shrink(img, 1600, 0.82), shrink(img, 480, 0.74)]);
    const path = `${p.id}/${id}.jpg`;
    const thumbPath = `${p.id}/${id}_t.jpg`;
    await uploadFile(BUCKET, thumbPath, thumb);
    // If the big one fails, don't leave the small one behind in storage.
    await uploadFile(BUCKET, path, full).catch((e) => { removeFiles(BUCKET, [thumbPath]).catch(() => {}); throw e; });
    // Show the picture from the phone right away (no download needed).
    imgs.set(thumbPath, h('img', { alt: '', decoding: 'async', draggable: 'false', src: URL.createObjectURL(thumb) }));
    imgs.set(path, h('img', { alt: '', decoding: 'async', draggable: 'false', src: URL.createObjectURL(full) }));
    if (currentProject()?.id === p.id && cur().org) {
      const last = concepts().at(-1);
      cur().org.concept.push({ id, path, thumb: thumbPath, caption: '', w: img.naturalWidth, h: img.naturalHeight, created: Date.now(), order: Math.max(Date.now(), last ? rank(last) + 1 : 0) });
    }
    uploading = uploading.filter((t) => t !== tile);
    save();
  } catch (e) {
    uploading = uploading.filter((t) => t !== tile);
    redraw();
    tell('Couldn’t add the image', /bucket/i.test(e.message || '') ? 'Run the Preview setup step in Supabase first.' : e.message);
  } finally {
    if (tile.url) URL.revokeObjectURL(tile.url);
  }
}

async function removeConcept(item) {
  if (!await ask({ title: 'Delete this image?', message: 'It’s removed for everyone in the project.', ok: 'Delete', danger: true })) return false;
  cur().org.concept = cur().org.concept.filter((x) => x !== item);
  save();
  removeFiles(BUCKET, [item.path, item.thumb].filter(Boolean)).catch(() => {});
  return true;
}

/* ---------- Full-screen viewer (swipe sideways = next, down = close) ---------- */

const viewer = h('dialog', { class: 'pv-viewer', 'aria-label': 'Concept image' });
document.body.append(viewer);
let viewing = null; // id of the image shown

function openViewer(id) {
  viewing = id;
  drawViewer();
  if (!viewer.open) viewer.showModal();
}
function closeViewer() {
  viewer.classList.add('closing');
  setTimeout(() => { viewer.classList.remove('closing'); viewer.close(); viewing = null; viewer.replaceChildren(); }, 180);
}
viewer.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });

function drawViewer(dir = 0) {
  const list = concepts();
  const i = list.findIndex((x) => x.id === viewing);
  if (i < 0) { if (viewer.open) closeViewer(); return; }
  const item = list[i];
  const full = imageFor(item.path, 'pv-full');
  // The grid keeps its own thumbnail; a copy (same link, already loaded) shows until the full image arrives.
  const small = imageFor(item.thumb).src;
  const stage = h('div', { class: `pv-stage${dir ? (dir > 0 ? ' from-right' : ' from-left') : ''}` },
    small ? h('img', { class: 'pv-full pv-under', src: small, alt: '', draggable: 'false' }) : null, full);
  const caption = h('button', { type: 'button', class: `pv-caption${item.caption ? '' : ' empty'}`, onclick: editCaption }, item.caption || 'Add caption');
  async function editCaption() {
    const v = await askText({ title: 'Caption', value: item.caption || '', placeholder: 'Scene 3 — the bus stop at dawn', ok: 'Save' });
    if (v === null) return;
    item.caption = v.trim();
    save();
  }
  viewer.replaceChildren(
    h('div', { class: 'pv-bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closeViewer }, icon(ICONS.close)),
      h('span', { class: 'pv-move' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => move(-1) }, icon(ICONS.left)),
        h('span', { class: 'pv-count' }, `${i + 1} / ${list.length}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move later', disabled: i === list.length - 1, onclick: () => move(1) }, icon(ICONS.right))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete image', onclick: async () => { if (await removeConcept(item)) closeViewer(); } }, icon(ICONS.trash))),
    stage,
    h('div', { class: 'pv-foot' }, caption));
  swipe(stage, list, i);

  // Swap places with the neighbour (numbers everything once, so older images get an order too).
  function move(step) {
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    list.forEach((x, k) => { if (x.order !== k) x.order = k; });
    [list[i].order, list[j].order] = [j, i];
    save();
  }
}

function swipe(stage, list, i) {
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let axis = '';
  let id = null;
  const go = (step) => {
    const next = list[i + step];
    if (!next) { stage.style.transition = 'transform .25s ease'; stage.style.transform = ''; return; }
    stage.style.transition = 'transform .2s ease-in, opacity .2s';
    stage.style.transform = `translateX(${step > 0 ? -100 : 100}%)`;
    stage.style.opacity = '0';
    setTimeout(() => { viewing = next.id; drawViewer(step); }, 180);
  };
  stage.addEventListener('pointerdown', (e) => { id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); axis = ''; stage.style.transition = 'none'; });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (!axis && Math.hypot(dx, dy) > 8) { axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; stage.setPointerCapture(id); }
    if (axis === 'x') stage.style.transform = `translateX(${dx}px)`;
    if (axis === 'y' && dy > 0) { stage.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 300) / 1500})`; viewer.style.setProperty('--dim', String(1 - Math.min(dy, 300) / 400)); }
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    const fast = Date.now() - t0 < 250;
    viewer.style.removeProperty('--dim');
    if (axis === 'x' && (Math.abs(dx) > window.innerWidth / 4 || (fast && Math.abs(dx) > 30))) go(dx < 0 ? 1 : -1);
    else if (axis === 'y' && (dy > 110 || (fast && dy > 40))) closeViewer();
    else { stage.style.transition = 'transform .25s ease'; stage.style.transform = ''; }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

/* ---------- Result: one YouTube video ---------- */

/** YouTube video id (+ start seconds) from any usual link, or null. */
export function parseYouTube(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s, start: 0 };
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.split('/')[1] || '';
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1] || '';
  }
  if (!/^[\w-]{11}$/.test(id)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  return { id, start };
}

const resultItem = () => org('result').find((x) => x.id === 'result') || null;

async function setResult() {
  const cur0 = resultItem();
  let message = 'Paste the YouTube link of the finished film.';
  let value = cur0?.url || '';
  for (;;) {
    const v = await askText({ title: 'Result', message, value, placeholder: 'https://youtu.be/…', inputmode: 'url', ok: 'Save' });
    if (v === null) return;
    if (!v.trim()) { message = 'Paste a YouTube link.'; continue; }
    const yt = parseYouTube(v);
    if (!yt) { message = 'That doesn’t look like a YouTube link.'; value = v; continue; }
    const item = resultItem();
    const next = { url: v.trim(), video: yt.id, start: yt.start, set: Date.now() };
    if (item) Object.assign(item, next);
    else cur().org.result.push({ id: 'result', ...next });
    playing = false;
    save();
    return;
  }
}

async function clearResult() {
  if (!await ask({ title: 'Remove the result video?', message: 'Only the link is removed — the video stays on YouTube.', ok: 'Remove', danger: true })) return;
  cur().org.result = cur().org.result.filter((x) => x.id !== 'result');
  playing = false;
  save();
}

let playing = false;
function thumbFor(id) {
  // maxres isn't made for every video: YouTube then sends a 120px placeholder.
  const img = h('img', { class: 'pv-thumb', alt: '', src: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` });
  const fallback = () => { if (!img.src.includes('hqdefault')) img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; };
  img.onerror = fallback;
  img.onload = () => { if (img.naturalWidth <= 120) fallback(); };
  return img;
}

function resultView() {
  const r = resultItem();
  if (!r?.video) {
    return h('div', { class: 'pv-result' },
      h('button', { type: 'button', class: 'pv-player pv-empty', onclick: setResult },
        h('span', { class: 'pv-play' }, icon(ICONS.play)),
        h('span', {}, 'Add YouTube link')));
  }
  const box = h('div', { class: 'pv-player' });
  const play = () => {
    playing = true;
    const src = `https://www.youtube-nocookie.com/embed/${r.video}?autoplay=1&playsinline=1&rel=0${r.start ? `&start=${r.start}` : ''}`;
    box.replaceChildren(h('iframe', {
      src, title: 'Result video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
    }));
  };
  if (playing) play();
  else {
    box.append(thumbFor(r.video), h('button', { type: 'button', class: 'pv-play-btn', 'aria-label': 'Play', onclick: play }, h('span', { class: 'pv-play' }, icon(ICONS.play))));
  }
  return h('div', { class: 'pv-result' }, box,
    h('div', { class: 'pv-result-tools' },
      h('a', { class: 'pv-yt', href: `https://www.youtube.com/watch?v=${r.video}${r.start ? `&t=${r.start}s` : ''}`, target: '_blank', rel: 'noopener' }, icon(ICONS.link), 'YouTube'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'pill', onclick: setResult }, 'Change'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove video', onclick: clearResult }, icon(ICONS.trash))));
}

/* ---------- Concept grid ---------- */

function conceptView() {
  const list = concepts();
  if (!list.length && !uploading.length) {
    return h('div', { class: 'pv-body' },
      h('button', { type: 'button', class: 'pv-add-empty', onclick: () => picker.click() },
        icon(ICONS.plus), h('span', {}, 'Add concept art, storyboards or reference shots')));
  }
  return h('div', { class: 'pv-body' }, h('div', { class: 'pv-grid' },
    list.map((x) => h('button', { type: 'button', class: 'pv-tile', 'aria-label': x.caption || 'Concept image', onclick: () => openViewer(x.id) },
      h('span', { class: 'pv-frame' }, imageFor(x.thumb)),
      x.caption ? h('span', { class: 'pv-cap' }, x.caption) : null)),
    uploading.map((t) => h('div', { class: 'pv-tile loading', 'aria-label': 'Uploading' },
      h('span', { class: 'pv-frame' }, t.url ? h('img', { src: t.url, alt: '' }) : null, h('span', { class: 'pv-spin' }))))));
}

/* ---------- Page ---------- */

// JSON with sorted keys: the database hands objects back with their keys reordered.
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function redraw() { if (root && !root.hidden) renderPreview(root); }

export function renderPreview(el) {
  root = el;
  const p = currentProject();
  if (!p || !cur().org) {
    shownSig = '';
    playing = false;
    el.replaceChildren(h('div', { class: 'settings preview-page' }, h('h1', { class: 'display' }, 'Preview'),
      h('p', { class: 'set-note' }, filmStatus() === 'missing' ? 'Film mode isn’t set up yet.' : 'Choose or create a project: tap the slate on the Calendar.')));
    return;
  }
  // Skip redraws that change nothing here (a refresh would otherwise restart a playing video).
  const sig = stable([p.id, p.name, section, needsSetup(['concept', 'result']),
    section === 'concept' ? [concepts(), uploading.map((t) => [t.id, !!t.url])] : resultItem()]);
  if (sig === shownSig && el.firstChild) return;
  shownSig = sig;
  const prevScroll = el.querySelector('.preview-page')?.scrollTop || 0;
  el.replaceChildren(h('div', { class: `settings preview-page ${section}` },
    h('div', { class: 'page-sticky' },
      h('div', { class: 'page-head' },
        h('h1', { class: 'display org-project' }, p.name),
        section === 'concept' ? h('button', { class: 'icon-btn page-add', 'aria-label': 'Add images', onclick: () => picker.click() }, icon(ICONS.plus)) : null),
      h('div', { class: 'segmented pv-tabs', role: 'radiogroup' }, SECTIONS.map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(k === section),
        onclick: () => {
          if (k === section) return;
          section = k;
          playing = false;
          localStorage.setItem('planner.previewsection', k);
          renderPreview(el);
        },
      }, label)))),
    needsSetup(['concept', 'result']) ? h('p', { class: 'write-banner' }, 'Not saved to the project yet: run the Preview setup step in Supabase.') : null,
    section === 'concept' ? conceptView() : resultView()));
  const page = el.querySelector('.preview-page');
  if (page && prevScroll) page.scrollTop = prevScroll;
  if (viewer.open && viewing) drawViewer();
}

/** Leaving the tab stops the video. */
export function leavePreview() {
  if (!playing) return;
  playing = false;
  shownSig = '';
  root?.querySelector('.pv-player iframe')?.remove(); // a hidden tab would keep playing
}
