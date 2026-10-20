'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateShortcut, shortcutWarning, maxBindings } = require('../src/main/shortcut-rules');
const { formatShortcut } = require('../src/main/keys');
const { DEFAULTS } = require('../src/main/settings');

const bindings = DEFAULTS.bindings;
const check = (keys, action, opts) => validateShortcut(keys, action, bindings, opts);
/** The message code a rule returns ({ code, params }), or null. */
const codeOf = (m) => (m ? m.code : null);

test('defaults are valid', () => {
  for (const b of bindings) {
    assert.equal(validateShortcut(b.keys, b.action, bindings, { ignoreId: b.id, trigger: b.trigger }), null, b.id);
  }
});

test('rules', () => {
  assert.deepEqual(check(['A'], 'dictate'), { code: 'needsModifier', params: {} });
  assert.equal(codeOf(check(['Ctrl'], 'dictate')), 'needsModifier');
  assert.equal(check(['AltRight'], 'dictate'), null);
  assert.equal(check(['F8'], 'dictate'), null);
  assert.equal(check(['F13'], 'pressEnter'), null);
  assert.equal(check(['Mouse4'], 'dictate'), null);
  assert.equal(check(['Ctrl', 'Shift', 'D'], 'dictate'), null);
  assert.equal(codeOf(check(['Ctrl', 'Shift', 'Alt', 'D'], 'dictate')), 'tooManyKeys');
  assert.equal(codeOf(check(['Ctrl', 'CtrlRight'], 'dictate')), 'leftRight');
  assert.equal(check(['F9'], 'cancel', { ignoreId: 'cancel-1' }), null);
  assert.equal(codeOf(check(['Escape'], 'dictate')), 'needsModifier', 'Esc alone is only for Cancel');
  assert.equal(codeOf(check(['F9'], 'nope')), 'unknownAction');
  assert.equal(codeOf(check([], 'dictate')), 'noKeys');
});

test('duplicates are hard errors, within an action or across actions', () => {
  assert.deepEqual(check(['Ctrl', 'Meta', 'Space'], 'translate'), { code: 'taken', params: { keys: ['Ctrl', 'Meta', 'Space'], action: 'dictate' } });
  assert.deepEqual(check(['Meta', 'Ctrl'], 'dictate').params.action, 'dictate');
  assert.equal(check(['Ctrl', 'Meta'], 'dictate', { ignoreId: 'dictate-1' }), null, 'replacing a binding with itself is fine');
});

test('Windows-reserved combinations are hard errors', () => {
  for (const keys of [['Meta', 'L'], ['Meta', 'D'], ['Meta', 'E'], ['Meta', 'Tab'], ['Meta', 'R'], ['Meta', 'I'], ['Alt', 'F4'], ['MetaRight', 'L'], ['AltRight', 'F4']]) {
    assert.equal(codeOf(check(keys, 'dictate')), 'reserved', formatShortcut(keys));
  }
  assert.equal(check(['Meta', 'Shift', 'L'], 'dictate'), null);
  assert.deepEqual(check(['Meta', 'L'], 'dictate'), { code: 'reserved', params: { keys: ['Meta', 'L'], reason: 'lock' } });
  assert.equal(check(['Alt', 'F4'], 'dictate').params.reason, 'closeWindow');
});

test('common app shortcuts are warnings, not errors', () => {
  for (const keys of [['Ctrl', 'C'], ['Ctrl', 'V'], ['Ctrl', 'X'], ['Ctrl', 'Z'], ['Ctrl', 'S'], ['Ctrl', 'A'], ['Ctrl', 'F'], ['Ctrl', 'T'], ['Ctrl', 'W'], ['CtrlRight', 'C']]) {
    assert.equal(check(keys, 'pasteLast'), null, formatShortcut(keys));
    assert.equal(codeOf(shortcutWarning(keys)), 'common', formatShortcut(keys));
  }
  assert.deepEqual(shortcutWarning(['Ctrl', 'C']), { code: 'common', params: { keys: ['Ctrl', 'C'], what: 'copy' } });
  assert.equal(shortcutWarning(['Alt', 'Tab']).params.what, 'switchWindows');
  assert.equal(shortcutWarning(['Ctrl', 'Shift', 'C']), null);
  assert.equal(shortcutWarning(['Ctrl', 'Meta']), null);
});

test('up to four shortcuts per action, eight for Dictate (one per mode), one for Cancel', () => {
  assert.equal(maxBindings('pasteLast'), 4);
  assert.equal(maxBindings('dictate'), 8);
  assert.equal(maxBindings('cancel'), 1);
  const full = [...bindings, ...[5, 6, 7].map((n) => ({ id: `x${n}`, action: 'pasteLast', keys: [`F${n}`] }))];
  assert.deepEqual(validateShortcut(['F9'], 'pasteLast', full), { code: 'tooMany', params: { action: 'pasteLast', count: 4 } });
  assert.deepEqual(check(['F9'], 'cancel'), { code: 'tooMany', params: { action: 'cancel', count: 1 } });
  assert.equal(validateShortcut(['F9'], 'pasteLast', full, { ignoreId: 'x7' }), null, 'replacing does not add one');
  const dictating = [...bindings, ...[13, 14, 15, 16].map((n) => ({ id: `d${n}`, action: 'dictate', keys: [`F${n}`] }))];
  assert.equal(validateShortcut(['F9'], 'dictate', dictating), null, 'eight Dictate shortcuts');
  assert.deepEqual(validateShortcut(['F9'], 'dictate', [...dictating, { id: 'd17', action: 'dictate', keys: ['F17'] }]), { code: 'tooMany', params: { action: 'dictate', count: 8 } });
});

test('double-tap needs one Ctrl, Alt or Shift key', () => {
  assert.equal(check(['CtrlRight'], 'dictate', { trigger: 'doubleTap' }), null);
  assert.equal(check(['Shift'], 'pressEnter', { trigger: 'doubleTap' }), null, 'left modifiers work as a double-tap');
  assert.equal(codeOf(check(['Meta'], 'dictate', { trigger: 'doubleTap' })), 'doubleTapWin');
  assert.equal(codeOf(check(['F8'], 'dictate', { trigger: 'doubleTap' })), 'doubleTapKey');
  assert.equal(codeOf(check(['Ctrl', 'Shift'], 'dictate', { trigger: 'doubleTap' })), 'doubleTapKey');
  const withChord = [...bindings, { id: 'r1', action: 'pasteLast', keys: ['CtrlRight'] }];
  assert.deepEqual(validateShortcut(['CtrlRight'], 'dictate', withChord, { trigger: 'doubleTap' }), { code: 'taken', params: { keys: ['CtrlRight'], action: 'pasteLast' } });
});

test('formatShortcut orders modifiers first', () => {
  assert.equal(formatShortcut(['Space', 'Meta', 'Ctrl']), 'Ctrl + Win + Space');
  assert.equal(formatShortcut(['Z', 'Alt', 'Shift']), 'Alt + Shift + Z');
});
