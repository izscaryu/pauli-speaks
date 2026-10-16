'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BACKUP_KEYS, exportBackup, importBackup } = require('../src/main/settings-backup');
const { SETTINGS_VERSION } = require('../src/main/settings');
const { normalizeBindings } = require('../src/main/shortcut-rules');

const NOT_A_BACKUP = "This isn't a Pauli Speaks backup.";

test('BACKUP_KEYS lists the portable settings', () => {
  assert.deepEqual(BACKUP_KEYS, ['bindings', 'voiceCommands', 'voiceCommandsEnabled', 'dictionary', 'snippets', 'appStyles']);
});

test('exportBackup keeps the backup keys and never the cloud settings or any key', () => {
  const data = {
    bindings: [{ id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'Meta'] }],
    dictionary: [{ from: 'a', to: 'b' }],
    cloud: { baseUrl: 'https://example.test', apiKeyEnc: 'x' },
    apiKeyEnc: 'y',
    apiKey: 'z',
    onboarded: true,
    microphoneId: 'default',
  };
  const out = exportBackup(data, 4, '1.2.0');
  assert.equal(out.app, 'pauli-speaks');
  assert.equal(out.settingsVersion, 4);
  assert.equal(out.appVersion, '1.2.0');
  assert.ok(!Number.isNaN(Date.parse(out.exportedAt)));
  assert.deepEqual(Object.keys(out.settings).sort(), ['bindings', 'dictionary']);
  assert.deepEqual(out.settings.bindings, data.bindings);
  assert.ok(!JSON.stringify(out).includes('apiKey'));
  assert.ok(!('cloud' in out.settings));
});

test('exportBackup copies the values instead of sharing them', () => {
  const data = { dictionary: [{ from: 'a', to: 'b' }] };
  const out = exportBackup(data, 4, '1.2.0');
  out.settings.dictionary[0].to = 'changed';
  assert.equal(data.dictionary[0].to, 'b');
});

test('exportBackup ignores inherited keys', () => {
  const data = Object.create({ dictionary: [] });
  assert.deepEqual(exportBackup(data, 4, '1.2.0').settings, {});
});

test('importBackup rejects what is not a backup', () => {
  for (const bad of [null, undefined, 'text', 42, [], { settingsVersion: 4, settings: {} }, { app: 'other', settingsVersion: 4, settings: {} },
    { app: 'pauli-speaks', settings: {} }, { app: 'pauli-speaks', settingsVersion: 'x', settings: {} }, { app: 'pauli-speaks', settingsVersion: 0, settings: {} }, { app: 'pauli-speaks', settingsVersion: 1.5, settings: {} },
    { app: 'pauli-speaks', settingsVersion: 4 }, { app: 'pauli-speaks', settingsVersion: 4, settings: [] }]) {
    assert.deepEqual(importBackup(bad, SETTINGS_VERSION), { ok: false, error: NOT_A_BACKUP }, JSON.stringify(bad));
  }
});

test('importBackup refuses a backup from a newer version', () => {
  const r = importBackup({ app: 'pauli-speaks', settingsVersion: 99, settings: {} }, SETTINGS_VERSION);
  assert.deepEqual(r, { ok: false, error: 'This backup is from a newer Pauli Speaks. Update first.' });
});

test('importBackup yields a patch with only the backup keys, and no prototype pollution', () => {
  const json = JSON.parse('{"app":"pauli-speaks","settingsVersion":4,"settings":{"__proto__":{"polluted":true},"dictionary":[]}}');
  const r = importBackup(json, 4);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.patch), ['dictionary']);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(r.patch), Object.prototype);
});

test('importBackup drops keys of the wrong type and keys that are not backup keys', () => {
  const r = importBackup({
    app: 'pauli-speaks',
    settingsVersion: 4,
    settings: {
      dictionary: 'nope', snippets: [{ trigger: 'a', text: 'b' }], bindings: {}, voiceCommands: 'x', voiceCommandsEnabled: 'yes',
      appStyles: [], cloud: { apiKeyEnc: 'x' }, apiKeyEnc: 'x', onboarded: true, constructor: [],
    },
  }, 4);
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { snippets: [{ trigger: 'a', text: 'b' }] });
});

test('importBackup accepts every backup key with the right type', () => {
  const settings = {
    bindings: [], voiceCommands: [], voiceCommandsEnabled: false, dictionary: [], snippets: [], appStyles: { enabled: true, rules: [] },
  };
  const r = importBackup({ app: 'pauli-speaks', settingsVersion: 4, settings }, 4);
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, settings);
});

test('importBackup migrates an older backup before picking keys', () => {
  const r = importBackup({
    app: 'pauli-speaks',
    settingsVersion: 1,
    settings: { voiceCommands: false, dictionary: [{ from: 'a', to: 'b' }] },
  }, SETTINGS_VERSION);
  assert.equal(r.ok, true);
  assert.equal(r.patch.voiceCommandsEnabled, false);
  assert.ok(Array.isArray(r.patch.voiceCommands) && r.patch.voiceCommands.length > 0);
  assert.deepEqual(r.patch.dictionary, [{ from: 'a', to: 'b' }]);
  assert.ok(!('betaUpdates' in r.patch) && !('setupCard' in r.patch) && !('settingsVersion' in r.patch));
});

