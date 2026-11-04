// Pixel pipeline for print corrections. Runs inside a Web Worker so large
// prints don't freeze the page. Operates on RGBA bytes in place.
//
// adj: { brightness, shadowLift, contrast, saturation, sharpen } (roughly -0.3..0.6)
// opts.sharpenRadius: blur radius in pixels for sharpening
// opts.simulate: paper sim profile { black, white:[r,g,b], gamut } for on-screen preview only

export function applyAdjustments(data, width, height, adj, opts = {}) {
  const lut = toneCurve(adj);
  const sat = adj.saturation || 0;

  for (let i = 0; i < data.length; i += 4) {
    let r = lut[data[i]], g = lut[data[i + 1]], b = lut[data[i + 2]];
    if (sat) {
      // Vibrance-style: boosts muted colours more than ones already saturated,
      // so vivid areas don't clip.
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const s = max ? (max - min) / max : 0;
      const k = 1 + (sat > 0 ? sat * (1 - s) : sat);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  if (adj.sharpen > 0.001) unsharpMask(data, width, height, adj.sharpen, opts.sharpenRadius || 1.5);
  if (opts.simulate) simulatePaper(data, opts.simulate);
}

function toneCurve({ brightness = 0, shadowLift = 0, contrast = 0 }) {
  const lut = new Uint8ClampedArray(256);
  const gamma = 1 / (1 + brightness * 3);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = Math.pow(v, gamma);
    // Lift the toe of the curve: opens shadow detail while keeping pure black black.
    v += shadowLift * 5 * v * Math.pow(1 - v, 3);
    // Gentle S-curve around the midpoint.
    const s = v * v * (3 - 2 * v);
    v += contrast * 2 * (s - v);
    lut[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return lut;
}

// Sharpens luminance only, which avoids coloured halos along edges.
function unsharpMask(data, width, height, amount, radius) {
  const n = width * height;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const blurred = boxBlur(lum, width, height, Math.max(1, Math.round(radius)));
  const strength = amount * 1.6;
  const threshold = 2;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const diff = lum[p] - blurred[p];
    if (Math.abs(diff) < threshold) continue;
    const d = diff * strength;
    data[i] += d;
    data[i + 1] += d;
    data[i + 2] += d;
  }
}

// Two passes of a separable box blur approximate a Gaussian.
function boxBlur(src, w, h, r) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    blurLine(a, b, w, h, r, 1, w);
    blurLine(b, a, h, w, r, w, 1);
  }
  return a;
}

// Blurs `lines` rows of `len` samples. step = distance between samples, stride = between rows.
function blurLine(src, dst, len, lines, r, step, stride) {
  const span = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    const base = line * stride;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + clampIdx(k, len) * step];
    for (let x = 0; x < len; x++) {
      dst[base + x * step] = sum / span;
      sum += src[base + clampIdx(x + r + 1, len) * step] - src[base + clampIdx(x - r, len) * step];
    }
  }
}

const clampIdx = (i, len) => (i < 0 ? 0 : i >= len ? len - 1 : i);

// Approximates how the paper will render: raised black point, tinted paper
// white and a narrower colour range. Preview only, never sent to the printer.
function simulatePaper(data, { black, white, gamut }) {
  const k = black * 255;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * gamut;
    g = l + (g - l) * gamut;
    b = l + (b - l) * gamut;
    data[i] = k + (r / 255) * (white[0] - k);
    data[i + 1] = k + (g / 255) * (white[1] - k);
    data[i + 2] = k + (b / 255) * (white[2] - k);
  }
}
