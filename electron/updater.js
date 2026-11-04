// One-click updates from this project's GitHub Releases.
//
// The app is ad-hoc signed (no paid Apple Developer ID), which Electron's
// built-in updater can't use, so this does the job directly: check the latest
// release, download its .dmg, verify it against GitHub's SHA-256, copy the new
// app out of the disk image, and swap it into place once the app has quit.

import { app, dialog, ipcMain, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { pickUpdate, SWAP_SCRIPT } from './update-helpers.js';

const run = promisify(execFile);
const REPO = 'Dogowar01/signal9-print-studio';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'Signal9-Print-Studio-Updater' };

export function setupUpdater({ getWindow }) {
  let offer = null; // the update currently on offer
  let installing = false;

  const notify = (message) => getWindow()?.webContents.send('update', message);

  async function check({ manual = false } = {}) {
    if (installing) return;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
      if (res.status === 404) throw new Error('No releases have been published yet.');
      if (!res.ok) throw new Error(`GitHub replied with status ${res.status}.`);
      offer = pickUpdate(await res.json(), app.getVersion(), process.arch);
      if (offer) announce();
      else if (manual) {
        await dialog.showMessageBox(getWindow(), {
          message: 'You’re up to date',
          detail: `Signal9 Print Studio ${app.getVersion()} is the latest version.`,
        });
      }
    } catch (err) {
      if (manual) await dialog.showMessageBox(getWindow(), { type: 'warning', message: 'Couldn’t check for updates', detail: err.message });
    }
  }

  // Re-sent whenever the window (re)loads, so a reopened window still shows the offer.
  function announce() {
    if (offer && !installing) notify({ type: 'available', version: offer.version, notes: offer.notes, size: offer.asset.size });
  }

  ipcMain.handle('update:install', async () => {
    if (!offer || installing) return;
    installing = true;
    let tmp = null;
    try {
      tmp = await mkdtemp(path.join(os.tmpdir(), 'signal9-update-'));
      const dmg = path.join(tmp, offer.asset.name);
      await download(offer.asset, dmg, (percent) => notify({ type: 'progress', percent }));

      const target = await replaceableBundle();
      if (!target) {
        // Can't replace this copy in place (not in a writable folder, or run from the
        // disk image): open the new installer so it can be dragged into Applications.
        await shell.openPath(dmg);
        notify({ type: 'manual', version: offer.version });
        installing = false;
        return;
      }

      notify({ type: 'installing' });
      const staged = await stageApp(dmg, tmp, target);
      notify({ type: 'restarting' });
      spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'signal9-update', String(process.pid), target, staged, tmp], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      setTimeout(() => app.quit(), 400);
    } catch (err) {
      installing = false;
      if (tmp) rm(tmp, { recursive: true, force: true }).catch(() => {});
      notify({ type: 'error', message: err.message });
    }
  });

  const enabled = app.isPackaged && process.platform === 'darwin';
  if (enabled) {
    setTimeout(() => check(), 5000);
    setInterval(() => check(), CHECK_EVERY_MS);
  }

  return {
    enabled,
    announce,
    checkNow: () => (enabled ? check({ manual: true }) : dialog.showMessageBox(getWindow(), {
      message: 'Updates are only installed in the Mac app',
      detail: 'This copy is running from the source code. Use git pull to get the latest version.',
    })),
  };
}

async function download(asset, file, onProgress) {
  const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok || !res.body) throw new Error(`The download failed (status ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || asset.size;
  const hash = createHash('sha256');
  let received = 0;
  let lastPercent = -1;
  const meter = new Transform({
    transform(chunk, _enc, done) {
      received += chunk.length;
      hash.update(chunk);
      const percent = Math.min(100, Math.floor((received / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(file));
  if (received !== asset.size) throw new Error('The download was incomplete. Please try again.');
  if (asset.digest?.startsWith('sha256:') && hash.digest('hex') !== asset.digest.slice('sha256:'.length)) {
    throw new Error('The download didn’t match GitHub’s checksum, so it wasn’t installed.');
  }
}

// The installed .app this process runs from, if it can be replaced in place.
async function replaceableBundle() {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!bundle.endsWith('.app')) return null;
  // macOS runs downloaded apps from a read-only "translocated" copy until they're moved.
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return null;
  try {
    await access(path.dirname(bundle), constants.W_OK);
    await access(bundle, constants.W_OK);
    return bundle;
  } catch {
    return null;
  }
}

// Copies the new app out of the disk image next to the installed one and checks its signature.
async function stageApp(dmg, tmp, target) {
  const mount = path.join(tmp, 'volume');
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount]);
  const staged = path.join(path.dirname(target), `.${path.basename(target, '.app')}-update.app`);
  try {
    const name = (await readdir(mount)).find((n) => n.endsWith('.app'));
    if (!name) throw new Error('The download didn’t contain the app.');
    await rm(staged, { recursive: true, force: true });
    await run('ditto', [path.join(mount, name), staged]);
    await run('codesign', ['--verify', '--deep', staged]);
  } catch (err) {
    await rm(staged, { recursive: true, force: true });
    throw err;
  } finally {
    await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
  }
  return staged;
}
