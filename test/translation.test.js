'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitForTranslation, joinTranslated, NLLB_CODES } = require('../src/main/asr/translator-local');
const { languageCode } = require('../src/main/asr/cloud');
const { canWhisperTranslate } = require('../src/main/asr/whisper-local');
const { DEFAULTS } = require('../src/main/settings');
const { validateShortcut } = require('../src/main/shortcut-rules');

test('line breaks from voice commands survive translation', () => {
  const pieces = splitForTranslation('Bok svima.\n\nSastanak je sutra. Dođite na vrijeme.');
  assert.deepEqual(pieces.map((p) => p.translate), [true, false, true, true]);
  const translated = pieces.map((p) => (p.translate ? { ...p, text: p.text.toUpperCase() } : p));
  assert.equal(joinTranslated(translated), 'BOK SVIMA.\n\nSASTANAK JE SUTRA. DOĐITE NA VRIJEME.');
});

test('each sentence is translated on its own (NLLB drops text in multi-sentence input)', () => {
  const pieces = splitForTranslation('Bok, sutra imamo sastanak. Pripremi prezentaciju! Može li?');
  assert.deepEqual(pieces.map((p) => p.text), ['Bok, sutra imamo sastanak.', 'Pripremi prezentaciju!', 'Može li?']);
  assert.deepEqual(splitForTranslation('bez interpunkcije'), [{ text: 'bez interpunkcije', translate: true }]);
});

test('Croatian and English have NLLB codes', () => {
  assert.equal(NLLB_CODES.hr, 'hrv_Latn');
  assert.equal(NLLB_CODES.en, 'eng_Latn');
});

test('cloud verbose_json language names map to codes', () => {
  assert.equal(languageCode('croatian'), 'hr');
  assert.equal(languageCode('English'), 'en');
  assert.equal(languageCode('hr'), 'hr');
  assert.equal(languageCode(undefined), null);
});

test('turbo cannot use Whisper translate', () => {
  assert.equal(canWhisperTranslate('onnx-community/whisper-large-v3-turbo'), false);
  assert.equal(canWhisperTranslate('onnx-community/whisper-small'), true);
});

test('default translate shortcut is valid and distinct', () => {
  const b = DEFAULTS.bindings.find((x) => x.action === 'translate');
  assert.deepEqual(b.keys, ['Ctrl', 'Meta', 'Shift']);
  assert.equal(validateShortcut(b.keys, 'translate', DEFAULTS.bindings, { ignoreId: b.id }), null);
  assert.deepEqual(DEFAULTS.translation, { always: false, target: 'en', quality: 'fast' });
});
