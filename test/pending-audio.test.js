'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPendingAudio } = require('../src/main/pending-audio');

const seconds = (s) => new Float32Array(Math.round(s * 16000));

test('put returns an id; get hands back the audio and its meta', () => {
  const store = createPendingAudio();
  const audio = seconds(1);
  const id = store.put(audio, { command: false });
  assert.equal(typeof id, 'string');
  const got = store.get(id);
  assert.equal(got.audio, audio);
  assert.deepEqual(got.meta, { command: false });
  assert.equal(store.size, 1);
});

test('the oldest goes beyond maxItems', () => {
  const evicted = [];
  const store = createPendingAudio({ maxItems: 2, onEvict: (id) => evicted.push(id) });
  const a = store.put(seconds(1));
  const b = store.put(seconds(1));
  const c = store.put(seconds(1));
  assert.equal(store.get(a), null);
  assert.ok(store.get(b));
  assert.ok(store.get(c));
  assert.equal(store.size, 2);
  assert.deepEqual(evicted, [a]);
});

test('the oldest goes beyond maxSeconds in total', () => {
  const store = createPendingAudio({ maxItems: 5, maxSeconds: 10 });
  const a = store.put(seconds(4));
  const b = store.put(seconds(4));
  const c = store.put(seconds(4)); // 12 s: a goes
  assert.equal(store.get(a), null);
  assert.ok(store.get(b));
  assert.ok(store.get(c));
  const d = store.put(seconds(9)); // b + c + d = 17 s: b and c go
  assert.equal(store.get(b), null);
  assert.equal(store.get(c), null);
  assert.ok(store.get(d));
  assert.equal(store.size, 1);
});

test('the newest recording is kept even when it alone is longer than maxSeconds', () => {
  const store = createPendingAudio({ maxSeconds: 10 });
  const a = store.put(seconds(2));
  const long = store.put(seconds(30));
  assert.equal(store.get(a), null);
  assert.ok(store.get(long));
});

test('take removes and returns; a second take is null', () => {
  const evicted = [];
  const store = createPendingAudio({ onEvict: (id) => evicted.push(id) });
  const audio = seconds(1);
  const id = store.put(audio, { x: 1 });
  assert.equal(store.take(id).audio, audio);
  assert.equal(store.take(id), null);
  assert.equal(store.get(id), null);
  assert.equal(store.size, 0);
  assert.deepEqual(evicted, [], 'take is not an eviction');
});

test('drop removes; unknown and evicted ids are null', () => {
  const store = createPendingAudio({ maxItems: 1 });
  const a = store.put(seconds(1));
  store.drop(a);
  assert.equal(store.get(a), null);
  assert.equal(store.size, 0);
  const b = store.put(seconds(1));
  store.put(seconds(1));
  assert.equal(store.get(b), null);
  assert.equal(store.get('nope'), null);
  assert.equal(store.get('constructor'), null);
  assert.equal(store.take(undefined), null);
  store.drop('nope'); // no throw
});

test('dropped audio frees its seconds for the cap', () => {
  const store = createPendingAudio({ maxSeconds: 10 });
  const a = store.put(seconds(6));
  store.drop(a);
  const b = store.put(seconds(6));
  const c = store.put(seconds(4));
  assert.ok(store.get(b));
  assert.ok(store.get(c));
});

test('ids are unique across runs (failed History entries from an earlier run must not match new audio)', () => {
  const first = createPendingAudio().put(seconds(1));
  const second = createPendingAudio().put(seconds(1));
  assert.notEqual(first, second);
});

test('an uncapped recording (a held Undo) never evicts the others and is never evicted', () => {
  const evicted = [];
  const store = createPendingAudio({ maxItems: 1, maxSeconds: 5, onEvict: (id) => evicted.push(id) });
  const failed = store.put(seconds(4));
  const held = store.put(seconds(4), {}, { capped: false });
  assert.ok(store.get(failed), 'the failed recording stays');
  assert.ok(store.get(held));
  const next = store.put(seconds(4)); // a capped one: the older capped one goes, the held one stays
  assert.deepEqual(evicted, [failed]);
  assert.ok(store.get(held));
  assert.ok(store.get(next));
  store.take(held);
  assert.equal(store.size, 1);
});

test('clear forgets everything, capped or not', () => {
  const store = createPendingAudio();
  const a = store.put(seconds(1));
  const b = store.put(seconds(1), {}, { capped: false });
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.get(a), null);
  assert.equal(store.get(b), null);
  const c = store.put(seconds(1));
  assert.ok(store.get(c), 'usable after clear');
});
