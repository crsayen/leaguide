const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { TOWN_VENDORS } = require('./parsers');
const { getConfig, saveConfig, getLogPath, loadVisitedZones, saveVisitedZones } = require('./config');
const { LogTailer } = require('./log-tailer');
const { checkForUpdate } = require('./updater');

const isDev = !app.isPackaged;

let win = null;
let tailer = null;

let currentZone = 'Unknown';
let currentLevel = 1;
let playerClass = 'Unknown';
let characterName = '';
let knownCharacters = [];
let visitedZones = new Set();
let config = null;
let logPath = null;

function getWindowWidthForLayoutImages(enabled) {
  return enabled ? 1400 : 800;
}

function resizeWindowForLayoutImages(enabled) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const [currentWidth, currentHeight] = win.getSize();
  const targetWidth = getWindowWidthForLayoutImages(enabled);
  if (currentWidth === targetWidth) {
    return;
  }

  const bounds = win.getBounds();
  win.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: targetWidth,
    height: currentHeight
  }, true);
}

function buildState(levelUp = false) {
  const state = {
    zone: currentZone,
    level: currentLevel,
    class: playerClass,
    character_name: characterName,
    town_has_vendors: Object.prototype.hasOwnProperty.call(TOWN_VENDORS, currentZone),
    visited_zones: Array.from(visitedZones)
  };
  if (levelUp) {
    state.level_up = true;
  }
  return state;
}

function sendState(levelUp = false) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('state-update', buildState(levelUp));
  }
}

function mergeKnownCharacters(names) {
  let changed = false;
  for (const name of names) {
    if (name && !knownCharacters.includes(name)) {
      knownCharacters.push(name);
      changed = true;
    }
  }
  if (changed) {
    config.known_characters = knownCharacters;
    saveConfig(config);
  }
}

function getPartyMembersFromBackscan(backscan) {
  return new Set(Array.isArray(backscan.partyMembers) ? backscan.partyMembers : []);
}

function applyBackscanResult(result, activeName, hasPersisted) {
  const zoneValue = result.zone || 'Unknown';
  const levelValue = Number.isInteger(result.level) ? result.level : 1;
  const classValue = result.playerClass || 'Unknown';

  if (activeName && (result.characterInLog || hasPersisted)) {
    currentZone = zoneValue;
    currentLevel = levelValue;
    playerClass = classValue;
  } else if (!activeName && result.detectedPlayer) {
    currentZone = zoneValue;
    currentLevel = result.detectedClass ? levelValue : 1;
    playerClass = result.detectedClass || 'Unknown';
  } else if (!hasPersisted) {
    currentZone = activeName ? 'Unknown' : zoneValue;
    currentLevel = 1;
    playerClass = 'Unknown';
  }
}

function restartTailer() {
  if (!logPath) {
    return;
  }

  if (tailer) {
    tailer.stop();
  }

  tailer = new LogTailer(logPath);
  tailer.currentZone = currentZone;
  tailer.currentLevel = currentLevel;
  tailer.playerClass = playerClass;

  tailer.on('character-detected', ({ characterName: detectedName }) => {
    if (!detectedName || characterName) {
      return;
    }

    characterName = detectedName;
    config.character_name = detectedName;
    mergeKnownCharacters([detectedName]);

    const rescanned = tailer.backscan(detectedName);
    currentZone = rescanned.zone || currentZone;
    currentLevel = rescanned.level || currentLevel;
    playerClass = rescanned.playerClass || playerClass;
    visitedZones = loadVisitedZones(config, detectedName);
    saveConfig(config);
    sendState();
  });

  tailer.on('characters-discovered', ({ characters }) => {
    const filtered = characters.filter((name) => !tailer.partyMembers.has(name));
    if (filtered.length > 0) {
      mergeKnownCharacters(filtered);
    }
  });

  tailer.on('zone-change', ({ zone }) => {
    currentZone = zone;
    visitedZones.add(zone);
    if (characterName) {
      saveVisitedZones(config, characterName, visitedZones);
      config = getConfig();
    }
    sendState();
  });

  tailer.on('level-up', ({ level, className, characterName: activeCharacter }) => {
    currentLevel = level;
    playerClass = className;
    if (activeCharacter && !characterName) {
      characterName = activeCharacter;
      config.character_name = activeCharacter;
      mergeKnownCharacters([activeCharacter]);
      saveConfig(config);
    }
    sendState(true);
  });

  tailer.on('vendor-dialog', ({ vendorName }) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('vendor-dialog', { vendor_name: vendorName });
    }
  });

  tailer.on('death', () => {});

  tailer.start(characterName);
}

