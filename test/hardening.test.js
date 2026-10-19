'use strict';
// Input from links, the command line, settings.json and the window must not be able to
// reach built-in object properties (constructor, __proto__, toString...).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDeepLink, parseCommandLine } = require('../src/main/remote');
const { validateShortcut, normalizeBindings, maxBindings } = require('../src/main/shortcut-rules');
const { ShortcutRecorder } = require('../src/main/shortcut-recorder');
const { normalizeVoiceCommands } = require('../src/main/voice-commands');
const { Settings, DEFAULTS } = require('../src/main/settings');
const { isAllowedExternalUrl } = require('../src/main/system-check');

const plain = { encrypt: (s) => `plain:${s}`, decrypt: (s) => s.slice(6) };
const BUILTINS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

test('links and flags only know their own commands', () => {
  for (const name of BUILTINS) {
    assert.equal(parseDeepLink(`pauli-speaks://${name}`), null, name);
    assert.equal(parseCommandLine(['Pauli Speaks.exe', name]), null, name);
  }
});

test('a mode from a link or flag must be a plain name', () => {
  assert.deepEqual(parseDeepLink('pauli-speaks://dictate/start?mode=email-en_2'), { command: 'start', mode: 'email-en_2' });
  assert.deepEqual(parseDeepLink('pauli-speaks://dictate/start?mode=a%0Afake%20log%20line'), { command: 'start' });
  assert.deepEqual(parseDeepLink(`pauli-speaks://dictate/start?mode=${'x'.repeat(41)}`), { command: 'start' });
  assert.deepEqual(parseCommandLine(['P.exe', '--start', '--mode=../../x']), { command: 'start' });
});

test('built-in names are not actions', () => {
  for (const name of BUILTINS) {
    assert.equal((validateShortcut(['F8'], name, DEFAULTS.bindings) || {}).code, 'unknownAction', name);
    assert.equal(maxBindings(name), 0, name);
  }
  assert.deepEqual(normalizeBindings([{ action: 'constructor', keys: ['F8'] }, { action: 'toString', keys: ['F9'] }]), []);
  const rec = new ShortcutRecorder({ getBindings: () => [], onUpdate() {}, onSave() {} });
  assert.equal(rec.start({ action: 'constructor' }), false);
  assert.equal(rec.active, false);
});

test('settings ignore built-in keys from the file and from the window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-harden-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"__proto__": {"polluted": true}, "constructor": "x", "sounds": false}');
  const s = new Settings(file, plain);
  assert.equal(s.get().sounds, false);
  assert.equal(s.get().polluted, undefined);
  assert.equal(Object.getPrototypeOf(s.get()), Object.prototype);
  assert.equal(Object.hasOwn(s.get(), 'constructor'), false);
  s.update(JSON.parse('{"__proto__": {"polluted": true}, "toString": 1, "sounds": true}'));
  assert.equal(s.get().sounds, true);
  assert.equal(s.get().polluted, undefined);
  assert.equal(Object.hasOwn(s.get(), 'toString'), false);
  assert.equal(Object.getPrototypeOf(s.get()), Object.prototype);
});

test('voice-command phrases and inserted text have sane lengths', () => {
  const list = normalizeVoiceCommands([
    { phrases: ['x'.repeat(61), 'ok phrase'], action: 'key', arg: 'Enter' },
    { phrases: ['huge'], action: 'insert', arg: 'y'.repeat(2001) },
    { phrases: ['fine'], action: 'insert', arg: 'y'.repeat(2000) },
  ]);
  assert.deepEqual(list.map((c) => c.phrases), [['ok phrase'], ['fine']]);
});

test('the window may open https links and the Windows microphone privacy page, nothing else', () => {
  assert.equal(isAllowedExternalUrl('https://github.com/izscaryu/pauli-speaks'), true);
  assert.equal(isAllowedExternalUrl('ms-settings:privacy-microphone'), true);
  for (const url of [
    'ms-settings:', 'ms-settings:privacy-webcam', 'ms-settings:privacy-microphone2', 'ms-settings:privacy-microphone?x=1',
    ' ms-settings:privacy-microphone', 'MS-SETTINGS:privacy-microphone', 'ms-settings:windowsupdate',
    'file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', 'http://example.com', 'HTTPS://example.com', '',
  ]) {
    assert.equal(isAllowedExternalUrl(url), false, url);
  }
  for (const value of [undefined, null, 42, {}, ['https://x'], { toString: () => 'https://x' }]) {
    assert.equal(isAllowedExternalUrl(value), false, String(value));
  }
});
