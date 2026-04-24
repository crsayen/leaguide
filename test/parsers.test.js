const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../src/parsers');

describe('parseZoneChange', () => {
  it('extracts zone name from SCENE log line', () => {
    assert.equal(
      parseZoneChange('[SCENE] Set Source [The Riverbank]'),
      'The Riverbank'
    );
  });

  it('trims whitespace from zone name', () => {
    assert.equal(
      parseZoneChange('[SCENE] Set Source [ Clearfell ]'),
      'Clearfell'
    );
  });

  it('returns null for non-scene lines', () => {
    assert.equal(parseZoneChange('[INFO Client 123] some other log'), null);
  });

  it('returns null for (null) zone', () => {
    assert.equal(parseZoneChange('[SCENE] Set Source [(null)]'), null);
  });

  it('returns null for (unknown) zone', () => {
    assert.equal(parseZoneChange('[SCENE] Set Source [(Unknown)]'), null);
  });

  it('returns null for act transitions', () => {
    assert.equal(parseZoneChange('[SCENE] Set Source [Act 2]'), null);
  });
});

describe('parseLevelChange', () => {
  it('extracts level and class for matching player', () => {
    const result = parseLevelChange(
      '[INFO Client 123] : TestChar (Warrior) is now level 15',
      'TestChar'
    );
    assert.deepEqual(result, { level: 15, className: 'Warrior' });
  });

  it('returns null when player name does not match', () => {
    assert.equal(
      parseLevelChange(
        '[INFO Client 123] : OtherChar (Witch) is now level 10',
        'TestChar'
      ),
      null
    );
  });

  it('returns null when no player name provided', () => {
    assert.equal(
      parseLevelChange('[INFO Client 123] : TestChar (Warrior) is now level 5', null),
      null
    );
  });

  it('returns null for empty player name', () => {
    assert.equal(
      parseLevelChange('[INFO Client 123] : TestChar (Warrior) is now level 5', ''),
      null
    );
  });

  it('handles class names with spaces', () => {
    const result = parseLevelChange(
      '[INFO Client 123] : MyChar (Blood Mage) is now level 20',
      'MyChar'
    );
    assert.deepEqual(result, { level: 20, className: 'Blood Mage' });
  });

  it('escapes regex special chars in player name', () => {
    const result = parseLevelChange(
      '[INFO Client 123] : Test.Char (Ranger) is now level 3',
      'Test.Char'
    );
    assert.deepEqual(result, { level: 3, className: 'Ranger' });
  });
});

describe('parseVendorDialog', () => {
  it('returns vendor name when a known vendor speaks', () => {
    assert.equal(
      parseVendorDialog('[INFO Client 123] Renly: Welcome, Exile.'),
      'Renly'
    );
  });

  it('returns null for unknown speakers', () => {
    assert.equal(
      parseVendorDialog('[INFO Client 123] RandomNPC: Hello there.'),
      null
    );
  });

  it('returns null for non-dialog lines', () => {
    assert.equal(parseVendorDialog('[SCENE] Set Source [Kingsmarch]'), null);
  });
});

describe('parseDeath', () => {
  it('extracts character name from death line', () => {
    assert.equal(
      parseDeath('[INFO Client 123] : TestChar has been slain.'),
      'TestChar'
    );
  });

  it('returns null for non-death lines', () => {
    assert.equal(parseDeath('[INFO Client 123] : TestChar has joined the area.'), null);
  });
});

describe('parseReward', () => {
  it('extracts character name from reward line', () => {
    assert.equal(
      parseReward('[INFO Client 123] : TestChar has received '),
      'TestChar'
    );
  });

  it('returns null for non-reward lines', () => {
    assert.equal(parseReward('[INFO Client 123] : TestChar has been slain.'), null);
  });
});

describe('parseAreaJoin', () => {
  it('extracts name from area join line', () => {
    assert.equal(
      parseAreaJoin('[INFO Client 123] : PartyMember has joined the area.'),
      'PartyMember'
    );
  });

  it('returns null for non-join lines', () => {
    assert.equal(parseAreaJoin('[INFO Client 123] : TestChar has been slain.'), null);
  });
});

describe('parseAreaLeave', () => {
  it('extracts name from area leave line', () => {
    assert.equal(
      parseAreaLeave('[INFO Client 123] : PartyMember has left the area.'),
      'PartyMember'
    );
  });

  it('returns null for non-leave lines', () => {
    assert.equal(parseAreaLeave('[INFO Client 123] some random line'), null);
  });
});

describe('discoverCharacters', () => {
  it('finds unique character names from level-up lines', () => {
    const lines = [
      '[INFO Client 1] : Alpha (Warrior) is now level 5',
      '[INFO Client 1] : Beta (Witch) is now level 3',
      '[INFO Client 1] : Alpha (Warrior) is now level 6'
    ];
    assert.deepEqual(discoverCharacters(lines), ['Alpha', 'Beta']);
  });

  it('returns empty array when no level-ups found', () => {
    assert.deepEqual(discoverCharacters(['[SCENE] Set Source [Clearfell]']), []);
  });
});

describe('identifyPlayerCharacter', () => {
  it('identifies player by reward lines (highest priority)', () => {
    const lines = [
      '[INFO Client 1] : Alpha (Warrior) is now level 5',
      '[INFO Client 1] : Alpha has received '
    ];
    const result = identifyPlayerCharacter(lines);
    assert.equal(result.name, 'Alpha');
  });

  it('excludes party members who joined/left', () => {
    const lines = [
      '[INFO Client 1] : PartyGuy has joined the area.',
      '[INFO Client 1] : PartyGuy has received ',
      '[INFO Client 1] : MyChar (Ranger) is now level 2',
      '[INFO Client 1] : MyChar has received '
    ];
    const result = identifyPlayerCharacter(lines);
    assert.equal(result.name, 'MyChar');
  });

  it('returns null when no candidates found', () => {
    const lines = ['[SCENE] Set Source [Clearfell]'];
    assert.equal(identifyPlayerCharacter(lines), null);
  });
});

describe('TOWN_VENDORS', () => {
  it('contains expected town hubs', () => {
    assert.ok(TOWN_VENDORS['Clearfell Encampment']);
    assert.ok(TOWN_VENDORS['Kingsmarch'] !== undefined);
  });

  it('ALL_VENDOR_NAMES includes known vendors', () => {
    assert.ok(ALL_VENDOR_NAMES.has('Renly'));
    assert.ok(ALL_VENDOR_NAMES.has('Una'));
    assert.ok(ALL_VENDOR_NAMES.has('Zarka'));
  });
});
