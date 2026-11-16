// Full-screen viewer: one work at a time filling the window, with zoom to actual pixels,
// panning, and stepping through the works in view.

const PAD = 28; // breathing room around a fitted work, in CSS pixels
const IDLE_MS = 2400; // controls fade after this long without the mouse moving

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ic = {
  close: svg('M6 6l12 12M18 6 6 18'),
  prev: svg('M15 6l-6 6 6 6'),
  next: svg('M9 6l6 6-6 6'),
  zoomIn: svg('M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8M10.5 8v5M8 10.5h5'),
  zoomOut: svg('M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8M8 10.5h5'),
  enterFs: svg('M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5'),
  exitFs: svg('M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5'),
  printer: svg('M7 9V4h10v5M5 9h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM7 14h10v6H7z'),
};

// ---------- Geometry (pure, so it can be tested) ----------

// Scale that fits a w×h work inside a vw×vh stage, padding included. Small works are
// enlarged to fill the screen too; "actual size" is one click away.
export function fitScale(w, h, vw, vh, pad = PAD) {
  if (!w || !h) return 1;
  return Math.max(0.01, Math.min((vw - pad * 2) / w, (vh - pad * 2) / h));
}

export const maxScale = (fit) => Math.max(4, fit * 4);

// Where a click on a fitted work zooms to: actual pixels, or further when the work
// is already shown that large.
export const zoomTarget = (fit) => (fit < 0.9 ? 1 : fit * 2.5);

