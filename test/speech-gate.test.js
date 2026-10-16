'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gateSpeech, reportOncePerMessage, SILENCE_LEVEL, NO_SOUND_LEVEL } = require('../src/main/speech-gate');
const { speechLevel, SAMPLE_RATE } = require('../src/main/audio-utils');

const tone = (seconds, amp = 0.1) => Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => amp * Math.sin(i / 10));
const quiet = (seconds) => tone(seconds, 0.001);
const level = speechLevel;

test('constants: the old silence floor and the much lower "mic is dead" floor', () => {
  assert.equal(SILENCE_LEVEL, 0.004);
  assert.equal(NO_SOUND_LEVEL, 0.0005);
});

test('speech segments become the audio that goes on, joined with 100 ms of silence', async () => {
  const audio = tone(4);
  const segments = [{ start: 0, end: SAMPLE_RATE }, { start: 3 * SAMPLE_RATE, end: 4 * SAMPLE_RATE }];
  const r = await gateSpeech(audio, { enabled: true, detect: async () => segments, level });
  assert.equal(r.trimmed, true);
  assert.equal(r.audio.length, 2 * SAMPLE_RATE + 0.1 * SAMPLE_RATE);
  assert.deepEqual([...r.audio.subarray(0, 100)], [...audio.subarray(0, 100)]);
});

test('no speech segments from the detector skips with no-speech', async () => {
  const r = await gateSpeech(tone(2), { enabled: true, detect: async () => [], level });
  assert.deepEqual(r, { skip: 'no-speech' });
});

test('a silent microphone (all zeros) skips with no-sound and never asks the detector', async () => {
  let asked = false;
  const r = await gateSpeech(new Float32Array(2 * SAMPLE_RATE), { enabled: true, detect: async () => (asked = true, []), level });
  assert.deepEqual(r, { skip: 'no-sound' });
  assert.equal(asked, false);
});

test('gate falls back when vad is unavailable: no detector gives the full audio for speech-level input', async () => {
  const audio = tone(2);
  const r = await gateSpeech(audio, { enabled: true, detect: null, level });
  assert.equal(r.audio, audio);
  assert.equal(r.trimmed, false);
});

test('gate falls back when vad is unavailable: a detector that throws gives the full audio', async () => {
  const audio = tone(2);
  for (const detect of [async () => { throw new Error('model missing'); }, () => { throw new Error('worker gone'); }]) {
    const r = await gateSpeech(audio, { enabled: true, detect, level });
    assert.equal(r.audio, audio);
    assert.equal(r.trimmed, false);
  }
});

test('gate falls back when vad is unavailable: quiet input is no-speech, without throwing', async () => {
  const audio = quiet(2);
  assert.ok(level(audio) > NO_SOUND_LEVEL && level(audio) < SILENCE_LEVEL);
  for (const detect of [null, async () => { throw new Error('nope'); }]) {
    assert.deepEqual(await gateSpeech(audio, { enabled: true, detect, level }), { skip: 'no-speech' });
  }
});

test('with the switch off the detector is never called and the old level check applies', async () => {
  let calls = 0;
  const detect = async () => (calls++, []);
  const loud = tone(2);
  const r = await gateSpeech(loud, { enabled: false, detect, level });
  assert.equal(r.audio, loud);
  assert.equal(r.trimmed, false);
  assert.deepEqual(await gateSpeech(quiet(2), { enabled: false, detect, level }), { skip: 'no-speech' });
  assert.equal(calls, 0);
});

test('a dead microphone says no-sound even with the switch off or no detector', async () => {
  const zeros = new Float32Array(SAMPLE_RATE);
  assert.deepEqual(await gateSpeech(zeros, { enabled: false, detect: null, level }), { skip: 'no-sound' });
  assert.deepEqual(await gateSpeech(zeros, { enabled: true, detect: null, level }), { skip: 'no-sound' });
});

test('onError is called once with the error for a sync throw and for a rejection, before the fallback', async () => {
  const audio = tone(2);
  const syncErr = new Error('worker gone');
  const asyncErr = new Error('model missing');
  for (const [detect, err] of [[() => { throw syncErr; }, syncErr], [async () => { throw asyncErr; }, asyncErr]]) {
    const seen = [];
    const r = await gateSpeech(audio, { enabled: true, detect, level, onError: (e) => seen.push(e) });
    assert.deepEqual(seen, [err]);
    assert.equal(r.audio, audio, 'still falls back to the full audio');
  }
});

test('onError is not called on success, with no detector, or with the switch off', async () => {
  const seen = [];
  const onError = (e) => seen.push(e);
  await gateSpeech(tone(2), { enabled: true, detect: async () => [{ start: 0, end: SAMPLE_RATE }], level, onError });
  await gateSpeech(tone(2), { enabled: true, detect: async () => [], level, onError });
  await gateSpeech(tone(2), { enabled: true, detect: null, level, onError });
  await gateSpeech(tone(2), { enabled: false, detect: async () => { throw new Error('x'); }, level, onError });
  assert.deepEqual(seen, []);
});

test('a throwing onError never breaks the gate', async () => {
  const audio = tone(2);
  const r = await gateSpeech(audio, { enabled: true, detect: async () => { throw new Error('x'); }, level, onError: () => { throw new Error('log failed'); } });
  assert.equal(r.audio, audio);
});

test('reportOncePerMessage reports each distinct message once, message text only', () => {
  const out = [];
  const onError = reportOncePerMessage((m) => out.push(m));
  onError(new Error('model missing'));
  onError(new Error('model missing'));
  onError(new Error('onnx failed'));
  onError('plain string');
  assert.deepEqual(out, ['model missing', 'onnx failed', 'plain string']);
});
