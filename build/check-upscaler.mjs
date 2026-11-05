// Build-time check of the bundled upscaler, through the app's own code:
// makes a throwaway library with one small image, upscales it 4× and 2×
// (2× uses macOS's sips to resize), and fails the build if anything's off.
//
//   node build/check-upscaler.mjs <upscaler folder> <test image.png>

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Library } from '../server/library.js';
import { Upscaler, pngSize } from '../server/upscale.js';
import { upscalerIn } from '../server.js';

const [dir, image] = process.argv.slice(2);
const work = await mkdtemp(path.join(tmpdir(), 's9-upscale-check-'));
const fail = (msg) => {
  console.error(`upscaler check failed: ${msg}`);
  process.exit(1);
};

try {
  const lib = new Library(work);
  await lib.init();
  const buffer = await readFile(image);
  const { width, height } = await pngSize(image);
  const art = await lib.addArtwork({ originalName: 'check.png', buffer, mime: 'image/png' });
  await lib.update(art.id, { width, height });

  const up = new Upscaler(lib, upscalerIn(dir));
  await up.init();
  if (!up.available) fail(`not found in ${dir}`);

  for (const [scale, model] of [[4, 'painting'], [2, 'graphic']]) {
    const started = Date.now();
    up.start(art.id, { scale, model });
    await up.queue;
    const job = up.job(art.id);
    if (job.state !== 'done') fail(`${scale}× ${model}: ${job.state} ${job.error || ''}`);
    const u = lib.find(art.id).upscaled;
    if (u.width !== width * scale || u.height !== height * scale) {
      fail(`${scale}× gave ${u.width} × ${u.height}, expected ${width * scale} × ${height * scale}`);
    }
    console.log(`  ${scale}× ${model}: ${width} × ${height} → ${u.width} × ${u.height} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
