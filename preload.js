const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),

  // Game launch
  launch: (opts) => ipcRenderer.invoke('game:launch', opts),
  getGameDir: () => ipcRenderer.invoke('game:getDir'),

  // Config (profile persistence)
  readConfig: () => ipcRenderer.invoke('config:read'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),

  // Shell / filesystem
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  listMods: () => ipcRenderer.invoke('mods:list'),

  // Listen for launch events from main process
  onLaunchStatus: (callback) => {
    ipcRenderer.on('launch:status', (event, data) => callback(data));
  },
  onLaunchProgress: (callback) => {
    ipcRenderer.on('launch:progress', (event, data) => callback(data));
  },

  // Auto-updater
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update:status', (event, data) => callback(data));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (event, data) => callback(data));
  },
  installUpdate: () => ipcRenderer.invoke('update:install')
});
