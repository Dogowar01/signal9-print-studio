// Finding like images, two ways:
//
// - Style: how a work looks (its palette, how light or dark it is, contrast,
//   how much fine detail). Measured here from the thumbnail; works everywhere.
// - Subject: what's in it (a city, a flower, a face). Recognised on the Mac by
//   Apple's Vision framework (see server/vision.js), which also gives a feature
//   print the server compares for "More like this".

export const STYLE_VERSION = 2;
const EDGE = 96;

const HUE_BINS = 12; // 30° each, starting at red

// How colourful one pixel is, 0–1: its saturation, faded out for near-black
// pixels (where hue means little) so dark-but-rich colour still counts.
function colourfulness(max, chroma) {
  if (!max) return 0;
  const s = chroma / max;
  const v = max / 255;
  return s * Math.min(1, Math.max(0, (v - 0.06) / 0.24));
}

/** Measures a work's look from an image or canvas (the thumbnail is plenty). */
export function styleSignature(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, EDGE / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const hue = new Array(HUE_BINS).fill(0);
  const lumBins = [0, 0, 0, 0, 0];
  const lum = new Float32Array(n);
  let sat = 0, sumL = 0, sumL2 = 0, colourPx = 0, colourSum = 0;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[p] = L;
    sumL += L;
    sumL2 += L * L;
    lumBins[Math.min(4, Math.floor(L * 5))]++;
    sat += max ? chroma / max : 0;
    const strength = colourfulness(max, chroma);
    if (strength < 0.15) continue; // greys, paper and near-black
    colourPx++;
    colourSum += strength;
    let hDeg;
    if (max === r) hDeg = ((g - b) / chroma) % 6;
    else if (max === g) hDeg = (b - r) / chroma + 2;
    else hDeg = (r - g) / chroma + 4;
    hDeg = (hDeg * 60 + 360) % 360;
    hue[Math.floor(hDeg / (360 / HUE_BINS)) % HUE_BINS] += strength;
  }
  let lap = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      lap += Math.abs(4 * lum[p] - lum[p - 1] - lum[p + 1] - lum[p - w] - lum[p + w]);
    }
  }
  const hueTotal = hue.reduce((s, v) => s + v, 0);
  const mean = sumL / n;
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    v: STYLE_VERSION,
    // The palette: share of the work's colour in each hue (sums to 1 when there is any).
    hue: hue.map((v) => round(hueTotal ? v / hueTotal : 0)),
    // How much of the picture is coloured at all, and how strongly where it is.
    colour: round(colourPx / n),
    vivid: round(colourPx ? colourSum / colourPx : 0),
    lum: lumBins.map((v) => round(v / n)),
    light: round(mean),
    contrast: round(Math.sqrt(Math.max(0, sumL2 / n - mean * mean))),
    sat: round(sat / n),
    detail: round(Math.min(1, lap / Math.max(1, (w - 2) * (h - 2)) / 0.3)),
  };
}

const l1 = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
const MONO = 0.02; // under 2% coloured pixels reads as black & white
const isMono = (s) => s.colour < MONO;

/** How alike two works look, 0 (nothing in common) to 1 (the same look). */
export function styleSimilarity(a, b) {
  if (!a || !b) return 0;
  // Palette, with a little spill to neighbouring hues so orange sits near red.
  const soft = (s) => s.hue.map((v, i) => v * 0.6 + (s.hue[(i + 1) % HUE_BINS] + s.hue[(i + HUE_BINS - 1) % HUE_BINS]) * 0.2);
  const palette = isMono(a) && isMono(b) ? 0 : isMono(a) || isMono(b) ? 1 : l1(soft(a), soft(b)) / 2;
  const amount = Math.min(1, Math.abs(a.colour - b.colour) / 0.5);
  const vivid = Math.min(1, Math.abs(a.vivid - b.vivid) / 0.5);
  const tone = l1(a.lum, b.lum) / 2;
  const d = 0.34 * palette + 0.1 * amount + 0.1 * vivid + 0.26 * tone
    + 0.1 * Math.min(1, Math.abs(a.contrast - b.contrast) / 0.25)
    + 0.1 * Math.min(1, Math.abs(a.detail - b.detail) / 0.6);
  return Math.max(0, 1 - d);
}

