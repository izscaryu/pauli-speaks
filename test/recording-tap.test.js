'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecordingTap } = require('../src/main/recording-tap');

const settle = () => new Promise((r) => setImmediate(r));

/** A recorder that grows by 16000 samples per tick; sample i holds the value i. */
function fakeRecorder() {
  let length = 0;
  const froms = [];
  return {
    froms,
    grow(n = 16000) { length += n; },
    get length() { return length; },
    requestTail: async (from) => {
      froms.push(from);
      return Float32Array.from({ length: Math.max(0, length - from) }, (_, i) => from + i);
    },
  };
}

function collect() {
  const parts = [];
  return {
    parts,
    onSamples: (s) => { parts.push(s); },
    all() { return parts.flatMap((p) => Array.from(p)); },
  };
}

test('the tap pulls from 0, then from the previous length, and never re-sends old samples', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const rec = fakeRecorder();
  const out = collect();
  const tap = createRecordingTap({ requestTail: rec.requestTail, onSamples: out.onSamples, intervalMs: 1000 });
  tap.start();
  for (let i = 0; i < 3; i++) {
    rec.grow();
    t.mock.timers.tick(1000);
    await settle();
  }
  assert.deepEqual(rec.froms, [0, 16000, 32000]);
  assert.deepEqual(out.parts.map((p) => p.length), [16000, 16000, 16000]);
  assert.deepEqual(out.all(), Array.from({ length: 48000 }, (_, i) => i), 'no overlap, no gap');
  await tap.stop();
});

test('stop() does one last pull and then no more', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const rec = fakeRecorder();
  const out = collect();
  const tap = createRecordingTap({ requestTail: rec.requestTail, onSamples: out.onSamples, intervalMs: 1000 });
  tap.start();
  rec.grow();
  t.mock.timers.tick(1000);
  await settle();
  rec.grow(5000);
  await tap.stop();
  assert.deepEqual(rec.froms, [0, 16000]);
  assert.equal(out.all().length, 21000);
  rec.grow();
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(rec.froms, [0, 16000], 'no pulls after stop()');
  await tap.stop();
  assert.deepEqual(rec.froms, [0, 16000], 'a second stop() does not pull again');
});

test('an empty tail does not move `from`', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const rec = fakeRecorder();
  const tap = createRecordingTap({ requestTail: rec.requestTail, onSamples: () => {}, intervalMs: 1000 });
  tap.start();
  t.mock.timers.tick(1000);
  await settle();
  rec.grow();
  t.mock.timers.tick(1000);
  await settle();
  await tap.stop();
  assert.deepEqual(rec.froms, [0, 0, 16000]);
});

test('pulls are serialised: a tick while a pull is running is skipped, and stop() waits for it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let running = 0;
  let maxRunning = 0;
  let release = null;
  const froms = [];
  const requestTail = (from) => {
    froms.push(from);
    running++;
    maxRunning = Math.max(maxRunning, running);
    return new Promise((resolve) => {
      release = () => { running--; resolve(new Float32Array(100)); };
    });
  };
  const tap = createRecordingTap({ requestTail, onSamples: () => {}, intervalMs: 1000 });
  tap.start();
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(froms, [0], 'ticks during a running pull are skipped');
  const stopped = tap.stop();
  await settle();
  assert.deepEqual(froms, [0], 'stop() waits for the running pull first');
  release();
  await settle();
  assert.deepEqual(froms, [0, 100], 'then pulls the rest');
  release();
  await stopped;
  assert.equal(maxRunning, 1);
});

test('a failing onSamples is reported and the tap keeps going', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const rec = fakeRecorder();
  const errors = [];
  let calls = 0;
  const tap = createRecordingTap({
    requestTail: rec.requestTail,
    onSamples: () => { calls++; if (calls === 1) throw new Error('disk full'); },
    onError: (err) => errors.push(err.message),
    intervalMs: 1000,
  });
  tap.start();
  rec.grow();
  t.mock.timers.tick(1000);
  await settle();
  rec.grow();
  t.mock.timers.tick(1000);
  await settle();
  await tap.stop();
  assert.deepEqual(errors, ['disk full']);
  assert.deepEqual(rec.froms, [0, 16000, 32000], 'samples given to a failing onSamples still count as sent');
});
