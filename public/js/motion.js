// Motion in Signal9's own language: paint flicked off the brush, works breaking back into
// their colour tiles, cards gliding between views, gallery light, a sharpening wipe.
// Everything here stands still when the Mac asks for reduced motion.

import { PAINT, seeded, subdivide, sampleColours } from './mosaic.js';

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const inView = (r) => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0;

function overlay(className) {
  const el = document.createElement('div');
  el.className = className;
  document.body.append(el);
  return el;
}

// ---------- Paint splatter ----------

// Flicks paint drops out from a point; they arc, fall and fade. power ≈ size of the moment.
export function splatter(x, y, { power = 1, count = Math.round(12 + power * 10) } = {}) {
  if (reducedMotion()) return;
  const layer = overlay('splat-layer');
  const rand = Math.random;
  let longest = 0;
  for (let i = 0; i < count; i++) {
    const drop = document.createElement('i');
    const big = rand() < 0.18;
    const r = (big ? 4 + rand() * 4 : 1.2 + rand() * 2.6) * (0.8 + power * 0.25);
    const angle = rand() * Math.PI * 2;
    const dist = (24 + rand() * 70) * (0.7 + power * 0.45) * (big ? 0.7 : 1);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.8 - 14 * power;
    const fall = 16 + rand() * 40 * power;
    const ms = 700 + rand() * 500 + power * 150;
    longest = Math.max(longest, ms);
    drop.style.cssText = `left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;background:${PAINT[Math.floor(rand() * PAINT.length)]}`;
    layer.append(drop);
    drop.animate([
      { transform: 'translate(0, 0) scale(.2)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: 0.42 },
      // Big blots run as they fall.
      { transform: `translate(${dx * 1.08}px, ${dy + fall}px) scale(${big ? '0.8, 2.4' : '0.9'})`, opacity: 0 },
    ], { duration: ms, easing: 'cubic-bezier(.15,.85,.35,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), longest + 60);
}

export function splatterFrom(el, opts) {
  const r = el?.getBoundingClientRect();
  if (r && inView(r)) splatter(r.left + r.width / 2, r.top + r.height / 2, opts);
}

// ---------- Flying a picture from one place to another ----------

// A stand-in image that travels between two rectangles (cover-cropped, so a card's crop
// opens out into the whole work). Resolves when it lands.
export function fly(src, from, to, { duration = 480, fadeOut = false, z = 75 } = {}) {
  if (reducedMotion() || !src || !from || !to) return Promise.resolve();
  const img = document.createElement('img');
  img.className = 'flyer';
  img.src = src;
  img.style.zIndex = z;
  document.body.append(img);
  const box = (r) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const anim = img.animate([
    { ...box(from), opacity: 1 },
    { ...box(to), opacity: fadeOut ? 0.0 : 1 },
  ], { duration, easing: EASE, fill: 'forwards' });
  return anim.finished.catch(() => {}).then(() => img.remove());
}

// ---------- Cards gliding between views (FLIP) ----------

const MAX_FLIP = 90;

// Remembers where each card sits (relative to the grid, so scrolling doesn't count as movement).
export function measureCards(grid) {
  const base = grid.getBoundingClientRect();
  const seen = new Map();
  for (const card of grid.querySelectorAll('.card')) {
    const id = card.dataset.id;
    if (seen.has(id)) continue;
    const r = card.getBoundingClientRect();
    seen.set(id, { card, r, x: r.left - base.left, y: r.top - base.top, visible: inView(r) });
  }
  return seen;
}

// After the grid is rebuilt: cards that moved glide from where they were, new arrivals
// rise in, and departures fade where they stood (or break into tiles, when removed).
export function playCards(grid, before, { leaving = 'fade', removed = new Set() } = {}) {
  if (reducedMotion() || !before) return;
  const after = measureCards(grid);
  let n = 0;
  for (const [id, now] of after) {
    if (!now.visible || n >= MAX_FLIP) continue;
    if (now.card.classList.contains('fresh')) continue; // imports have their own entrance
    const was = before.get(id);
    if (was) {
      const dx = was.x - now.x, dy = was.y - now.y;
      const k = was.r.width / now.r.width;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(k - 1) < 0.01) continue;
      n++;
      now.card.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, transformOrigin: 'top left' },
        { transform: 'none', transformOrigin: 'top left' },
      ], { duration: 620, easing: EASE });
    } else if (leaving) {
      n++;
      now.card.animate([
        { opacity: 0, transform: 'translateY(14px) scale(.97)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 560, delay: 120 + Math.min(n, 12) * 28, easing: EASE, fill: 'backwards' });
    }
  }
  let gone = 0;
  for (const [id, was] of before) {
    if (after.has(id) || !was.visible || gone >= 30) continue;
    gone++;
    if (removed.has(id)) shatter(was.card, was.r);
    else if (leaving === 'fade') ghostOut(was.card, was.r);
  }
}

function ghostOut(card, r) {
  const ghost = card.cloneNode(true);
  ghost.classList.remove('fresh');
  ghost.classList.add('ghost-card');
  ghost.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;max-width:none;flex:none`;
  document.body.append(ghost);
  ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' })
    .finished.catch(() => {}).then(() => ghost.remove());
}

// ---------- A removed work breaks back into its colour tiles ----------

// rect is where the card stood (it may already be gone from the page).
export function shatter(card, r = card.getBoundingClientRect()) {
  const img = card.querySelector('.frame img');
  if (reducedMotion() || !img || !inView(r)) return;
  const rand = seeded(card.dataset.id + ':out');
  const tiles = subdivide(rand, 12 + Math.floor(rand() * 6), 100 * (r.width / r.height), 100, 5);
  let colours = [];
  try { colours = sampleColours(img, tiles); } catch { /* unreadable: stone-black tiles */ }
  const box = overlay('shatter');
  box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  const pic = img.cloneNode();
  box.append(pic);
  pic.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 120, fill: 'forwards' });
  let longest = 0;
  tiles.forEach((t, i) => {
    const el = document.createElement('i');
    el.style.cssText = `left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;background:${colours[i] || '#1d1b18'}`;
    box.append(el);
    const delay = 140 + rand() * 380;
    const ms = 760 + rand() * 360;
    longest = Math.max(longest, delay + ms);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' });
    el.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${(rand() - 0.5) * 60}px, ${90 + rand() * 140}px) rotate(${(rand() - 0.5) * 50}deg) scale(.9)`, opacity: 0 },
    ], { duration: ms, delay, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'both' });
  });
  setTimeout(() => box.remove(), longest + 80);
}

