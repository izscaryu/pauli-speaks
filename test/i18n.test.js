'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createI18n, splitSlots, placeholders } = require('../src/renderer/i18n');

const en = {
  'home.ready': 'Ready',
  'home.hello': 'Hello, {name}!',
  'home.words.one': '{count} word',
  'home.words.other': '{count} words',
  'only.english': 'Only in English',
};
const hr = {
  'home.ready': 'Spremno',
  'home.hello': 'Bok, {name}!',
  'home.words.one': '{count} riječ',
  'home.words.few': '{count} riječi',
  'home.words.other': '{count} riječi',
};

test('t() looks a key up in the chosen language', () => {
  const { t } = createI18n({ lang: 'hr', strings: hr, fallback: en });
  assert.equal(t('home.ready'), 'Spremno');
});

test('t() falls back to English, then to the key itself', () => {
  const { t } = createI18n({ lang: 'hr', strings: hr, fallback: en });
  assert.equal(t('only.english'), 'Only in English');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('t() fills {placeholders} and leaves unknown ones as they are', () => {
  const { t } = createI18n({ lang: 'en', strings: en, fallback: en });
  assert.equal(t('home.hello', { name: 'Ana' }), 'Hello, Ana!');
  assert.equal(t('home.hello'), 'Hello, {name}!');
});

test('t() picks the plural form for count with the language rules', () => {
  const hrT = createI18n({ lang: 'hr', strings: hr, fallback: en }).t;
  assert.equal(hrT('home.words', { count: 1 }), '1 riječ');
  assert.equal(hrT('home.words', { count: 3 }), '3 riječi');
  assert.equal(hrT('home.words', { count: 21 }), '21 riječ');
  const enT = createI18n({ lang: 'en', strings: en, fallback: en }).t;
  assert.equal(enT('home.words', { count: 1 }), '1 word');
  assert.equal(enT('home.words', { count: 2 }), '2 words');
});

test('t() falls back to the English plural forms when a language lacks the key', () => {
  const { t } = createI18n({ lang: 'hr', strings: {}, fallback: en });
  assert.equal(t('home.words', { count: 5 }), '5 words');
});

test('numbers in vars are formatted for the language', () => {
  const { t, num } = createI18n({ lang: 'hr', strings: hr, fallback: en });
  assert.equal(t('home.words', { count: 1234 }), '1.234 riječi');
  assert.equal(num(1234.5), '1.234,5');
  assert.equal(createI18n({ lang: 'en', strings: en, fallback: en }).num(1234.5), '1,234.5');
});

test('date() formats with the language', () => {
  const { date } = createI18n({ lang: 'hr', strings: hr, fallback: en });
  const d = new Date(2026, 9, 19, 14, 5);
  assert.equal(date(d, { hour: '2-digit', minute: '2-digit' }), '14:05');
});

test('languageName() names a language in the UI language, capitalised for lists', () => {
  assert.equal(createI18n({ lang: 'hr', strings: hr, fallback: en }).languageName('de'), 'Njemački');
  assert.equal(createI18n({ lang: 'en', strings: en, fallback: en }).languageName('de'), 'German');
});

test('list() joins names the way the language does', () => {
  assert.equal(createI18n({ lang: 'en', strings: en, fallback: en }).list(['Discord', 'Zoom', 'Teams']), 'Discord, Zoom, and Teams');
  assert.equal(createI18n({ lang: 'hr', strings: hr, fallback: en }).list(['Discord', 'Zoom']), 'Discord i Zoom');
  assert.equal(createI18n({ lang: 'hr', strings: hr, fallback: en }).list(['Discord']), 'Discord');
});

test('an unknown language code still works (English formatting)', () => {
  const { t, num } = createI18n({ lang: 'not a locale', strings: {}, fallback: en });
  assert.equal(t('home.ready'), 'Ready');
  assert.equal(typeof num(1), 'string');
});

test('splitSlots() cuts a sentence around {slots}', () => {
  assert.deepEqual(splitSlots('Hold {keys} and say {words}.'), ['Hold ', { slot: 'keys' }, ' and say ', { slot: 'words' }, '.']);
  assert.deepEqual(splitSlots('No slots'), ['No slots']);
  assert.deepEqual(splitSlots('{a}'), [{ slot: 'a' }]);
});

test('placeholders() lists the {names} in a string', () => {
  assert.deepEqual(placeholders('Hi {name}, {count} {name}'), ['count', 'name']);
  assert.deepEqual(placeholders('none'), []);
});
