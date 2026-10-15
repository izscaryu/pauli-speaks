'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepLink, parseCommandLine, PROTOCOL } = require('../src/main/remote');

test('the protocol is pauli-speaks', () => {
  assert.equal(PROTOCOL, 'pauli-speaks');
});

test('dictation links', () => {
  assert.deepEqual(parseDeepLink('pauli-speaks://dictate/toggle'), { command: 'toggle' });
  assert.deepEqual(parseDeepLink('pauli-speaks://dictate/start?mode=email'), { command: 'start', mode: 'email' });
  assert.deepEqual(parseDeepLink('pauli-speaks://dictate/stop/'), { command: 'stop' }, 'Windows may add a slash');
  assert.deepEqual(parseDeepLink('PAULI-SPEAKS://Dictate/Cancel'), { command: 'cancel' });
  assert.deepEqual(parseDeepLink('pauli-speaks://toggle'), { command: 'toggle' });
  assert.deepEqual(parseDeepLink('pauli-speaks://open'), { command: 'open' });
});

test('links cannot paste or press keys (any web page can open a link)', () => {
  assert.equal(parseDeepLink('pauli-speaks://paste-last'), null);
  assert.equal(parseDeepLink('pauli-speaks://press-enter'), null);
  assert.equal(parseDeepLink('pauli-speaks://dictate/explode'), null);
  assert.equal(parseDeepLink('https://example.com/dictate/toggle'), null);
  assert.equal(parseDeepLink('not a url'), null);
  assert.equal(parseDeepLink(undefined), null);
});

test('command-line flags', () => {
  const exe = 'C:\\Program Files\\Pauli Speaks\\Pauli Speaks.exe';
  assert.deepEqual(parseCommandLine([exe, '--toggle']), { command: 'toggle' });
  assert.deepEqual(parseCommandLine([exe, '--start']), { command: 'start' });
  assert.deepEqual(parseCommandLine([exe, '--stop']), { command: 'stop' });
  assert.deepEqual(parseCommandLine([exe, '--cancel']), { command: 'cancel' });
  assert.deepEqual(parseCommandLine([exe, '--paste-last']), { command: 'pasteLast' });
  assert.deepEqual(parseCommandLine([exe, '--copy-last']), { command: 'copyLast' });
  assert.deepEqual(parseCommandLine([exe, '--undo-last']), { command: 'undoLast' });
  assert.deepEqual(parseCommandLine([exe, '--press-enter']), { command: 'pressEnter' });
  assert.deepEqual(parseCommandLine([exe, '--start', '--mode=email']), { command: 'start', mode: 'email' });
  assert.deepEqual(parseCommandLine(['electron.exe', '.', '--toggle']), { command: 'toggle' }, 'npm start -- --toggle');
});

test('a link passed on the command line (how Windows opens one)', () => {
  assert.deepEqual(parseCommandLine(['Pauli Speaks.exe', '--allow-file-access-from-files', 'pauli-speaks://dictate/start']), { command: 'start' });
  assert.equal(parseCommandLine(['Pauli Speaks.exe', 'pauli-speaks://paste-last']), null);
});

test('nothing to do', () => {
  assert.equal(parseCommandLine(['Pauli Speaks.exe']), null);
  assert.equal(parseCommandLine(['Pauli Speaks.exe', '--hidden']), null);
  assert.equal(parseCommandLine(undefined), null);
});
