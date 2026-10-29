'use strict';
// Hold the shortcut, speak (a fake microphone), let go: the text is "pasted" and kept in History.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, setUpSettings } = require('./helpers');

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

// Tester report: with Both on a two-key shortcut (Ctrl+Win), a double-tap said "Hold … while you speak" instead of
// locking, because tapping two keys twice takes longer than the window allowed. Ctrl+F14 stands in for Ctrl+Win.
test('Both on a two-key shortcut: a double-tap locks hands-free, the next press finishes', async (t) => {
  const run = await launch({
    settings: setUpSettings({ bindings: [{ id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'F14'], behaviour: 'both' }, { id: 'cancel-1', action: 'cancel', keys: ['Escape'] }] }),
  });
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  const status = () => run.page.evaluate(() => window.pauli.getDictationStatus());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chord = async (down) => {
    for (const k of down ? ['Ctrl', 'F14'] : ['F14', 'Ctrl']) { await run.key(k, down); await sleep(40); }
  };
  await chord(true);
  await sleep(200);
  await chord(false);
  await sleep(250);
  await chord(true);
  await chord(false);
  await sleep(1200); // well past the tap window
  const now = await status();
  assert.deepEqual([now.status, now.locked], ['listening', true]);
  await chord(true);
  await chord(false);
  await waitFor(async () => (await run.state()).pasted.length, { what: 'a paste' });
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
