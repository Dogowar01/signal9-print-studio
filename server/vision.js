// Content recognition: runs the signal9-vision helper (Apple's Vision framework,
// on the Mac only) over each artwork in the background.
//
// - What's in the picture (labels like "cityscape" or "flower") is saved on
//   the artwork as `vision.labels`, so the library can group and search by it.
// - Vision's feature print (a vector; similar content lands close together) is
//   kept in features.json beside library.json, and used to find similar works.

import { execFile } from 'node:child_process';
import { access, readFile, writeFile, rename, constants } from 'node:fs/promises';
import path from 'node:path';

export const VISION_VERSION = 1;
const BATCH = 8;

export class Vision {
  /**
   * @param {import('./library.js').Library} library
   * @param {string[]|null} helper command (and leading arguments) that runs signal9-vision
   */
  constructor(library, helper) {
    this.library = library;
    this.helper = helper;
    this.available = false;
    this.file = path.join(library.dir, 'features.json');
    this.prints = {}; // artwork id -> Float32Array
    this.running = null;
    this.pending = 0;
  }

  async init() {
    if (this.helper?.length) {
      try {
        await access(this.helper[0], constants.X_OK);
        this.available = true;
      } catch {
        this.available = false;
      }
    }
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      for (const [id, b64] of Object.entries(saved)) this.prints[id] = decode(b64);
    } catch { /* first run */ }
    if (this.available) this.scan();
  }

  status() {
    return { available: this.available, pending: this.pending };
  }

  needsLook(art) {
    return art.vision?.v !== VISION_VERSION && (art.display || art.original);
  }

  // Looks at every artwork that hasn't been looked at yet. Safe to call often.
  scan() {
    if (!this.available) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        const todo = this.library.data.artworks.filter((a) => this.needsLook(a));
        this.pending = todo.length;
        for (let i = 0; i < todo.length; i += BATCH) {
          await this.look(todo.slice(i, i + BATCH));
          this.pending = Math.max(0, todo.length - i - BATCH);
        }
      } while (this.again);
      this.pending = 0;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  async look(arts) {
    const files = new Map();
    for (const a of arts) {
      // The browser-friendly copy is enough for recognition and always readable.
      const kind = a.display && a.display !== a.original ? 'display' : 'originals';
      files.set(path.join(this.library.dir, kind, kind === 'display' ? a.display : a.original), a);
    }
    let lines = [];
    try {
      const [cmd, ...pre] = this.helper;
      const out = await new Promise((resolve, reject) => {
        execFile(cmd, [...pre, ...files.keys()], { maxBuffer: 64 * 1024 * 1024, timeout: 300000 }, (err, stdout) => {
          if (err && !stdout) reject(err);
          else resolve(stdout);
        });
      });
      lines = out.split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch (err) {
      // The helper itself failed: leave these works to try again next time.
      console.warn('signal9-vision failed:', err.message);
      return;
    }
    const byPath = new Map(lines.map((r) => [r.path, r]));
    for (const [file, art] of files) {
      if (!this.library.data.artworks.includes(art)) continue; // removed meanwhile
      const r = byPath.get(file);
      art.vision = {
        v: VISION_VERSION,
        labels: (r?.labels || []).map(([id, c]) => [String(id), Number(c)]),
        at: new Date().toISOString(),
        ...(r && !r.error ? {} : { failed: true }),
      };
      if (r?.print) this.prints[art.id] = decode(r.print);
    }
    await this.library.save();
    await this.savePrints();
  }

  async savePrints() {
    const ids = new Set(this.library.data.artworks.map((a) => a.id));
    const out = {};
    for (const [id, vec] of Object.entries(this.prints)) {
      if (ids.has(id)) out[id] = encode(vec);
      else delete this.prints[id];
    }
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(out));
    await rename(tmp, this.file);
  }

  /** How alike in content every other artwork is to `id`, from -1 to 1. */
  similarTo(id) {
    const target = this.prints[id];
    if (!target) return {};
    const out = {};
    for (const a of this.library.data.artworks) {
      const vec = this.prints[a.id];
      if (a.id !== id && vec && vec.length === target.length) out[a.id] = Math.round(cosine(target, vec) * 1000) / 1000;
    }
    return out;
  }
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function decode(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
}

function encode(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64');
}
