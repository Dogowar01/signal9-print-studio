// Image analysis and print recommendations.
//
// analyzeImage() measures the artwork once (tone, colour, detail, palette),
// and recommend() combines those measurements with the chosen paper and
// print size to choose quality, colour mode and tone/colour corrections.

const SAMPLE_EDGE = 640;
export const ANALYSIS_VERSION = 2;

export function analyzeImage(source, naturalWidth, naturalHeight) {
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(naturalWidth, naturalHeight));
  const w = Math.max(1, Math.round(naturalWidth * scale));
  const h = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const hist = new Uint32Array(256);
  const lum = new Float32Array(n);
  const buckets = new Map();
  let sumL = 0, sumSat = 0, highSat = 0, gamutRisk = 0, neutral = 0, transparent = 0;
  let castR = 0, castB = 0, castN = 0;

  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const a = data[i + 3];
    if (a < 250) transparent++;
    // Composite over white so transparent areas read as paper.
    const r = blendWhite(data[i], a), g = blendWhite(data[i + 1], a), b = blendWhite(data[i + 2], a);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[p] = L;
    hist[Math.min(255, Math.round(L))]++;
    sumL += L;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const chroma = max - min;
    sumSat += max ? chroma / max : 0;
    if (chroma > 170) highSat++;
    if (chroma < 12) neutral++;

    // Saturated blues/violets, vivid greens and hot orange-reds sit outside
    // what inkjet inks can reproduce and get compressed when printed.
    if (chroma > 150) {
      const hue = hueOf(r, g, b, max, chroma);
      if ((hue >= 200 && hue <= 290) || (hue >= 85 && hue <= 165 && chroma > 175) || (hue >= 5 && hue <= 35 && chroma > 200)) gamutRisk++;
    }

    if (chroma < 40 && L > 60 && L < 220) {
      castR += r - g;
      castB += b - (r + g) / 2;
      castN++;
    }

    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  // Detail: average local contrast (Laplacian) on the luminance channel.
  let lap = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      lap += Math.abs(4 * lum[p] - lum[p - 1] - lum[p + 1] - lum[p - w] - lum[p + w]);
    }
  }
  const detail = Math.min(1, lap / Math.max(1, (w - 2) * (h - 2)) / 25);

  // Flat graphic art (posters, vector work, pixel art) is made of a handful of
  // solid colours. Photos, paintings and gradients, even greyscale ones, spread
  // across many tones. Flat art shouldn't be sharpened.
  const counts = [...buckets.values()].sort((a, b) => b - a);
  const topShare = counts.slice(0, 12).reduce((sum, c) => sum + c, 0) / n;

  const pct = (k) => percentile(hist, n, k) / 255;
  const share = (lo, hi) => {
    let s = 0;
    for (let v = lo; v <= hi; v++) s += hist[v];
    return s / n;
  };

  return {
    width: naturalWidth,
    height: naturalHeight,
    meanLum: sumL / n / 255,
    p1: pct(0.01),
    p99: pct(0.99),
    shadowClip: share(0, 3),
    highlightClip: share(252, 255),
    shadowShare: share(0, 50),
    highlightShare: share(206, 255),
    meanSat: sumSat / n,
    highSatShare: highSat / n,
    gamutRisk: gamutRisk / n,
    neutralShare: neutral / n,
    monochrome: neutral / n > 0.985,
    cast: castN > n * 0.05 ? { red: castR / castN, blue: castB / castN } : null,
    detail,
    topShare,
    flatArt: topShare >= 0.75 && detail < 0.35,
    transparency: transparent / n > 0.001,
    analyzedAt: new Date().toISOString(),
    v: ANALYSIS_VERSION,
  };
}

/**
 * @param {object} a  analysis from analyzeImage
 * @param {object} paper paper profile
 * @param {{ppi:number, borderless:boolean}} print
 */
