// Bottom sheets (<dialog class="sheet">) slide away instead of vanishing, their backdrop
// fades, and they can be dragged down by the grabber / header to close, like iOS sheets.
// Only transform / opacity move. Code keeps calling sheet.close() / showModal() as before.
const CLOSE_MS = 220;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function enhance(sheet) {
  if (sheet.dataset.motion) return;
  sheet.dataset.motion = '1';
  const realClose = sheet.close.bind(sheet);
  const realShow = sheet.showModal.bind(sheet);
  let timer = 0;
  // While sliding away it already counts as closed, so `if (!sheet.open) showModal()` works.
  const openDesc = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'open');
  Object.defineProperty(sheet, 'open', {
    configurable: true,
    get() { return openDesc.get.call(sheet) && !sheet.classList.contains('closing'); },
    set(v) { openDesc.set.call(sheet, v); },
  });
  const finish = (value) => {
    clearTimeout(timer);
    sheet.classList.remove('closing');
    sheet.style.transition = '';
    sheet.style.transform = '';
    realClose(value);
  };

  sheet.close = (value) => {
    if (!sheet.open) return; // (also false while already sliding away)
    if (reduced.matches) { realClose(value); return; }
    sheet.classList.add('closing');
    sheet.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(.4, 0, 1, 1)`;
    sheet.style.transform = 'translateY(100%)';
    timer = setTimeout(() => finish(value), CLOSE_MS);
  };
  // Reopened while still sliding away: finish closing properly (its 'close' listeners run),
  // then open fresh.
  sheet.showModal = () => {
    if (sheet.classList.contains('closing')) finish();
    realShow();
  };

  // Drag down from the grabber or the header (not its buttons).
  let start = null;
  // The click that follows a drag isn't a tap (only right after one).
  let quietUntil = 0;
  sheet.addEventListener('click', (ev) => {
    if (Date.now() < quietUntil) { ev.stopImmediatePropagation(); ev.preventDefault(); }
  }, { capture: true });
  sheet.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.grabber, .sheet-head');
    if (!handle || e.target.closest('button, input, textarea, a') || sheet.scrollTop > 0) return;
    start = { y: e.clientY, t: Date.now(), id: e.pointerId, dy: 0, handle };
    sheet.style.transition = 'none';
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    start.dy = Math.max(0, e.clientY - start.y);
    // Capture on the handle: capturing on the sheet would turn the release into a
    // "backdrop" click, which closes it.
    if (start.dy > 4 && !start.handle.hasPointerCapture(e.pointerId)) start.handle.setPointerCapture(e.pointerId);
    sheet.style.transform = `translateY(${start.dy}px)`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const { dy, t } = start;
    start = null;
    if (dy > 4) quietUntil = Date.now() + 400;
    const flick = dy > 50 && dy / Math.max(1, Date.now() - t) > 0.6;
    if (dy > Math.min(140, sheet.offsetHeight / 3) || flick) {
      sheet.close();
    } else {
      sheet.style.transition = 'transform .25s cubic-bezier(.2, .8, .2, 1)';
      sheet.style.transform = '';
    }
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

export function setupSheets() {
  document.querySelectorAll('dialog.sheet').forEach(enhance);
}
