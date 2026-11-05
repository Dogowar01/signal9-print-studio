// AI upscaling for print (Real-ESRGAN in the Mac app): shared by the library's
// details panel and the print studio.

import { api } from './util.js';

const A4_LONG = 3508, A4_SHORT = 2480; // A4 at 300 ppi
export const SHARP_PPI = 240;

/** Where to load a work for printing: its upscaled copy if it has one. */
export function printSource(art) {
  return art.upscaled ? `/files/upscaled/${art.upscaled.file}` : `/files/display/${art.display}`;
}

/** The pixel size a work prints from. */
export function printPixels(art) {
  return art.upscaled ? { w: art.upscaled.width, h: art.upscaled.height } : { w: art.width, h: art.height };
}

/** Largest size this many pixels print sharply at, and which paper that covers. */
export function sharpSize(w, h) {
  const longIn = Math.max(w, h) / SHARP_PPI;
  const shortIn = Math.min(w, h) / SHARP_PPI;
  const sizes = [['A4 / Letter', 11.0, 8.0], ['8 × 10 in', 10, 8], ['A5 / 5 × 7 in', 7, 5], ['10 × 15 cm', 6, 4]];
  const fit = sizes.find(([, l, s]) => longIn >= l && shortIn >= s);
  const cm = (i) => (i * 2.54).toFixed(0);
  return { text: `${cm(shortIn)} × ${cm(longIn)} cm`, paper: fit ? fit[0] : null };
}

/** Does this work need upscaling to print A4 sharply? */
export function needsUpscale(art) {
  if (!art.width || art.upscaled) return false;
  return Math.max(art.width, art.height) < A4_LONG * 0.8 || Math.min(art.width, art.height) < A4_SHORT * 0.8;
}

/** The smallest scale that reaches a sharp A4, or 4× if none does. */
export function recommendedScale(art) {
  const long = Math.max(art.width || 0, art.height || 0), short = Math.min(art.width || 0, art.height || 0);
  return [2, 3].find((s) => long * s >= A4_LONG && short * s >= A4_SHORT) || 4;
}

/** Illustration-style model for flat graphic art, otherwise the painting/photo model. */
export function defaultModel(art) {
  return art.analysis?.flatArt ? 'graphic' : 'painting';
}

export const MODEL_LABELS = { painting: 'Painting & photo', graphic: 'Illustration & graphic' };

// One poll loop per work, shared by everyone waiting on it.
const waiting = new Map();

/**
 * Starts (or joins) an upscale and resolves with the updated artwork when done.
 * onProgress(0–1) is called while it runs.
 */
const starting = new Set();

export async function runUpscale(art, { scale, model }, onProgress = () => {}) {
  starting.add(art.id);
  let job;
  try {
    job = await api(`/api/artworks/${art.id}/upscale`, { method: 'POST', json: { scale, model } });
  } finally {
    starting.delete(art.id);
  }
  return followUpscale(art.id, onProgress, job);
}

export function followUpscale(id, onProgress = () => {}, first = null) {
  if (!waiting.has(id)) {
    const listeners = new Set();
    const promise = (async () => {
      let job = first;
      for (;;) {
        if (job) for (const fn of listeners) fn(job.progress, job);
        if (job && job.state === 'done') break;
        if (job && job.state === 'failed') throw new Error(job.error || 'Upscaling failed.');
        await new Promise((r) => setTimeout(r, 800));
        const r = await api(`/api/artworks/${id}/upscale`);
        if (!r.job) return r.artwork;
        job = r.job;
      }
      return (await api(`/api/artworks/${id}/upscale`)).artwork;
    })().finally(() => waiting.delete(id));
    waiting.set(id, { promise, listeners });
  }
  const w = waiting.get(id);
  w.listeners.add(onProgress);
  return w.promise.finally(() => w.listeners.delete(onProgress));
}

export function isUpscaling(id) {
  return waiting.has(id) || starting.has(id);
}
