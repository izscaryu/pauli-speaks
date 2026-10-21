'use strict';
// Home shows one notice at a time, the most important first, with "1 of 3" and ‹ › for the rest
// (src/renderer/notice-queue.js; home-notices.js draws them as InfoBars).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ORDER, SEVERITY, ordered, shown, step } = require('../src/renderer/notice-queue');

test('the order: what stops dictation first, suggestions last', () => {
  assert.deepEqual(ORDER, ['hook', 'model', 'update', 'recovery', 'conflict', 'language', 'setup', 'whatsNew']);
  assert.deepEqual(ordered(['setup', 'language', 'hook', 'update']), ['hook', 'update', 'language', 'setup']);
  assert.deepEqual(ordered([]), []);
  assert.deepEqual(ordered(['model', 'model']), ['model'], 'once each');
  assert.throws(() => ordered(['banner']), /unknown notice/);
});

test('each notice has one severity: a failed hook is an error, a hint is information', () => {
  assert.deepEqual(SEVERITY, { hook: 'error', update: 'success', recovery: 'warning', conflict: 'warning', language: 'info', setup: 'info', whatsNew: 'info' });
});

test('the most important notice is shown, unless the user stepped to another that is still there', () => {
  const ids = ['hook', 'model', 'setup'];
  assert.equal(shown(ids, null), 'hook');
  assert.equal(shown(ids, 'setup'), 'setup');
  assert.equal(shown(['hook', 'model'], 'setup'), 'hook', 'the one stepped to is gone: back to the first');
  assert.equal(shown([], 'setup'), null);
});

test('‹ and › step through them and stop at either end', () => {
  const ids = ['hook', 'model', 'setup'];
  assert.equal(step(ids, 'hook', 1), 'model');
  assert.equal(step(ids, 'model', 1), 'setup');
  assert.equal(step(ids, 'setup', 1), 'setup');
  assert.equal(step(ids, 'model', -1), 'hook');
  assert.equal(step(ids, 'hook', -1), 'hook');
  assert.equal(step(ids, 'gone', 1), 'model', 'from what was shown: the first');
  assert.equal(step([], null, 1), null);
});