// ---------- Gallery light ----------

// A soft light follows the pointer across the wall; the card under it leans toward you
// and its glass catches the light.
export function galleryLight(grid) {
  if (!grid || grid.dataset.light) return;
  grid.dataset.light = '1';
  let frame = 0, last = null, lit = null;
  const settle = (card) => {
    if (!card) return;
    card.style.removeProperty('--rx');
    card.style.removeProperty('--ry');
  };
  grid.addEventListener('pointermove', (e) => {
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (reducedMotion() || !last) return;
      const g = grid.getBoundingClientRect();
      grid.style.setProperty('--mx', `${last.clientX - g.left}px`);
      grid.style.setProperty('--my', `${last.clientY - g.top}px`);
      grid.classList.add('lit');
      const card = last.target.closest?.('.card');
      if (card !== lit) settle(lit);
      lit = card;
      if (!card || last.buttons) return;
      const r = card.getBoundingClientRect();
      const px = (last.clientX - r.left) / r.width, py = (last.clientY - r.top) / r.height;
      card.style.setProperty('--rx', `${((0.5 - py) * 6).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
      card.style.setProperty('--px', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--py', `${(py * 100).toFixed(1)}%`);
    });
  });
  grid.addEventListener('pointerleave', () => {
    grid.classList.remove('lit');
    settle(lit);
    lit = null;
  });
}

// ---------- A work sharpening, after an upscale ----------

// A blurred veil over the picture is wiped away left to right behind a glowing edge.
export async function sharpenReveal(target) {
  if (reducedMotion() || !target) return;
  // Let the picture's own entrance finish first.
  await Promise.all(target.getAnimations?.().map((a) => a.finished.catch(() => {})) || []);
  await new Promise((r) => setTimeout(r, 150));
  const r = target.getBoundingClientRect();
  if (!inView(r)) return;
  const box = overlay('sharpen');
  box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  box.innerHTML = '<div class="sharpen-veil"></div><div class="sharpen-edge"></div>';
  const opts = { duration: 1500, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' };
  box.firstChild.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], opts);
  box.lastChild.animate([{ left: '0%', opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { left: '100%', opacity: 0 }], opts)
    .finished.catch(() => {}).then(() => box.remove());
}

// ---------- The print room's sheet ----------

// While sending, a print head of ink colours passes down the sheet.
export function inking(sheet, on) {
  sheet?.classList.toggle('inking', on && !reducedMotion());
}

// The finished sheet feeds away into the printer, and a fresh one settles in its place.
export async function feedSheet(sheet) {
  if (reducedMotion() || !sheet) return;
  await sheet.animate([
    { transform: 'none', opacity: 1 },
    { transform: 'translateY(10px) scale(.995)', opacity: 1, offset: 0.18 },
    { transform: 'translateY(-115%) scale(.96)', opacity: 0 },
  ], { duration: 1100, easing: 'cubic-bezier(.6,0,.3,1)' }).finished.catch(() => {});
  await sheet.animate([
    { transform: 'translateY(26px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ], { duration: 700, easing: EASE }).finished.catch(() => {});
}
