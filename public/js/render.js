// Page layout and print rendering.
// All page measurements are in points (1/72 inch) with a top-left origin.

const MM = 72 / 25.4;
const MAX_PPI = 360;      // the ET-8500 driver's native input resolution
const MIN_PPI = 300;      // below this we upsample smoothly before sharpening
const MAX_PIXELS = 16_000_000; // stay under Safari's canvas size limit

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./adjust-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.buffer);
    };
  }
  return worker;
}

export function adjustImageData(imageData, adj, opts) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, {
      resolve: (buffer) => resolve(new ImageData(new Uint8ClampedArray(buffer), imageData.width, imageData.height)),
      reject,
    });
    getWorker().postMessage({ id, buffer: imageData.data.buffer, width: imageData.width, height: imageData.height, adj, opts }, [imageData.data.buffer]);
  });
}

/**
 * @param {object} pageSize   from printer capabilities (portrait points + imageable area)
 * @param {object} s          { fit: 'fit'|'fill'|'custom', marginMm, customWidthMm, autoRotate }
 * @param {number} imgW, imgH source pixels
 */
export function computeLayout(pageSize, s, imgW, imgH) {
  const pw = pageSize.width, ph = pageSize.height;
  const ia = pageSize.imageable;
  // Printable area in portrait page coordinates.
  let area = pageSize.borderless
    ? { x: 0, y: 0, width: pw, height: ph }
    : { x: ia.left, y: ph - ia.top, width: ia.right - ia.left, height: ia.top - ia.bottom };
  const m = Math.max(0, s.marginMm || 0) * MM;
  area = { x: area.x + m, y: area.y + m, width: Math.max(10, area.width - 2 * m), height: Math.max(10, area.height - 2 * m) };

  const rotate = s.autoRotate && (imgW > imgH) !== (pw > ph) && imgW !== imgH;
  // Work in the orientation the user sees: landscape images on a landscape-looking page.
  const view = rotate ? { width: ph, height: pw } : { width: pw, height: ph };
  const vArea = rotate ? toLandscape(area, pw) : area;

  let rect, crop = { sx: 0, sy: 0, sw: imgW, sh: imgH };
  if (s.fit === 'fill') {
    rect = { ...vArea };
    const targetAspect = vArea.width / vArea.height;
    if (imgW / imgH > targetAspect) {
      crop.sw = imgH * targetAspect;
      crop.sx = (imgW - crop.sw) / 2;
    } else {
      crop.sh = imgW / targetAspect;
      crop.sy = (imgH - crop.sh) / 2;
    }
  } else {
    let width, height;
    if (s.fit === 'custom' && s.customWidthMm > 0) {
      width = s.customWidthMm * MM;
      height = (width * imgH) / imgW;
      const shrink = Math.min(1, vArea.width / width, vArea.height / height);
      width *= shrink;
      height *= shrink;
    } else {
      const scale = Math.min(vArea.width / imgW, vArea.height / imgH);
      width = imgW * scale;
      height = imgH * scale;
    }
    rect = { x: vArea.x + (vArea.width - width) / 2, y: vArea.y + (vArea.height - height) / 2, width, height };
  }

  const ppi = crop.sw / (rect.width / 72);
  return { page: { width: pw, height: ph }, view, area: vArea, rect, crop, rotate, ppi, borderless: pageSize.borderless };
}

// Portrait page rect -> landscape view rect (page turned 90° anticlockwise for display).
function toLandscape(r, pageWidth) {
  return { x: r.y, y: pageWidth - (r.x + r.width), width: r.height, height: r.width };
}

// Landscape view rect -> portrait page rect.
function toPortrait(r, pageWidth) {
  return { x: pageWidth - (r.y + r.height), y: r.x, width: r.height, height: r.width };
}

function drawCropped(img, crop, w, h) {
  // Downscale in halving steps: a single big reduction looks jagged in some browsers.
  let src = img, sx = crop.sx, sy = crop.sy, sw = crop.sw, sh = crop.sh;
  while (sw / w > 2.2 && sh / h > 2.2) {
    const c = document.createElement('canvas');
    c.width = Math.round(sw / 2);
    c.height = Math.round(sh / 2);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c;
    sx = 0; sy = 0; sw = c.width; sh = c.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // transparent areas print as paper white
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return canvas;
}

/** Renders the on-screen preview of the artwork area. Returns a canvas. */
export async function renderPreview(img, layout, adj, { mode = 'adjusted', sim = null, maxEdge = 1100 } = {}) {
  const scale = Math.min(1, maxEdge / Math.max(layout.crop.sw, layout.crop.sh));
  const w = Math.max(1, Math.round(layout.crop.sw * scale));
  const h = Math.max(1, Math.round(layout.crop.sh * scale));
  const canvas = drawCropped(img, layout.crop, w, h);
  if (mode === 'original') return canvas;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, w, h);
  // Sharpening radius scaled to what it will be at print resolution.
  const printPx = (layout.rect.width / 72) * clampPpi(layout.ppi);
  const radius = Math.max(0.5, (clampPpi(layout.ppi) / 180) * (w / printPx));
  const out = await adjustImageData(data, adj, { sharpenRadius: radius, simulate: mode === 'paper' ? sim : null });
  ctx.putImageData(out, 0, 0);
  return canvas;
}

const clampPpi = (ppi) => Math.min(MAX_PPI, Math.max(MIN_PPI, ppi));

/**
 * Renders the final print image at print resolution, applies corrections,
 * rotates if needed and encodes JPEG. Returns everything the server needs to build the PDF.
 */
export async function renderForPrint(img, layout, adj, applyCorrections = true) {
  let ppi = clampPpi(layout.ppi);
  let w = Math.round((layout.rect.width / 72) * ppi);
  let h = Math.round((layout.rect.height / 72) * ppi);
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.floor(w * k);
    h = Math.floor(h * k);
    ppi *= k;
  }
  let canvas = drawCropped(img, layout.crop, w, h);
  if (applyCorrections) {
    const ctx = canvas.getContext('2d');
    const out = await adjustImageData(ctx.getImageData(0, 0, w, h), adj, { sharpenRadius: ppi / 180 });
    ctx.putImageData(out, 0, 0);
  }

  let rect = layout.rect;
  if (layout.rotate) {
    // Turn the image 90° clockwise so it sits on the portrait sheet the printer feeds.
    const r = document.createElement('canvas');
    r.width = h;
    r.height = w;
    const rc = r.getContext('2d');
    rc.translate(h, 0);
    rc.rotate(Math.PI / 2);
    rc.drawImage(canvas, 0, 0);
    canvas = r;
    rect = toPortrait(layout.rect, layout.page.width);
  }

  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the print image.'))), 'image/jpeg', 0.95));
  return { blob, pixelWidth: canvas.width, pixelHeight: canvas.height, rect, page: layout.page, ppi };
}

export const mm = (pt) => pt / MM;
