'use strict';
// Hold the shortcut, speak (a fake microphone), let go: the text is "pasted" and kept in History.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor } = require('./helpers');

/** Holds the dictate shortcut (F13) long enough to be push-to-talk, then lets go. */
const dictate = (run, ms = 1500) => run.dictate('F13', { ms });

test('hold, speak, let go: the cleaned-up text is pasted and appears in History', async (t) => {
  const run = await launch();
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500)); // the pill and its recorder get ready
  await run.set('transcript', 'um hello there');
  await dictate(run);
  const state = await waitFor(async () => { const s = await run.state(); return s.pasted.length ? s : null; }, { what: 'a paste' });
  assert.deepEqual(state.pasted, ['Hello there ']);
  assert.equal(state.recognised.length, 1);
  assert.ok(state.recognised[0].seconds >= 1, `recorded ${state.recognised[0].seconds}s`);
  const history = await run.page.evaluate(() => window.pauli.listHistory());
  assert.equal(history[0].text, 'Hello there');
});

test('a voice command at the end ("press enter") presses Enter after the paste, once', async (t) => {
  const run = await launch();
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'see you tomorrow press enter');
  await dictate(run);
  const state = await waitFor(async () => { const s = await run.state(); return s.keys.length ? s : null; }, { what: 'Enter' });
  assert.deepEqual(state.pasted, ['See you tomorrow']);
  assert.deepEqual(state.keys, [{ vk: 0x0d, times: 1 }]);
});

test('"scratch that" at the end: nothing is pasted or kept', async (t) => {
  const run = await launch();
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'never mind scratch that');
  await dictate(run);
  await waitFor(async () => (await run.state()).recognised.length, { what: 'the transcription' });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual((await run.state()).pasted, []);
  assert.deepEqual(await run.page.evaluate(() => window.pauli.listHistory()), []);
});
