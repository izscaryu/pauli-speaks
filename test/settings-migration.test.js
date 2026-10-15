'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, migrateSettings } = require('../src/main/settings');
const { normalizeBindings } = require('../src/main/shortcut-rules');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
const keysOf = (bindings, action, behaviour) =>
  bindings.filter((b) => b.action === action && (!behaviour || b.behaviour === behaviour)).map((b) => b.keys);

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-settings-'));
  const file = path.join(dir, 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('default bindings do what the old single shortcuts did', () => {
  const b = DEFAULTS.bindings;
  assert.deepEqual(keysOf(b, 'dictate', 'both'), [['Ctrl', 'Meta']]);
  assert.deepEqual(keysOf(b, 'dictate', 'toggle'), [['Ctrl', 'Meta', 'Space']]);
  assert.deepEqual(keysOf(b, 'translate', 'both'), [['Ctrl', 'Meta', 'Shift']]);
  assert.deepEqual(keysOf(b, 'command', 'both'), [['Ctrl', 'Meta', 'Alt']]);
  assert.deepEqual(keysOf(b, 'cancel'), [['Escape']]);
  assert.deepEqual(keysOf(b, 'pasteLast'), [['Shift', 'Alt', 'Z']]);
  assert.deepEqual(keysOf(b, 'readAloud'), [['Shift', 'Alt', 'S']]);
  for (const action of ['copyLast', 'undoLast', 'pressEnter', 'cycleMode']) assert.deepEqual(keysOf(b, action), [], action);
  assert.equal(new Set(b.map((x) => x.id)).size, b.length, 'ids are unique');
  assert.equal(DEFAULTS.shortcuts, undefined);
});

test('old shortcuts become bindings: PTT = both, hands-free = toggle', () => {
  const data = migrateSettings({
    shortcuts: { ptt: ['F8'], handsFree: ['Mouse4'], cancel: ['F9'], pasteLast: ['Shift', 'Alt', 'Z'], translate: ['Ctrl', 'Meta', 'Shift'] },
  });
  assert.equal(data.shortcuts, undefined);
  assert.deepEqual(keysOf(data.bindings, 'dictate', 'both'), [['F8']]);
  assert.deepEqual(keysOf(data.bindings, 'dictate', 'toggle'), [['Mouse4']]);
  assert.deepEqual(keysOf(data.bindings, 'cancel'), [['F9']]);
  assert.deepEqual(keysOf(data.bindings, 'translate', 'both'), [['Ctrl', 'Meta', 'Shift']]);
  assert.deepEqual(keysOf(data.bindings, 'command', 'both'), [['Ctrl', 'Meta', 'Alt']], 'missing ones get the old defaults');
  assert.deepEqual(keysOf(data.bindings, 'readAloud'), [['Shift', 'Alt', 'S']]);
});

test('the old voice-command switch becomes voiceCommandsEnabled plus the default list', () => {
  const off = migrateSettings({ voiceCommands: false });
  assert.equal(off.voiceCommandsEnabled, false);
  assert.deepEqual(off.voiceCommands, DEFAULTS.voiceCommands);
  const on = migrateSettings({ voiceCommands: true });
  assert.equal(on.voiceCommandsEnabled, true);
  assert.ok(DEFAULTS.voiceCommands.some((c) => c.phrases.includes('novi red')));
});

test('an older settings.json is migrated on load, rewritten, and backed up', () => {
  const old = { shortcuts: { ptt: ['AltRight'] }, voiceCommands: false, sounds: false };
  const file = tempFile(old);
  const s = new Settings(file, plain);
  assert.deepEqual(keysOf(s.get().bindings, 'dictate', 'both'), [['AltRight']]);
  assert.equal(s.get().sounds, false);
  assert.equal(s.get().voiceCommandsEnabled, false);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.shortcuts, undefined);
  assert.ok(Array.isArray(saved.bindings));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'settings.v1.json'), 'utf8')), old);
  const again = new Settings(file, plain);
  assert.deepEqual(again.get().bindings, s.get().bindings, 'a migrated file loads unchanged');
});

test('a first run gets the defaults and writes nothing', () => {
  const file = tempFile(null);
  const s = new Settings(file, plain);
  assert.deepEqual(s.get().bindings, DEFAULTS.bindings);
  assert.equal(fs.existsSync(file), false);
});

test('bindings are cleaned up: limits, unknown actions, behaviours, ids', () => {
  const list = normalizeBindings([
    { id: 'a', action: 'dictate', keys: ['F1'], behaviour: 'hold' },
    { id: 'a', action: 'dictate', keys: ['F2'], behaviour: 'sometimes' },
    { action: 'dictate', keys: ['F3'] },
    { action: 'dictate', keys: ['F4'] },
    { action: 'dictate', keys: ['F5'] },
    { action: 'cancel', keys: ['Escape'] },
    { action: 'cancel', keys: ['F6'] },
    { action: 'launchRockets', keys: ['F7'] },
    { action: 'pasteLast', keys: 'F8' },
    { action: 'pressEnter', keys: ['F9'], behaviour: 'hold' },
    { action: 'dictate', keys: ['CtrlRight'], trigger: 'doubleTap', behaviour: 'both' },
  ]);
  assert.deepEqual(keysOf(list, 'dictate'), [['F1'], ['F2'], ['F3'], ['F4']], 'four per action');
  assert.deepEqual(keysOf(list, 'cancel'), [['Escape']], 'one cancel');
  assert.deepEqual(list.find((b) => b.keys[0] === 'F2').behaviour, 'both');
  assert.equal(list.find((b) => b.action === 'pressEnter').behaviour, undefined, 'only talk actions have a behaviour');
  assert.equal(list.length, 6);
  assert.equal(new Set(list.map((b) => b.id)).size, list.length);
  assert.equal(list[0].id, 'a');
});

test('a double-tap talk binding always toggles', () => {
  const [b] = normalizeBindings([{ action: 'dictate', keys: ['CtrlRight'], trigger: 'doubleTap', behaviour: 'hold' }]);
  assert.equal(b.behaviour, 'toggle');
  assert.equal(b.trigger, 'doubleTap');
});

test('update() cleans bindings sent by the window', () => {
  const s = new Settings(tempFile(null), plain);
  s.update({ bindings: [{ action: 'dictate', keys: ['F8'], behaviour: 'hold' }, { action: 'nope', keys: ['F9'] }] });
  assert.equal(s.get().bindings.length, 1);
  assert.ok(s.get().bindings[0].id);
});