// ---------- Style groups ----------

const FAMILIES = [
  // [name, hue bins] (bins are 30°: 0 = red, 1 = orange, 2 = yellow…)
  ['warm', [11, 0, 1, 2]],
  ['green', [3, 4, 5]],
  ['blue', [6, 7, 8]],
  ['violet', [9, 10]],
];
const FAMILY_WORDS = { warm: 'warm tones', green: 'greens', blue: 'blues', violet: 'violets & pinks' };

/** Puts a work's look into a named group like "Dark warm tones" or "Black & white". */
export function styleGroup(s) {
  if (!s || s.v !== STYLE_VERSION) return { key: 'unknown', name: 'Not yet measured', sort: 99 };
  if (isMono(s)) return { key: 'mono', name: 'Black & white', blurb: 'Greys, inks and monochrome work.', sort: 50 };
  const shares = FAMILIES.map(([key, bins]) => [key, bins.reduce((t, b) => t + s.hue[b], 0)]).sort((a, b) => b[1] - a[1]);
  const fam = shares[0][1] >= 0.62 ? [shares[0][0]] : [shares[0][0], shares[1][0]].sort();
  const tone = s.light < 0.32 ? 'dark' : s.light > 0.66 ? 'light' : 'mid';
  // Mostly grey with touches of colour, or colour that's soft where it appears.
  const muted = s.vivid < 0.35 || s.colour < 0.12;
  const words = fam.map((f) => FAMILY_WORDS[f]).join(' & ');
  const lead = { dark: 'Dark', light: 'Pale', mid: '' }[tone];
  const name = [lead, muted ? 'muted' : '', words].filter(Boolean).join(' ');
  return {
    key: `${tone}-${muted ? 'm' : 'v'}-${fam.join('+')}`,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    blurb: `${{ dark: 'Low-lit', light: 'Light, airy', mid: 'Mid-toned' }[tone]} work in ${muted ? 'touches of ' : ''}${words}.`,
    sort: { dark: 0, mid: 10, light: 20 }[tone] + (muted ? 5 : 0),
  };
}

const MERGE_AT = 0.8; // groups whose works look this alike on average become one

/**
 * Groups works by look. Each work first gets a named group from styleGroup();
 * then groups that look nearly the same (a work just either side of a palette
 * line) are merged, keeping the bigger group's name.
 */
export function groupByStyle(arts) {
  const groups = new Map();
  for (const a of arts) {
    const g = styleGroup(a.style);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, arts: [] });
    groups.get(g.key).arts.push(a);
  }
  const list = [...groups.values()];
  const measured = (g) => g.sort < 98;
  const alike = (x, y) => {
    let sum = 0;
    for (const a of x.arts) for (const b of y.arts) sum += styleSimilarity(a.style, b.style);
    return sum / (x.arts.length * y.arts.length);
  };
  for (;;) {
    let best = null;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!measured(list[i]) || !measured(list[j]) || (list[i].key === 'mono') !== (list[j].key === 'mono')) continue;
        const s = alike(list[i], list[j]);
        if (s >= MERGE_AT && (!best || s > best.s)) best = { i, j, s };
      }
    }
    if (!best) break;
    const [big, small] = list[best.i].arts.length >= list[best.j].arts.length ? [list[best.i], list[best.j]] : [list[best.j], list[best.i]];
    big.arts.push(...small.arts);
    list.splice(list.indexOf(small), 1);
  }
  return list;
}

// ---------- Subject groups (from Vision labels) ----------

