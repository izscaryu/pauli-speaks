'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { appName } = require('../src/renderer/app-names');

test('appName: the name people know, not the process name', () => {
  assert.equal(appName('WINWORD.EXE'), 'Word');
  assert.equal(appName('winword.exe'), 'Word', 'any case');
  assert.equal(appName('OUTLOOK.EXE'), 'Outlook');
  assert.equal(appName('olk.exe'), 'Outlook', 'the new Outlook');
  assert.equal(appName('chrome.exe'), 'Chrome');
  assert.equal(appName('msedge.exe'), 'Edge');
  assert.equal(appName('Code.exe'), 'VS Code');
  assert.equal(appName('POWERPNT.EXE'), 'PowerPoint');
  assert.equal(appName('ms-teams.exe'), 'Teams');
});

test('appName: an app it doesn\'t know keeps its own name, without .exe and in title case', () => {
  assert.equal(appName('notepad++.exe'), 'Notepad++');
  assert.equal(appName('SOMEAPP.EXE'), 'Someapp');
  assert.equal(appName('myTool.exe'), 'MyTool', 'mixed case is kept');
  assert.equal(appName('obscure'), 'Obscure', 'no .exe');
});

test('appName: nothing in, nothing out', () => {
  assert.equal(appName(''), '');
  assert.equal(appName(null), '');
  assert.equal(appName(undefined), '');
});
