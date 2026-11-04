// Signal9's photomosaic language: walls of rectangular tiles (artworks set among
// rust, ochre, ember and stone-black tiles), paint splatter, and works that
// resolve out of their own colour blocks.

// Tile and paint colours taken from the Signal9 artworks.
export const TILE = {
  black: ['#0d0c0b', '#131211', '#181614', '#1d1b18', '#24201c'],
  warm: ['#b4532a', '#c2412b', '#d9a23a', '#e07a2e', '#9b4f2a', '#c98a2e'],
  cool: ['#2f5a74', '#466f88', '#8fa6b4'],
  paper: ['#e4d8bf', '#d6c9ae'],
};
const PAINT = ['#e07a2e', '#e07a2e', '#d9a23a', '#c2412b', '#e8e2d9', '#b4532a', '#7fa6bf'];

// Small seeded random generator, so a view always gets the same mosaic.
export function seeded(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/**
 * Cuts a w×h area into `count` rectangles, always splitting the biggest tile
 * across its longer side, like the tiled walls in the artworks.
 * Returns rectangles in percent of the area.
 */
export function subdivide(rand, count, w = 100, h = 100, minSide = 0) {
  const tiles = [{ x: 0, y: 0, w, h }];
  const done = []; // tiles too small to cut again
  while (tiles.length && tiles.length + done.length < count) {
    tiles.sort((a, b) => b.w * b.h - a.w * a.h);
    const t = tiles.shift();
    const r = 0.32 + rand() * 0.36;
    const [a, b] = t.w >= t.h
      ? [{ ...t, w: t.w * r }, { ...t, x: t.x + t.w * r, w: t.w * (1 - r) }]
      : [{ ...t, h: t.h * r }, { ...t, y: t.y + t.h * r, h: t.h * (1 - r) }];
    if (Math.min(a.w, a.h, b.w, b.h) < minSide) done.push(t);
    else tiles.push(a, b);
  }
  tiles.push(...done);
  return tiles.map((t) => ({ x: (t.x / w) * 100, y: (t.y / h) * 100, w: (t.w / w) * 100, h: (t.h / h) * 100 }));
}

// ---------- Brand textures (set once as CSS variables) ----------

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Paint splatter: clustered dots, a few blots and drips, mostly ember and ochre.
export function splatterSvg(seed, w = 600, h = 400, amount = 1) {
  const rand = seeded(seed);
  const parts = [];
  const clusters = Array.from({ length: 3 }, () => ({ x: rand() * w, y: rand() * h, s: 40 + rand() * 120 }));
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const n = Math.round(90 * amount);
  for (let i = 0; i < n; i++) {
    const c = clusters[i % clusters.length];
    const loose = rand() < 0.35;
    const x = loose ? rand() * w : c.x + gauss() * c.s * 1.6;
    const y = loose ? rand() * h : c.y + gauss() * c.s;
    const roll = rand();
    const r = roll < 0.7 ? 0.5 + rand() * 1.4 : roll < 0.94 ? 2 + rand() * 2.6 : 4.5 + rand() * 5;
    const col = pick(rand, PAINT);
    const op = r > 4 ? 0.55 + rand() * 0.3 : 0.5 + rand() * 0.5;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${col}" opacity="${op.toFixed(2)}"/>`);
    // Big blots sometimes run.
    if (r > 4.5 && rand() < 0.5) {
      const len = 20 + rand() * 70;
      parts.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}v${len.toFixed(1)}" stroke="${col}" stroke-width="${(r * 0.32).toFixed(2)}" stroke-linecap="round" opacity="${(op * 0.8).toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${parts.join('')}</svg>`;
}

// The tiled stone wall from the artworks: near-black tiles of slightly different
// tone and texture, copper seams, the odd rust or ochre tile.
function wallSvg(seed, w = 900, h = 900) {
  const rand = seeded(seed);
  const tiles = subdivide(rand, 34, w, h, 70);
  const out = [];
  for (const t of tiles) {
    const x = (t.x / 100) * w, y = (t.y / 100) * h, tw = (t.w / 100) * w, th = (t.h / 100) * h;
    const accent = rand() < 0.08;
    const fill = accent ? pick(rand, ['#35190e', '#33260f', '#2c150f', '#16222b']) : pick(rand, TILE.black);
    out.push(`<rect x="${(x + 1.5).toFixed(1)}" y="${(y + 1.5).toFixed(1)}" width="${(tw - 3).toFixed(1)}" height="${(th - 3).toFixed(1)}" fill="${fill}" stroke="#8a5a2c" stroke-opacity=".28" stroke-width="1"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <filter id="t"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <rect width="${w}" height="${h}" fill="#070606"/><g>${out.join('')}</g><rect width="${w}" height="${h}" filter="url(#t)" fill="#000"/></svg>`;
}

// A thin strip of coloured tiles used as the brand's dividing rule.
function tileRule(seed) {
  const rand = seeded(seed);
  const stops = [];
  let at = 0;
  while (at < 100) {
    const wide = 1.5 + rand() * 7;
    const roll = rand();
    const col = roll < 0.42 ? pick(rand, TILE.warm) : roll < 0.6 ? pick(rand, TILE.cool) : roll < 0.72 ? pick(rand, TILE.paper) : '#24201c';
    const end = Math.min(100, at + wide);
    stops.push(`${col} ${at.toFixed(2)}% ${(end - 0.25).toFixed(2)}%`, `transparent ${(end - 0.25).toFixed(2)}% ${end.toFixed(2)}%`);
    at = end;
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function applyBrandTextures() {
  const root = document.documentElement.style;
  root.setProperty('--splatter', svgUrl(splatterSvg('signal9-a', 700, 420)));
  root.setProperty('--splatter-b', svgUrl(splatterSvg('signal9-b', 520, 360, 0.6)));
  root.setProperty('--wall', svgUrl(wallSvg('signal9-wall')));
  root.setProperty('--tile-rule', tileRule('signal9-rule'));
}

// ---------- Hero: a mosaic wall built from the works in view ----------

let heroKey = '';

export function renderHeroMosaic(el, artworks, viewKey) {
  const works = artworks.filter((a) => a.thumb).slice(0, 7);
  const key = `${viewKey}|${works.map((a) => a.id).join()}`;
  if (key === heroKey) return;
  heroKey = key;
  const rand = seeded(viewKey);
  // Wide area (the hero is roughly 2.4:1); more tiles than works so colour tiles sit between them.
  const tiles = subdivide(rand, Math.max(14, works.length * 2 + 6), 240, 100, 9);
  // Works take the largest, least elongated tiles.
  const order = tiles
    .map((t, i) => {
      const w = t.w * 2.4, h = t.h; // back to the 240×100 working units
      return { i, score: (w * h) / Math.max(w / h, h / w) };
    })
    .sort((a, b) => b.score - a.score)
    .map((o) => o.i);
  const workAt = new Map(order.slice(0, works.length).map((tileIndex, n) => [tileIndex, works[n]]));
  el.innerHTML = tiles.map((t, i) => {
    const pos = `left:${t.x.toFixed(2)}%;top:${t.y.toFixed(2)}%;width:${t.w.toFixed(2)}%;height:${t.h.toFixed(2)}%;--i:${Math.round(rand() * 14)}`;
    const a = workAt.get(i);
    if (a) return `<div class="m-tile art" style="${pos}"><img src="/files/thumbs/${a.thumb}" alt="" draggable="false"></div>`;
    const roll = rand();
    const fill = roll < 0.48 ? pick(rand, TILE.black) : roll < 0.8 ? pick(rand, TILE.warm) : roll < 0.92 ? pick(rand, TILE.cool) : pick(rand, TILE.paper);
    return `<div class="m-tile" style="${pos};--fill:${fill}"></div>`;
  }).join('');
}

// ---------- Cards: each new work resolves out of its own colour blocks ----------

const sampler = document.createElement('canvas');

function sampleColours(img, tiles) {
  const S = 24;
  sampler.width = S;
  sampler.height = S;
  const ctx = sampler.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  return tiles.map((t) => {
    const x0 = Math.floor((t.x / 100) * S), x1 = Math.max(x0 + 1, Math.round(((t.x + t.w) / 100) * S));
    const y0 = Math.floor((t.y / 100) * S), y1 = Math.max(y0 + 1, Math.round(((t.y + t.h) / 100) * S));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = (y * S + x) * 4;
        r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
      }
    }
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  });
}

export function revealCard(card) {
  const frame = card.querySelector('.frame');
  const img = frame?.querySelector('img');
  if (!img || frame.querySelector('.resolve')) return;
  const rand = seeded(card.dataset.id);
  const tiles = subdivide(rand, 9 + Math.floor(rand() * 6), 100 * (parseFloat(card.style.getPropertyValue('--ar')) || 1), 100, 6);
  const layer = document.createElement('div');
  layer.className = 'resolve';
  layer.innerHTML = tiles.map((t) =>
    `<i style="left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;--o:${Math.round(rand() * 650)}ms"></i>`).join('');
  frame.append(layer);
  const start = () => {
    try {
      const cols = sampleColours(img, tiles);
      [...layer.children].forEach((el, i) => { el.style.background = cols[i]; });
    } catch { /* unreadable image: the tiles stay stone-black */ }
    requestAnimationFrame(() => layer.classList.add('go'));
    setTimeout(() => layer.remove(), 2600 + (parseInt(card.style.getPropertyValue('--d'), 10) || 0));
  };
  if (img.complete && img.naturalWidth) start();
  else {
    img.addEventListener('load', start, { once: true });
    img.addEventListener('error', () => layer.remove(), { once: true });
  }
}
