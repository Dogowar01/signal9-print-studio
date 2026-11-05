// Stands in for the Mac's signal9-vision helper in tests: "recognises" a
// subject from the file's contents and gives a matching feature print.
import { readFileSync } from 'node:fs';

const PRINTS = {
  city: [1, 0.1, 0],
  flower: [0, 1, 0.1],
  bad: null,
};
for (const file of process.argv.slice(2)) {
  const kind = readFileSync(file, 'utf8').split(':')[0];
  if (kind === 'bad') {
    console.log(JSON.stringify({ path: file, error: 'Could not read image' }));
    continue;
  }
  const vec = Float32Array.from(PRINTS[kind] || [0.3, 0.3, 0.3]);
  console.log(JSON.stringify({
    path: file,
    labels: kind === 'city' ? [['cityscape', 0.81], ['sky', 0.9]] : [['sunflower', 0.77]],
    print: Buffer.from(vec.buffer).toString('base64'),
  }));
}
