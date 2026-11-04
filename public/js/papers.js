// Paper profiles: how each paper behaves and what it needs.
//
// `match` lists words to look for in the driver's Media Type choices, most
// specific first, so the app works whatever the installed driver calls them.
// `tune` is the starting colour/tone correction for that paper before the
// artwork's own analysis adjusts it. `sim` describes how the paper renders
// (black density, paper white, colour range) for the on-screen simulation.

export const PAPERS = [
  {
    id: 'ultra-glossy',
    name: 'Epson Ultra Premium Photo Paper Glossy',
    short: 'Ultra Glossy',
    finish: 'Glossy',
    match: ['ultra glossy', 'ultra-glossy', 'ultra premium', 'high-gloss', 'high gloss', 'premium glossy', 'glossy'],
    quality: 'best',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.03, shadowLift: 0.0, contrast: 0.0, saturation: 0.0, sharpen: 0.2 },
    sim: { black: 0.03, white: [251, 251, 255], gamut: 1.0 },
    tip: 'Deepest blacks and widest colour range. Best for vivid, high-contrast work. Let prints dry 24 hours before framing behind glass.',
  },
  {
    id: 'premium-glossy',
    name: 'Epson Premium Photo Paper Glossy',
    short: 'Premium Glossy',
    finish: 'Glossy',
    match: ['premium glossy', 'premium-glossy', 'photographic-glossy', 'glossy'],
    quality: 'best',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.03, shadowLift: 0.01, contrast: 0.0, saturation: 0.0, sharpen: 0.22 },
    sim: { black: 0.04, white: [250, 250, 254], gamut: 0.98 },
    tip: 'Bright, punchy photo finish with rich blacks.',
  },
  {
    id: 'semi-gloss',
    name: 'Epson Premium Photo Paper Semi-Gloss / Luster',
    short: 'Semi-Gloss / Luster',
    finish: 'Semi-gloss',
    match: ['semigloss', 'semi-gloss', 'semi gloss', 'luster', 'lustre', 'satin', 'photographic-semi-gloss', 'photographic-satin', 'premium glossy', 'glossy'],
    quality: 'best',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.03, shadowLift: 0.02, contrast: 0.02, saturation: 0.02, sharpen: 0.25 },
    sim: { black: 0.05, white: [249, 249, 250], gamut: 0.97 },
    tip: 'Less glare than glossy with nearly the same colour depth. A great all-round choice for framed art.',
  },
  {
    id: 'photo-glossy',
    name: 'Epson Photo Paper Glossy (everyday)',
    short: 'Photo Glossy',
    finish: 'Glossy',
    match: ['photo paper glossy', 'photo-glossy', 'photo glossy', 'photographic-glossy', 'glossy'],
    quality: 'high',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.04, shadowLift: 0.02, contrast: 0.02, saturation: 0.02, sharpen: 0.22 },
    sim: { black: 0.06, white: [248, 248, 252], gamut: 0.95 },
    tip: 'Economical glossy paper for proofs and casual prints.',
  },
  {
    id: 'third-party-glossy',
    name: 'Other brand glossy or luster photo paper',
    short: 'Other Glossy',
    finish: 'Glossy',
    match: ['other glossy', 'photographic-glossy', 'photographic', 'premium glossy', 'glossy'],
    quality: 'best',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.04, shadowLift: 0.02, contrast: 0.02, saturation: 0.0, sharpen: 0.22 },
    sim: { black: 0.06, white: [250, 250, 252], gamut: 0.95 },
    tip: 'Uses Epson’s glossy settings. If prints look too dark or have a tint, nudge Brightness or check whether the paper maker publishes an ICC profile.',
  },
  {
    id: 'matte',
    name: 'Epson Premium Presentation Paper Matte',
    short: 'Matte',
    finish: 'Matte',
    match: ['epson matte', 'presentation', 'premium matte', 'com.epson-matte', 'photographic-matte', 'matte'],
    quality: 'high',
    borderless: true,
    source: 'photo',
    tune: { brightness: 0.04, shadowLift: 0.07, contrast: 0.05, saturation: 0.08, sharpen: 0.4 },
    sim: { black: 0.15, white: [247, 247, 244], gamut: 0.85 },
    tip: 'No glare and a soft, painterly look. Blacks print as very dark grey, so the app opens up shadow detail and adds a little saturation to compensate.',
  },
  {
    id: 'velvet',
    name: 'Fine art / Velvet / cotton rag paper',
    short: 'Fine Art Velvet',
    finish: 'Fine art matte',
    match: ['velvet', 'fine art', 'fine-art', 'fineart', 'cotton', 'archival', 'watercolor', 'watercolour', 'matte'],
    quality: 'high',
    borderless: false,
    source: 'rear',
    tune: { brightness: 0.04, shadowLift: 0.09, contrast: 0.06, saturation: 0.1, sharpen: 0.5 },
    sim: { black: 0.2, white: [246, 243, 235], gamut: 0.8 },
    tip: 'Textured, museum-style surface. Feed one sheet at a time through the rear paper feed and leave at least a 3 mm border.',
  },
  {
    id: 'cardstock',
    name: 'Thick paper / cardstock (up to 1.3 mm)',
    short: 'Cardstock',
    finish: 'Matte card',
    match: ['cardstock', 'thick', 'heavyweight', 'stationery-heavyweight', 'card', 'matte'],
    quality: 'high',
    borderless: false,
    source: 'rear',
    tune: { brightness: 0.05, shadowLift: 0.09, contrast: 0.06, saturation: 0.08, sharpen: 0.45 },
    sim: { black: 0.22, white: [245, 244, 240], gamut: 0.78 },
    tip: 'For cards and art board. Load through the rear paper feed one sheet at a time.',
  },
  {
    id: 'plain',
    name: 'Plain paper',
    short: 'Plain',
    finish: 'Uncoated',
    match: ['stationery', 'plain'],
    quality: 'normal',
    borderless: false,
    source: 'auto',
    tune: { brightness: 0.06, shadowLift: 0.1, contrast: 0.06, saturation: 0.06, sharpen: 0.35 },
    sim: { black: 0.28, white: [244, 245, 247], gamut: 0.7 },
    tip: 'Fine for proofs and layout checks. Plain paper absorbs ink, so colours look duller and dark areas can feel heavy.',
  },
];

