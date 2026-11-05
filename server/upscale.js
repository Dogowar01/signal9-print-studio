// AI upscaling for print, with Real-ESRGAN (realesrgan-ncnn-vulkan, bundled in
// the Mac app). Runs on the Mac's graphics chip; nothing is uploaded.
//
// The upscaled copy is saved in the library's `upscaled` folder and recorded on
// the artwork as `upscaled`; the original is never touched. The print studio
// prints from the upscaled copy when there is one.

import { spawn, execFile } from 'node:child_process';
import { access, rename, unlink, open, constants } from 'node:fs/promises';
import path from 'node:path';
import { httpError } from './printing.js';

export const MODELS = {
  // Paintings, photos and anything with texture.
  painting: 'realesrgan-x4plus',
  // Illustration, line art and flat graphics: keeps edges clean.
  graphic: 'realesrgan-x4plus-anime',
};
export const MAX_EDGE = 16000; // longest side of an upscaled copy, in pixels
const NATIVE = 4; // the models always enlarge 4×; smaller scales are resized down afterwards

export class Upscaler {
  /**
   * @param {import('./library.js').Library} library
   * @param {{ bin: string[], models: string } | null} tool the upscaler command and its models folder
   * @param {(file: string, longEdge: number) => Promise<void>} [shrink] resizes a PNG in place
   */
  constructor(library, tool, shrink = sipsShrink) {
    this.library = library;
    this.tool = tool;
    this.shrink = shrink;
    this.available = false;
    this.jobs = new Map(); // artwork id -> job
    this.queue = Promise.resolve();
  }

  async init() {
    if (!this.tool?.bin?.length) return;
    try {
      await access(this.tool.bin[0], constants.X_OK);
      await access(path.join(this.tool.models, `${MODELS.painting}.param`));
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  status() {
    return { available: this.available, jobs: [...this.jobs.values()].map(publicJob) };
  }

  job(id) {
    const j = this.jobs.get(id);
    return j ? publicJob(j) : null;
  }

  /** Queues an upscale of artwork `id`. scale: 2, 3 or 4; model: 'painting' | 'graphic'. */
  start(id, { scale = 4, model = 'painting' } = {}) {
    if (!this.available) throw httpError(503, 'Upscaling runs in the Signal9 Print Studio Mac app.');
    const art = this.library.find(id);
    if (!art.display) throw httpError(400, 'This work has no preview the upscaler can read.');
    scale = Number(scale);
    if (![2, 3, 4].includes(scale)) throw httpError(400, 'Scale must be 2, 3 or 4.');
    if (!MODELS[model]) throw httpError(400, 'Unknown upscaling style.');
    if (art.width && Math.max(art.width, art.height) * scale > MAX_EDGE) {
      throw httpError(400, `That would be over ${MAX_EDGE.toLocaleString('en')} pixels wide. Choose a smaller scale.`);
    }
    const running = this.jobs.get(id);
    if (running && (running.state === 'queued' || running.state === 'running')) return publicJob(running);

    const job = { id, scale, model, state: 'queued', progress: 0, error: null, startedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    this.queue = this.queue.then(() => this.run(job)).catch(() => {});
    return publicJob(job);
  }

  async run(job) {
    const art = this.library.data.artworks.find((a) => a.id === job.id);
    if (!art) {
      job.state = 'failed';
      job.error = 'The work was removed.';
      return;
    }
    job.state = 'running';
    const dir = path.join(this.library.dir, 'upscaled');
    const input = this.library.fileFor('display', art.display);
    const tmp = path.join(dir, `${art.id}.working.png`);
    try {
      await this.enlarge(input, tmp, MODELS[job.model], (p) => { job.progress = p; });
      let { width, height } = await pngSize(tmp);
      if (job.scale < NATIVE) {
        const srcW = Math.round(width / NATIVE), srcH = Math.round(height / NATIVE);
        await this.shrink(tmp, Math.max(srcW, srcH) * job.scale);
        ({ width, height } = await pngSize(tmp));
      }
      const file = `${art.id}-${job.scale}x.png`;
      await rename(tmp, path.join(dir, file));
      if (art.upscaled?.file && art.upscaled.file !== file) await unlink(path.join(dir, art.upscaled.file)).catch(() => {});
      art.upscaled = { file, width, height, scale: job.scale, model: job.model, at: new Date().toISOString() };
      await this.library.save();
      job.state = 'done';
      job.progress = 1;
    } catch (err) {
      await unlink(tmp).catch(() => {});
      job.state = 'failed';
      job.error = err.message || 'Upscaling failed.';
    }
  }

  // Runs the upscaler, reporting progress from its "12.50%" lines.
  enlarge(input, output, model, onProgress) {
    const [cmd, ...pre] = this.tool.bin;
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, [...pre, '-i', input, '-o', output, '-n', model, '-m', this.tool.models, '-s', String(NATIVE), '-f', 'png']);
      let log = '';
      const read = (chunk) => {
        const text = chunk.toString();
        log = (log + text).slice(-4000);
        const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)];
        if (pcts.length) onProgress(Math.min(0.99, Number(pcts.at(-1)[1]) / 100));
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', reject);
      child.on('close', async (code) => {
        const made = await access(output).then(() => true, () => false);
        if (code === 0 && made) resolve();
        else reject(new Error(friendlyError(log) || `The upscaler stopped (code ${code}).`));
      });
    });
  }

  // Removes an artwork's upscaled copy.
  async discard(id) {
    const art = this.library.find(id);
    if (art.upscaled?.file) await unlink(path.join(this.library.dir, 'upscaled', art.upscaled.file)).catch(() => {});
    art.upscaled = null;
    this.jobs.delete(id);
    await this.library.save();
    return art;
  }
}

function publicJob(j) {
  return { id: j.id, scale: j.scale, model: j.model, state: j.state, progress: Math.round(j.progress * 1000) / 1000, error: j.error };
}

function friendlyError(log) {
  if (/vkCreate|invalid gpu|no vulkan|MoltenVK/i.test(log)) return 'The upscaler could not use this Mac’s graphics chip.';
  if (/decode image .* failed|failed to (load|read)/i.test(log)) return 'The upscaler could not read this image.';
  if (/encode image .* failed|failed to (save|write)/i.test(log)) return 'The upscaler could not save its result. Is the disk full?';
  return '';
}

// Width and height from a PNG's header.
export async function pngSize(file) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('The upscaler did not produce a PNG.');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    await fh.close();
  }
}

// High-quality downsizing with macOS's built-in `sips`.
function sipsShrink(file, longEdge) {
  return new Promise((resolve, reject) => {
    execFile('sips', ['-Z', String(Math.round(longEdge)), file, '--out', file], (err) => (err ? reject(err) : resolve()));
  });
}

