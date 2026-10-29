'use strict';
// Settings v9: where the pill sits (dragged to the left, the centre or the right of the screen).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, MIGRATIONS, SETTINGS_VERSION } = require('../src/main/settings');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-settings-'));
  const file = path.join(dir, 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('a new install has the pill in the centre; v8 → v9 puts it there and keeps everything else', () => {
  assert.ok(SETTINGS_VERSION >= 9);
  assert.equal(DEFAULTS.pillPosition, 'center');
  const step = MIGRATIONS.find((m) => m.from === 8);
  assert.deepEqual(step.run({ settingsVersion: 8, sounds: false }), { settingsVersion: 8, sounds: false, pillPosition: 'center' });
  assert.equal(step.run({ pillPosition: 'left' }).pillPosition, 'left');
});

test('a v8 file is backed up as settings.v8.json and saved as the current version', () => {
  const file = tempFile({ settingsVersion: 8, onboarded: true });
  assert.equal(new Settings(file, plain).get().pillPosition, 'center');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).settingsVersion, SETTINGS_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'settings.v8.json'), 'utf8')).settingsVersion, 8);
});

test('only left, center or right is kept', () => {
  const s = new Settings(tempFile(), plain);
  s.update({ pillPosition: 'right' });
  assert.equal(s.get().pillPosition, 'right');
  s.update({ pillPosition: 'top' });
  assert.equal(s.get().pillPosition, 'right');
  assert.equal(new Settings(tempFile({ settingsVersion: 9, pillPosition: 42 }), plain).get().pillPosition, 'center');
});
