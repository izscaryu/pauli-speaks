'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { relatedChosen, areRelated, RELATIVES } = require('../src/main/language-relatives');

test('the groups are the well-known Whisper confusions, each language in one group only', () => {
  const flat = RELATIVES.flat();
  assert.equal(new Set(flat).size, flat.length);
  for (const pair of [['hr', 'sr'], ['hr', 'bs'], ['no', 'nb'], ['nn', 'da'], ['ms', 'id'], ['gl', 'pt'], ['cs', 'sk'], ['uk', 'ru'], ['be', 'ru']]) {
    assert.equal(areRelated(...pair), true, pair.join('/'));
  }
  assert.equal(areRelated('hr', 'de'), false);
  assert.equal(areRelated('en', 'en'), true, 'a language is its own relative');
});

test('relatedChosen: the chosen language close to the one heard', () => {
  assert.equal(relatedChosen('bs', ['en', 'hr']), 'hr');
  assert.equal(relatedChosen('sr', ['hr', 'en']), 'hr');
  assert.equal(relatedChosen('ru', ['en', 'uk']), 'uk');
  assert.equal(relatedChosen('hr', ['en', 'hr']), 'hr', 'one of yours is itself');
});

test('relatedChosen: null when nothing chosen is close, or nothing was heard', () => {
  assert.equal(relatedChosen('de', ['en', 'hr']), null);
  assert.equal(relatedChosen(null, ['en', 'hr']), null);
  assert.equal(relatedChosen('', ['en']), null);
  assert.equal(relatedChosen('bs', []), null);
  assert.equal(relatedChosen('constructor', ['en']), null);
});
