// Signal9 Print Studio: the Mac app.
// Runs the library/printing server inside the app and shows it in a native
// window. Closing the window keeps the app in the Dock, like any Mac app;
// clicking the Dock icon brings it back. ⌘Q quits.

import { app, BrowserWindow, Menu, dialog, screen, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, upscalerIn } from '../server.js';
import { setupUpdater } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';
const REPO_URL = 'https://github.com/Dogowar01/signal9-print-studio';
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff', 'heic', 'heif', 'psd', 'bmp', 'dng'];
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic' };

app.setName('Signal9 Print Studio');

let server = null;
let win = null;
let updater = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(async () => {
    try {
      // A fixed port keeps per-window preferences (last paper, sort order) between launches.
      server = await startServer({
        ports: [4747, 4748, 4749],
        libraryDir: process.env.SIGNAL9_LIBRARY || undefined,
        // The image-recognition helper is built with the app and sits in its Resources folder.
        visionHelper: app.isPackaged ? [path.join(process.resourcesPath, 'signal9-vision')] : undefined,
        upscaler: app.isPackaged ? upscalerIn(path.join(process.resourcesPath, 'upscaler')) : undefined,
      });
    } catch (err) {
      dialog.showErrorBox('Signal9 Print Studio could not start', err.message);
      app.quit();
      return;
    }
    updater = setupUpdater({ getWindow: () => win });
    Menu.setApplicationMenu(buildMenu());
    showWindow();
  });
}

// Mac apps stay open with no windows; elsewhere closing the window quits.
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
app.on('activate', () => showWindow());
app.on('before-quit', () => server?.close());

function showWindow() {
  if (!server) return;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  const state = loadWindowState();
  win = new BrowserWindow({
    ...state.bounds,
    minWidth: 960,
    minHeight: 640,
    title: 'Signal9 Print Studio',
    backgroundColor: '#0a0908',
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 20, y: 24 },
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveWindowState);
  win.on('closed', () => {
    win = null;
  });

  // Keep the window on the app's own pages; web links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.url)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('did-finish-load', () => updater?.announce());
  win.loadURL(server.url);
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// Sends a menu command to the page, opening the window first if it was closed.
function send(command) {
  if (!win) {
    showWindow();
    win?.webContents.once('did-finish-load', () => win?.webContents.send('menu', command));
  } else {
    win.webContents.send('menu', command);
  }
}

// The page's own Import button uses the browser file picker; the menu item
// uses the native one and adds the files straight to the library.
async function importFromMenu() {
  showWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Import artworks',
    buttonLabel: 'Import',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: IMAGE_TYPES }],
  });
  if (result.canceled || !result.filePaths.length) return;
  let added = 0;
  for (const file of result.filePaths) {
    try {
      const ext = path.extname(file).slice(1).toLowerCase();
      await server.library.addArtwork({ originalName: path.basename(file), buffer: await readFile(file), mime: MIME[ext] || '' });
      added++;
    } catch (err) {
      dialog.showErrorBox('Could not import', `${path.basename(file)}: ${err.message}`);
    }
  }
  if (added) send('refresh');
}

function buildMenu() {
  return Menu.buildFromTemplate([
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => updater.checkNow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Artworks…', accelerator: 'CmdOrCtrl+O', click: importFromMenu },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: 'Show Library in Finder', click: () => shell.openPath(server.libraryDir) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      // Written out (not the stock editMenu) so ⌘A selects artworks rather than page text,
      // and so removing works has a menu item and shortcut.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => send('selectAll') },
        { type: 'separator' },
        { label: 'Remove from Library…', accelerator: 'CmdOrCtrl+Backspace', click: () => send('remove') },
        { label: 'Find Duplicates…', click: () => send('duplicates') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Signal9 Print Studio on GitHub', click: () => openExternal(REPO_URL) },
        ...(isMac ? [] : [{ label: 'Check for Updates…', click: () => updater.checkNow() }]),
      ],
    },
  ]);
}

// ---- Window size and position, remembered between launches ----

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const fallback = { bounds: { width: 1440, height: 900 }, maximized: false };
  try {
    const saved = JSON.parse(readFileSync(stateFile(), 'utf8'));
    // Ignore a saved position that is no longer on any screen (e.g. an unplugged display).
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.bounds.x < a.x + a.width && saved.bounds.x + saved.bounds.width > a.x &&
      saved.bounds.y < a.y + a.height && saved.bounds.y + saved.bounds.height > a.y);
    return visible ? saved : { ...fallback, bounds: { width: saved.bounds.width, height: saved.bounds.height } };
  } catch {
    return fallback;
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch { /* not worth interrupting a close over */ }
}
