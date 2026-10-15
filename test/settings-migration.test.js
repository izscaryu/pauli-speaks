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

// --- versioning -------------------------------------------------------------

const { SETTINGS_VERSION, MIGRATIONS, runMigrations } = require('../src/main/settings');

const backupOf = (file, v) => path.join(path.dirname(file), `settings.v${v}.json`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('migrations form an unbroken chain up to the current version', () => {
  assert.equal(SETTINGS_VERSION, 2);
  MIGRATIONS.forEach((m, i) => {
    assert.equal(m.from, i + 1);
    assert.equal(m.to, m.from + 1);
  });
  assert.equal(MIGRATIONS.at(-1).to, SETTINGS_VERSION);
});

test('v1 → v2 on its own: shortcuts become bindings, the voice-command switch becomes voiceCommandsEnabled', () => {
  const [v1to2] = MIGRATIONS;
  const out = v1to2.run({ shortcuts: { ptt: ['F8'] }, voiceCommands: false, sounds: false });
  assert.equal(out.shortcuts, undefined);
  assert.deepEqual(keysOf(out.bindings, 'dictate', 'both'), [['F8']]);
  assert.equal(out.voiceCommandsEnabled, false);
  assert.ok(Array.isArray(out.voiceCommands));
  assert.equal(out.sounds, false, 'other settings are kept');
});

test('v1 → v2 leaves a file that already has bindings alone', () => {
  const bindings = [{ id: 'x', action: 'dictate', keys: ['F8'], behaviour: 'hold' }];
  const out = MIGRATIONS[0].run({ bindings, voiceCommands: DEFAULTS.voiceCommands });
  assert.deepEqual(out.bindings, bindings);
  assert.deepEqual(out.voiceCommands, DEFAULTS.voiceCommands);
});

test('runMigrations applies each step in order, from the file\'s version to the target', () => {
  const seen = [];
  const steps = [
    { from: 1, to: 2, run: (s) => (seen.push(1), { ...s, a: 'one' }) },
    { from: 2, to: 3, run: (s) => (seen.push(2), { ...s, b: `${s.a}+two` }) },
    { from: 3, to: 4, run: (s) => (seen.push(3), { ...s, c: `${s.b}+three` }) },
  ];
  const out = runMigrations({ settingsVersion: 2, a: 'kept' }, steps, 4);
  assert.deepEqual(seen, [2, 3]);
  assert.equal(out.c, 'kept+two+three');
  assert.equal(out.settingsVersion, 4);
});

test('a file without settingsVersion is version 1 and runs the whole chain', () => {
  const steps = [{ from: 1, to: 2, run: (s) => ({ ...s, migrated: true }) }];
  assert.deepEqual(runMigrations({ x: 1 }, steps, 2), { x: 1, migrated: true, settingsVersion: 2 });
});

test('a file at the target version runs no migration', () => {
  const steps = [{ from: 1, to: 2, run: () => assert.fail('should not run') }];
  assert.deepEqual(runMigrations({ settingsVersion: 2, x: 1 }, steps, 2), { settingsVersion: 2, x: 1 });
});

test('a file from a newer version is left as it is', () => {
  const steps = [{ from: 1, to: 2, run: () => assert.fail('should not run') }];
  assert.deepEqual(runMigrations({ settingsVersion: 7, x: 1 }, steps, 2), { settingsVersion: 7, x: 1 });
});

test('a gap in the chain is an error, not a silently skipped step', () => {
  const steps = [{ from: 1, to: 2, run: (s) => s }];
  assert.throws(() => runMigrations({}, steps, 3), /2/);
});

test('a version number that is not a whole number counts as version 1', () => {
  const steps = [{ from: 1, to: 2, run: (s) => ({ ...s, migrated: true }) }];
  assert.equal(runMigrations({ settingsVersion: 'two' }, steps, 2).migrated, true);
  assert.equal(runMigrations({ settingsVersion: 1.5 }, steps, 2).migrated, true);
});

test('migrateSettings brings a v1 file all the way to the current version', () => {
  const out = migrateSettings({ shortcuts: { ptt: ['F8'] } });
  assert.equal(out.settingsVersion, SETTINGS_VERSION);
  assert.deepEqual(keysOf(out.bindings, 'dictate', 'both'), [['F8']]);
});

test('the saved file records settingsVersion; the window cannot change it', () => {
  const file = tempFile(null);
  const s = new Settings(file, plain);
  s.update({ sounds: false, settingsVersion: 99 });
  assert.equal(readJson(file).settingsVersion, SETTINGS_VERSION);
  assert.equal(s.get().settingsVersion, undefined, 'not a setting');
});

test('a v1 file is backed up as settings.v1.json and saved as the current version', () => {
  const old = { shortcuts: { ptt: ['F8'] } };
  const file = tempFile(old);
  new Settings(file, plain);
  assert.deepEqual(readJson(backupOf(file, 1)), old);
  assert.equal(readJson(file).settingsVersion, SETTINGS_VERSION);
});

test('an unnumbered file that already has bindings gets a version number but keeps an existing v1 backup', () => {
  const bindings = [{ id: 'mine', action: 'dictate', keys: ['F8'], behaviour: 'hold' }];
  const file = tempFile({ bindings, sounds: false });
  const realV1 = { shortcuts: { ptt: ['AltRight'] } };
  fs.writeFileSync(backupOf(file, 1), JSON.stringify(realV1));
  const s = new Settings(file, plain);
  assert.deepEqual(s.get().bindings, bindings);
  assert.equal(readJson(file).settingsVersion, SETTINGS_VERSION);
  assert.deepEqual(readJson(backupOf(file, 1)), realV1, 'the first backup is never overwritten');
});

test('a file at the current version is not rewritten on load', () => {
  const content = { settingsVersion: SETTINGS_VERSION, sounds: false };
  const file = tempFile(content);
  new Settings(file, plain);
  assert.deepEqual(readJson(file), content);
  assert.equal(fs.existsSync(backupOf(file, SETTINGS_VERSION)), false);
});

test('a file from a newer version is backed up before this version saves over it', () => {
  const newer = { settingsVersion: SETTINGS_VERSION + 1, sounds: false, someFutureSetting: { on: true } };
  const file = tempFile(newer);
  const s = new Settings(file, plain);
  assert.equal(s.get().sounds, false, 'what this version understands is used');
  s.update({ capitalize: false });
  assert.deepEqual(readJson(backupOf(file, SETTINGS_VERSION + 1)), newer);
});