async function ensureLogPath() {
  logPath = getLogPath(config);
  if (logPath) {
    config.log_path = logPath;
    saveConfig(config);
    return logPath;
  }

  const result = await dialog.showOpenDialog({
    title: 'Locate Path of Exile 2 Client.txt',
    buttonLabel: 'Use Client.txt',
    properties: ['openFile'],
    filters: [{ name: 'Client Log', extensions: ['txt'] }]
  });

  if (!result.canceled && result.filePaths[0]) {
    logPath = result.filePaths[0];
    config.log_path = logPath;
    saveConfig(config);
    return logPath;
  }

  return null;
}

function readInitialStateFromLog() {
  const activeName = config.character_name || '';
  const result = tailer.backscan(activeName);
  const partyMembers = getPartyMembersFromBackscan(result);
  const discovered = (result.discovered || []).filter((name) => !partyMembers.has(name));

  knownCharacters = Array.isArray(config.known_characters) ? [...config.known_characters] : [];
  if (result.detectedPlayer && !knownCharacters.includes(result.detectedPlayer)) {
    knownCharacters.unshift(result.detectedPlayer);
  }
  if (activeName && !knownCharacters.includes(activeName)) {
    knownCharacters.unshift(activeName);
  }
  for (const name of discovered) {
    if (!knownCharacters.includes(name)) {
      knownCharacters.push(name);
    }
  }

  config.known_characters = knownCharacters;
  saveConfig(config);

  characterName = activeName;
  const hasPersisted = Boolean(activeName) && loadVisitedZones(config, activeName).size > 0;
  visitedZones = activeName ? loadVisitedZones(config, activeName) : new Set();
  applyBackscanResult(result, activeName, hasPersisted);
}

async function createWindow() {
  win = new BrowserWindow({
    width: getWindowWidthForLayoutImages(config?.show_layout_images === true),
    height: 900,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function setupIpc() {
  ipcMain.handle('get-version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version;
  });

  ipcMain.handle('get-characters', async () => ({
    active: characterName || config.character_name || '',
    known: knownCharacters
  }));

  ipcMain.handle('set-character', async (event, name) => {
    const newName = String(name || '').trim();
    if (!newName) {
      throw new Error('Character name is required');
    }

    characterName = newName;
    config.character_name = newName;
    if (!knownCharacters.includes(newName)) {
      knownCharacters.push(newName);
      config.known_characters = knownCharacters;
    }
    saveConfig(config);

    visitedZones = loadVisitedZones(config, newName);
    const hasPersisted = visitedZones.size > 0;

    // Reset to defaults before applying new character state so that
    // zone/level/class from the previously-active character cannot leak.
    currentZone = 'Unknown';
    currentLevel = 1;
    playerClass = 'Unknown';

    if (tailer && logPath) {
      const result = tailer.backscan(newName);
      const partyMembers = getPartyMembersFromBackscan(result);
      const discovered = (result.discovered || []).filter((char) => !partyMembers.has(char));
      mergeKnownCharacters(discovered);

      if (result.characterInLog || hasPersisted) {
        // Level/class from backscan are character-specific (parseLevelChange
        // filters by name), so they are reliable when the character was found.
        if (result.characterInLog) {
          currentLevel = result.level || currentLevel;
          playerClass = result.playerClass || playerClass;
        }
        // Zone changes in the log are NOT character-specific, so the backscan
        // zone may belong to another character's session.  Only trust it when
        // this character has actually visited that zone.
        if (result.zone && visitedZones.has(result.zone)) {
          currentZone = result.zone;
        }
      }
    }

    restartTailer();
    sendState();

    return { status: 'ok', character_name: newName };
  });

  ipcMain.handle('get-state', async () => buildState());

  ipcMain.handle('get-preferences', async () => ({
    vendorRegexes: Array.isArray(config.vendor_regexes) ? config.vendor_regexes : [],
    trackedBases: config.tracked_bases && typeof config.tracked_bases === 'object' ? config.tracked_bases : {},
    showLayoutImages: config.show_layout_images === true
  }));

  ipcMain.handle('save-preferences', async (event, prefs) => {
    const next = { ...config };
    if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'vendorRegexes')) {
      next.vendor_regexes = Array.isArray(prefs.vendorRegexes) ? prefs.vendorRegexes : [];
    }
    if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'trackedBases')) {
      next.tracked_bases = prefs.trackedBases && typeof prefs.trackedBases === 'object' && !Array.isArray(prefs.trackedBases)
        ? prefs.trackedBases
        : {};
    }
    if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'showLayoutImages')) {
      next.show_layout_images = prefs.showLayoutImages === true;
    }
    config = next;
    saveConfig(config);
    return { ok: true };
  });

  ipcMain.handle('set-campaign-location', async (event, newVisitedZones) => {
    if (!characterName) {
      throw new Error('No character selected');
    }
    visitedZones = new Set(Array.isArray(newVisitedZones) ? newVisitedZones : []);
    saveVisitedZones(config, characterName, visitedZones);
    config = getConfig();
    sendState();
    return { ok: true };
  });

  ipcMain.handle('set-layout-images-enabled', async (event, enabled) => {
    const nextEnabled = enabled === true;
    config = { ...config, show_layout_images: nextEnabled };
    saveConfig(config);
    resizeWindowForLayoutImages(nextEnabled);
    return { ok: true, showLayoutImages: nextEnabled };
  });
}

