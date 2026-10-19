'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trayTemplate, trayHints } = require('../src/main/tray-menu');
const strings = require('../src/main/strings');

const noop = () => {};
const actions = { open: noop, files: noop, toggle: noop, pasteLast: noop, copyLast: noop, install: noop, quit: noop };
const labels = (template) => template.map((i) => (i.type === 'separator' ? '---' : i.label));

test('the tray menu, idle with nothing dictated yet', () => {
  strings.setLanguage('en', []);
  const menu = trayTemplate({ busy: false, hasLast: false, updateVersion: null }, actions);
  assert.deepEqual(labels(menu), [
    'Open Pauli Speaks', 'Transcribe a file…', '---', 'Start hands-free dictation',
    'Paste last transcript', 'Copy last transcript', '---', 'Quit Pauli Speaks',
  ]);
  assert.equal(menu.find((i) => i.label === 'Paste last transcript').enabled, false);
  assert.equal(menu.find((i) => i.label === 'Copy last transcript').enabled, false);
});

test('while dictating it offers Stop; a downloaded update offers a restart; each item runs its action', () => {
  strings.setLanguage('en', []);
  const ran = [];
  const spy = Object.fromEntries(Object.keys(actions).map((k) => [k, () => ran.push(k)]));
  const menu = trayTemplate({ busy: true, hasLast: true, updateVersion: '1.4.0' }, spy);
  assert.ok(labels(menu).includes('Stop dictation'));
  assert.ok(labels(menu).includes('Restart to update to 1.4.0'));
  assert.equal(menu.find((i) => i.label === 'Paste last transcript').enabled, true);
  for (const item of menu) item.click?.();
  assert.deepEqual(ran, ['open', 'files', 'toggle', 'pasteLast', 'copyLast', 'install', 'quit']);
});

test('the tray speaks Croatian when the UI does', () => {
  strings.setLanguage('hr', []);
  const menu = trayTemplate({ busy: false, hasLast: true, updateVersion: '1.4.0' }, actions);
  assert.deepEqual(labels(menu), [
    'Otvori Pauli Speaks', 'Transkribiraj datoteku…', '---', 'Pokreni diktiranje bez ruku',
    'Zalijepi zadnji transkript', 'Kopiraj zadnji transkript', '---', 'Ponovno pokreni i ažuriraj na 1.4.0', 'Zatvori Pauli Speaks',
  ]);
  strings.setLanguage('en', []);
});

test('hints name the first hold shortcut, else any dictate shortcut, else the bar', () => {
  strings.setLanguage('en', []);
  assert.deepEqual(trayHints({ hold: 'Ctrl + Win', any: 'Ctrl + Win' }), {
    tooltip: 'Pauli Speaks - hold Ctrl + Win to dictate',
    balloon: 'Hold Ctrl + Win to dictate anywhere. Change the shortcut on the Shortcuts page. Right-click the tray icon to quit.',
  });
  assert.equal(trayHints({ hold: '', any: 'F13' }).tooltip, 'Pauli Speaks - press F13 to dictate');
  assert.equal(trayHints({ hold: '', any: '' }).tooltip, 'Pauli Speaks - click the bar to dictate');
  assert.match(trayHints({ hold: '', any: '' }).balloon, /^Click the bar to dictate/);
});