// Vision's labels are many and specific; these gather them into subjects that
// suit an art library. Weights favour what a picture is *of* over its backdrop.
const SUBJECTS = [
  ['people', 'People & portraits', 1.15, ['people', 'person', 'adult', 'child', 'baby', 'portrait', 'face', 'crowd', 'selfie']],
  ['animals', 'Animals', 1.1, ['animal', 'bird', 'cat', 'dog', 'horse', 'fish', 'insect', 'mammal', 'butterfly', 'wildlife', 'reptile', 'feline', 'canine']],
  ['music', 'Music & text', 1.05, ['music', 'sheet_music', 'musical', 'document', 'text', 'printed_page', 'book', 'handwriting', 'newspaper', 'poster', 'letter']],
  ['flowers', 'Flowers & plants', 1.0, ['flower', 'sunflower', 'rose', 'blossom', 'plant', 'tree', 'leaf', 'foliage', 'garden', 'forest', 'bouquet', 'petal']],
  ['city', 'Cities & buildings', 1.0, ['cityscape', 'city', 'building', 'skyscraper', 'architecture', 'street', 'bridge', 'tower', 'skyline', 'house', 'monument', 'structure', 'church', 'castle', 'downtown']],
  ['vehicles', 'Vehicles', 1.0, ['vehicle', 'car', 'train', 'boat', 'ship', 'aircraft', 'airplane', 'bicycle', 'motorcycle']],
  ['food', 'Food & still life', 0.95, ['food', 'fruit', 'vegetable', 'drink', 'still_life', 'vase', 'bottle']],
  ['land', 'Landscapes', 0.9, ['landscape', 'mountain', 'hill', 'field', 'desert', 'canyon', 'valley', 'countryside', 'grass', 'land']],
  ['water', 'Sea & water', 0.85, ['sea', 'ocean', 'beach', 'lake', 'river', 'water', 'waterfall', 'wave', 'shore', 'coast']],
  ['sky', 'Sky & space', 0.8, ['sky', 'cloud', 'sunset', 'sunrise', 'night_sky', 'star', 'moon', 'galaxy', 'astronomy', 'space', 'outer_space', 'aurora']],
  ['pattern', 'Abstract & pattern', 0.7, ['abstract', 'pattern', 'texture', 'art', 'painting', 'graphic', 'illustration', 'design', 'fractal', 'mosaic', 'collage']],
];

const pretty = (id) => id.replace(/_/g, ' ');
// A label matches a word exactly or as its last part ("night_sky" is sky).
const matches = (label, words) => words.some((w) => label === w || label.endsWith(`_${w}`));

export function subjectGroup(vision) {
  if (!vision) return { key: 'pending', name: 'Not yet recognised', sort: 98 };
  let bestScore = 0, best = null;
  for (const [key, name, weight, words] of SUBJECTS) {
    const conf = Math.max(0, ...vision.labels.filter(([l]) => matches(l, words)).map(([, c]) => c));
    if (conf >= 0.3 && conf * weight > bestScore) {
      bestScore = conf * weight;
      best = { key, name, sort: SUBJECTS.findIndex((s) => s[0] === key) };
    }
  }
  if (best) return best;
  // Something Vision is sure about but not one of the subjects above: use its own word.
  const top = vision.labels.find(([, c]) => c >= 0.5);
  if (top) return { key: `label:${top[0]}`, name: pretty(top[0]).replace(/^\w/, (ch) => ch.toUpperCase()), sort: 60 };
  return { key: 'other', name: 'Abstract & other', sort: 90 };
}

/** The recognised words worth showing or searching for a work. */
export function subjectWords(vision, min = 0.35) {
  return (vision?.labels || []).filter(([, c]) => c >= min).slice(0, 8).map(([l]) => pretty(l));
}

// ---------- More like this ----------

/**
 * Ranks every other work by how alike it is to `target`.
 * `content` is the server's content similarity per id (empty off the Mac).
 * mode: 'both' | 'style' | 'subject'
 */
export function rankSimilar(target, artworks, content = {}, mode = 'both') {
  const others = artworks.filter((a) => a.id !== target.id);
  // Spread each measure over 0–1 across this library, so neither dominates by scale.
  const spread = (vals) => {
    const xs = Object.values(vals);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  };
  const style = Object.fromEntries(others.filter((a) => a.style).map((a) => [a.id, styleSimilarity(target.style, a.style)]));
  const sNorm = spread(style), cNorm = spread(content);
  const hasContent = Object.keys(content).length > 0;
  return others
    .map((a) => {
      const s = a.id in style ? sNorm(style[a.id]) : null;
      const c = hasContent && a.id in content ? cNorm(content[a.id]) : null;
      let score;
      if (mode === 'style') score = s;
      else if (mode === 'subject') score = c;
      else if (s !== null && c !== null) score = 0.55 * c + 0.45 * s;
      else score = s ?? c;
      return { art: a, score };
    })
    .filter((x) => x.score !== null)
    .sort((a, b) => b.score - a.score);
}