// Keeps a zoomed work covering the stage: no panning past its edges, and centred on
// any axis where it is smaller than the stage. x and y offset the work's centre from the stage's.
export function clampPan(v, w, h, vw, vh) {
  const mx = Math.max(0, (w * v.s - vw) / 2);
  const my = Math.max(0, (h * v.s - vh) / 2);
  return { s: v.s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

// Changes the scale while keeping the point (px, py), measured from the stage centre, still.
export function zoomAround(v, s, px, py) {
  const k = s / v.s;
  return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

// ---------- The viewer ----------

let current = null; // the open viewer, if any

export const viewerOpen = () => Boolean(current);
export const viewerArtwork = () => current?.art()?.id ?? null;
export const closeViewer = () => current?.close();

// list: the works to step through, in order. Each needs width/height and display or thumb.
export function openViewer(list, startId, { plate = () => '', onPrint = null, onClose = null } = {}) {
  closeViewer();
  let index = Math.max(0, list.findIndex((a) => a.id === startId));
  let view = { s: 1, x: 0, y: 0 };
  let fit = 1;
  let size = { w: 1, h: 1 };
  let drag = null;
  let idleTimer = 0;
  let loadToken = 0;
  const returnFocus = document.activeElement;

  const el = document.createElement('div');
  el.className = 'viewer';
  el.tabIndex = -1;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Full-screen view');
  el.innerHTML = `
    <div class="viewer-stage"><img class="viewer-img" alt="" draggable="false"><p class="viewer-missing" hidden>No preview</p></div>
    <div class="viewer-top viewer-ui">
      <span class="viewer-count"></span>
      <div class="spacer"></div>
      <button class="viewer-zoom" data-act="fit" type="button" title="Fit to screen (0)"></button>
      <button class="icon-btn" data-act="out" type="button" title="Zoom out (−)">${ic.zoomOut}</button>
      <button class="icon-btn" data-act="in" type="button" title="Zoom in (+)">${ic.zoomIn}</button>
      <button class="icon-btn" data-act="fullscreen" type="button" title="Full screen (F)">${ic.enterFs}</button>
      ${onPrint ? `<button class="icon-btn" data-act="print" type="button" title="Print this artwork (⌘P)">${ic.printer}</button>` : ''}
      <button class="icon-btn" data-act="close" type="button" title="Close (Esc)">${ic.close}</button>
    </div>
    <button class="viewer-nav prev viewer-ui" data-act="prev" type="button" title="Previous (←)">${ic.prev}</button>
    <button class="viewer-nav next viewer-ui" data-act="next" type="button" title="Next (→)">${ic.next}</button>
    <div class="viewer-caption viewer-ui"><span class="plate"></span><span class="title"></span><span class="meta"></span></div>`;
  const q = (s) => el.querySelector(s);
  const stage = q('.viewer-stage');
  const img = q('.viewer-img');

  const art = () => list[index];
  const stageSize = () => ({ vw: stage.clientWidth, vh: stage.clientHeight });
  const isZoomed = () => view.s > fit * 1.001;

  function apply(animate = false) {
    const { vw, vh } = stageSize();
    view = clampPan(view, size.w, size.h, vw, vh);
    img.classList.toggle('animate', animate);
    img.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    el.classList.toggle('zoomed', isZoomed());
    q('.viewer-zoom').textContent = isZoomed() ? `${Math.round(view.s * 100)}%` : 'Fit';
    q('.viewer-zoom').disabled = !isZoomed();
    q('[data-act="out"]').disabled = !isZoomed();
    q('[data-act="in"]').disabled = view.s >= maxScale(fit) * 0.999;
  }

  function refit(keepZoom) {
    const { vw, vh } = stageSize();
    const wasZoomed = isZoomed();
    fit = fitScale(size.w, size.h, vw, vh);
    if (!keepZoom || !wasZoomed) view = { s: fit, x: 0, y: 0 };
    else view.s = Math.min(maxScale(fit), Math.max(fit, view.s));
  }

  function zoomTo(s, px = 0, py = 0, animate = true) {
    s = Math.min(maxScale(fit), Math.max(fit, s));
    view = s <= fit * 1.001 ? { s: fit, x: 0, y: 0 } : zoomAround(view, s, px, py);
    apply(animate);
  }

  function show(i) {
    index = Math.min(list.length - 1, Math.max(0, i));
    const a = art();
    const token = ++loadToken;
    size = { w: a.width || 1, h: a.height || 1 };
    const thumb = a.thumb ? `/files/thumbs/${a.thumb}` : '';
    const full = a.display ? `/files/display/${a.display}` : '';
    q('.viewer-missing').hidden = Boolean(thumb || full);
    img.hidden = !(thumb || full);
    // The thumbnail stands in, stretched to the work's size, until the full image arrives.
    img.src = thumb || full;
    img.style.width = `${size.w}px`;
    img.style.height = `${size.h}px`;
    img.classList.remove('swap');
    void img.offsetWidth;
    img.classList.add('swap');
    if (full) {
      const hi = new Image();
      hi.onload = () => {
        if (token !== loadToken) return;
        if (!a.width || !a.height) {
          size = { w: hi.naturalWidth, h: hi.naturalHeight };
          img.style.width = `${size.w}px`;
          img.style.height = `${size.h}px`;
          refit(false);
          apply();
        }
        if (thumb) img.src = full;
      };
      hi.src = full;
    }
    // Warm the neighbours so stepping through is instant.
    for (const n of [list[index + 1], list[index - 1]]) if (n?.display) new Image().src = `/files/display/${n.display}`;

    q('.viewer-count').textContent = list.length > 1 ? `${index + 1} / ${list.length}` : '';
    q('.plate').textContent = plate(a) || '';
    q('.title').textContent = a.title || '';
    q('.meta').textContent = a.width ? `${a.width} × ${a.height}` : '';
    q('.prev').disabled = index === 0;
    q('.next').disabled = index === list.length - 1;
    el.setAttribute('aria-label', `Full-screen view: ${a.title || 'artwork'}`);
    refit(false);
    apply();
  }

  // Controls step aside while the work is being looked at.
  function wake(e) {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    if (!e?.target?.closest?.('.viewer-ui')) idleTimer = setTimeout(() => !drag && el.classList.add('idle'), IDLE_MS);
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {});
    else el.requestFullscreen?.()?.catch(() => {});
  };
  const onFullscreen = () => {
    const fs = document.fullscreenElement === el;
    const b = q('[data-act="fullscreen"]');
    b.innerHTML = fs ? ic.exitFs : ic.enterFs;
    b.title = fs ? 'Exit full screen (F)' : 'Full screen (F)';
  };

  function close() {
    if (current !== api) return;
    current = null;
    clearTimeout(idleTimer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreen);
    if (document.fullscreenElement === el) document.exitFullscreen?.()?.catch(() => {});
    el.remove();
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.(art().id);
  }

  function print() {
    const id = art().id;
    close();
    onPrint?.(id);
  }

  const act = {
    close,
    print,
    prev: () => show(index - 1),
    next: () => show(index + 1),
    in: () => zoomTo(view.s * 1.6),
    out: () => zoomTo(view.s / 1.6),
    fit: () => zoomTo(fit),
    fullscreen: toggleFullscreen,
  };

  // Keys are caught before the library sees them, so Delete or ⌘A can't act on the works behind.
  function onKey(e) {
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (k === 'Escape' || k === ' ') close();
    else if (k === 'ArrowLeft' || k === 'PageUp') act.prev();
    else if (k === 'ArrowRight' || k === 'PageDown') act.next();
    else if (k === 'Home') show(0);
    else if (k === 'End') show(list.length - 1);
    else if (k === '+' || k === '=') act.in();
    else if (k === '-' || k === '_') act.out();
    else if (k === '0') act.fit();
    else if ((k === 'z' || k === 'Z' || k === '1') && !mod) zoomTo(isZoomed() ? fit : zoomTarget(fit));
    else if ((k === 'f' || k === 'F') && !mod) toggleFullscreen();
    else if (mod && (k === 'p' || k === 'P') && onPrint) print();
    else if (mod && /^[qwr]$/i.test(k)) handled = false; // leave quit, close window and reload alone
    else if (k === 'Tab' || k === 'Enter') handled = false;
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    wake();
  }

  const onResize = () => {
    refit(true);
    apply();
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act[b.dataset.act]();
  });
  el.addEventListener('mousemove', wake);

  const onImage = (cx, cy) => {
    const r = img.getBoundingClientRect();
    return !img.hidden && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  const fromCentre = (cx, cy) => {
    const r = stage.getBoundingClientRect();
    return [cx - r.left - r.width / 2, cy - r.top - r.height / 2];
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved && isZoomed()) {
      el.classList.add('dragging');
      view = { s: view.s, x: drag.vx + dx, y: drag.vy + dy };
      apply();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const wasClick = !drag.moved && e.type === 'pointerup';
    drag = null;
    el.classList.remove('dragging');
    if (!wasClick) return;
    // Clicking the work zooms in on that spot, or back out; clicking around a fitted work closes.
    if (isZoomed()) zoomTo(fit);
    else if (onImage(e.clientX, e.clientY)) zoomTo(zoomTarget(fit), ...fromCentre(e.clientX, e.clientY));
    else close();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // Pinch (or ⌘/Ctrl + scroll) and mouse wheels zoom; two-finger trackpad scrolling pans.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const wheelLike = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || wheelLike) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const k = Math.exp(-dy * (e.ctrlKey && !wheelLike ? 0.01 : 0.002));
      zoomTo(view.s * k, ...fromCentre(e.clientX, e.clientY), false);
    } else if (isZoomed()) {
      view = { s: view.s, x: view.x - e.deltaX, y: view.y - e.deltaY };
      apply();
    } else if (Math.abs(e.deltaX) > 30 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2 && !drag) {
      // A horizontal swipe at fit steps to the next or previous work, once per gesture.
      const now = Date.now();
      if (now - (stage.lastSwipe || 0) > 500) {
        stage.lastSwipe = now;
        e.deltaX > 0 ? act.next() : act.prev();
      }
    }
  }, { passive: false });

  const api = { close, art };
  current = api;
  document.body.append(el);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onFullscreen);
  el.focus({ preventScroll: true });
  show(index);
  wake();
  return api;
}
