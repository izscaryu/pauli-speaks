'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeWav, decodeWav, speechLevel } = require('../src/main/audio-utils');

test('wav round trip', () => {
  const samples = new Float32Array(1600).map((_, i) => Math.sin(i / 10) * 0.5);
  const wav = encodeWav(samples);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.length, 44 + samples.length * 2);
  const back = decodeWav(wav);
  assert.equal(back.sampleRate, 16000);
  assert.equal(back.samples.length, samples.length);
  for (let i = 0; i < samples.length; i += 97) assert.ok(Math.abs(back.samples[i] - samples[i]) < 1e-3);
});

test('speech level separates silence from signal', () => {
  assert.equal(speechLevel(new Float32Array(16000)), 0);
  const tone = new Float32Array(16000).map((_, i) => 0.2 * Math.sin(i / 5));
  assert.ok(speechLevel(tone) > 0.1);
});
