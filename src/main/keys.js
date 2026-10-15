'use strict';
// Key identity used throughout Pauli Speaks.
//
// uiohook reports its own keycodes; we turn them into stable names and keep
// a Windows virtual-key table for GetAsyncKeyState / SendInput.

const { UiohookKey } = require('uiohook-napi');

// uiohook keycode -> name
const CODE_TO_NAME = new Map();
for (const [name, code] of Object.entries(UiohookKey)) {
  CODE_TO_NAME.set(code, /^\d$/.test(name) ? `Digit${name}` : name);
}

const MODIFIERS = new Set([
  'Ctrl', 'CtrlRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight', 'Meta', 'MetaRight',
]);

const MOUSE_BUTTONS = { 3: 'Mouse3', 4: 'Mouse4', 5: 'Mouse5' };
const MOUSE_NAMES = new Set(Object.values(MOUSE_BUTTONS));

// name -> Windows virtual-key code
const VK = {
  Ctrl: 0xa2, CtrlRight: 0xa3, Alt: 0xa4, AltRight: 0xa5, Shift: 0xa0, ShiftRight: 0xa1,
  Meta: 0x5b, MetaRight: 0x5c, Space: 0x20, Escape: 0x1b, CapsLock: 0x14, Enter: 0x0d,
  Tab: 0x09, Backspace: 0x08, Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23,
  PageUp: 0x21, PageDown: 0x22, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27,
  ArrowDown: 0x28, Backquote: 0xc0, Minus: 0xbd, Equal: 0xbb, BracketLeft: 0xdb,
  BracketRight: 0xdd, Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Comma: 0xbc,
  Period: 0xbe, Slash: 0xbf, Mouse3: 0x04, Mouse4: 0x05, Mouse5: 0x06,
  PrintScreen: 0x2c, ScrollLock: 0x91, NumLock: 0x90,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i <= 9; i++) VK[`Digit${i}`] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK[`F${i}`] = 0x6f + i;

const DISPLAY = {
  Ctrl: 'Ctrl', CtrlRight: 'Right Ctrl', Alt: 'Alt', AltRight: 'Right Alt',
  Shift: 'Shift', ShiftRight: 'Right Shift', Meta: 'Win', MetaRight: 'Right Win',
  Escape: 'Esc', CapsLock: 'Caps Lock', Mouse3: 'Middle Click', Mouse4: 'Mouse 4',
  Mouse5: 'Mouse 5', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/',
};

// Display order: modifiers first.
const ORDER = ['Ctrl', 'CtrlRight', 'Meta', 'MetaRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight'];

function keyName(code) {
  return CODE_TO_NAME.get(code);
}

function mouseName(button) {
  return MOUSE_BUTTONS[button];
}

function sortKeys(keys) {
  return [...keys].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

function displayName(key) {
  if (DISPLAY[key]) return DISPLAY[key];
  if (key.startsWith('Digit')) return key.slice(5);
  return key;
}

function formatShortcut(keys) {
  if (!keys || keys.length === 0) return 'Not set';
  return sortKeys(keys).map(displayName).join(' + ');
}

module.exports = {
  MODIFIERS, MOUSE_NAMES, VK, keyName, mouseName, sortKeys, displayName, formatShortcut,
};
