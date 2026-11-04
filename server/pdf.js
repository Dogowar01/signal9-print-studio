// Writes a single-page PDF holding one JPEG placed at an exact position.
// Sending a page-sized PDF (instead of a bare image) means CUPS doesn't
// rescale or re-centre the artwork, so what the preview shows is what prints.

const fmt = (n) => Number(n.toFixed(3)).toString();

/**
 * @param {object} p
 * @param {number} p.pageWidth  page width in points (1/72 in)
 * @param {number} p.pageHeight page height in points
 * @param {{x:number,y:number,width:number,height:number}} p.rect image rect in points, origin top-left
 * @param {Buffer} p.jpeg       baseline or progressive JPEG data
 * @param {number} p.pixelWidth  JPEG width in pixels
 * @param {number} p.pixelHeight JPEG height in pixels
 * @param {string} [p.title]
 */
export function buildImagePdf({ pageWidth, pageHeight, rect, jpeg, pixelWidth, pixelHeight, title = 'Artwork' }) {
  const x = rect.x;
  const y = pageHeight - rect.y - rect.height; // PDF origin is bottom-left
  const content = `q\n${fmt(rect.width)} 0 0 ${fmt(rect.height)} ${fmt(x)} ${fmt(y)} cm\n/Im0 Do\nQ\n`;
  const safeTitle = title.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');

  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(pageHeight)}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    { dict: `<< /Length ${Buffer.byteLength(content)} >>`, stream: Buffer.from(content, 'latin1') },
    {
      dict: `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      stream: jpeg,
    },
    `<< /Title (${safeTitle}) /Producer (Signal9 Print Studio) >>`,
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    const parts = typeof obj === 'string'
      ? [Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1')]
      : [Buffer.from(`${i + 1} 0 obj\n${obj.dict}\nstream\n`, 'latin1'), obj.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
    for (const part of parts) {
      chunks.push(part);
      offset += part.length;
    }
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
