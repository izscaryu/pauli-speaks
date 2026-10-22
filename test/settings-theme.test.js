'use strict';
// The app's theme: System (follow Windows), Light or Dark (Settings › General). No new settings version: a file
// without it reads as System.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, SETTINGS_VERSION } = require('../src/main/settings');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-settings-'));
  const file = path.join(dir, 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

test('the theme follows Windows until you choose one', () => {
  assert.equal(DEFAULTS.theme, 'system');
  assert.equal(new Settings(tempFile({ settingsVersion: SETTINGS_VERSION, onboarded: true }), plain).get().theme, 'system', 'a file from before');
});

test('System, Light or Dark is kept and saved; anything else is not', () => {
  const file = tempFile();
  const s = new Settings(file, plain);
  s.update({ theme: 'dark' });
  assert.equal(s.get().theme, 'dark');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).theme, 'dark');
  s.update({ theme: 'blue' });
  assert.equal(s.get().theme, 'dark', 'an unknown theme is ignored');
  s.update({ theme: 'light' });
  assert.equal(s.get().theme, 'light');
  assert.equal(new Settings(tempFile({ settingsVersion: SETTINGS_VERSION, theme: 'purple' }), plain).get().theme, 'system', 'a hand-edited file');
});
