import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePPD, parseLpoptions, applyLpDefaults } from '../server/ppd.js';
import { buildImagePdf } from '../server/pdf.js';

const mockPpd = readFileSync(new URL('../server/mock/EPSON_ET_8500_Series.ppd', import.meta.url), 'latin1');

test('PPD: reads options, labels, defaults and groups', () => {
  const caps = parsePPD(mockPpd);
  const media = caps.options.find((o) => o.key === 'MediaType');
  assert.equal(media.label, 'Media Type');
  assert.equal(media.default, 'stationery');
  assert.ok(media.choices.some((c) => c.value === 'com.epson-velvet-fine-art' && c.label === 'Epson Velvet Fine Art'));
  assert.equal(caps.options.find((o) => o.key === 'EPIJ_Expd').group, 'Advanced Settings');
});

test('PPD: page sizes carry dimensions, imageable area and borderless flag', () => {
  const caps = parsePPD(mockPpd);
  const a4 = caps.pageSizes.find((p) => p.name === 'A4');
  const a4b = caps.pageSizes.find((p) => p.name === 'A4.Borderless');
  assert.deepEqual([a4.width, a4.height], [595, 842]);
  assert.equal(a4.borderless, false);
  assert.equal(a4.imageable.left, 8.5);
  assert.equal(a4b.borderless, true);
  assert.equal(a4b.base, 'A4');
});

test('PPD: labels containing colons are kept whole', () => {
  const caps = parsePPD(mockPpd);
  const wide = caps.pageSizes.find((p) => p.name === 'HiVision.Borderless');
  assert.equal(wide.label, '16:9 Wide (102 x 181 mm) (Borderless)');
  assert.equal(wide.imageable.left, 0);
});

test('PPD: multi-line invocation values do not break parsing', () => {
  const ppd = `*OpenUI *Quality/Print Quality: PickOne
*DefaultQuality: Normal
*Quality Normal/Normal: "
  << /HWResolution [360 360] >>
  setpagedevice"
*End
*Quality Fine/Fine: "<< /HWResolution [720 720] >> setpagedevice"
*CloseUI: *Quality`;
  const q = parsePPD(ppd).options[0];
  assert.deepEqual(q.choices.map((c) => c.value), ['Normal', 'Fine']);
});

test('lpoptions: parses choices and marks the default', () => {
  const caps = parseLpoptions('PageSize/Media Size: Letter *A4 na_index-4x6_4x6in w288h432\nColorModel/Color Mode: *RGB Gray');
  assert.equal(caps.options[0].default, 'A4');
  assert.equal(caps.pageSizes.find((p) => p.name === 'na_index-4x6_4x6in').width, 288);
  assert.equal(caps.pageSizes.find((p) => p.name === 'w288h432').height, 432);
});

test('lpoptions defaults override PPD defaults', () => {
  const caps = applyLpDefaults(parsePPD(mockPpd), 'MediaType/Media Type: stationery *com.epson-matte');
  assert.equal(caps.options.find((o) => o.key === 'MediaType').default, 'com.epson-matte');
});

test('PDF: structure, page size and image placement', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildImagePdf({ pageWidth: 595, pageHeight: 842, rect: { x: 10, y: 20, width: 300, height: 400 }, jpeg, pixelWidth: 1250, pixelHeight: 1667, title: 'Test (1)' });
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/MediaBox [0 0 595 842]'));
  // y is flipped to PDF's bottom-left origin: 842 - 20 - 400 = 422
  assert.ok(text.includes('300 0 0 400 10 422 cm'));
  assert.ok(text.includes('/Width 1250 /Height 1667'));
  assert.ok(text.includes('(Test \\(1\\))'));
  // xref offsets must point at the object headers
  const xrefStart = Number(text.match(/startxref\n(\d+)/)[1]);
  const entries = text.slice(xrefStart).split('\n').slice(3, 9);
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
});
