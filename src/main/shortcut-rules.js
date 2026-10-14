'use strict';
// Shortcut validation - mirrors Wispr Flow's validator (module 28889, `u()`):
// max 3 keys, must include a modifier or mouse button, no left+right pair of
// the same modifier, no duplicates of another action.

const { MODIFIERS, MOUSE_NAMES, formatShortcut } = require('./keys');
const { sameSet } = require('./shortcut-engine');

const ACTION_LABELS = {
  ptt: 'Push-to-talk',
  handsFree: 'Hands-free',
  cancel: 'Cancel',
  pasteLast: 'Paste last transcript',
  translate: 'Translate while talking',
  command: 'Command mode',
  readAloud: 'Read aloud',
};

const PAIRS = [['Ctrl', 'CtrlRight'], ['Alt', 'AltRight'], ['Shift', 'ShiftRight'], ['Meta', 'MetaRight']];
const RIGHT_MODIFIERS = new Set(['CtrlRight', 'AltRight', 'ShiftRight', 'MetaRight']);
const STANDALONE = new Set(['CapsLock', 'ScrollLock', 'Insert', 'Pause']);

/** @returns {string|null} error message, or null when valid */
function validateShortcut(keys, action, shortcuts) {
  if (!keys || keys.length === 0) return 'Press a key combination.';
  if (keys.length > 3) return 'Use 3 keys or fewer.';
  if (PAIRS.some(([l, r]) => keys.includes(l) && keys.includes(r))) {
    return "Can't use the left and right version of the same key together.";
  }
  if (action !== 'cancel') {
    const single = keys.length === 1 ? keys[0] : null;
    const ok =
      keys.some((k) => MOUSE_NAMES.has(k)) ||
      (single && (RIGHT_MODIFIERS.has(single) || /^F\d+$/.test(single) || STANDALONE.has(single))) ||
      (!single && keys.some((k) => MODIFIERS.has(k)));
    if (!ok) {
      return 'Include Ctrl, Alt, Shift or Win - or use a single F-key, a right-side modifier, or a mouse side button.';
    }
  }
  for (const [other, otherKeys] of Object.entries(shortcuts || {})) {
    if (other !== action && otherKeys && sameSet(otherKeys, keys)) {
      return `${formatShortcut(keys)} is already used for ${ACTION_LABELS[other] || other}.`;
    }
  }
  return null;
}

module.exports = { validateShortcut, ACTION_LABELS };
