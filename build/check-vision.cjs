// Build-time check that the signal9-vision helper works: reads its output for
// the test images from stdin and fails the build unless every image got a
// feature print and at least one was recognised as something.
const lines = require('fs').readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
let labelled = 0;
for (const line of lines) {
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    console.error('signal9-vision printed something unexpected:', line.slice(0, 400));
    process.exit(1);
  }
  if (r.error || !r.print) {
    console.error('signal9-vision self-test failed:', JSON.stringify(r).slice(0, 400));
    process.exit(1);
  }
  if (r.labels?.length) labelled++;
  const floats = Buffer.from(r.print, 'base64').length / 4;
  console.log(`  ${r.path.split('/').pop()}: ${r.labels.slice(0, 5).map(([l, c]) => `${l} ${c}`).join(', ') || 'no labels'} · feature print of ${floats} values`);
}
if (!lines.length || !labelled) {
  console.error('signal9-vision recognised nothing in the test images.');
  process.exit(1);
}
