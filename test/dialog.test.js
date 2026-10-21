'use strict';
// The ContentDialog that asks before something can't be undone (src/renderer/dialog.js). What it shows and how
// it ends are pure and tested here; opening it, Esc and the focus going back are in test/e2e/dialogs.e2e.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dialogSpec, answer } = require('../src/renderer/dialog');

const BASE = { title: 'Clear your history?', confirm: 'Clear history', cancel: 'Cancel' };

test('a danger dialog: the red button first, Windows order, and focus starts on Cancel', () => {
  const spec = dialogSpec({ ...BASE, body: 'Deletes 213 transcripts.', tone: 'danger' });
  assert.equal(spec.title, 'Clear your history?');
  assert.deepEqual(spec.body, ['Deletes 213 transcripts.']);
  assert.deepEqual(spec.buttons, [
    { id: 'confirm', label: 'Clear history', className: 'btn danger primary' },
    { id: 'cancel', label: 'Cancel', className: 'btn' },
  ]);
  assert.equal(spec.initialFocus, 'cancel', 'Enter on a destructive dialog must not destroy anything');
  assert.equal(spec.danger, true);
});

test('any other dialog: a primary button, and focus starts on it', () => {
  const spec = dialogSpec({ ...BASE, tone: 'primary' });
  assert.equal(spec.buttons[0].className, 'btn primary');
  assert.equal(spec.initialFocus, 'confirm');
  assert.equal(spec.danger, false);
  assert.equal(dialogSpec(BASE).initialFocus, 'confirm', 'primary is the default tone');
});

test('a list of what goes, and a note after it; empty parts are left out', () => {
  const spec = dialogSpec({ ...BASE, body: ['', 'First.', null], list: ['History', '', 'Recordings'], note: 'This can\'t be undone.' });
  assert.deepEqual(spec.body, ['First.']);
  assert.deepEqual(spec.list, ['History', 'Recordings']);
  assert.deepEqual(spec.note, 'This can\'t be undone.');
  assert.deepEqual(dialogSpec(BASE).list, []);
  assert.equal(dialogSpec(BASE).note, '');
});

test('a dialog without a title or a button label is a mistake in the code', () => {
  assert.throws(() => dialogSpec({ ...BASE, title: '' }), TypeError);
  assert.throws(() => dialogSpec({ ...BASE, confirm: undefined }), TypeError);
  assert.throws(() => dialogSpec({ ...BASE, cancel: null }), TypeError);
  assert.throws(() => dialogSpec({ ...BASE, tone: 'loud' }), TypeError);
});

test('only the confirm button says yes: Cancel, Esc and closing say no', () => {
  assert.equal(answer('confirm'), true);
  assert.equal(answer('cancel'), false);
  assert.equal(answer(''), false, 'Esc closes a <dialog> with an empty returnValue');
  assert.equal(answer(undefined), false);
});
