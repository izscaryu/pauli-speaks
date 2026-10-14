'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTranscript, countWords } = require('../src/main/text-cleanup');

const opts = { removeFillers: true, voiceCommands: true, capitalize: true };

test('removes filler words and fixes spacing/capitalization', () => {
  assert.equal(
    cleanTranscript('Um, the meeting is uh moved to Friday.', opts),
    'The meeting is moved to Friday.',
  );
  assert.equal(cleanTranscript('Hello, um, world.', opts), 'Hello, world.');
});

test('keeps words that merely contain filler letters', () => {
  assert.equal(cleanTranscript('Umbrella and humming.', opts), 'Umbrella and humming.');
});

test('voice commands', () => {
  assert.equal(cleanTranscript('First line. New line. Second line.', opts), 'First line.\nSecond line.');
  assert.equal(cleanTranscript('Intro new paragraph body text', opts), 'Intro\n\nBody text');
  assert.equal(cleanTranscript('Prvi red novi red drugi red', opts), 'Prvi red\nDrugi red');
});

test('dictionary replacements are whole-word and case-insensitive', () => {
  const dictionary = [{ from: 'polyspeaks', to: 'Pauli Speaks' }, { from: 'react js', to: 'React.js' }];
  assert.equal(
    cleanTranscript('I love Polyspeaks and react JS.', { ...opts, dictionary }),
    'I love Pauli Speaks and React.js.',
  );
  assert.equal(cleanTranscript('polyspeaksy', { ...opts, dictionary }), 'Polyspeaksy');
});

test('strips Whisper artifacts and silence hallucinations', () => {
  assert.equal(cleanTranscript('[BLANK_AUDIO]', opts), '');
  assert.equal(cleanTranscript(' Thank you.', opts), '');
  assert.equal(cleanTranscript('(music) Hello there', opts), 'Hello there');
});

test('trailing space option', () => {
  assert.equal(cleanTranscript('hi', { ...opts, addTrailingSpace: true }), 'Hi ');
  assert.equal(cleanTranscript('hi new line', { ...opts, addTrailingSpace: true }), 'Hi\n');
});

test('options off leaves text alone', () => {
  assert.equal(cleanTranscript('um hello new line', { capitalize: false }), 'um hello new line');
});

test('countWords handles unicode', () => {
  assert.equal(countWords('Dobar dan, kako ste? Ćao!'), 5);
  assert.equal(countWords(''), 0);
});
