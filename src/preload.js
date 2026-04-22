const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  setCharacter: (name) => ipcRenderer.invoke('set-character', name),
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (event, data) => callback(data)),
  onVendorDialog: (callback) => ipcRenderer.on('vendor-dialog', (event, data) => callback(data)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: (installerPath) => ipcRenderer.send('install-update', installerPath),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data))
});
