import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Library } from '../server/library.js';

async function tempLibrary() {
  const dir = await mkdtemp(path.join(tmpdir(), 's9-lib-'));
  const lib = new Library(dir);
  await lib.init();
  return { lib, dir, done: () => rm(dir, { recursive: true, force: true }) };
}

const png = (n) => Buffer.from(`fake-png-${n}`);

test('importing the exact same file again hands back the copy already there', async () => {
  const { lib, done } = await tempLibrary();
  try {
    const first = await lib.addArtwork({ originalName: 'dusk.png', buffer: png(1), mime: 'image/png' });
    const again = await lib.addArtwork({ originalName: 'dusk copy.png', buffer: png(1), mime: 'image/png' });
    assert.equal(again.id, first.id);
    assert.equal(again.alreadyInLibrary, true);
    assert.equal(lib.data.artworks.length, 1);
    await lib.addArtwork({ originalName: 'other.png', buffer: png(2), mime: 'image/png' });
    assert.equal(lib.data.artworks.length, 2);
  } finally {
    await done();
  }
});

test('works imported before fingerprints existed get one when hashes are asked for', async () => {
  const { lib, done } = await tempLibrary();
  try {
    const a = await lib.addArtwork({ originalName: 'a.png', buffer: png(1), mime: 'image/png' });
    const b = await lib.addArtwork({ originalName: 'b.png', buffer: png(2), mime: 'image/png' });
    delete a.hash;
    delete b.hash;
    const hashes = await lib.fileHashes();
    assert.match(hashes[a.id], /^[0-9a-f]{64}$/);
    assert.notEqual(hashes[a.id], hashes[b.id]);
    // An older library copy of an existing file is also caught on import.
    const again = await lib.addArtwork({ originalName: 'a.png', buffer: png(1), mime: 'image/png' });
    assert.equal(again.id, a.id);
  } finally {
    await done();
  }
});

test('merging duplicates keeps one copy with everything from the others', async () => {
  const { lib, dir, done } = await tempLibrary();
  try {
    const col = await lib.addCollection({ name: 'Mosaics' });
    const keep = await lib.addArtwork({ originalName: 'city.png', buffer: png(1), mime: 'image/png' });
    const copy = await lib.addArtwork({ originalName: 'city-export.png', buffer: png(2), mime: 'image/png' });
    await lib.update(keep.id, { tags: ['city'], rating: 2, notes: 'First proof' });
    await lib.update(copy.id, { tags: ['mosaic', 'city'], rating: 4, favorite: true, collections: [col.id], notes: 'Print on velvet' });
    await lib.recordPrint({ artworkId: copy.id, title: 'city', copies: 2 });

    const merged = await lib.mergeDuplicates(keep.id, [copy.id, keep.id]);
    assert.deepEqual(lib.data.artworks.map((a) => a.id), [keep.id]);
    assert.deepEqual(merged.tags.sort(), ['city', 'mosaic']);
    assert.deepEqual(merged.collections, [col.id]);
    assert.equal(merged.rating, 4);
    assert.equal(merged.favorite, true);
    assert.equal(merged.printCount, 2);
    assert.equal(merged.notes, 'First proof\n\nPrint on velvet');
    assert.equal(lib.history()[0].artworkId, keep.id);
    // The removed copy's original is in the trash folder, not deleted.
    assert.ok((await readdir(path.join(dir, 'trash'))).includes(copy.original));
    const saved = JSON.parse(await readFile(path.join(dir, 'library.json'), 'utf8'));
    assert.equal(saved.artworks.length, 1);
  } finally {
    await done();
  }
});

test('merging refuses unknown works', async () => {
  const { lib, done } = await tempLibrary();
  try {
    const a = await lib.addArtwork({ originalName: 'a.png', buffer: png(1), mime: 'image/png' });
    await assert.rejects(lib.mergeDuplicates(a.id, ['missing']), /not found/);
    assert.equal(lib.data.artworks.length, 1);
  } finally {
    await done();
  }
});
