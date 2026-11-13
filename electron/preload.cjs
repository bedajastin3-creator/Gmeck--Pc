// @ts-check
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, isolated desktop capabilities to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getVersion: () => process.env.npm_package_version || '1.0.0',
  send: (channel, data) => {
    // Whitelist channels if needed in future
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});
