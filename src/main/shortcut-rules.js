'use strict';
// Shortcut validation: max 3 keys, must include a modifier or mouse button, no left+right pair of
// the same modifier, no duplicates, up to 4 shortcuts per action (Cancel: 1).
// On top of that: combinations Windows keeps for itself are refused, and
// common app shortcuts (Ctrl+C...) get a warning the user has to confirm,
// because the hook can't stop them from also doing their usual job.

const { MODIFIERS, MOUSE_NAMES, formatShortcut } = require('./keys');
const { sameSet } = require('./shortcut-engine');

const MAX_BINDINGS = 4;
const BEHAVIOURS = ['hold', 'toggle', 'both'];

// talk: the action records speech, so each shortcut picks Hold / Toggle / Both.
const ACTIONS = {
  dictate: { label: 'Dictate', talk: true },
  translate: { label: 'Talk & translate', talk: true },
  command: { label: 'Command mode', talk: true },
  cancel: { label: 'Cancel', max: 1 },
  cycleMode: { label: 'Switch mode' },
  pasteLast: { label: 'Paste last transcript' },
  copyLast: { label: 'Copy last transcript' },
  undoLast: { label: 'Undo last dictation' },
  pressEnter: { label: 'Press Enter' },
  readAloud: { label: 'Read aloud' },
};
const ACTION_LABELS = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label]));

const PAIRS = [['Ctrl', 'CtrlRight'], ['Alt', 'AltRight'], ['Shift', 'ShiftRight'], ['Meta', 'MetaRight']];
const RIGHT_MODIFIERS = new Set(['CtrlRight', 'AltRight', 'ShiftRight', 'MetaRight']);
const STANDALONE = new Set(['CapsLock', 'ScrollLock', 'Insert', 'Pause']);
const LEFT = { CtrlRight: 'Ctrl', AltRight: 'Alt', ShiftRight: 'Shift', MetaRight: 'Meta' };

const RESERVED = [
  [['Meta', 'L'], 'locks the PC'],
  [['Meta', 'D'], 'shows the desktop'],
  [['Meta', 'E'], 'opens File Explorer'],
  [['Meta', 'Tab'], 'opens Task view'],
  [['Meta', 'R'], 'opens Run'],
  [['Meta', 'I'], 'opens Settings'],
  [['Alt', 'F4'], 'closes the window'],
  [['Ctrl', 'Alt', 'Delete'], 'opens the security screen'],
];
const COMMON = [
  [['Ctrl', 'C'], 'Copy'], [['Ctrl', 'V'], 'Paste'], [['Ctrl', 'X'], 'Cut'], [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'S'], 'Save'], [['Ctrl', 'A'], 'Select all'], [['Ctrl', 'F'], 'Find'], [['Ctrl', 'T'], 'New tab'],
  [['Ctrl', 'W'], 'Close tab'], [['Alt', 'Tab'], 'Switch windows'],
];

/** Right-side modifiers count as the left ones when Windows or apps look at a combination. */
const leftSided = (keys) => keys.map((k) => LEFT[k] || k);
const lookup = (table, keys) => (table.find(([combo]) => sameSet(combo, leftSided(keys))) || [])[1];

/** Only our own action names - never inherited properties like "constructor". */
const isAction = (action) => typeof action === 'string' && Object.hasOwn(ACTIONS, action);
const isTalkAction = (action) => isAction(action) && !!ACTIONS[action].talk;

const maxBindings = (action) => (isAction(action) ? ACTIONS[action].max || MAX_BINDINGS : 0);

/**
 * Hard errors: the shortcut can't be saved.
 * @param {string[]} keys
 * @param {string} action
 * @param {{id: string, action: string, keys: string[]}[]} bindings everything bound today
 * @param {{trigger?: 'doubleTap', ignoreId?: string}} opts ignoreId = the binding being replaced
 * @returns {string|null} error message, or null when valid
 */
