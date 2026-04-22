const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { TOWN_VENDORS } = require('./parsers');
const { getConfig, saveConfig, getLogPath, loadVisitedZones, saveVisitedZones } = require('./config');
const { LogTailer } = require('./log-tailer');
const { checkForUpdate } = require('./updater');

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
    width: 800,
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

    const hasPersisted = loadVisitedZones(config, newName).size > 0;
    visitedZones = loadVisitedZones(config, newName);

    if (tailer && logPath) {
      const result = tailer.backscan(newName);
      const partyMembers = getPartyMembersFromBackscan(result);
      const discovered = (result.discovered || []).filter((char) => !partyMembers.has(char));
      mergeKnownCharacters(discovered);

      if (!result.characterInLog && !hasPersisted) {
        currentLevel = 1;
        playerClass = 'Unknown';
        currentZone = 'Unknown';
        visitedZones = new Set();
      } else {
        currentZone = result.zone || currentZone;
        currentLevel = result.level || currentLevel;
        playerClass = result.playerClass || 'Unknown';
      }
    } else if (!hasPersisted) {
      currentLevel = 1;
      playerClass = 'Unknown';
      currentZone = 'Unknown';
    }

    restartTailer();
    sendState();

    return { status: 'ok', character_name: newName };
  });

  ipcMain.handle('get-state', async () => buildState());
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

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const update = await checkForUpdate(pkg.version, 'crsayen', 'leaguide');
  if (update && update.available && win && !win.isDestroyed()) {
    win.webContents.send('update-available', update);
  }
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
