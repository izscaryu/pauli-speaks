'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadLocales, languageList, resolveLanguage, createStrings, LOCALES_DIR } = require('../src/main/strings');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-locales-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

const EN = { 'language.name': 'English', 'tray.open': 'Open Pauli Speaks', 'tray.update': 'Restart to update to {version}' };
const HR = { 'language.name': 'Hrvatski', 'tray.open': 'Otvori Pauli Speaks' };

test('loadLocales() reads every <code>.json and skips broken or odd files', (t) => {
  const dir = fixture({ 'en.json': EN, 'hr.json': HR, 'broken.json': '{nope', 'README.md': 'x', 'de.json': ['not', 'an', 'object'] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(Object.keys(loadLocales(dir)).sort(), ['en', 'hr']);
});

test('languageList() names each language in itself, English first', () => {
  assert.deepEqual(languageList({ hr: HR, en: EN, de: { 'language.name': 'Deutsch' } }), [
    { code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch' }, { code: 'hr', name: 'Hrvatski' },
  ]);
});

test('resolveLanguage(): a chosen language wins when there is a file for it', () => {
  assert.equal(resolveLanguage('hr', ['en-US'], ['en', 'hr']), 'hr');
  assert.equal(resolveLanguage('fr', ['hr-HR'], ['en', 'hr']), 'hr', 'no French file: same as Windows');
});

test('resolveLanguage(): "Same as Windows" takes the first Windows language we have', () => {
  assert.equal(resolveLanguage('system', ['hr-HR', 'en-US'], ['en', 'hr']), 'hr');
  assert.equal(resolveLanguage('system', ['fr-FR', 'hr'], ['en', 'hr']), 'hr');
  assert.equal(resolveLanguage('system', ['fr-FR'], ['en', 'hr']), 'en');
  assert.equal(resolveLanguage('system', [], ['en', 'hr']), 'en');
  assert.equal(resolveLanguage(undefined, undefined, ['en']), 'en');
});

test('createStrings() speaks English until a language is set, then that one', (t) => {
  const dir = fixture({ 'en.json': EN, 'hr.json': HR });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createStrings({ dir });
  assert.equal(s.t('tray.open'), 'Open Pauli Speaks');
  s.setLanguage('system', ['hr-HR']);
  assert.equal(s.lang, 'hr');
  assert.equal(s.t('tray.open'), 'Otvori Pauli Speaks');
  assert.equal(s.t('tray.update', { version: '1.4.0' }), 'Restart to update to 1.4.0', 'English when Croatian lacks it');
  s.setLanguage('en', ['hr-HR']);
  assert.equal(s.t('tray.open'), 'Open Pauli Speaks');
});

test('payload() is what a window needs: language, setting, both dictionaries and the list', (t) => {
  const dir = fixture({ 'en.json': EN, 'hr.json': HR });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = createStrings({ dir });
  s.setLanguage('hr', []);
  const p = s.payload();
  assert.equal(p.lang, 'hr');
  assert.equal(p.setting, 'hr');
  assert.equal(p.strings['tray.open'], 'Otvori Pauli Speaks');
  assert.equal(p.fallback['tray.open'], 'Open Pauli Speaks');
  assert.deepEqual(p.languages.map((l) => l.code), ['en', 'hr']);
});

test('the shipped locales include English and Croatian', () => {
  const codes = Object.keys(loadLocales(LOCALES_DIR));
  assert.ok(codes.includes('en'));
  assert.ok(codes.includes('hr'));
});
