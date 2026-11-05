import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from '../server/library.js';
import { Vision, cosine } from '../server/vision.js';
import { STYLE_VERSION, styleSimilarity, styleGroup, subjectGroup, subjectWords, rankSimilar } from '../public/js/similar.js';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-vision.mjs');

// A style signature: palette shares by 30° hue bin from red, how much is coloured, tone, etc.
function look({ hue = {}, colour = 0.6, vivid = 0.6, light = 0.5, contrast = 0.2, detail = 0.3 }) {
  const h = new Array(12).fill(0);
  for (const [bin, v] of Object.entries(hue)) h[bin] = v;
  const lum = [0, 0, 0, 0, 0];
  lum[Math.min(4, Math.floor(light * 5))] = 1;
  return { v: STYLE_VERSION, hue: h, colour, vivid, lum, light, sat: colour * vivid, contrast, detail };
}
const emberDark = look({ hue: { 0: 0.4, 1: 0.6 }, light: 0.2 });
const rustDark = look({ hue: { 0: 0.5, 1: 0.5 }, light: 0.25, vivid: 0.55 });
const paleBlue = look({ hue: { 7: 1 }, colour: 0.5, light: 0.8, vivid: 0.4 });
const greyInk = look({ colour: 0.01, vivid: 0.2, light: 0.5 });
// A watercolour on white paper: little of it coloured, but clearly in colour.
const paleWash = look({ hue: { 1: 0.7, 11: 0.3 }, colour: 0.06, vivid: 0.45, light: 0.84 });

test('style: works with the same palette and tone score closer than different ones', () => {
  assert.ok(styleSimilarity(emberDark, rustDark) > 0.8);
  assert.ok(styleSimilarity(emberDark, paleBlue) < styleSimilarity(emberDark, rustDark) - 0.3);
  assert.equal(styleSimilarity(emberDark, emberDark), 1);
});

test('style groups get plain names', () => {
  assert.equal(styleGroup(emberDark).name, 'Dark warm tones');
  assert.equal(styleGroup(paleBlue).name, 'Pale blues');
  assert.equal(styleGroup(greyInk).name, 'Black & white');
  assert.equal(styleGroup(look({ hue: { 1: 0.5, 7: 0.5 }, light: 0.5 })).name, 'Blues & warm tones');
  assert.equal(styleGroup(paleWash).name, 'Pale muted warm tones');
  assert.equal(styleGroup(null).sort, 99);
  assert.equal(styleGroup({ ...emberDark, v: 1 }).sort, 99); // older measurements get redone
});

test('subjects: a landscape is a landscape, not a city', () => {
  // Real signal9-vision output for macOS's "Valley Light" desktop picture (GitHub Actions build).
  const valley = { labels: [['outdoor', 0.902], ['sky', 0.879], ['blue_sky', 0.851], ['rocks', 0.777], ['structure', 0.777]] };
  assert.equal(subjectGroup(valley).name, 'Landscapes');
});

test('subjects: what a picture is of beats its backdrop', () => {
  const city = { labels: [['sky', 0.92], ['cityscape', 0.8], ['structure', 0.85]] };
  assert.equal(subjectGroup(city).name, 'Cities & buildings');
  assert.equal(subjectGroup({ labels: [['sunflower', 0.6], ['sky', 0.7]] }).name, 'Flowers & plants');
  assert.equal(subjectGroup({ labels: [['night_sky', 0.7]] }).name, 'Sky & space');
  assert.equal(subjectGroup({ labels: [['tool', 0.6]] }).name, 'Tool');
  assert.equal(subjectGroup({ labels: [['tool', 0.2]] }).name, 'Abstract & other');
  assert.equal(subjectGroup(null).name, 'Not yet recognised');
  assert.deepEqual(subjectWords({ labels: [['night_sky', 0.7], ['tool', 0.2]] }), ['night sky']);
});

test('more like this: blends subject and look, and each can be used alone', () => {
  const works = [
    { id: 't', style: emberDark },
    { id: 'samelook', style: rustDark },
    { id: 'samesubject', style: paleBlue },
    { id: 'neither', style: greyInk },
  ];
  const content = { samelook: 0.1, samesubject: 0.95, neither: 0.05 };
  assert.equal(rankSimilar(works[0], works, content, 'style')[0].art.id, 'samelook');
  assert.equal(rankSimilar(works[0], works, content, 'subject')[0].art.id, 'samesubject');
  const both = rankSimilar(works[0], works, content).map((x) => x.art.id);
  assert.equal(both.at(-1), 'neither');
  // Off the Mac there's no content similarity; look alone decides.
  assert.equal(rankSimilar(works[0], works, {})[0].art.id, 'samelook');
});

test('vision: labels land on artworks and content similarity is served', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's9-vision-'));
  try {
    const lib = new Library(dir);
    await lib.init();
    const city = await lib.addArtwork({ originalName: 'city.png', buffer: Buffer.from('city:1'), mime: 'image/png' });
    const city2 = await lib.addArtwork({ originalName: 'city2.png', buffer: Buffer.from('city:2'), mime: 'image/png' });
    const flower = await lib.addArtwork({ originalName: 'flower.png', buffer: Buffer.from('flower:1'), mime: 'image/png' });
    const bad = await lib.addArtwork({ originalName: 'bad.png', buffer: Buffer.from('bad:1'), mime: 'image/png' });

    const vision = new Vision(lib, [process.execPath, fake]);
    await vision.init();
    assert.equal(vision.available, true);
    await vision.scan();
    assert.equal(vision.status().pending, 0);

    assert.deepEqual(city.vision.labels[0], ['cityscape', 0.81]);
    assert.equal(bad.vision.failed, true);
    const sims = vision.similarTo(city.id);
    assert.ok(sims[city2.id] > sims[flower.id]);
    assert.equal(sims[city.id], undefined);

    // Feature prints survive a restart, and forgotten works are dropped from them.
    await lib.remove(flower.id);
    await vision.savePrints();
    const again = new Vision(lib, null);
    await again.init();
    assert.equal(again.available, false);
    assert.ok(again.similarTo(city.id)[city2.id] > 0.99);
    const saved = JSON.parse(await readFile(path.join(dir, 'features.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), [city.id, city2.id].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vision: a missing helper means no recognition, not an error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's9-vision-'));
  try {
    const lib = new Library(dir);
    await lib.init();
    const vision = new Vision(lib, [path.join(dir, 'nope')]);
    await vision.init();
    assert.deepEqual(vision.status(), { available: false, pending: 0 });
    assert.deepEqual(vision.similarTo('x'), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cosine similarity', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});
