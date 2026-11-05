// Stands in for realesrgan-ncnn-vulkan in tests: writes a PNG header 4× the
// input's size and reports progress like the real one. An input whose bytes
// end in "BROKEN" fails the way a GPU error would.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(k) + 1];
const input = readFileSync(opt('-i'));
if (input.toString('latin1').endsWith('BROKEN')) {
  process.stderr.write('vkCreateInstance failed -9\n');
  process.exit(255);
}
const w = input.readUInt32BE(16), h = input.readUInt32BE(20);
for (const p of ['0.00%', '25.00%', '50.00%', '75.00%']) process.stderr.write(`${p}\n`);
writeFileSync(opt('-o'), pngHeader(w * Number(opt('-s')), h * Number(opt('-s'))));

export function pngHeader(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
