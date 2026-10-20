'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');

function tempHistory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-history-'));
  const file = path.join(dir, 'history.json');
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { history: new History(file), file };
}

const entry = (text, words = 2) => ({ text, rawText: text, durationMs: 2000, words, engine: 'base', language: 'en' });

test('addFailed: a failed item with no text, listed first', () => {
  const { history } = tempHistory();
  history.add(entry('hello there'));
  const failed = history.addFailed({ audioId: 'a1', durationMs: 3000, engine: 'whisper-large-v3-turbo', error: 'Invalid API key' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.text, undefined);
  assert.equal(failed.audioId, 'a1');
  assert.equal(failed.error, 'Invalid API key');
  assert.ok(failed.id && failed.createdAt);
  assert.equal(history.list()[0], failed);
  assert.equal(history.list().length, 2);
});

test('failed items are left out of the stats', () => {
  const { history } = tempHistory();
  history.add(entry('one two three', 3));
  const before = history.stats();
  history.addFailed({ audioId: 'a1', durationMs: 60000, engine: 'x', error: 'boom' });
  assert.deepEqual(history.stats(), before);
  assert.equal(history.stats().dictations, 1);
});

test('a day with only failed items does not count for the streak', () => {
  const { history } = tempHistory();
  history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' });
  assert.equal(history.stats().streak, 0);
  assert.equal(history.stats().dictations, 0);
});

test('last() skips failed items (Paste last / Copy last)', () => {
  const { history } = tempHistory();
  assert.equal(history.last(), null);
  history.addFailed({ audioId: 'a0', durationMs: 1000, engine: 'x', error: 'boom' });
  assert.equal(history.last(), null);
  const ok = history.add(entry('kept'));
  history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' });
  assert.equal(history.last(), ok);
});

test('resolve replaces a failed item with a normal one, keeping its id, time and position', () => {
  const { history, file } = tempHistory();
  history.add(entry('older'));
  const failed = history.addFailed({ audioId: 'a1', durationMs: 3000, engine: 'x', error: 'boom' });
  history.add(entry('newer'));
  const resolved = history.resolve(failed.id, entry('what I said', 3));
  assert.equal(resolved.id, failed.id);
  assert.equal(resolved.createdAt, failed.createdAt);
  assert.equal(resolved.text, 'what I said');
  assert.equal(resolved.status, undefined);
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.audioId, undefined);
  assert.deepEqual(history.list().map((i) => i.text), ['newer', 'what I said', 'older']);
  assert.equal(history.stats().dictations, 3);
  assert.equal(new History(file).list()[1].text, 'what I said');
});

test('resolve of an unknown id returns null and changes nothing', () => {
  const { history } = tempHistory();
  history.add(entry('a'));
  assert.equal(history.resolve('missing', entry('b')), null);
  assert.equal(history.resolve('constructor', entry('b')), null);
  assert.deepEqual(history.list().map((i) => i.text), ['a']);
});

test('failed items are saved like the rest, unless added with persist: false (session only)', () => {
  const { history, file } = tempHistory();
  const kept = history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' });
  const sessionOnly = history.addFailed({ audioId: 'a2', durationMs: 1000, engine: 'x', error: 'boom' }, { persist: false });
  assert.deepEqual(history.list().map((i) => i.id), [sessionOnly.id, kept.id]);
  assert.deepEqual(new History(file).list().map((i) => i.id), [kept.id]);
  // resolved, it is a normal entry and saved
  history.resolve(sessionOnly.id, entry('now saved'));
  assert.deepEqual(new History(file).list().map((i) => i.text || null), ['now saved', null]);
});

test('change is emitted for addFailed and resolve', () => {
  const { history } = tempHistory();
  let changes = 0;
  history.on('change', () => changes++);
  const f = history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' });
  history.resolve(f.id, entry('x'));
  assert.equal(changes, 2);
});

test('addFailed keeps the mode it was recorded in, so a retry uses it again', () => {
  const { history } = tempHistory();
  assert.equal(history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom', mode: 'code' }).mode, 'code');
  assert.equal(history.addFailed({ audioId: 'a2', durationMs: 1000, engine: 'x', error: 'boom' }).mode, undefined);
});
