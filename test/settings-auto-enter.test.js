'use strict';
// Settings v10: each mode can press Enter after pasting (autoEnter), off unless you switch it on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, MIGRATIONS, SETTINGS_VERSION } = require('../src/main/settings');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-settings-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('v9 → v10: every mode gets autoEnter switched off, and nothing else changes', () => {
  assert.equal(SETTINGS_VERSION, 10);
  const step = MIGRATIONS.find((m) => m.from === 9);
  const v9 = { settingsVersion: 9, sounds: false, modes: [{ id: 'default', style: 'normal' }, { id: 'chat', style: 'casual', apps: ['slack.exe'] }] };
  const out = step.run(structuredClone(v9));
  assert.deepEqual(out.modes.map((m) => m.autoEnter), [false, false]);
  assert.deepEqual(out.modes.map(({ autoEnter, ...rest }) => rest), v9.modes);
  assert.equal(out.sounds, false);
  assert.deepEqual(step.run({ sounds: true }), { sounds: true }, 'a file without modes keeps the defaults');
  assert.equal(step.run({ modes: [{ id: 'chat', autoEnter: true }] }).modes[0].autoEnter, true, 'a value already there is kept');
});

test('a new install: no mode presses Enter', () => {
  assert.ok(DEFAULTS.modes.every((m) => m.autoEnter === false));
});

test('a v9 file is backed up as settings.v9.json and saved as v10 with autoEnter off on every mode', () => {
  const file = tempFile({ settingsVersion: 9, onboarded: true, modes: [{ id: 'default' }, { id: 'chat', style: 'casual' }] });
  const s = new Settings(file, plain);
  assert.deepEqual(s.get().modes.map((m) => m.autoEnter), [false, false]);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.settingsVersion, 10);
  assert.deepEqual(saved.modes.map((m) => m.autoEnter), [false, false]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'settings.v9.json'), 'utf8')).settingsVersion, 9);
});

test('a mode switched on keeps it; only true or false is kept', () => {
  const s = new Settings(tempFile(), plain);
  s.update({ modes: s.get().modes.map((m) => (m.id === 'chat' ? { ...m, autoEnter: true } : m)) });
  assert.equal(s.get().modes.find((m) => m.id === 'chat').autoEnter, true);
  s.update({ modes: s.get().modes.map((m) => (m.id === 'chat' ? { ...m, autoEnter: 'on' } : m)) });
  assert.equal(s.get().modes.find((m) => m.id === 'chat').autoEnter, false);
});
