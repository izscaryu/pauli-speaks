'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateShortcut } = require('../src/main/shortcut-rules');
const { formatShortcut } = require('../src/main/keys');
const { DEFAULTS } = require('../src/main/settings');

const shortcuts = DEFAULTS.shortcuts;

test('defaults are valid', () => {
  for (const [action, keys] of Object.entries(shortcuts)) {
    assert.equal(validateShortcut(keys, action, shortcuts), null, action);
  }
});

test('rules', () => {
  assert.match(validateShortcut(['A'], 'ptt', shortcuts), /Include/);
  assert.match(validateShortcut(['Ctrl'], 'ptt', shortcuts), /Include/);
  assert.equal(validateShortcut(['AltRight'], 'ptt', shortcuts), null);
  assert.equal(validateShortcut(['F8'], 'ptt', shortcuts), null);
  assert.equal(validateShortcut(['Mouse4'], 'ptt', shortcuts), null);
  assert.equal(validateShortcut(['Ctrl', 'Shift', 'D'], 'ptt', shortcuts), null);
  assert.match(validateShortcut(['Ctrl', 'Shift', 'Alt', 'D'], 'ptt', shortcuts), /3 keys/);
  assert.match(validateShortcut(['Ctrl', 'CtrlRight'], 'ptt', shortcuts), /left and right/);
  assert.match(validateShortcut(['Ctrl', 'Meta', 'Space'], 'ptt', shortcuts), /already used for Hands-free/);
  assert.equal(validateShortcut(['F9'], 'cancel', shortcuts), null);
});

test('formatShortcut orders modifiers first', () => {
  assert.equal(formatShortcut(['Space', 'Meta', 'Ctrl']), 'Ctrl + Win + Space');
  assert.equal(formatShortcut(['Z', 'Alt', 'Shift']), 'Alt + Shift + Z');
});
