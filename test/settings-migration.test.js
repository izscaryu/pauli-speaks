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
  bindings.filter((b) => b.action === action && !b.mode && (!behaviour || b.behaviour === behaviour)).map((b) => b.keys);
const translateKeys = (bindings) => bindings.filter((b) => b.action === 'dictate' && b.mode === 'translate').map((b) => [b.keys, b.behaviour]);

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
  assert.deepEqual(translateKeys(b), [[['Ctrl', 'Meta', 'Shift'], 'both']], 'Talk & translate is a Dictate shortcut for the Translate mode');
  assert.ok(DEFAULTS.modes.some((m) => m.id === 'translate' && m.translateTo === 'en'));
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
  assert.deepEqual(translateKeys(data.bindings), [[['Ctrl', 'Meta', 'Shift'], 'both']]);
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
    { id: 'a', action: 'command', keys: ['F1'], behaviour: 'hold' },
    { id: 'a', action: 'command', keys: ['F2'], behaviour: 'sometimes' },
    { action: 'command', keys: ['F3'] },
    { action: 'command', keys: ['F4'] },
    { action: 'command', keys: ['F5'] },
    { action: 'cancel', keys: ['Escape'] },
    { action: 'cancel', keys: ['F6'] },
    { action: 'launchRockets', keys: ['F7'] },
    { action: 'pasteLast', keys: 'F8' },
    { action: 'pressEnter', keys: ['F9'], behaviour: 'hold' },
    { action: 'command', keys: ['CtrlRight'], trigger: 'doubleTap', behaviour: 'both' },
  ]);
  assert.deepEqual(keysOf(list, 'command'), [['F1'], ['F2'], ['F3'], ['F4']], 'four per action');
  assert.deepEqual(keysOf(list, 'cancel'), [['Escape']], 'one cancel');
  assert.deepEqual(list.find((b) => b.keys[0] === 'F2').behaviour, 'both');
  assert.equal(list.find((b) => b.action === 'pressEnter').behaviour, undefined, 'only talk actions have a behaviour');
  assert.equal(list.length, 6);
  assert.equal(new Set(list.map((b) => b.id)).size, list.length);
  assert.equal(list[0].id, 'a');
});

