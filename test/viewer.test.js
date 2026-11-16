import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, maxScale, zoomTarget, clampPan, zoomAround } from '../public/js/viewer.js';

test('viewer: a large work fits inside the padded stage', () => {
  // 4000×3000 in a 1000×800 stage with 28px padding: width is the limit.
  assert.equal(fitScale(4000, 3000, 1000, 800), (1000 - 56) / 4000);
  // A tall work is limited by height instead.
  assert.equal(fitScale(1000, 4000, 1000, 800), (800 - 56) / 4000);
});

test('viewer: small works are enlarged to fill the screen', () => {
  assert.ok(fitScale(400, 300, 1456, 1000) > 1);
});

test('viewer: clicking a fitted work zooms to actual pixels, or further for small works', () => {
  assert.equal(zoomTarget(0.25), 1);
  assert.equal(zoomTarget(2), 5);
  assert.equal(maxScale(0.25), 4);
  assert.equal(maxScale(3), 12);
});

test('viewer: panning stops at the work’s edges and centres a narrow axis', () => {
  // 2000×500 at 1× in a 1000×800 stage: 500px of slack each side horizontally, none vertically.
  assert.deepEqual(clampPan({ s: 1, x: 900, y: 300 }, 2000, 500, 1000, 800), { s: 1, x: 500, y: 0 });
  assert.deepEqual(clampPan({ s: 1, x: -900, y: 0 }, 2000, 500, 1000, 800), { s: 1, x: -500, y: 0 });
  assert.deepEqual(clampPan({ s: 1, x: 120, y: 0 }, 2000, 500, 1000, 800), { s: 1, x: 120, y: 0 });
});

test('viewer: zooming keeps the point under the pointer still', () => {
  const before = { s: 0.5, x: 10, y: -20 };
  const p = [150, 80];
  const after = zoomAround(before, 2, ...p);
  // The image point under p: (p - offset) / scale must be the same before and after.
  const pt = (v) => [(p[0] - v.x) / v.s, (p[1] - v.y) / v.s];
  assert.deepEqual(pt(after), pt(before));
});
