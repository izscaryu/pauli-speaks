'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerI18nIpc } = require('../src/main/i18n-ipc');
const strings = require('../src/main/strings');

function fakeIpc() {
  const on = {};
  return { on: (channel, fn) => { on[channel] = fn; }, send: (channel) => { const e = {}; on[channel](e); return e.returnValue; } };
}

function setup(uiLanguage, system = ['en-US']) {
  const ipc = fakeIpc();
  const sent = [];
  let settings = { uiLanguage };
  const i18n = registerI18nIpc(ipc, {
    getSettings: () => settings,
    systemLanguages: () => system,
    broadcast: (channel, data) => sent.push([channel, data]),
  });
  return { ipc, sent, i18n, set: (s) => { settings = s; } };
}

test('the language is set from the settings when the IPC is registered', () => {
  setup('system', ['hr-HR']);
  assert.equal(strings.currentLanguage(), 'hr');
  setup('en', ['hr-HR']);
  assert.equal(strings.currentLanguage(), 'en');
});

test('i18n:get answers synchronously with the strings for the window', () => {
  const { ipc } = setup('hr');
  const p = ipc.send('i18n:get');
  assert.equal(p.lang, 'hr');
  assert.equal(p.setting, 'hr');
  assert.equal(p.strings['language.name'], 'Hrvatski');
  assert.equal(p.fallback['language.name'], 'English');
  assert.ok(p.languages.some((l) => l.code === 'hr'));
});

test('a uiLanguage change switches the language and tells every window', () => {
  const { i18n, sent, set } = setup('en');
  set({ uiLanguage: 'hr' });
  assert.equal(i18n.settingsChanged({ uiLanguage: 'hr' }), true);
  assert.equal(strings.currentLanguage(), 'hr');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'i18n:changed');
  assert.equal(sent[0][1].lang, 'hr');
});

test('other setting changes leave the language alone and send nothing', () => {
  const { i18n, sent } = setup('en');
  assert.equal(i18n.settingsChanged({ sounds: false }), false);
  assert.equal(sent.length, 0);
});

test('a broken system-language lookup falls back to English', () => {
  const ipc = fakeIpc();
  registerI18nIpc(ipc, { getSettings: () => ({ uiLanguage: 'system' }), systemLanguages: () => { throw new Error('nope'); }, broadcast() {} });
  assert.equal(strings.currentLanguage(), 'en');
});

test('a patch that keeps the same language (a reset, for example) sends nothing', () => {
  const { i18n, sent } = setup('en');
  assert.equal(i18n.settingsChanged({ uiLanguage: 'en', sounds: true }), false);
  assert.equal(sent.length, 0);
});
