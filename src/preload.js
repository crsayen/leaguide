const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  setCharacter: (name) => ipcRenderer.invoke('set-character', name),
  getState: () => ipcRenderer.invoke('get-state'),
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  savePreferences: (prefs) => ipcRenderer.invoke('save-preferences', prefs),
  setCampaignLocation: (visitedZones) => ipcRenderer.invoke('set-campaign-location', visitedZones),
  setLayoutImagesEnabled: (enabled) => ipcRenderer.invoke('set-layout-images-enabled', enabled),
  onStateUpdate: (callback) => ipcRenderer.on('state-update', (event, data) => callback(data)),
  onVendorDialog: (callback) => ipcRenderer.on('vendor-dialog', (event, data) => callback(data)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: (installerPath) => ipcRenderer.send('install-update', installerPath),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data))
});