async function init() {
  config = getConfig();
  setupIpc();
  await createWindow();

  const resolvedLogPath = await ensureLogPath();
  if (resolvedLogPath) {
    tailer = new LogTailer(resolvedLogPath);
    readInitialStateFromLog();
    restartTailer();
  }

  sendState();
  initAutoUpdater();
}

function initAutoUpdater() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  let latestDownloadUrl = null;

  // Always check via GitHub releases API — works for any build type.
  checkForUpdate(pkg.version, 'crsayen', 'leaguide').then((update) => {
    if (update && update.available && win && !win.isDestroyed()) {
      latestDownloadUrl = update.downloadUrl;
      win.webContents.send('update-available', update);
    }
  });

  // Download handler: download the installer from GitHub, save to temp, launch it
  ipcMain.handle('download-update', async () => {
    if (!latestDownloadUrl) {
      throw new Error('No download URL');
    }

    const tmpDir = app.getPath('temp');
    const fileName = path.basename(latestDownloadUrl);
    const destPath = path.join(tmpDir, fileName);

    // Stream download with progress
    const https = require('https');
    const http = require('http');

    return new Promise((resolve, reject) => {
      const get = latestDownloadUrl.startsWith('https') ? https.get : http.get;

      function doDownload(url) {
        get(url, (res) => {
          // Follow redirects (GitHub uses them for release assets)
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doDownload(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error('Download failed: HTTP ' + res.statusCode));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
          let downloaded = 0;
          const fileStream = fs.createWriteStream(destPath);

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalBytes > 0 && win && !win.isDestroyed()) {
              win.webContents.send('download-progress', {
                percent: Math.round((downloaded / totalBytes) * 100)
              });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            if (win && !win.isDestroyed()) {
              win.webContents.send('update-downloaded', { installerPath: destPath });
            }
            resolve({ status: 'downloaded', path: destPath });
          });

          fileStream.on('error', reject);
        }).on('error', reject);
      }

      doDownload(latestDownloadUrl);
    });
  });

  // Install handler: launch the downloaded installer and quit
  ipcMain.on('install-update', (event, installerPath) => {
    if (installerPath && fs.existsSync(installerPath)) {
      const { spawn } = require('child_process');
      spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore', shell: true }).unref();
      app.quit();
    }
  });
}

app.whenReady().then(init);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (tailer) {
    tailer.stop();
  }
});