test('Dictate takes up to eight shortcuts (one per mode is the point), each keeping its mode', () => {
  const list = normalizeBindings(Array.from({ length: 10 }, (_, i) => ({ action: 'dictate', keys: [`F${i + 13}`], mode: i ? `m${i}` : undefined })));
  assert.equal(list.length, 8);
  assert.equal(list[0].mode, undefined);
  assert.equal(list[3].mode, 'm3');
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
  assert.equal(SETTINGS_VERSION, 8);
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

test('v2 → v3 on its own: "Get early versions" arrives switched off, everything else is kept', () => {
  const v2to3 = MIGRATIONS.find((m) => m.from === 2);
  assert.equal(v2to3.to, 3);
  const out = v2to3.run({ sounds: false, bindings: [{ id: 'x', action: 'dictate', keys: ['F8'], behaviour: 'hold' }] });
  assert.equal(out.betaUpdates, false);
  assert.equal(out.sounds, false);
  assert.deepEqual(out.bindings, [{ id: 'x', action: 'dictate', keys: ['F8'], behaviour: 'hold' }]);
  assert.equal(v2to3.run({ betaUpdates: true }).betaUpdates, true, 'an existing choice is kept');
  assert.equal(v2to3.run({ betaUpdates: 'yes' }).betaUpdates, false, 'anything but true is off');
});

test('v3 → v4 on its own: an onboarded user keeps the setup card, lastSeenVersion stays unset', () => {
  const v3to4 = MIGRATIONS.find((m) => m.from === 3);
  assert.equal(v3to4.to, 4);
  const out = v3to4.run({ settingsVersion: 3, onboarded: true, sounds: false });
  assert.equal(out.setupCard, true);
  assert.equal(out.onboarded, true);
  assert.equal(out.sounds, false, 'other settings are kept');
  assert.equal('lastSeenVersion' in out, false, 'existing users see the release notes once');
  assert.equal(v3to4.run({ onboarded: false }).setupCard, false);
  assert.equal(v3to4.run({}).setupCard, false);
  assert.equal(v3to4.run({ onboarded: 'yes' }).setupCard, false, 'anything but true is off');
});

test('a v1 file with onboarded: false reaches v4 without a setup card', () => {
  const out = runMigrations({ onboarded: false }, MIGRATIONS, SETTINGS_VERSION);
  assert.equal(out.setupCard, false);
  assert.equal(out.onboarded, false);
  assert.equal(out.settingsVersion, SETTINGS_VERSION);
});

test('a new install is not onboarded and has no setup card', () => {
  const s = new Settings(tempFile(null), plain);
  assert.equal(s.get().onboarded, false);
  assert.equal(s.get().setupCard, false);
  assert.equal(s.get().lastSeenVersion, '');
});

test('early versions are off by default', () => {
  assert.equal(DEFAULTS.betaUpdates, false);
  assert.equal(new Settings(tempFile(null), plain).get().betaUpdates, false);
});

test('a v2 file is backed up as settings.v2.json and saved as the current version with early versions off', () => {
  const v2 = { settingsVersion: 2, sounds: false, bindings: [{ id: 'x', action: 'dictate', keys: ['F8'], behaviour: 'hold' }] };
  const file = tempFile(v2);
  const s = new Settings(file, plain);
  assert.equal(s.get().betaUpdates, false);
  assert.equal(s.get().sounds, false);
  assert.deepEqual(readJson(backupOf(file, 2)), v2);
  const saved = readJson(file);
  assert.equal(saved.settingsVersion, SETTINGS_VERSION);
  assert.equal(saved.betaUpdates, false);
});

test('a v3 file is backed up as settings.v3.json and saved as the current version with the setup card kept for onboarded users', () => {
  const v3 = { settingsVersion: 3, onboarded: true, sounds: false };
  const file = tempFile(v3);
  const s = new Settings(file, plain);
  assert.equal(s.get().setupCard, true);
  assert.equal(s.get().lastSeenVersion, '');
  assert.deepEqual(readJson(backupOf(file, 3)), v3);
  const saved = readJson(file);
  assert.equal(saved.settingsVersion, SETTINGS_VERSION);
  assert.equal(saved.setupCard, true);
  assert.equal(saved.onboarded, true);
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

// --- v4 -> v5 (dictation that just works) ------------------------------------

const V5_DEFAULTS = { silenceDetection: true, crashRecovery: true, historyRetention: 'keep', audioHistory: 'off', languageHints: { shown: [] } };

test('v4 → v5 on its own: existing keys are untouched and the new ones get their defaults', () => {
  const v4to5 = MIGRATIONS.find((m) => m.from === 4);
  assert.equal(v4to5.to, 5);
  const saved = { settingsVersion: 4, sounds: false, languages: ['hr'], cloud: { model: 'x' } };
  const out = v4to5.run(saved);
  for (const [k, v] of Object.entries(V5_DEFAULTS)) assert.deepEqual(out[k], v, k);
  assert.equal(out.sounds, false);
  assert.deepEqual(out.languages, ['hr']);
  assert.deepEqual(out.cloud, { model: 'x' });
  assert.equal(saved.silenceDetection, undefined, 'the input is not changed');
});

test('v4 → v5 adds only missing keys: a value already there is kept', () => {
  const v4to5 = MIGRATIONS.find((m) => m.from === 4);
  const out = v4to5.run({ silenceDetection: false, historyRetention: '24h', languageHints: { shown: ['hr'] } });
  assert.equal(out.silenceDetection, false);
  assert.equal(out.historyRetention, '24h');
  assert.deepEqual(out.languageHints, { shown: ['hr'] });
  assert.equal(out.crashRecovery, true);
  assert.equal(out.audioHistory, 'off');
});

test('the v5 defaults hold for a new install', () => {
  const data = new Settings(tempFile(null), plain).get();
  for (const [k, v] of Object.entries(V5_DEFAULTS)) assert.deepEqual(data[k], v, k);
});

test('a v4 file is backed up as settings.v4.json and saved as the current version with the v5 defaults', () => {
  const v4 = { settingsVersion: 4, sounds: false, onboarded: true };
  const file = tempFile(v4);
  const s = new Settings(file, plain);
  for (const [k, v] of Object.entries(V5_DEFAULTS)) assert.deepEqual(s.get()[k], v, k);
  assert.equal(s.get().sounds, false);
  assert.deepEqual(readJson(backupOf(file, 4)), v4);
  const saved = readJson(file);
  assert.equal(saved.settingsVersion, SETTINGS_VERSION);
  assert.equal(saved.silenceDetection, true);
});

test('languageHints merges key by key like the other object settings', () => {
  const s = new Settings(tempFile({ settingsVersion: 5, languageHints: {} }), plain);
  assert.deepEqual(s.get().languageHints, { shown: [] });
});

// --- v5 -> v6 (speaks your language) ------------------------------------------

test('v5 → v6 on its own: the UI language arrives as "Same as Windows", everything else is kept', () => {
  const v5to6 = MIGRATIONS.find((m) => m.from === 5);
  assert.equal(v5to6.to, 6);
  const saved = { settingsVersion: 5, sounds: false, languages: ['hr'] };
  const out = v5to6.run(saved);
  assert.equal(out.uiLanguage, 'system');
  assert.equal(out.sounds, false);
  assert.deepEqual(out.languages, ['hr']);
  assert.equal(saved.uiLanguage, undefined, 'the input is not changed');
});

test('v5 → v6 keeps a UI language that is already there', () => {
  assert.equal(MIGRATIONS.find((m) => m.from === 5).run({ uiLanguage: 'hr' }).uiLanguage, 'hr');
});

test('a new install follows the Windows language', () => {
  assert.equal(new Settings(tempFile(null), plain).get().uiLanguage, 'system');
});

test('a v5 file is backed up as settings.v5.json and saved as v6 with uiLanguage', () => {
  const v5 = { settingsVersion: 5, sounds: false, onboarded: true };
  const file = tempFile(v5);
  const s = new Settings(file, plain);
  assert.equal(s.get().uiLanguage, 'system');
  assert.deepEqual(readJson(backupOf(file, 5)), v5);
  const saved = readJson(file);
  assert.equal(saved.settingsVersion, SETTINGS_VERSION);
  assert.equal(saved.uiLanguage, 'system');
});

test('update() takes "system" or a language code for uiLanguage and ignores anything else', () => {
  const s = new Settings(tempFile(null), plain);
  s.update({ uiLanguage: 'hr' });
  assert.equal(s.get().uiLanguage, 'hr');
  for (const bad of [42, '', '../../etc', 'x'.repeat(40), null]) {
    s.update({ uiLanguage: bad });
    assert.equal(s.get().uiLanguage, 'hr', String(bad));
  }
  s.update({ uiLanguage: 'system' });
  assert.equal(s.get().uiLanguage, 'system');
});

// --- v6 -> v7 (modes) ---------------------------------------------------------

const modeIds = (modes) => modes.map((m) => m.id);

test('a v6 file is backed up as settings.v6.json and saved as v7: its app styles, Always translate and translate key are modes now', () => {
  const v6 = {
    settingsVersion: 6, sounds: false,
    appStyles: { enabled: true, rules: [{ app: 'outlook.exe', style: 'formal' }, { app: 'code.exe', style: 'code' }] },
    translation: { always: true, target: 'en', quality: 'fast' },
    bindings: [
      { id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'Meta'], behaviour: 'both' },
      { id: 'translate-1', action: 'translate', keys: ['F13'], behaviour: 'toggle' },
    ],
  };
  const file = tempFile(v6);
  const s = new Settings(file, plain);
  assert.deepEqual(modeIds(s.get().modes), ['default', 'code', 'formal', 'translate']);
  assert.ok(s.get().modes.every((m) => m.translateTo === 'en'), 'everything that was translated still is');
  assert.deepEqual(s.get().modes.find((m) => m.id === 'formal').apps, ['outlook.exe']);
  assert.deepEqual(s.get().bindings[1], { id: 'translate-1', action: 'dictate', keys: ['F13'], behaviour: 'toggle', mode: 'translate' });
  assert.equal(s.get().appStyles, undefined);
  assert.equal(s.get().translation.always, undefined);
  assert.equal(s.get().sounds, false);
  assert.deepEqual(readJson(backupOf(file, 6)), v6);
  const saved = readJson(file);
  assert.equal(saved.settingsVersion, SETTINGS_VERSION);
  assert.equal(saved.appStyles, undefined);
  assert.deepEqual(new Settings(file, plain).get().modes, s.get().modes, 'a migrated file loads unchanged');
});

test('a v6 file that never changed the defaults gets the default modes, so it works as before', () => {
  const s = new Settings(tempFile({ settingsVersion: 6, onboarded: true }), plain);
  assert.deepEqual(s.get().modes, DEFAULTS.modes);
  assert.deepEqual(translateKeys(s.get().bindings), [[['Ctrl', 'Meta', 'Shift'], 'both']]);
});

test('a new install has the default modes and no app styles or Always translate', () => {
  const s = new Settings(tempFile(null), plain);
  assert.deepEqual(modeIds(s.get().modes), ['default', 'chat', 'code', 'formal', 'translate']);
  assert.equal(s.get().appStyles, undefined);
  assert.equal(s.get().translation.always, undefined);
});

test('update() cleans the modes sent by the window', () => {
  const s = new Settings(tempFile(null), plain);
  s.update({ modes: [{ id: 'mine', name: 'Mine', style: 'code', apps: ['Code.exe'] }, { nope: true, apps: 'x' }] });
  assert.deepEqual(modeIds(s.get().modes), ['default', 'mine', 'mode']);
  assert.deepEqual(s.get().modes[1].apps, ['code.exe']);
  s.update({ modes: 'gone' });
  assert.deepEqual(modeIds(s.get().modes), ['default', 'chat', 'code', 'formal', 'translate'], 'not a list: the defaults');
});

test('modes from a hand-edited v7 file are cleaned on load', () => {
  const s = new Settings(tempFile({ settingsVersion: 7, modes: [{ id: 'x', style: 'loud' }] }), plain);
  assert.deepEqual(modeIds(s.get().modes), ['default', 'x']);
  assert.equal(s.get().modes[1].style, 'normal');
});
