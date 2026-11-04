// Stores artworks as plain files in a library folder, with all organisation
// (titles, tags, ratings, collections, print history) in library.json beside them.

import { mkdir, readFile, writeFile, rename, copyFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { httpError } from './printing.js';

const run = promisify(execFile);
const BROWSER_SAFE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
// Formats macOS can convert with the built-in `sips` tool.
const CONVERTIBLE = new Set(['.tif', '.tiff', '.heic', '.heif', '.psd', '.bmp', '.jp2', '.dng', '.cr2', '.nef', '.arw']);
const EDITABLE = ['title', 'tags', 'rating', 'favorite', 'collections', 'notes', 'width', 'height', 'analysis', 'paperId'];
const HISTORY_LIMIT = 1000;

export class Library {
  constructor(dir) {
    this.dir = dir;
    this.dbFile = path.join(dir, 'library.json');
    this.data = { version: 1, artworks: [], collections: [], history: [] };
    this.writing = Promise.resolve();
  }

  async init() {
    for (const sub of ['originals', 'display', 'thumbs', 'trash']) {
      await mkdir(path.join(this.dir, sub), { recursive: true });
    }
    try {
      this.data = { ...this.data, ...JSON.parse(await readFile(this.dbFile, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep a copy of a damaged file rather than silently overwriting it.
        await copyFile(this.dbFile, `${this.dbFile}.damaged-${Date.now()}`).catch(() => {});
      }
    }
  }

  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.dbFile}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.dbFile);
    });
    return this.writing;
  }

  snapshot() {
    return { artworks: this.data.artworks, collections: this.data.collections };
  }

  fileFor(kind, name) {
    if (!['originals', 'display', 'thumbs'].includes(kind) || !/^[\w-]+\.[\w]+$/.test(name)) return null;
    // Browser-friendly originals are viewed directly rather than copied.
    if (kind === 'display' && this.data.artworks.some((a) => a.display === name && a.original === name)) kind = 'originals';
    return path.join(this.dir, kind, name);
  }

  find(id) {
    const art = this.data.artworks.find((a) => a.id === id);
    if (!art) throw httpError(404, 'Artwork not found.');
    return art;
  }

  async addArtwork({ originalName, buffer, mime }) {
    const id = randomUUID();
    const ext = (path.extname(originalName) || mimeExt(mime)).toLowerCase();
    const original = `${id}${ext}`;
    await writeFile(path.join(this.dir, 'originals', original), buffer);

    let display = null;
    let note = null;
    if (BROWSER_SAFE.has(ext)) {
      display = original;
    } else if (CONVERTIBLE.has(ext) && process.platform === 'darwin') {
      const out = `${id}.png`;
      try {
        await run('sips', ['-s', 'format', 'png', path.join(this.dir, 'originals', original), '--out', path.join(this.dir, 'display', out)]);
        display = out;
      } catch {
        note = 'macOS could not convert this file for viewing.';
      }
    } else {
      note = `${ext.toUpperCase().slice(1)} files are converted for viewing on the Mac. Save as JPEG, PNG or TIFF to use it here.`;
    }

    const art = {
      id,
      title: path.basename(originalName, path.extname(originalName)).replace(/[_-]+/g, ' ').trim() || 'Untitled',
      originalName,
      original,
      display,
      thumb: null,
      size: buffer.length,
      mime,
      width: null,
      height: null,
      addedAt: new Date().toISOString(),
      tags: [],
      rating: 0,
      favorite: false,
      collections: [],
      notes: '',
      analysis: null,
      paperId: null,
      lastPrintedAt: null,
      printCount: 0,
      note,
    };
    this.data.artworks.unshift(art);
    await this.save();
    return art;
  }

  async update(id, patch) {
    const art = this.find(id);
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      let v = patch[key];
      if (key === 'tags') v = [...new Set((Array.isArray(v) ? v : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
      if (key === 'collections') v = (Array.isArray(v) ? v : []).filter((c) => this.data.collections.some((x) => x.id === c));
      if (key === 'rating') v = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
      if (key === 'favorite') v = Boolean(v);
      if (key === 'title') v = String(v).slice(0, 200) || 'Untitled';
      if (key === 'notes') v = String(v).slice(0, 5000);
      art[key] = v;
    }
    await this.save();
    return art;
  }

  async setThumb(id, buffer) {
    const art = this.find(id);
    art.thumb = `${id}.jpg`;
    await writeFile(path.join(this.dir, 'thumbs', art.thumb), buffer);
    await this.save();
    return art;
  }

  // Deleted artworks go to the library's trash folder, never straight to oblivion.
  async remove(id) {
    const art = this.find(id);
    const trashDir = path.join(this.dir, 'trash');
    await rename(path.join(this.dir, 'originals', art.original), path.join(trashDir, `${art.original}`)).catch(() => {});
    await writeFile(path.join(trashDir, `${id}.json`), JSON.stringify(art, null, 2));
    for (const [kind, file] of [['display', art.display], ['thumbs', art.thumb]]) {
      if (file && file !== art.original) await unlink(path.join(this.dir, kind, file)).catch(() => {});
    }
    this.data.artworks = this.data.artworks.filter((a) => a.id !== id);
    await this.save();
  }

  async addCollection(name) {
    const col = { id: randomUUID(), name: String(name).trim().slice(0, 100) || 'Untitled collection', createdAt: new Date().toISOString() };
    this.data.collections.push(col);
    await this.save();
    return col;
  }

  async renameCollection(id, name) {
    const col = this.data.collections.find((c) => c.id === id);
    if (!col) throw httpError(404, 'Collection not found.');
    col.name = String(name).trim().slice(0, 100) || col.name;
    await this.save();
    return col;
  }

  async removeCollection(id) {
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    for (const art of this.data.artworks) art.collections = art.collections.filter((c) => c !== id);
    await this.save();
  }

  async recordPrint(entry) {
    this.data.history.unshift({ ...entry, at: new Date().toISOString() });
    this.data.history.length = Math.min(this.data.history.length, HISTORY_LIMIT);
    const art = this.data.artworks.find((a) => a.id === entry.artworkId);
    if (art) {
      art.lastPrintedAt = new Date().toISOString();
      art.printCount = (art.printCount || 0) + (entry.copies || 1);
      if (entry.paperId) art.paperId = entry.paperId;
    }
    await this.save();
  }

  history() {
    return this.data.history.slice(0, 200);
  }
}

function mimeExt(mime) {
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/tiff': '.tif', 'image/heic': '.heic', 'image/gif': '.gif' }[mime] || '.bin';
}
