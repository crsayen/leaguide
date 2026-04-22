const fs = require('fs');
const EventEmitter = require('events');

const {
  parseZoneChange,
  parseLevelChange,
  parseVendorDialog,
  parseDeath,
  parseReward,
  parseAreaJoin,
  parseAreaLeave,
  discoverCharacters,
  identifyPlayerCharacter
} = require('./parsers');

class LogTailer extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.fd = null;
    this.position = 0;
    this.pollTimer = null;
    this.waitTimer = null;
    this.running = false;
    this.playerName = '';
    this.currentZone = 'Unknown';
    this.currentLevel = 1;
    this.playerClass = 'Unknown';
    this.partyMembers = new Set();
    this.leftover = '';
    this.isPolling = false;
  }

  backscan(playerName, scanBytes = 2 * 1024 * 1024) {
    if (!fs.existsSync(this.filePath)) {
      return {
        discovered: [],
        characterInLog: false,
        detectedPlayer: null,
        detectedClass: null,
        zone: this.currentZone,
        level: this.currentLevel,
        playerClass: this.playerClass,
        partyMembers: []
      };
    }

    const stats = fs.statSync(this.filePath);
    const fileSize = stats.size;
    const startPos = Math.max(0, fileSize - scanBytes);
    const fd = fs.openSync(this.filePath, 'r');

    try {
      const length = fileSize - startPos;
      const buffer = Buffer.alloc(length);
      if (length > 0) {
        fs.readSync(fd, buffer, 0, length, startPos);
      }

      let content = buffer.toString('utf8');
      if (startPos > 0) {
        const firstNewline = content.indexOf('\n');
        content = firstNewline === -1 ? '' : content.slice(firstNewline + 1);
      }

      const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
      let zone = this.currentZone;
      let level = this.currentLevel;
      let playerClass = this.playerClass;
      let zoneFound = false;
      let levelFound = false;

      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];

        if (!zoneFound) {
          const foundZone = parseZoneChange(line);
          if (foundZone) {
            zone = foundZone;
            zoneFound = true;
          }
        }

        if (!levelFound && playerName) {
          const foundLevel = parseLevelChange(line, playerName);
          if (foundLevel) {
            level = foundLevel.level;
            playerClass = foundLevel.className;
            levelFound = true;
          }
        }

        if (zoneFound && levelFound) {
          break;
        }
      }

      const discovered = discoverCharacters(lines);
      const characterInLog = Boolean(playerName) && discovered.includes(playerName);
      const detected = identifyPlayerCharacter(lines);
      const partyMembers = [];
      for (const line of lines) {
        const partyMember = parseAreaJoin(line) || parseAreaLeave(line);
        if (partyMember && !partyMembers.includes(partyMember)) {
          partyMembers.push(partyMember);
        }
      }

      return {
        discovered,
        characterInLog,
        detectedPlayer: detected ? detected.name : null,
        detectedClass: detected ? detected.className : null,
        zone,
        level,
        playerClass,
        partyMembers
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  start(playerName) {
    this.stop();
    this.running = true;
    this.playerName = playerName || '';
    this.partyMembers = new Set();
    this.leftover = '';
    this.openWhenAvailable();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch (error) {
        // ignore close errors
      }
      this.fd = null;
    }
  }

  openWhenAvailable() {
    if (!this.running) {
      return;
    }

    if (!fs.existsSync(this.filePath)) {
      this.waitTimer = setTimeout(() => this.openWhenAvailable(), 2000);
      return;
    }

    try {
      this.fd = fs.openSync(this.filePath, 'r');
      this.position = fs.statSync(this.filePath).size;
      this.pollTimer = setInterval(() => {
        this.poll().catch(() => {});
      }, 100);
    } catch (error) {
      if (this.fd !== null) {
        try {
          fs.closeSync(this.fd);
        } catch (closeError) {
          // ignore
        }
        this.fd = null;
      }
      this.waitTimer = setTimeout(() => this.openWhenAvailable(), 2000);
    }
  }

  async poll() {
    if (!this.running || this.fd === null || this.isPolling) {
      return;
    }

    this.isPolling = true;
    const shouldContinue = this.running;
    try {
      const stats = fs.statSync(this.filePath);
      if (stats.size < this.position) {
        this.position = 0;
        this.leftover = '';
      }

      if (stats.size === this.position) {
        return;
      }

      const toRead = stats.size - this.position;
      const buffer = Buffer.alloc(toRead);
      const bytesRead = fs.readSync(this.fd, buffer, 0, toRead, this.position);
      this.position += bytesRead;
      this.consumeChunk(buffer.toString('utf8', 0, bytesRead));
    } catch (error) {
      this.stop();
      if (shouldContinue) {
        this.running = true;
        this.openWhenAvailable();
      }
    } finally {
      this.isPolling = false;
    }
  }

  consumeChunk(chunk) {
    const combined = this.leftover + chunk;
    const parts = combined.split(/\r?\n/);
    this.leftover = parts.pop() || '';
    for (const line of parts) {
      if (line) {
        this.processLine(line);
      }
    }
  }

  processLine(line) {
    const activeName = this.playerName;

    const joined = parseAreaJoin(line);
    if (joined) {
      this.partyMembers.add(joined);
    }

    const left = parseAreaLeave(line);
    if (left) {
      this.partyMembers.add(left);
    }

    if (!this.playerName) {
      const detected = parseReward(line) || parseDeath(line);
      if (detected && !this.partyMembers.has(detected)) {
        this.playerName = detected;
        this.emit('character-detected', { characterName: detected });
      }
    }

    const discovered = discoverCharacters([line]).filter((name) => !this.partyMembers.has(name));
    if (discovered.length > 0) {
      this.emit('characters-discovered', { characters: discovered });
    }

    const newZone = parseZoneChange(line);
    if (newZone && newZone !== this.currentZone) {
      this.currentZone = newZone;
      this.emit('zone-change', { zone: newZone });
    }

    const currentActiveName = this.playerName || activeName;
    if (currentActiveName) {
      const levelChange = parseLevelChange(line, currentActiveName);
      if (levelChange && levelChange.level !== this.currentLevel) {
        this.currentLevel = levelChange.level;
        this.playerClass = levelChange.className;
        this.emit('level-up', { level: this.currentLevel, className: this.playerClass, characterName: currentActiveName });
      }
    }

    const vendor = parseVendorDialog(line);
    if (vendor) {
      this.emit('vendor-dialog', { vendorName: vendor });
    }

    const death = parseDeath(line);
    if (death) {
      this.emit('death', { name: death });
    }
  }
}

module.exports = {
  LogTailer
};