export function recommend(a, paper, print) {
  const notes = [];
  const t = paper.tune;
  const adj = { brightness: t.brightness, shadowLift: t.shadowLift, contrast: t.contrast, saturation: t.saturation, sharpen: t.sharpen };
  let quality = paper.quality;

  // ---- Resolution
  const ppi = print.ppi;
  if (ppi < 120) notes.push({ level: 'bad', text: `Only ${Math.round(ppi)} pixels per inch at this size. Expect visible softness or blockiness. Try a smaller print size.` });
  else if (ppi < 200) notes.push({ level: 'warn', text: `${Math.round(ppi)} ppi at this size: fine from arm’s length, slightly soft up close.` });
  else if (ppi < 280) notes.push({ level: 'good', text: `${Math.round(ppi)} ppi: good resolution for this print size.` });
  else notes.push({ level: 'good', text: `${Math.round(ppi)} ppi: excellent, the printer can use all the detail.` });

  // ---- Quality
  if (a.flatArt && paper.finish === 'Uncoated') quality = 'normal';
  else if ((a.detail > 0.4 || a.monochrome || ppi >= 240) && paper.quality !== 'normal') quality = 'best';
  if (ppi < 150 && quality === 'best') quality = 'high'; // the extra passes can't add missing detail

  // ---- Tone
  // Prints are viewed by reflected light and look darker than a backlit screen.
  if (a.meanLum < 0.3) {
    adj.brightness += 0.03;
    notes.push({ level: 'info', text: 'Low-key artwork: brightened slightly so dark midtones don’t sink on paper.' });
  } else if (a.meanLum > 0.75) {
    adj.brightness = Math.max(0, adj.brightness - 0.02);
  }

  const shadowWeight = clamp(0.5 + a.shadowShare * 2.5, 0.5, 1.6);
  adj.shadowLift = t.shadowLift * shadowWeight;
  if (paper.sim.black >= 0.12 && a.shadowShare > 0.15) {
    notes.push({ level: 'info', text: `${Math.round(a.shadowShare * 100)}% of the image is deep shadow. ${paper.short} can’t print true black, so shadow detail has been opened up to keep it visible.` });
  }
  if (a.shadowClip > 0.08) notes.push({ level: 'info', text: 'Large areas of pure black: these print as solid ink with no detail.' });

  const range = a.p99 - a.p1;
  if (range < 0.55 && !a.flatArt) {
    adj.contrast += 0.08;
    notes.push({ level: 'info', text: 'Soft, low-contrast tones: added a little contrast so the print doesn’t look flat.' });
  }

  if (a.highlightClip > 0.05 && paper.finish === 'Glossy') {
    notes.push({ level: 'info', text: 'Pure white areas get no ink, so on glossy paper they can look a little different in sheen from printed areas.' });
  }

  // ---- Colour
  if (a.monochrome) {
    adj.saturation = 0;
    notes.push({ level: 'good', text: 'Black-and-white artwork: printing in grayscale mode gives neutral greys with no colour tint.' });
  } else {
    adj.saturation = t.saturation * (1 - Math.min(1, a.highSatShare * 3));
    if (a.gamutRisk > 0.04) {
      adj.saturation -= 0.04;
      notes.push({ level: 'warn', text: `${Math.round(a.gamutRisk * 100)}% of the image uses very saturated blues, greens or oranges that are beyond what ink can reproduce. They will print slightly less intense. The app softens them a touch so detail inside those areas survives.` });
    } else if (a.meanSat < 0.15 && paper.sim.gamut < 0.9) {
      notes.push({ level: 'info', text: `Muted palette: suits ${paper.short} well.` });
    }
    if (a.cast && (Math.abs(a.cast.red) > 10 || Math.abs(a.cast.blue) > 10)) {
      const tint = Math.abs(a.cast.blue) > Math.abs(a.cast.red) ? (a.cast.blue > 0 ? 'cool (blue)' : 'warm (yellow)') : (a.cast.red > 0 ? 'warm (red)' : 'green');
      notes.push({ level: 'info', text: `Neutral areas lean ${tint}. Kept as-is in case it’s intentional.` });
    }
  }

  // ---- Sharpening
  if (a.flatArt) {
    adj.sharpen = 0;
    notes.push({ level: 'info', text: 'Flat graphic artwork: sharpening turned off to keep clean edges.' });
  } else if (ppi < 150) {
    adj.sharpen *= 0.6; // sharpening an upscaled image mostly exaggerates artefacts
  }

  if (a.transparency) notes.push({ level: 'info', text: 'Transparent areas will print as paper white.' });

  if (print.borderless) {
    notes.push({ level: 'info', text: 'Borderless enlarges the image slightly past the paper edges, so about 2–3 mm is trimmed from each side.' });
  }

  for (const k of Object.keys(adj)) adj[k] = round(adj[k]);
  return { quality, monochrome: a.monochrome, adjustments: adj, notes };
}

export function describe(a) {
  if (!a) return [];
  const tags = [];
  if (a.monochrome) tags.push('Black & white');
  else if (a.meanSat > 0.45) tags.push('Vivid colour');
  else if (a.meanSat < 0.15) tags.push('Muted colour');
  if (a.meanLum < 0.3) tags.push('Low-key');
  else if (a.meanLum > 0.72) tags.push('High-key');
  if (a.flatArt) tags.push('Flat graphic');
  else if (a.detail > 0.45) tags.push('Fine detail');
  if (a.gamutRisk > 0.04) tags.push('Out-of-gamut colours');
  if (a.transparency) tags.push('Transparency');
  return tags;
}

function blendWhite(c, a) {
  return a === 255 ? c : (c * a + 255 * (255 - a)) / 255;
}

function hueOf(r, g, b, max, chroma) {
  let h;
  if (max === r) h = ((g - b) / chroma) % 6;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function percentile(hist, n, k) {
  const target = n * k;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 1000) / 1000;
