'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { e2eEnabled, createE2E } = require('../src/main/e2e');

test('end-to-end mode needs PAULI_E2E=1 and a development run: never in an installed or portable app', () => {
  assert.equal(e2eEnabled({ isPackaged: false }, { PAULI_E2E: '1' }), true);
  assert.equal(e2eEnabled({ isPackaged: true }, { PAULI_E2E: '1' }), false);
  assert.equal(e2eEnabled({ isPackaged: false }, {}), false);
  assert.equal(e2eEnabled({ isPackaged: false }, { PAULI_E2E: 'true' }), false);
});

test('the fakes record what would have been pasted, pressed and copied, and say what was heard', async () => {
  const e2e = createE2E();
  e2e.state.transcript = 'hello there';
  assert.deepEqual(await e2e.io.recognise(new Float32Array(16000), 'transcribe'), { text: 'hello there', language: 'en' });
  assert.deepEqual(await e2e.io.pasteText('Hello there ', { restoreClipboard: true }), { mode: 'paste' });
  await e2e.io.pressKey(13);
  await e2e.io.pressKey(8, 3);
  await e2e.io.writeClipboard('diagnostics');
  assert.equal(await e2e.io.getSelectedText(), '');
  assert.deepEqual(e2e.state.pasted, ['Hello there ']);
  assert.deepEqual(e2e.state.keys, [{ vk: 13, times: 1 }, { vk: 8, times: 3 }]);
  assert.deepEqual(e2e.state.clipboard, ['diagnostics']);
  assert.deepEqual(e2e.state.recognised, [{ task: 'transcribe', seconds: 1, languages: null }]);
});

test('attach: keys go straight into the shortcut engine, which no longer sweeps keys Windows does not see as held', () => {
  const e2e = createE2E();
  const handled = [];
  let swept = 0;
  const keyboard = { engine: { handleKey: (k, down) => handled.push([k, down]), sweepStale: () => { swept++; } } };
  const target = {};
  e2e.attach({ keyboard, target });
  target.__pauliE2E.key('F13', true);
  target.__pauliE2E.key('F13', false);
  keyboard.engine.sweepStale();
  assert.deepEqual(handled, [['F13', true], ['F13', false]]);
  assert.equal(swept, 0);
  assert.equal(target.__pauliE2E.state, e2e.state);
});
