'use strict';
// Settings v8: AI polish (Settings → AI polish). The provider, its URL and model, and the own key for a custom URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS, MIGRATIONS, SETTINGS_VERSION, runMigrations } = require('../src/main/settings');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
const OFF = { provider: 'off', baseUrl: '', model: '', apiKeyEnc: '' };

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-settings-'));
  const file = path.join(dir, 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a new install has AI polish off', () => {
  assert.deepEqual(DEFAULTS.polish, OFF);
  assert.equal(SETTINGS_VERSION, 8);
});

test('v7 → v8 on its own: AI polish arrives switched off, everything else is kept', () => {
  const step = MIGRATIONS.find((m) => m.from === 7);
  const v7 = { settingsVersion: 7, engine: 'cloud', modes: [{ id: 'default', aiPolish: 'off' }], cloud: { baseUrl: 'x' } };
  assert.deepEqual(step.run(v7), { ...v7, polish: OFF });
  const already = { polish: { provider: 'ollama', model: 'qwen2.5:1.5b' } };
  assert.deepEqual(step.run(already).polish, { ...OFF, provider: 'ollama', model: 'qwen2.5:1.5b' }, 'kept when there');
  assert.equal(runMigrations({ settingsVersion: 7 }, MIGRATIONS, SETTINGS_VERSION).settingsVersion, 8);
});

test('a v7 file is backed up as settings.v7.json and saved as v8 with AI polish off', () => {
  const file = tempFile({ settingsVersion: 7, onboarded: true, engine: 'local' });
  const s = new Settings(file, plain);
  assert.deepEqual(s.get().polish, OFF);
  assert.equal(readJson(file).settingsVersion, 8);
  assert.deepEqual(readJson(file).polish, OFF);
  assert.equal(readJson(path.join(path.dirname(file), 'settings.v7.json')).settingsVersion, 7);
});

test('the custom URL\'s own key is encrypted, never handed to the window, and can be cleared', () => {
  const s = new Settings(tempFile(), plain);
  s.update({ polish: { provider: 'custom', baseUrl: 'https://llm.example.org/v1', model: 'm', apiKey: '  sk-own  ' } });
  assert.equal(s.get().polish.apiKeyEnc, 'plain:sk-own');
  assert.equal(s.getPolishKey(), 'sk-own');
  const pub = s.getPublic().polish;
  assert.equal(pub.apiKeyEnc, undefined);
  assert.equal(pub.hasApiKey, true);
  assert.equal(JSON.stringify(s.getPublic()).includes('sk-own'), false);
  s.update({ polish: { model: 'other', hasApiKey: false } });
  assert.equal(s.getPolishKey(), 'sk-own', 'changing the model keeps the key; hasApiKey from the window is ignored');
  assert.equal(s.get().polish.provider, 'custom', 'merged, not replaced');
  s.update({ polish: { apiKey: '' } });
  assert.equal(s.getPolishKey(), '');
  assert.equal(s.getPublic().polish.hasApiKey, false);
});

test('update() keeps AI polish valid: a known provider, an http(s) URL, a model name of sensible length', () => {
  const s = new Settings(tempFile(), plain);
  s.update({ polish: { provider: 'constructor', baseUrl: 'file:///C:/Windows', model: 'x'.repeat(500) } });
  assert.deepEqual(s.get().polish, OFF);
  s.update({ polish: { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-7b-instruct' } });
  assert.deepEqual(s.get().polish, { ...OFF, provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-7b-instruct' });
  s.update({ polish: { baseUrl: 42, model: null } });
  assert.deepEqual([s.get().polish.baseUrl, s.get().polish.model], ['', '']);
});

test('a hand-edited file with a broken polish block loads as off', () => {
  const file = tempFile({ settingsVersion: 8, polish: { provider: 'mystery', baseUrl: 'javascript:alert(1)', apiKeyEnc: 7 } });
  assert.deepEqual(new Settings(file, plain).get().polish, OFF);
});

test('Delete all my data clears the polish key with the rest', () => {
  const s = new Settings(tempFile(), plain);
  s.update({ polish: { provider: 'custom', baseUrl: 'https://llm.example.org/v1', model: 'm', apiKey: 'sk-own' } });
  s.reset();
  assert.deepEqual(s.get().polish, OFF);
  assert.equal(s.getPolishKey(), '');
});
