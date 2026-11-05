// Signal9 Print Studio: local server.
// Serves the app's pages and handles the library and printing. The Mac app
// starts it internally; `node server.js` runs it on its own for development.
// It only listens on this computer (127.0.0.1), never on your network.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Library } from './server/library.js';
import { createPrinting, httpError } from './server/printing.js';
import { buildImagePdf } from './server/pdf.js';
import { Vision } from './server/vision.js';
import { Upscaler } from './server/upscale.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version;
export const DEFAULT_LIBRARY = path.join(os.homedir(), 'Pictures', 'Signal9 Library');
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.heic': 'image/heic', '.ico': 'image/x-icon',
};

// The upscaler bundle: a folder holding realesrgan-ncnn-vulkan and its models folder.
export function upscalerIn(dir) {
  return dir ? { bin: [path.join(dir, 'realesrgan-ncnn-vulkan')], models: path.join(dir, 'models') } : null;
}

function hasCups() {
  if (process.platform === 'win32') return false;
  try {
    execFileSync('lpstat', ['-r'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function readBody(req, limit = MAX_UPLOAD) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'File is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req, 5 * 1024 * 1024);
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {};
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function sendFile(req, res, file, cache = 'no-cache') {
  let info;
  try {
    info = await stat(file);
    if (!info.isFile()) throw new Error();
  } catch {
    return send(res, 404, { error: 'Not found' });
  }
  const etag = `"${info.size}-${info.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cache,
    ETag: etag,
  });
  createReadStream(file).pipe(res);
}

/**
 * Starts the server. Tries each port in `ports` and falls back to any free port.
 * Resolves with { url, port, libraryDir, library, mock, close }.
 */
export async function startServer({
  ports = [4321],
  libraryDir = DEFAULT_LIBRARY,
  mock = process.env.SIGNAL9_MOCK === '1' || !hasCups(),
  // The Mac app passes the helper bundled in its Resources; from source, `npm run build:vision` makes one.
  visionHelper = process.env.SIGNAL9_VISION ? [process.env.SIGNAL9_VISION] : process.platform === 'darwin' ? [path.join(here, 'vision', 'signal9-vision')] : null,
  // Real-ESRGAN: the Mac app passes the copy in its Resources; from source, set SIGNAL9_UPSCALER to its folder.
  upscaler = upscalerIn(process.env.SIGNAL9_UPSCALER || (process.platform === 'darwin' ? path.join(here, 'vision', 'upscaler') : null)),
} = {}) {
  const library = new Library(libraryDir);
  const printing = createPrinting({ mock, outboxDir: path.join(libraryDir, 'simulated-prints') });
  await library.init();
  const vision = new Vision(library, visionHelper);
  await vision.init();
  const upscale = new Upscaler(library, upscaler);
  await upscale.init();

  const routes = [
    ['GET', /^\/api\/status$/, async () => ({
      mock, libraryDir, platform: process.platform, version: VERSION, vision: vision.status(), upscale: upscale.status(),
    })],

    ['GET', /^\/api\/library$/, async () => library.snapshot()],

    ['POST', /^\/api\/artworks$/, async (req) => {
      const name = decodeURIComponent(req.headers['x-filename'] || 'artwork.jpg');
      const buffer = await readBody(req);
      if (!buffer.length) throw httpError(400, 'Empty file.');
      const art = await library.addArtwork({ originalName: path.basename(name), buffer, mime: req.headers['content-type'] || '' });
      if (!art.alreadyInLibrary) vision.scan();
      return art;
    }],

    ['POST', /^\/api\/artworks\/([\w-]+)\/upscale$/, async (req, [id]) => upscale.start(id, await readJson(req))],
    ['GET', /^\/api\/artworks\/([\w-]+)\/upscale$/, async (req, [id]) => ({ job: upscale.job(id), artwork: library.find(id) })],
    ['DELETE', /^\/api\/artworks\/([\w-]+)\/upscale$/, async (req, [id]) => upscale.discard(id)],

    ['GET', /^\/api\/artworks\/([\w-]+)\/similar$/, async (req, [id]) => {
      library.find(id);
      return { available: vision.available, content: vision.similarTo(id) };
    }],

    ['PATCH', /^\/api\/artworks\/([\w-]+)$/, async (req, [id]) => library.update(id, await readJson(req))],

    ['PUT', /^\/api\/artworks\/([\w-]+)\/thumb$/, async (req, [id]) => library.setThumb(id, await readBody(req, 20 * 1024 * 1024))],

    ['DELETE', /^\/api\/artworks\/([\w-]+)$/, async (req, [id]) => {
      await library.remove(id);
      return { ok: true };
    }],

    ['GET', /^\/api\/duplicates\/hashes$/, async () => library.fileHashes()],
    ['POST', /^\/api\/duplicates\/merge$/, async (req) => {
      const { keep, remove } = await readJson(req);
      if (typeof keep !== 'string' || !Array.isArray(remove)) throw httpError(400, 'Say which copy to keep and which to remove.');
      return library.mergeDuplicates(keep, remove);
    }],

    ['POST', /^\/api\/collections$/, async (req) => library.addCollection(await readJson(req))],
    ['PATCH', /^\/api\/collections\/([\w-]+)$/, async (req, [id]) => library.updateCollection(id, await readJson(req))],
    ['DELETE', /^\/api\/collections\/([\w-]+)$/, async (req, [id]) => {
      await library.removeCollection(id);
      return { ok: true };
    }],

    ['GET', /^\/api\/printers$/, async () => printing.listPrinters()],
    ['GET', /^\/api\/printers\/([^/]+)\/capabilities$/, async (req, [name]) => printing.getCapabilities(decodeURIComponent(name))],
    ['GET', /^\/api\/printers\/([^/]+)\/status$/, async (req, [name]) => printing.status(decodeURIComponent(name))],
    ['POST', /^\/api\/jobs\/([^/]+)\/cancel$/, async (req, [id]) => printing.cancel(decodeURIComponent(id))],
    ['GET', /^\/api\/history$/, async () => library.history()],

    // Body: the rendered JPEG. Header x-print-job: URI-encoded JSON describing the page and settings.
    ['POST', /^\/api\/print$/, async (req) => {
      let job;
      try {
        job = JSON.parse(decodeURIComponent(req.headers['x-print-job'] || ''));
      } catch {
        throw httpError(400, 'Missing print job description.');
      }
      const jpeg = await readBody(req, 200 * 1024 * 1024);
      if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw httpError(400, 'Print image must be a JPEG.');
      const { page, rect, pixelWidth, pixelHeight } = job;
      for (const n of [page?.width, page?.height, rect?.x, rect?.y, rect?.width, rect?.height, pixelWidth, pixelHeight]) {
        if (!Number.isFinite(n)) throw httpError(400, 'Invalid page layout.');
      }
      const pdf = buildImagePdf({ pageWidth: page.width, pageHeight: page.height, rect, jpeg, pixelWidth, pixelHeight, title: job.title });
      const result = await printing.print({ printer: job.printer, options: job.options, copies: job.copies, title: job.title || 'Artwork', pdf });
      await library.recordPrint({
        artworkId: job.artworkId, title: job.title, printer: job.printer, jobId: result.jobId, copies: job.copies,
        paperId: job.paperId, paperName: job.paperName, pageSize: job.options?.PageSize, options: job.options,
        adjustments: job.adjustments, simulated: result.simulated,
      });
      return result;
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) {
        for (const [method, re, handler] of routes) {
          const m = pathname.match(re);
          if (m && req.method === method) return send(res, 200, await handler(req, m.slice(1)));
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }
      const fileMatch = pathname.match(/^\/files\/(originals|display|thumbs|upscaled)\/([^/]+)$/);
      if (fileMatch) {
        const file = library.fileFor(fileMatch[1], fileMatch[2]);
        if (!file) return send(res, 400, { error: 'Bad file name' });
        return sendFile(req, res, file, 'private, max-age=31536000, immutable');
      }
      const publicDir = path.join(here, 'public');
      const file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(publicDir)) return send(res, 403, { error: 'Forbidden' });
      return sendFile(req, res, file);
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.message || 'Something went wrong' });
    }
  });

  let port = null;
  for (const candidate of [...ports, 0]) {
    try {
      port = await listen(server, candidate);
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  return {
    url: `http://localhost:${port}`,
    port,
    libraryDir,
    library,
    mock,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// ---- Command line: node server.js [--library=/path] ----
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argLibrary = process.argv.find((a) => a.startsWith('--library='))?.slice('--library='.length);
  const port = Number(process.env.PORT) || 4321;
  const s = await startServer({ ports: [port], libraryDir: argLibrary || process.env.SIGNAL9_LIBRARY || DEFAULT_LIBRARY });
  if (s.port !== port) console.log(`\n  Port ${port} is busy (Signal9 may already be running), so this copy uses ${s.url}`);
  console.log(`\n  Signal9 Print Studio is running at ${s.url}`);
  console.log(`  Library folder: ${s.libraryDir}`);
  if (s.mock) console.log('  Printer: SIMULATED (no CUPS found). Prints are saved as PDFs in the library folder.');
  console.log('  Leave this window open while you use the app. Press Ctrl+C to stop.\n');
  if (process.env.SIGNAL9_OPEN === '1') {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [s.url], () => {});
  }
}
