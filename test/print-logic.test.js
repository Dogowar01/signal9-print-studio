import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePPD } from '../server/ppd.js';
import { PAPERS, paperById, driverSettings } from '../public/js/papers.js';
import { recommend } from '../public/js/analyze.js';
import { computeLayout } from '../public/js/render.js';
import { applyAdjustments } from '../public/js/adjust.js';

const caps = parsePPD(readFileSync(new URL('../server/mock/EPSON_ET_8500_Series.ppd', import.meta.url), 'latin1'));
const a4 = caps.pageSizes.find((p) => p.name === 'A4');
const a4b = caps.pageSizes.find((p) => p.name === 'A4.Borderless');
const small = caps.pageSizes.find((p) => p.name === '4x6');

const baseAnalysis = {
  meanLum: 0.5, p1: 0.03, p99: 0.97, shadowClip: 0, highlightClip: 0, shadowShare: 0.1, highlightShare: 0.1,
  meanSat: 0.35, highSatShare: 0.05, gamutRisk: 0, neutralShare: 0.1, monochrome: false, cast: null,
  detail: 0.3, topShare: 0.1, flatArt: false, transparency: false, v: 2,
};

test('every paper maps to its own Epson media type', () => {
  const expected = {
    'ultra-glossy': 'com.epson-ultra-glossy', 'premium-glossy': 'com.epson-premium-glossy', 'semi-gloss': 'com.epson-premium-semigloss',
    'photo-glossy': 'com.epson-photo-glossy', 'third-party-glossy': 'photographic-glossy', matte: 'com.epson-matte',
    velvet: 'com.epson-velvet-fine-art', cardstock: 'cardstock', plain: 'stationery',
  };
  for (const paper of PAPERS) {
    const { values } = driverSettings(caps, { paper, quality: paper.quality, monochrome: false, pageSize: a4 });
    assert.equal(values.MediaType, expected[paper.id], paper.id);
  }
});

test('quality, colour mode and paper source follow the job', () => {
  const glossy = driverSettings(caps, { paper: paperById('premium-glossy'), quality: 'best', monochrome: false, pageSize: small });
  assert.equal(glossy.values.cupsPrintQuality, 'Best');
  assert.equal(glossy.values.ColorModel, 'RGB');
  assert.equal(glossy.values.InputSlot, 'tray-1');

  const plain = driverSettings(caps, { paper: paperById('plain'), quality: 'normal', monochrome: true, pageSize: a4 });
  assert.equal(plain.values.cupsPrintQuality, 'Normal');
  assert.equal(plain.values.ColorModel, 'Gray');
  assert.equal(plain.values.InputSlot, 'tray-2');

  const velvet = driverSettings(caps, { paper: paperById('velvet'), quality: 'high', monochrome: false, pageSize: a4 });
  assert.equal(velvet.values.InputSlot, 'rear');
});

test('recommend: matte paper lifts shadows and boosts saturation more than glossy', () => {
  const dark = { ...baseAnalysis, meanLum: 0.25, shadowShare: 0.4 };
  const g = recommend(dark, paperById('ultra-glossy'), { ppi: 300, borderless: false });
  const m = recommend(dark, paperById('matte'), { ppi: 300, borderless: false });
  assert.ok(m.adjustments.shadowLift > g.adjustments.shadowLift);
  assert.ok(m.adjustments.saturation > g.adjustments.saturation);
  assert.ok(m.notes.some((n) => /shadow/i.test(n.text)));
});

test('recommend: resolution warnings and quality choice', () => {
  const low = recommend(baseAnalysis, paperById('premium-glossy'), { ppi: 100, borderless: false });
  assert.equal(low.notes[0].level, 'bad');
  assert.equal(low.quality, 'high');
  const high = recommend(baseAnalysis, paperById('premium-glossy'), { ppi: 320, borderless: false });
  assert.equal(high.quality, 'best');
});

test('recommend: flat graphics get no sharpening, monochrome gets grayscale and no saturation', () => {
  const flat = recommend({ ...baseAnalysis, flatArt: true }, paperById('matte'), { ppi: 300, borderless: false });
  assert.equal(flat.adjustments.sharpen, 0);
  const mono = recommend({ ...baseAnalysis, monochrome: true }, paperById('matte'), { ppi: 300, borderless: false });
  assert.equal(mono.monochrome, true);
  assert.equal(mono.adjustments.saturation, 0);
});

test('recommend: out-of-gamut colours are softened and flagged', () => {
  const vivid = recommend({ ...baseAnalysis, gamutRisk: 0.2, highSatShare: 0.3 }, paperById('ultra-glossy'), { ppi: 300, borderless: false });
  assert.ok(vivid.adjustments.saturation < 0);
  assert.ok(vivid.notes.some((n) => n.level === 'warn'));
});

test('layout: fit keeps the whole image inside the printable area', () => {
  const l = computeLayout(a4, { fit: 'fit', marginMm: 0, autoRotate: true }, 3000, 4000);
  assert.equal(l.rotate, false);
  assert.ok(l.rect.x >= 8.5 - 1e-6 && l.rect.x + l.rect.width <= 586.5 + 1e-6);
  assert.ok(Math.abs(l.rect.width / l.rect.height - 0.75) < 1e-6);
});

test('layout: landscape artwork rotates onto a portrait sheet', () => {
  const l = computeLayout(a4, { fit: 'fit', marginMm: 0, autoRotate: true }, 4000, 3000);
  assert.equal(l.rotate, true);
  assert.deepEqual(l.view, { width: 842, height: 595 });
  assert.ok(l.rect.width > l.rect.height);
});

test('layout: borderless fill covers the full page and crops to its shape', () => {
  const l = computeLayout(a4b, { fit: 'fill', marginMm: 0, autoRotate: false }, 4000, 4000);
  assert.deepEqual(l.rect, { x: 0, y: 0, width: 595, height: 842 });
  assert.ok(Math.abs(l.crop.sw / l.crop.sh - 595 / 842) < 1e-6);
});

test('layout: custom width is honoured and ppi computed', () => {
  const l = computeLayout(a4, { fit: 'custom', customWidthMm: 100, marginMm: 0, autoRotate: true }, 1181, 1181);
  assert.ok(Math.abs(l.rect.width - (100 / 25.4) * 72) < 1e-6);
  assert.ok(Math.abs(l.ppi - 300) < 1);
});

test('adjustments: shadow lift keeps pure black and white fixed', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 50, 50, 50, 255]);
  applyAdjustments(px, 3, 1, { brightness: 0, shadowLift: 0.1, contrast: 0, saturation: 0, sharpen: 0 });
  assert.deepEqual([...px.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...px.slice(4, 7)], [255, 255, 255]);
  assert.ok(px[8] > 50);
});

test('adjustments: saturation boost leaves greys neutral', () => {
  const px = new Uint8ClampedArray([128, 128, 128, 255, 200, 100, 100, 255]);
  applyAdjustments(px, 2, 1, { brightness: 0, shadowLift: 0, contrast: 0, saturation: 0.3, sharpen: 0 });
  assert.deepEqual([...px.slice(0, 3)], [128, 128, 128]);
  assert.ok(px[4] - px[5] > 100);
});
