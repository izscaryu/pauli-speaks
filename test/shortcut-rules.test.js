'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateShortcut, shortcutWarning, maxBindings } = require('../src/main/shortcut-rules');
const { formatShortcut } = require('../src/main/keys');
const { DEFAULTS } = require('../src/main/settings');

const bindings = DEFAULTS.bindings;
const check = (keys, action, opts) => validateShortcut(keys, action, bindings, opts);

test('defaults are valid', () => {
  for (const b of bindings) {
    assert.equal(validateShortcut(b.keys, b.action, bindings, { ignoreId: b.id, trigger: b.trigger }), null, b.id);
  }
});

test('rules', () => {
  assert.match(check(['A'], 'dictate'), /Include/);
  assert.match(check(['Ctrl'], 'dictate'), /Include/);
  assert.equal(check(['AltRight'], 'dictate'), null);
  assert.equal(check(['F8'], 'dictate'), null);
  assert.equal(check(['F13'], 'pressEnter'), null);
  assert.equal(check(['Mouse4'], 'dictate'), null);
  assert.equal(check(['Ctrl', 'Shift', 'D'], 'dictate'), null);
  assert.match(check(['Ctrl', 'Shift', 'Alt', 'D'], 'dictate'), /3 keys/);
  assert.match(check(['Ctrl', 'CtrlRight'], 'dictate'), /left and right/);
  assert.equal(check(['F9'], 'cancel', { ignoreId: 'cancel-1' }), null);
  assert.match(check(['Escape'], 'dictate'), /Include/, 'Esc alone is only for Cancel');
});

test('duplicates are hard errors, within an action or across actions', () => {
  assert.match(check(['Ctrl', 'Meta', 'Space'], 'translate'), /already used for Dictate/);
  assert.match(check(['Meta', 'Ctrl'], 'dictate'), /already used for Dictate/);
  assert.equal(check(['Ctrl', 'Meta'], 'dictate', { ignoreId: 'dictate-1' }), null, 'replacing a binding with itself is fine');
});

test('Windows-reserved combinations are hard errors', () => {
  for (const keys of [['Meta', 'L'], ['Meta', 'D'], ['Meta', 'E'], ['Meta', 'Tab'], ['Meta', 'R'], ['Meta', 'I'], ['Alt', 'F4'], ['MetaRight', 'L'], ['AltRight', 'F4']]) {
    assert.match(check(keys, 'dictate') || '', /Windows keeps/, formatShortcut(keys));
  }
  assert.equal(check(['Meta', 'Shift', 'L'], 'dictate'), null);
});

test('common app shortcuts are warnings, not errors', () => {
  for (const keys of [['Ctrl', 'C'], ['Ctrl', 'V'], ['Ctrl', 'X'], ['Ctrl', 'Z'], ['Ctrl', 'S'], ['Ctrl', 'A'], ['Ctrl', 'F'], ['Ctrl', 'T'], ['Ctrl', 'W'], ['CtrlRight', 'C']]) {
    assert.equal(check(keys, 'pasteLast'), null, formatShortcut(keys));
    assert.match(shortcutWarning(keys) || '', /in most apps/, formatShortcut(keys));
  }
  assert.equal(shortcutWarning(['Ctrl', 'Shift', 'C']), null);
  assert.equal(shortcutWarning(['Ctrl', 'Meta']), null);
});

test('up to four shortcuts per action, one for Cancel', () => {
  assert.equal(maxBindings('dictate'), 4);
  assert.equal(maxBindings('cancel'), 1);
  const full = [...bindings, { id: 'x1', action: 'dictate', keys: ['F7'] }, { id: 'x2', action: 'dictate', keys: ['F8'] }];
  assert.match(validateShortcut(['F9'], 'dictate', full), /up to 4/);
  assert.match(check(['F9'], 'cancel'), /up to 1/);
  assert.equal(validateShortcut(['F9'], 'dictate', full, { ignoreId: 'x2' }), null, 'replacing does not add one');
});

test('double-tap needs one Ctrl, Alt or Shift key', () => {
  assert.equal(check(['CtrlRight'], 'dictate', { trigger: 'doubleTap' }), null);
  assert.equal(check(['Shift'], 'pressEnter', { trigger: 'doubleTap' }), null, 'left modifiers work as a double-tap');
  assert.match(check(['Meta'], 'dictate', { trigger: 'doubleTap' }), /Start menu/);
  assert.match(check(['F8'], 'dictate', { trigger: 'doubleTap' }), /Double-tap/);
  assert.match(check(['Ctrl', 'Shift'], 'dictate', { trigger: 'doubleTap' }), /Double-tap/);
  const withChord = [...bindings, { id: 'r1', action: 'pasteLast', keys: ['CtrlRight'] }];
  assert.match(validateShortcut(['CtrlRight'], 'dictate', withChord, { trigger: 'doubleTap' }), /already used for Paste last/);
});

test('formatShortcut orders modifiers first', () => {
  assert.equal(formatShortcut(['Space', 'Meta', 'Ctrl']), 'Ctrl + Win + Space');
  assert.equal(formatShortcut(['Z', 'Alt', 'Shift']), 'Alt + Shift + Z');
});
