// Talks to the Mac's print system (CUPS) through its standard command-line
// tools: lpstat, lpoptions, lp, cancel and ipptool. Every call passes its
// arguments as an array, never through a shell.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePPD, parseLpoptions, applyLpDefaults } from './ppd.js';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_NAME = 'EPSON_ET_8500_Series';
const CAPS_TTL_MS = 60_000;

export function createPrinting({ mock, outboxDir }) {
  const capsCache = new Map();
  const mockJobs = [];
  let mockJobSeq = 100;

  async function listPrinters() {
    if (mock) {
      return [{ name: MOCK_NAME, info: 'EPSON ET-8500 Series (simulated)', state: 'idle', isDefault: true, mock: true }];
    }
    let out = '';
    try {
      ({ stdout: out } = await run('lpstat', ['-p', '-d']));
    } catch (err) {
      out = err.stdout || ''; // lpstat exits non-zero when no printers are set up
    }
    const defaultMatch = out.match(/system default destination:\s*(\S+)/);
    const printers = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^printer\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      const state = /disabled/.test(m[2]) ? 'stopped' : /printing/.test(m[2]) ? 'printing' : 'idle';
      printers.push({ name: m[1], info: m[1].replace(/_/g, ' '), state, isDefault: defaultMatch?.[1] === m[1], mock: false });
    }
    await Promise.all(printers.map(async (p) => {
      try {
        const { stdout } = await run('lpoptions', ['-p', p.name]);
        const info = stdout.match(/printer-info='([^']*)'|printer-info=(\S+)/);
        if (info) p.info = (info[1] ?? info[2]).replace(/\\/g, '');
      } catch { /* keep the queue name as the label */ }
    }));
    return printers;
  }

  async function assertPrinter(name) {
    const printers = await listPrinters();
    const p = printers.find((x) => x.name === name);
    if (!p) throw httpError(404, `Printer "${name}" was not found.`);
    return p;
  }

  async function getCapabilities(name) {
    await assertPrinter(name);
    const cached = capsCache.get(name);
    if (cached && Date.now() - cached.at < CAPS_TTL_MS) return cached.caps;

    let caps = null;
    let source = 'ppd';
    if (mock) {
      caps = parsePPD(await readFile(path.join(here, 'mock', `${MOCK_NAME}.ppd`), 'utf8'));
      source = 'simulated';
    } else {
      try {
        caps = parsePPD(await readFile(`/etc/cups/ppd/${name}.ppd`, 'latin1'));
      } catch { /* PPD unreadable; fall back to lpoptions */ }
      try {
        const { stdout } = await run('lpoptions', ['-p', name, '-l']);
        if (caps && caps.options.length) applyLpDefaults(caps, stdout);
        else {
          caps = parseLpoptions(stdout);
          source = 'lpoptions';
        }
      } catch (err) {
        if (!caps) throw httpError(500, `Could not read printer settings: ${err.message}`);
      }
    }
    caps = { ...caps, source };
    capsCache.set(name, { at: Date.now(), caps });
    return caps;
  }

  async function print({ printer, options = {}, copies = 1, title = 'Artwork', pdf }) {
    await assertPrinter(printer);
    const caps = await getCapabilities(printer);
    const args = ['-d', printer, '-n', String(clampInt(copies, 1, 99)), '-t', title.slice(0, 120)];
    for (const [key, value] of Object.entries(options)) {
      const opt = caps.options.find((o) => o.key === key);
      if (!opt) throw httpError(400, `Unknown printer setting "${key}".`);
      if (!opt.choices.some((c) => c.value === value)) throw httpError(400, `"${value}" is not a valid choice for ${opt.label}.`);
      args.push('-o', `${key}=${value}`);
    }
    // The PDF page already matches the paper, so stop CUPS from rescaling it.
    args.push('-o', 'print-scaling=none');

    if (mock) {
      await mkdir(outboxDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(outboxDir, `${stamp}-${title.replace(/[^\w.-]+/g, '_').slice(0, 60)}.pdf`);
      await writeFile(file, pdf);
      const id = `${printer}-${++mockJobSeq}`;
      mockJobs.unshift({ id, title, state: 'completed', time: new Date().toISOString(), args, file });
      return { jobId: id, simulated: true, savedTo: file, command: ['lp', ...args, '<file.pdf>'].join(' ') };
    }

    const tmpDir = path.join(os.tmpdir(), 'signal9-print');
    await mkdir(tmpDir, { recursive: true });
    const file = path.join(tmpDir, `job-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    await writeFile(file, pdf);
    try {
      const { stdout } = await run('lp', [...args, file]);
      const id = stdout.match(/request id is (\S+)/)?.[1] ?? null;
      return { jobId: id, simulated: false };
    } catch (err) {
      throw httpError(500, `The print system refused the job: ${(err.stderr || err.message).trim()}`);
    } finally {
      unlink(file).catch(() => {}); // CUPS has its own spooled copy once lp returns
    }
  }

  async function status(name) {
    await assertPrinter(name);
    if (mock) {
      return {
        state: 'idle',
        message: 'Simulated printer. Jobs are saved as PDFs instead of printed.',
        jobs: [],
        completed: mockJobs.slice(0, 10),
        ink: [
          { name: 'Photo Black', color: '#1b1b1b', level: 72 },
          { name: 'Black', color: '#000000', level: 58 },
          { name: 'Cyan', color: '#00a0e0', level: 81 },
          { name: 'Magenta', color: '#e0007a', level: 44 },
          { name: 'Yellow', color: '#f5dc00', level: 90 },
          { name: 'Gray', color: '#8a8a8a', level: 67 },
        ],
      };
    }
    const [stateOut, activeOut, doneOut, ink] = await Promise.all([
      run('lpstat', ['-p', name]).then((r) => r.stdout, (e) => e.stdout || ''),
      run('lpstat', ['-o', name]).then((r) => r.stdout, (e) => e.stdout || ''),
      run('lpstat', ['-W', 'completed', '-o', name]).then((r) => r.stdout, (e) => e.stdout || ''),
      inkLevels(name),
    ]);
    const lines = stateOut.split('\n');
    const head = lines[0] || '';
    const state = /disabled/.test(head) ? 'stopped' : /printing/.test(head) ? 'printing' : 'idle';
    const message = lines.slice(1).map((l) => l.trim()).filter(Boolean).join(' ');
    return { state, message, jobs: parseJobs(activeOut, 'pending'), completed: parseJobs(doneOut, 'completed').slice(-10).reverse(), ink };
  }

  async function cancel(jobId) {
    if (!/^[\w.-]+-\d+$/.test(jobId)) throw httpError(400, 'Invalid job id.');
    if (mock) return { ok: true };
    try {
      await run('cancel', [jobId]);
      return { ok: true };
    } catch (err) {
      throw httpError(500, (err.stderr || err.message).trim());
    }
  }

  // Ink levels come from the printer over IPP. Not every driver reports them,
  // so failure here just means the app shows no ink panel.
  async function inkLevels(name) {
    const testFile = path.join(os.tmpdir(), 'signal9-marker-levels.test');
    try {
      await writeFile(testFile, IPP_MARKER_TEST);
      const { stdout } = await run('ipptool', ['-T', '5', '-v', `ipp://localhost/printers/${encodeURIComponent(name)}`, testFile], { timeout: 7000 });
      const grab = (attr) => stdout.match(new RegExp(`${attr}\\s*\\([^)]*\\)\\s*=\\s*(.+)`))?.[1].trim().split(',');
      const names = grab('marker-names');
      const levels = grab('marker-levels');
      const colors = grab('marker-colors') || [];
      if (!names || !levels) return null;
      return names.map((n, i) => ({ name: n.trim(), level: Number(levels[i]), color: (colors[i] || '#888').trim().split('#').filter(Boolean).map((c) => '#' + c)[0] || '#888' }))
        .filter((m) => Number.isFinite(m.level) && m.level >= 0);
    } catch {
      return null;
    }
  }

  return { listPrinters, getCapabilities, print, status, cancel, mock };
}

function parseJobs(text, state) {
  return text.split('\n').map((line) => {
    const m = line.match(/^(\S+-\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    return m ? { id: m[1], user: m[2], size: Number(m[3]), time: m[4].trim(), state } : null;
  }).filter(Boolean);
}

function clampInt(n, lo, hi) {
  n = Math.round(Number(n) || lo);
  return Math.min(hi, Math.max(lo, n));
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const IPP_MARKER_TEST = `{
  NAME "Signal9 marker levels"
  OPERATION Get-Printer-Attributes
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR keyword requested-attributes marker-names,marker-levels,marker-colors
  STATUS successful-ok
  DISPLAY marker-names
  DISPLAY marker-levels
  DISPLAY marker-colors
}
`;
