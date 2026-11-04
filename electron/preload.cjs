// Gives the page a small, safe bridge to the Mac app: which platform it's on
// (for the window's title-bar layout), the menu commands it should act on, and
// app updates (offer, progress, install).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signal9App', {
  platform: process.platform,
  onMenu: (callback) => ipcRenderer.on('menu', (_event, command) => callback(command)),
  onUpdate: (callback) => ipcRenderer.on('update', (_event, info) => callback(info)),
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
