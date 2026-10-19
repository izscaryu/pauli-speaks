'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LastPaste } = require('../src/main/last-paste');
const { createTyping } = require('../src/main/typing');

const VK = { Backspace: 8, Tab: 9, Enter: 13 };

/** Typing with the real LastPaste; the clipboard, keys and windows are scripted. Held keys come up after `releaseAfter` waits. */
function rig({ mode = 'paste', last = { text: 'earlier text' }, held = false, releaseAfter = 2 } = {}) {
  const calls = { pasted: [], keys: [], flashed: [], copied: [], stops: [], waits: 0 };
  const controller = { isListening: false, status: 'idle', stop: (why) => calls.stops.push(why) };
  let clock = 0;
  let down = held ? 1 : 0;
  const typing = createTyping({
    settings: { get: () => ({ restoreClipboard: true, addTrailingSpace: true }) },
    lastPaste: new LastPaste(),
    history: { last: () => last },
    controller, VK,
    pasteText: async (text, opts) => { calls.pasted.push([text, opts]); return { mode }; },
    pressKey: async (vk, times = 1) => { calls.keys.push([vk, times]); },
    getSelectedText: async () => 'selected',
    foregroundApp: () => ({ exe: 'notepad.exe' }),
    keysDown: () => down,
    writeClipboard: async (text) => { calls.copied.push(text); },
    flash: (...a) => calls.flashed.push(a),
    log: { warn() {} },
    now: () => clock,
    sleep: async (ms) => { calls.waits++; clock += ms; if (calls.waits >= releaseAfter) down = 0; },
  });
  return { typing, calls, controller };
}

test('paste: typed into the app in front and remembered, so "undo last" removes it with Backspace', async () => {
  const { typing, calls } = rig();
  await typing.paste('Hello');
  assert.deepEqual(calls.pasted, [['Hello', { restoreClipboard: true }]]);
  assert.equal(await typing.undoLast(), true);
  assert.deepEqual(calls.keys, [[VK.Backspace, 5]]);
  assert.equal(await typing.undoLast(), false, 'only once');
  assert.deepEqual(calls.flashed, [['Nothing to undo']]);
});

test('paste into an administrator window: left on the clipboard, said so, and nothing to undo', async () => {
  const { typing, calls } = rig({ mode: 'copy-only' });
  const result = await typing.paste('Hello');
  assert.equal(result.mode, 'copy-only');
  assert.equal(await typing.undoLast(), false);
  assert.deepEqual(calls.flashed, [['Copied. Press Ctrl+V (this app runs as administrator)', 'info', 4500], ['Nothing to undo']]);
  assert.deepEqual(calls.keys, []);
});

test('pasteLast and copyLast use the last transcript, or say there is none', async () => {
  const { typing, calls } = rig();
  await typing.pasteLast();
  assert.deepEqual(calls.pasted.map((p) => p[0]), ['earlier text ']);
  typing.copyLast(true);
  await new Promise(setImmediate);
  assert.deepEqual(calls.copied, ['earlier text']);
  assert.deepEqual(calls.flashed, [['Copied your last dictation']]);

  const empty = rig({ last: null });
  await empty.typing.pasteLast();
  empty.typing.copyLast(true);
  empty.typing.copyLast(false);
  assert.deepEqual(empty.calls.flashed, [['Nothing to paste yet'], ['Nothing to copy yet']]);
  assert.deepEqual(empty.calls.pasted, []);
});

test('pressEnter: while listening it finishes and sends, while processing it sends after the paste, otherwise now', async () => {
  const { typing, calls, controller } = rig();
  controller.isListening = true;
  typing.pressEnter();
  assert.deepEqual(calls.stops, ['enter']);
  assert.equal(typing.enterAfterPaste, true);

  controller.isListening = false;
  typing.enterAfterPaste = false;
  controller.status = 'processing';
  typing.pressEnter();
  assert.equal(typing.enterAfterPaste, true);
  assert.deepEqual(calls.keys, []);

  controller.status = 'idle';
  await typing.pressEnter();
  assert.deepEqual(calls.keys, [[VK.Enter, 1]]);
  assert.equal(typing.enterAfterPaste, false, 'pressing Enter uses up the pending one');
});

test('pressEnterNow: what was sent can no longer be undone', async () => {
  const { typing, calls } = rig();
  await typing.paste('Hi');
  await typing.pressEnterNow();
  assert.equal(await typing.undoLast(), false);
  assert.deepEqual(calls.flashed, [['That was already sent']]);
});

test('runVoiceAction: "scratch that" alone says what it removed; keys are pressed; unknown keys are ignored', async () => {
  const { typing, calls } = rig();
  await typing.paste('Hi');
  await typing.runVoiceAction({ action: 'undo', arg: '' }, true);
  assert.deepEqual(calls.flashed, [['Removed the last dictation']]);
  await typing.runVoiceAction({ action: 'key', arg: 'Tab' }, false);
  await typing.runVoiceAction({ action: 'key', arg: 'Enter' }, false);
  await typing.runVoiceAction({ action: 'key', arg: 'Nope' }, false);
  assert.deepEqual(calls.keys, [[VK.Backspace, 2], [VK.Tab, 1], [VK.Enter, 1]]);
});

test("the selection is only copied once the user's shortcut keys are up", async () => {
  const { typing, calls } = rig({ held: true, releaseAfter: 2 });
  assert.equal(await typing.selectedText(), 'selected');
  assert.equal(calls.waits, 2);
});

test('a key that stays down holds things up for 1.5 s at most', async () => {
  const { typing, calls } = rig({ held: true, releaseAfter: Infinity });
  await typing.waitForKeysReleased();
  assert.equal(calls.waits, 100); // 1500 ms in 15 ms steps
});
