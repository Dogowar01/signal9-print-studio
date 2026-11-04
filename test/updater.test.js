import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, pickUpdate, summarizeNotes } from '../electron/update-helpers.js';

const release = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body: 'Faster printing and a new paper.\n\n---\nInstall notes',
  assets: [
    { name: `Signal9-Print-Studio-${tag.slice(1)}-arm64.dmg`, size: 100, browser_download_url: 'https://example.test/a.dmg' },
  ],
  ...extra,
});

test('isNewer compares versions numerically', () => {
  assert.equal(isNewer('1.2.0', '1.1.0'), true);
  assert.equal(isNewer('v1.10.0', '1.9.3'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.0.9', '1.1.0'), false);
  assert.equal(isNewer('2.0', '1.9.9'), true);
});

test('pickUpdate offers a newer release with a matching .dmg', () => {
  const offer = pickUpdate(release('v1.2.0'), '1.1.0', 'arm64');
  assert.equal(offer.version, '1.2.0');
  assert.equal(offer.asset.name, 'Signal9-Print-Studio-1.2.0-arm64.dmg');
  assert.equal(offer.notes, 'Faster printing and a new paper.');
});

test('pickUpdate ignores same/older versions, drafts, prereleases and other architectures', () => {
  assert.equal(pickUpdate(release('v1.1.0'), '1.1.0', 'arm64'), null);
  assert.equal(pickUpdate(release('v1.0.0'), '1.1.0', 'arm64'), null);
  assert.equal(pickUpdate(release('v1.2.0', { draft: true }), '1.1.0', 'arm64'), null);
  assert.equal(pickUpdate(release('v1.2.0', { prerelease: true }), '1.1.0', 'arm64'), null);
  assert.equal(pickUpdate(release('v1.2.0'), '1.1.0', 'x64'), null);
  assert.equal(pickUpdate(null, '1.1.0', 'arm64'), null);
});

test('summarizeNotes keeps the first paragraph, plain and short', () => {
  assert.equal(summarizeNotes('## New\n**Bold** change\n\nMore'), 'New Bold change');
  assert.ok(summarizeNotes('word '.repeat(100)).length <= 221);
  assert.equal(summarizeNotes(null), '');
});