function validateShortcut(keys, action, bindings = [], { trigger, ignoreId } = {}) {
  if (!isAction(action)) return 'Unknown action.';
  if (!keys || keys.length === 0) return 'Press a key combination.';
  const others = bindings.filter((b) => b.id !== ignoreId);
  const max = maxBindings(action);
  if (others.filter((b) => b.action === action).length >= max) {
    return `${ACTION_LABELS[action] || action} can have up to ${max} shortcut${max === 1 ? '' : 's'}.`;
  }
  if (keys.length > 3) return 'Use 3 keys or fewer.';
  if (PAIRS.some(([l, r]) => keys.includes(l) && keys.includes(r))) {
    return "Can't use the left and right version of the same key together.";
  }
  if (trigger === 'doubleTap') {
    if (keys.length !== 1 || !MODIFIERS.has(keys[0])) return 'Double-tap works with one Ctrl, Alt or Shift key.';
    if ((LEFT[keys[0]] || keys[0]) === 'Meta') return 'Tapping Win opens the Start menu. Double-tap Ctrl, Alt or Shift instead.';
  } else if (action !== 'cancel') {
    const single = keys.length === 1 ? keys[0] : null;
    const ok =
      keys.some((k) => MOUSE_NAMES.has(k)) ||
      (single && (RIGHT_MODIFIERS.has(single) || /^F\d+$/.test(single) || STANDALONE.has(single))) ||
      (!single && keys.some((k) => MODIFIERS.has(k)));
    if (!ok) {
      return 'Include Ctrl, Alt, Shift or Win - or use a single F-key, a right-side modifier, or a mouse side button.';
    }
  }
  const reserved = lookup(RESERVED, keys);
  if (reserved) return `Windows keeps ${formatShortcut(keys)} for itself (it ${reserved}).`;
  const taken = others.find((b) => b.keys && sameSet(b.keys, keys));
  if (taken) return `${formatShortcut(keys)} is already used for ${ACTION_LABELS[taken.action] || taken.action}.`;
  return null;
}

/** Soft warning: allowed, but only after the user confirms. @returns {string|null} */
function shortcutWarning(keys) {
  const what = lookup(COMMON, keys || []);
  return what ? `${formatShortcut(keys)} is ${what} in most apps, and it will still do that when Pauli Speaks uses it.` : null;
}

/** First free id like "dictate-2". */
function newBindingId(action, bindings) {
  const used = new Set(bindings.map((b) => b.id));
  let n = 1;
  while (used.has(`${action}-${n}`)) n++;
  return `${action}-${n}`;
}

/**
 * Repair a binding list from disk or from the window: known actions only,
 * 1-3 string keys, the per-action limit, a valid behaviour on talk actions
 * (double-taps always toggle), and unique ids. Does not apply the key rules.
 */
function normalizeBindings(list) {
  const input = Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : [];
  const out = [];
  for (const raw of input) {
    if (!isAction(raw.action)) continue;
    if (!Array.isArray(raw.keys) || raw.keys.length === 0 || raw.keys.length > 3 || !raw.keys.every((k) => typeof k === 'string')) continue;
    if (out.filter((b) => b.action === raw.action).length >= maxBindings(raw.action)) continue;
    const b = { id: '', action: raw.action, keys: [...raw.keys] };
    if (raw.trigger === 'doubleTap') b.trigger = 'doubleTap';
    if (isTalkAction(raw.action)) {
      b.behaviour = b.trigger === 'doubleTap' ? 'toggle' : BEHAVIOURS.includes(raw.behaviour) ? raw.behaviour : 'both';
    }
    if (typeof raw.mode === 'string' && raw.mode) b.mode = raw.mode;
    const id = typeof raw.id === 'string' ? raw.id : '';
    b.id = id && !out.some((o) => o.id === id) ? id : newBindingId(raw.action, [...out, ...input]);
    out.push(b);
  }
  return out;
}

module.exports = {
  validateShortcut, shortcutWarning, normalizeBindings, newBindingId, maxBindings, isAction, isTalkAction,
  ACTIONS, ACTION_LABELS, BEHAVIOURS, MAX_BINDINGS,
};