test('importBackup migrates a v2 backup and still leaves out what the migrations add', () => {
  const r = importBackup({ app: 'pauli-speaks', settingsVersion: 2, settings: { snippets: [] } }, SETTINGS_VERSION);
  assert.deepEqual(r, { ok: true, patch: { snippets: [] } });
});

test('importBackup turns a failing migration into an error instead of throwing', () => {
  // A target version the migration table has no step for.
  const r = importBackup({ app: 'pauli-speaks', settingsVersion: SETTINGS_VERSION, settings: {} }, SETTINGS_VERSION + 1);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

test('an exported backup imports back to the same values', () => {
  const data = { dictionary: [{ from: 'x', to: 'y' }], snippets: [], voiceCommandsEnabled: true, cloud: { apiKeyEnc: 'secret' } };
  const r = importBackup(JSON.parse(JSON.stringify(exportBackup(data, SETTINGS_VERSION, '1.2.0'))), SETTINGS_VERSION);
  assert.deepEqual(r, { ok: true, patch: { dictionary: data.dictionary, snippets: [], voiceCommandsEnabled: true } });
});

const backup = (settings) => ({ app: 'pauli-speaks', settingsVersion: 4, settings });

test('importBackup drops malformed elements instead of reporting a broken backup as fine', () => {
  // The confirmed example: every element is malformed, so nothing of it may reach the settings.
  const r = importBackup(backup({
    dictionary: [null, { from: 'x' }], snippets: [null], appStyles: { rules: 'x', enabled: 'yes' },
  }), 4);
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch, { dictionary: [], snippets: [] });
});

test('importBackup keeps dictionary entries only with string from and to', () => {
  const r = importBackup(backup({
    dictionary: [{ from: 'a', to: 'b' }, null, 'x', 7, [], { from: 'x' }, { to: 'y' }, { from: 1, to: 'y' }, { from: 'c', to: null },
      Object.create({ from: 'p', to: 'q' }), { from: 'd', to: '' }],
  }), 4);
  assert.deepEqual(r.patch.dictionary, [{ from: 'a', to: 'b' }, { from: 'd', to: '' }]);
});

test('importBackup keeps snippets only with string trigger and text', () => {
  const r = importBackup(backup({
    snippets: [{ trigger: 'my email', text: 'me@example.test' }, null, [], { trigger: 'x' }, { text: 'y' }, { trigger: 2, text: 'y' }],
  }), 4);
  assert.deepEqual(r.patch.snippets, [{ trigger: 'my email', text: 'me@example.test' }]);
});

test('importBackup keeps a boolean appStyles.enabled and well-formed rules only', () => {
  const rules = [{ app: 'code.exe', style: 'code' }, null, 'slack.exe', { app: 'x.exe' }, { style: 'casual' }, { app: 1, style: 'code' }];
  assert.deepEqual(importBackup(backup({ appStyles: { enabled: false, rules } }), 4).patch,
    { appStyles: { enabled: false, rules: [{ app: 'code.exe', style: 'code' }] } });
  // A bad field is left out, so the current value of that field stays.
  assert.deepEqual(importBackup(backup({ appStyles: { enabled: 'yes', rules: [] } }), 4).patch, { appStyles: { rules: [] } });
  assert.deepEqual(importBackup(backup({ appStyles: { enabled: true, rules: 'x' } }), 4).patch, { appStyles: { enabled: true } });
  assert.deepEqual(importBackup(backup({ appStyles: { rules: 'x', enabled: 'yes' } }), 4).patch, {});
});

test('importBackup drops voice commands that are not objects and leaves the rest to normalizeVoiceCommands', () => {
  const cmd = { phrases: ['new line'], action: 'insert', arg: '\n' };
  const r = importBackup(backup({ voiceCommands: [null, 'x', 3, [], cmd] }), 4);
  assert.deepEqual(r.patch.voiceCommands, [cmd]);
});

test('importBackup keeps the current shortcuts when the imported ones are all invalid', () => {
  assert.deepEqual(importBackup(backup({ bindings: [null] }), 4).patch, {});
  assert.deepEqual(importBackup(backup({ bindings: [{ action: 'nope', keys: ['Ctrl'] }, { action: 'dictate', keys: [] }] }), 4).patch, {});
  // An empty list on purpose is still imported.
  assert.deepEqual(importBackup(backup({ bindings: [] }), 4).patch, { bindings: [] });
  const good = { id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'Meta'] };
  assert.deepEqual(importBackup(backup({ bindings: [null, good] }), 4).patch.bindings, normalizeBindings([good]));
});

test('after a malformed import the cleanup and style code do not throw', () => {
  const { cleanTranscript } = require('../src/main/text-cleanup');
  const { resolveStyle } = require('../src/main/app-styles');
  const r = importBackup(backup({
    dictionary: [null, { from: 'x' }], snippets: [null], appStyles: { rules: 'x', enabled: 'yes' },
  }), 4);
  const settings = { dictionary: [], snippets: [], appStyles: { enabled: true, rules: [] }, ...r.patch };
  assert.doesNotThrow(() => cleanTranscript('x marks the spot', { dictionary: settings.dictionary, snippets: settings.snippets }));
  assert.equal(resolveStyle('code.exe', { ...settings.appStyles }), 'normal');
});