export const paperById = (id) => PAPERS.find((p) => p.id === id) || PAPERS[0];

// ---- Finding the matching driver option for each job ------------------------

const OPTION_HINTS = {
  media: { keys: ['MediaType', 'media-type', 'EPIJ_Medi', 'Media', 'cupsMediaType'], label: /media\s*type|paper\s*type/i },
  quality: { keys: ['cupsPrintQuality', 'print-quality', 'EPIJ_Qual', 'Quality', 'PrintQuality', 'OutputMode', 'StpQuality'], label: /quality/i },
  color: { keys: ['ColorModel', 'print-color-mode', 'EPIJ_Colr', 'ColorMode', 'cupsColorModel'], label: /colou?r\s*(mode|model)|gr[ae]yscale/i },
  source: { keys: ['InputSlot', 'media-source', 'EPIJ_FdSo'], label: /source|tray|feed/i },
  resolution: { keys: ['Resolution', 'cupsResolution'], label: /^resolution/i },
};

export function findOption(caps, kind) {
  const hint = OPTION_HINTS[kind];
  return caps.options.find((o) => hint.keys.includes(o.key)) ||
    caps.options.find((o) => hint.label.test(o.label) && !/expan/i.test(o.label)) || null;
}

const text = (c) => `${c.value} ${c.label}`.toLowerCase();

function bestByKeywords(option, keywords) {
  for (const kw of keywords) {
    const hit = option.choices.find((c) => text(c).includes(kw));
    if (hit) return hit.value;
  }
  return null;
}

function qualityRank(choice, index, count) {
  const t = text(choice);
  if (/draft|fast|econom|\beco\b|\blow\b/.test(t)) return 0;
  if (/best|max|highest|super|fine|photo|\b5\b/.test(t)) return 3;
  if (/high|\b4\b/.test(t)) return 2;
  if (/normal|standard|\bstd\b|medium|\b3\b/.test(t)) return 1;
  return count > 1 ? (index / (count - 1)) * 3 : 1;
}

/**
 * Work out driver settings for a paper and an artwork's needs.
 * Returns { values: {optionKey: choiceValue}, managed: Set of keys the app chose }.
 */
export function driverSettings(caps, { paper, quality, monochrome, pageSize }) {
  const values = {};
  const reasons = {};

  const media = findOption(caps, 'media');
  if (media) {
    const v = bestByKeywords(media, paper.match);
    if (v) {
      values[media.key] = v;
      reasons[media.key] = `Matches ${paper.short}`;
    }
  }

  const q = findOption(caps, 'quality');
  const target = { draft: 0, normal: 1, high: 2, best: 3 }[quality] ?? 2;
  if (q) {
    const ranked = q.choices.map((c, i) => ({ c, r: qualityRank(c, i, q.choices.length) }));
    ranked.sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target) || b.r - a.r);
    values[q.key] = ranked[0].c.value;
    reasons[q.key] = `${cap(quality)} quality for this paper and image`;
  } else {
    const res = findOption(caps, 'resolution');
    if (res) {
      const dpi = (c) => Math.max(...(c.value.match(/\d+/g) || ['0']).map(Number));
      const sorted = [...res.choices].sort((a, b) => dpi(b) - dpi(a));
      values[res.key] = (target >= 2 ? sorted[0] : sorted[Math.floor(sorted.length / 2)]).value;
      reasons[res.key] = 'Resolution set from the quality level';
    }
  }

  const color = findOption(caps, 'color');
  if (color) {
    const gray = color.choices.find((c) => /gr[ae]y|mono|black/.test(text(c)));
    const rgb = color.choices.find((c) => /rgb|colou?r|cmyk/.test(text(c)) && !/gr[ae]y/.test(text(c)));
    const pick = monochrome && gray ? gray : rgb || color.choices[0];
    values[color.key] = pick.value;
    reasons[color.key] = monochrome && gray ? 'Black-and-white artwork: grey and black inks only, for neutral tones' : 'Full colour';
  }

  const source = findOption(caps, 'source');
  if (source && pageSize) {
    const shortSide = Math.min(pageSize.width, pageSize.height);
    let prefs;
    if (paper.source === 'rear') prefs = ['rear', 'manual', 'back', 'feed slot'];
    else if (shortSide <= 365) prefs = ['cassette 1', 'tray-1', 'tray1', 'upper', 'photo', 'auto'];
    else prefs = ['cassette 2', 'tray-2', 'tray2', 'lower', 'main', 'auto'];
    const v = bestByKeywords(source, prefs);
    if (v) {
      values[source.key] = v;
      reasons[source.key] = paper.source === 'rear' ? 'Thick and fine art paper feeds from the rear' :
        shortSide <= 365 ? 'Small photo sizes load in cassette 1' : 'A4 and Letter load in cassette 2';
    }
  }

  return { values, reasons };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
