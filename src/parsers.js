const TOWN_VENDORS = {
  'Clearfell Encampment': ['Renly', 'Una', 'Finn'],
  'The Refuge': ['Renly', 'Una', 'Finn'],
  'The Ardura Caravan': ['Shambrin', 'Zarka', 'Risu'],
  'The Khari Bazaar': ['Sekhema Asala', 'Zarka', 'Risu', 'Torbik'],
  'Ziggurat Encampment': ['Oswald', 'Servi', 'Alva'],
  'The Glade': ['Doryani', 'Delwyn', 'Hilda'],
  Kingsmarch: [],
  'The Ziggurat Refuge': ['Zelina', 'Zolin', 'Alva', 'Gwennen', 'Rog', 'Tujen', 'Ange']
};

const ALL_VENDOR_NAMES = new Set(Object.values(TOWN_VENDORS).flat());

function parseZoneChange(line) {
  const match = line.match(/\[SCENE\] Set Source \[(.*?)\]/);
  if (!match) {
    return null;
  }

  const zone = match[1].trim();
  const lowered = zone.toLowerCase();
  if (lowered === '(null)' || lowered === '(unknown)' || lowered.startsWith('act ')) {
    return null;
  }

  return zone;
}

function parseLevelChange(line, playerName) {
  if (!playerName) {
    return null;
  }

  const escaped = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`: ${escaped} \\((.*?)\\) is now level (\\d+)`, 'i'));
  if (!match) {
    return null;
  }

  return {
    level: Number.parseInt(match[2], 10),
    className: match[1]
  };
}

function parseVendorDialog(line) {
  const match = line.match(/\[INFO Client \d+\] (\w[\w\s]*?): .+/);
  if (!match) {
    return null;
  }

  const speaker = match[1].trim();
  return ALL_VENDOR_NAMES.has(speaker) ? speaker : null;
}

function parseDeath(line) {
  const match = line.match(/\[INFO Client \d+\] : (\w+) has been slain\./);
  return match ? match[1] : null;
}

function parseReward(line) {
  const match = line.match(/\[INFO Client \d+\] : (\w+) has received /);
  return match ? match[1] : null;
}

function parseAreaJoin(line) {
  const match = line.match(/\[INFO Client \d+\] : (\w+) has joined the area\./);
  return match ? match[1] : null;
}

function parseAreaLeave(line) {
  const match = line.match(/\[INFO Client \d+\] : (\w+) has left the area\./);
  return match ? match[1] : null;
}

function discoverCharacters(lines) {
  const discovered = [];
  const seen = new Set();

  for (const line of lines) {
    const match = line.match(/: (\w+) \((\w[\w\s]*?)\) is now level (\d+)/);
    if (match) {
      const characterName = match[1];
      if (!seen.has(characterName)) {
        seen.add(characterName);
        discovered.push(characterName);
      }
    }
  }

  return discovered;
}

function identifyPlayerCharacter(lines) {
  const partyMembers = new Set();
  const candidates = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const partyName = parseAreaJoin(line) || parseAreaLeave(line);
    if (partyName) {
      partyMembers.add(partyName);
      continue;
    }

    const rewardName = parseReward(line);
    if (rewardName) {
      const old = candidates.get(rewardName);
      candidates.set(rewardName, { index: i, priority: 3, className: old ? old.className : null });
      continue;
    }

    const deathName = parseDeath(line);
    if (deathName) {
      const old = candidates.get(deathName);
      candidates.set(deathName, {
        index: i,
        priority: old ? Math.max(2, old.priority) : 2,
        className: old ? old.className : null
      });
      continue;
    }

    const levelMatch = line.match(/: (\w+) \((\w[\w\s]*?)\) is now level (\d+)/);
    if (levelMatch) {
      const [, name, className] = levelMatch;
      const old = candidates.get(name);
      candidates.set(name, {
        index: i,
        priority: old ? Math.max(1, old.priority) : 1,
        className
      });
    }
  }

  for (const partyMember of partyMembers) {
    candidates.delete(partyMember);
  }

  let bestName = null;
  let bestData = null;
  for (const [name, data] of candidates.entries()) {
    if (!bestData || data.priority > bestData.priority || (data.priority === bestData.priority && data.index > bestData.index)) {
      bestName = name;
      bestData = data;
    }
  }

  if (!bestData) {
    return null;
  }

  return { name: bestName, className: bestData.className };
}

module.exports = {
  TOWN_VENDORS,
  ALL_VENDOR_NAMES,
  parseZoneChange,
  parseLevelChange,
  parseVendorDialog,
  parseDeath,
  parseReward,
  parseAreaJoin,
  parseAreaLeave,
  discoverCharacters,
  identifyPlayerCharacter
};
