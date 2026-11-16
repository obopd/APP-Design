// Study mode: image occlusion, in Anki's own format, so notes made here and in Anki are the
// same. The "Occlusion" field holds one cloze per shape (shapes with the same number are one
// card), e.g. {{c1::image-occlusion:rect:left=.2:top=.3:width=.1:height=.05:oi=1}}.
// Positions are fractions of the picture's size (very old notes used pixels). oi=1 = "hide
// all, guess one": every shape is covered and the one asked is highlighted; otherwise only the
// one asked is covered. Shapes are drawn as plain boxes over the picture (no canvas, no script).
import { h, icon, ICONS } from './util.js';
import { pickImage, fillMedia } from './studymedia.js';

const SHAPE_RE = /\{\{c(\d+)::image-occlusion:([a-z]+)((?::[^:}]*?=[^:}]*)*)\s*(?:::[^}]*)?\}\}/gi;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Shapes in an Occlusion field: [{ n, kind, left, top, width, height, points?, oi, body }]. */
export function parseOcclusions(text) {
  const out = [];
  for (const m of String(text || '').replace(/&nbsp;/g, ' ').matchAll(SHAPE_RE)) {
    const props = {};
    for (const part of m[3].split(':').filter(Boolean)) {
      const i = part.indexOf('=');
      if (i > 0) props[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    const kind = m[2].toLowerCase();
    const body = `${kind}${m[3].replace(/:oi=\d+/g, '')}`; // kept as it was when saved again
    const s = { n: Number(m[1]), kind, oi: props.oi === '1', body, left: num(props.left), top: num(props.top) };
    if (kind === 'rect') { s.width = num(props.width); s.height = num(props.height); }
    else if (kind === 'ellipse') { s.width = num(props.rx) * 2; s.height = num(props.ry) * 2; }
    else if (kind === 'polygon') {
      s.points = String(props.points || '').trim().split(/\s+/).map((p) => p.split(',').map(num)).filter((p) => p.length === 2);
      if (s.points.length < 3) continue;
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      s.left = Math.min(...xs); s.top = Math.min(...ys);
      s.width = Math.max(...xs) - s.left; s.height = Math.max(...ys) - s.top;
    } else continue; // text labels etc.: not covers
    if (!(s.width > 0 && s.height > 0)) continue;
    out.push(s);
  }
  return out;
}

const fix = (v) => String(Number(v.toFixed(4))).replace(/^0\./, '.');
/** The Occlusion field for a list of shapes (new boxes written out; others kept as they were). */
export function occlusionText(shapes, hideAll) {
  const oi = hideAll ? ':oi=1' : '';
  return shapes.map((s) => (s.body
    ? `{{c${s.n}::image-occlusion:${s.body}${oi}}}`
    : `{{c${s.n}::image-occlusion:rect:left=${fix(s.left)}:top=${fix(s.top)}:width=${fix(s.width)}:height=${fix(s.height)}${oi}}}`)).join('<br>');
}

// Old notes measured in pixels: turn them into fractions once the picture's size is known.
function scaled(s, img) {
  const px = [s.left, s.top, s.width, s.height].some((v) => v > 1.001);
  if (!px) return s;
  const w = img.naturalWidth || 1;
  const ht = img.naturalHeight || 1;
  return { ...s, left: s.left / w, top: s.top / ht, width: s.width / w, height: s.height / ht, points: s.points?.map(([x, y]) => [x / w, y / ht]) };
}
const pct = (v) => `${(v * 100).toFixed(3)}%`;
function shapeEl(s, cls) {
  const el = h('div', { class: `io-shape ${cls}${s.kind === 'ellipse' ? ' io-ellipse' : ''}` });
  el.style.left = pct(s.left); el.style.top = pct(s.top); el.style.width = pct(s.width); el.style.height = pct(s.height);
  if (s.kind === 'polygon') {
    el.classList.add('io-polygon');
    el.style.clipPath = `polygon(${s.points.map(([x, y]) => `${(((x - s.left) / s.width) * 100).toFixed(2)}% ${(((y - s.top) / s.height) * 100).toFixed(2)}%`).join(', ')})`;
  }
  return el;
}

// The picture inside a slot, wrapped in a box the shapes are placed in.
function frame(slot) {
  const img = slot.querySelector('img');
  if (!img) return null;
  const box = h('div', { class: 'io-box' });
  img.replaceWith(box);
  box.append(img);
  return { box, img };
}
const whenLoaded = (img, fn) => { if (img.complete && img.naturalWidth) fn(); else img.addEventListener('load', fn, { once: true }); };

/**
 * Cover a rendered image-occlusion card: the card asked (`ord` + 1) is highlighted on the
 * front and uncovered on the back; with "hide all" the others stay covered.
 */
export function paintOcclusion(root, type, note, ord, back) {
  const slot = root.querySelector('.io-slot');
  const field = type.io?.occl || type.fields[0];
  if (!slot) return;
  const f = frame(slot);
  if (!f) return;
  const shapes = parseOcclusions(note.fields?.[field]);
  whenLoaded(f.img, () => {
    for (const s0 of shapes) {
      const s = scaled(s0, f.img);
      const asked = s.n === ord + 1;
      if (asked && back) f.box.append(shapeEl(s, 'io-shown'));
      else if (asked) f.box.append(shapeEl(s, 'io-asked'));
      else if (s.oi) f.box.append(shapeEl(s, 'io-other'));
    }
  });
}

/**
 * The editor for an image-occlusion note: choose a picture, drag to cover parts of it, tap a
 * box to pick it (then delete it). Each box is one card.
 * Returns { el, image (media name | null), field() → Occlusion text, count() }.
 */
export function occlusionEditor({ image = null, text = '' } = {}) {
  let name = image;
  let shapes = parseOcclusions(text);
  let hideAll = shapes.length ? shapes.some((s) => s.oi) : true;
  let picked = null;
  const startN = Math.max(0, ...shapes.map((s) => s.n));
  let nextN = startN + 1;

  const stage = h('div', { class: 'io-stage' });
  const del = h('button', { type: 'button', class: 'fmt-btn io-del', 'aria-label': 'Delete box', disabled: true, onclick: () => {
    if (!picked) return;
    shapes = shapes.filter((s) => s !== picked);
    picked = null;
    paint();
  } }, icon(ICONS.trash));
  const modeBtn = (v, label) => h('button', { type: 'button', role: 'radio', 'data-v': v, onclick: () => { hideAll = v === 'all'; paintMode(); } }, label);
  const mode = h('div', { class: 'segmented io-mode', role: 'radiogroup', 'aria-label': 'Hide' }, modeBtn('all', 'Hide all'), modeBtn('one', 'Hide one'));
  const paintMode = () => mode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.v === 'all') === hideAll)));
  const choose = h('button', { type: 'button', class: 'pill io-pick', 'aria-label': 'Choose picture', onclick: async () => {
    const got = await pickImage();
    if (!got) return;
    name = got;
    shapes = [];
    picked = null;
    nextN = 1;
    paint();
  } }, icon(ICONS.image), h('span', {}, 'Picture'));
  const help = h('p', { class: 'set-note io-help' });

  let img = null;
  const paint = () => {
    del.disabled = !picked;
    help.textContent = !name ? 'Choose a picture, then drag over each part to hide.'
      : shapes.length ? `${shapes.length} box${shapes.length === 1 ? '' : 'es'} · tap one to pick it` : 'Drag over a part of the picture to hide it.';
    if (!name) { stage.replaceChildren(); stage.hidden = true; img = null; return; }
    stage.hidden = false;
    if (!img || img.dataset.media !== name) {
      img = h('img', { class: 'card-img io-img', 'data-media': name, alt: '', draggable: false });
      stage.replaceChildren(h('div', { class: 'io-box' }, img));
      fillMedia(stage);
    }
    const box = stage.firstChild;
    box.querySelectorAll('.io-shape').forEach((el) => el.remove());
    whenLoaded(img, () => {
      box.querySelectorAll('.io-shape').forEach((el) => el.remove());
      for (const s0 of shapes) {
        const el = shapeEl(scaled(s0, img), `io-edit-shape${s0 === picked ? ' picked' : ''}`);
        el.append(h('span', { class: 'io-n' }, String(s0.n)));
        box.append(el);
      }
    });
  };

  // Drag = a new box; a short tap = pick the box under the finger.
  let drag = null;
  const at = (e) => {
    const r = img.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!img || !img.naturalWidth) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    drag = { x, y, id: e.pointerId, el: null };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = at(e);
    const s = { kind: 'rect', left: Math.min(x, drag.x), top: Math.min(y, drag.y), width: Math.abs(x - drag.x), height: Math.abs(y - drag.y) };
    if (!drag.el && s.width < 0.01 && s.height < 0.01) return;
    drag.el?.remove();
    drag.el = shapeEl(s, 'io-edit-shape drawing');
    drag.s = s;
    stage.firstChild.append(drag.el);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.el?.remove();
    if (d.s && d.s.width > 0.01 && d.s.height > 0.01) {
      shapes.push({ ...d.s, n: nextN, oi: hideAll });
      nextN += 1;
      picked = null;
    } else {
      const [x, y] = [d.x, d.y];
      const hit = [...shapes].reverse().find((s0) => {
        const s = scaled(s0, img);
        return x >= s.left && x <= s.left + s.width && y >= s.top && y <= s.top + s.height;
      });
      picked = hit && hit !== picked ? hit : null;
    }
    paint();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', (e) => { if (drag?.el) drag.el.remove(); drag = null; });

  paintMode();
  paint();
  const el = h('div', { class: 'io-edit' }, h('div', { class: 'io-tools' }, choose, mode, del), stage, help);
  return {
    el,
    image: () => name,
    count: () => shapes.length,
    // A new note's boxes are numbered 1, 2, 3… in the order drawn; an existing note keeps its
    // numbers so each card keeps its history.
    field: (isNew) => {
      if (isNew) shapes.forEach((s, i) => { s.n = i + 1; });
      return occlusionText(shapes, hideAll);
    },
  };
}
