// Gives the page a small, safe bridge to the Mac app: which platform it's on
// (for the window's title-bar layout) and the menu commands it should act on.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signal9App', {
  platform: process.platform,
  onMenu: (callback) => ipcRenderer.on('menu', (_event, command) => callback(command)),
});
