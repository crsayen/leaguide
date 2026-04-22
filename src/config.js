const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  known_characters: []
};

function getElectronApp() {
  try {
    const electron = require('electron');
    return electron.app || (electron.remote && electron.remote.app) || null;
  } catch (error) {
    return null;
  }
}

function getUserDataDir() {
  const electronApp = getElectronApp();
  if (electronApp && electronApp.isReady && electronApp.isReady()) {
    return electronApp.getPath('userData');
  }

  return __dirname;
}

function getLegacyConfigPath() {
  return path.join(process.cwd(), 'config.json');
}

function getDefaultConfigPath() {
  return path.join(getUserDataDir(), 'config.json');
}

function resolveConfigPath() {
  const legacyPath = getLegacyConfigPath();
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return getDefaultConfigPath();
}

function withDefaults(cfg) {
  const next = cfg && typeof cfg === 'object' ? { ...cfg } : {};
  next.known_characters = Array.isArray(next.known_characters) ? next.known_characters : [];
  return { ...DEFAULT_CONFIG, ...next };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getConfig() {
  const filePath = resolveConfigPath();
  if (!fs.existsSync(filePath)) {
    return withDefaults({});
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return withDefaults(JSON.parse(raw));
  } catch (error) {
    return withDefaults({});
  }
}

function saveConfig(cfg) {
  const filePath = resolveConfigPath();
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(withDefaults(cfg), null, 4), 'utf8');
}

function getLogPath(cfg) {
  const customPath = cfg && typeof cfg.log_path === 'string' ? cfg.log_path : '';
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  const commonPaths = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Steam', 'steamapps', 'common', 'Path of Exile 2', 'logs', 'Client.txt'),
    path.join(process.env.USERPROFILE || '', 'Documents', 'My Games', 'Path of Exile 2', 'logs', 'Client.txt'),
    'C:\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt'
  ];

  for (const candidate of commonPaths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadVisitedZones(cfg, charName) {
  const visited = cfg && typeof cfg.visited_zones === 'object' && cfg.visited_zones ? cfg.visited_zones : {};
  return new Set(Array.isArray(visited[charName]) ? visited[charName] : []);
}

function saveVisitedZones(cfg, charName, zonesSet) {
  const next = withDefaults(cfg);
  const visited = next.visited_zones && typeof next.visited_zones === 'object' ? { ...next.visited_zones } : {};
  visited[charName] = Array.from(zonesSet);
  next.visited_zones = visited;
  saveConfig(next);
}

module.exports = {
  getConfig,
  saveConfig,
  getLogPath,
  loadVisitedZones,
  saveVisitedZones,
  resolveConfigPath
};
