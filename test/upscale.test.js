import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from '../server/library.js';
import { Upscaler, pngSize } from '../server/upscale.js';
import { recommendedScale, needsUpscale, sharpSize, printSource, defaultModel } from '../public/js/upscale.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeBin = path.join(here, 'fake-upscaler.mjs');

function pngHeader(w, h, tail = '') {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return Buffer.concat([b, Buffer.from(tail, 'latin1')]);
}

// Resizes our fake PNGs the way sips -Z would: longest side to `edge`.
async function fakeShrink(file, edge) {
  const { width, height } = await pngSize(file);
  const k = edge / Math.max(width, height);
  await writeFile(file, pngHeader(Math.round(width * k), Math.round(height * k)));
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 's9-up-'));
  const models = path.join(dir, 'models');
  await mkdir(models);
  await writeFile(path.join(models, 'realesrgan-x4plus.param'), '');
  const lib = new Library(path.join(dir, 'lib'));
  await lib.init();
  const up = new Upscaler(lib, { bin: [process.execPath, fakeBin], models }, fakeShrink);
  await up.init();
  const add = async (w, h, tail = '') => {
    const art = await lib.addArtwork({ originalName: `w${w}${tail}.png`, buffer: pngHeader(w, h, tail), mime: 'image/png' });
    return lib.update(art.id, { width: w, height: h });
  };
  return { dir, lib, up, add, done: () => rm(dir, { recursive: true, force: true }) };
}

test('upscale 4×: saves a copy beside the original and records it', async () => {
  const { lib, up, add, done, dir } = await setup();
  try {
    assert.equal(up.available, true);
    const art = await add(900, 1316);
    up.start(art.id, { scale: 4, model: 'painting' });
    await up.queue;
    assert.equal(up.job(art.id).state, 'done');
    assert.equal(up.job(art.id).progress, 1);
    assert.deepEqual(
      { w: art.upscaled.width, h: art.upscaled.height, scale: art.upscaled.scale, file: art.upscaled.file },
      { w: 3600, h: 5264, scale: 4, file: `${art.id}-4x.png` },
    );
    assert.deepEqual(await readdir(path.join(dir, 'lib', 'upscaled')), [`${art.id}-4x.png`]);
    // The original is untouched.
    assert.deepEqual(await pngSize(path.join(dir, 'lib', 'originals', art.original)), { width: 900, height: 1316 });
    assert.equal(JSON.parse(await readFile(path.join(dir, 'lib', 'library.json'), 'utf8')).artworks[0].upscaled.width, 3600);
  } finally {
    await done();
  }
});

test('upscale 2×: shrinks the 4× result, and replaces an older copy', async () => {
  const { up, add, done, dir } = await setup();
  try {
    const art = await add(1000, 800);
    up.start(art.id, { scale: 4 });
    await up.queue;
    up.start(art.id, { scale: 2, model: 'graphic' });
    await up.queue;
    assert.equal(art.upscaled.width, 2000);
    assert.equal(art.upscaled.height, 1600);
    assert.equal(art.upscaled.model, 'graphic');
    assert.deepEqual(await readdir(path.join(dir, 'lib', 'upscaled')), [`${art.id}-2x.png`]);
  } finally {
    await done();
  }
});

test('upscale: failures are reported plainly and leave nothing behind', async () => {
  const { up, add, done, dir } = await setup();
  try {
    const art = await add(500, 500, 'BROKEN');
    up.start(art.id, { scale: 4 });
    await up.queue;
    const job = up.job(art.id);
    assert.equal(job.state, 'failed');
    assert.match(job.error, /graphics chip/);
    assert.equal(art.upscaled, undefined);
    assert.deepEqual(await readdir(path.join(dir, 'lib', 'upscaled')), []);
  } finally {
    await done();
  }
});

test('upscale: refuses bad requests', async () => {
  const { lib, up, add, done } = await setup();
  try {
    const big = await add(5000, 3000);
    assert.throws(() => up.start(big.id, { scale: 4 }), /16,000 pixels/);
    assert.throws(() => up.start(big.id, { scale: 5 }), /Scale must be/);
    assert.throws(() => up.start(big.id, { scale: 2, model: 'oil' }), /Unknown/);
    assert.throws(() => up.start('nope', { scale: 2 }), /not found/);
    const off = new Upscaler(lib, null);
    await off.init();
    assert.throws(() => off.start(big.id, { scale: 2 }), /Mac app/);
  } finally {
    await done();
  }
});

test('upscale: removing the copy or the work deletes the upscaled file', async () => {
  const { lib, up, add, done, dir } = await setup();
  try {
    const a = await add(400, 400);
    const b = await add(300, 600);
    for (const art of [a, b]) {
      up.start(art.id, { scale: 4 });
      await up.queue;
    }
    await up.discard(a.id);
    assert.equal(a.upscaled, null);
    await lib.remove(b.id);
    assert.deepEqual(await readdir(path.join(dir, 'lib', 'upscaled')), []);
  } finally {
    await done();
  }
});

test('upscale advice: suggested scale, when it is needed, and what prints', () => {
  assert.equal(recommendedScale({ width: 900, height: 1316 }), 3); // 2700 × 3948 reaches A4 at 300 ppi
  assert.equal(recommendedScale({ width: 1500, height: 2000 }), 2);
  assert.equal(recommendedScale({ width: 400, height: 600 }), 4);
  assert.equal(needsUpscale({ width: 900, height: 1316 }), true);
  assert.equal(needsUpscale({ width: 2480, height: 3508 }), false);
  assert.equal(needsUpscale({ width: 900, height: 1316, upscaled: { width: 3600, height: 5264 } }), false);
  assert.equal(sharpSize(3600, 5264).paper, 'A4 / Letter');
  assert.equal(sharpSize(900, 1316).paper, null);
  assert.equal(printSource({ display: 'a.jpg' }), '/files/display/a.jpg');
  assert.equal(printSource({ display: 'a.jpg', upscaled: { file: 'a-4x.png' } }), '/files/upscaled/a-4x.png');
  assert.equal(defaultModel({ analysis: { flatArt: true } }), 'graphic');
  assert.equal(defaultModel({ analysis: null }), 'painting');
});
