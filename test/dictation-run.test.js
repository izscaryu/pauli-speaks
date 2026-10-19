'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');
const { DEFAULTS } = require('../src/main/settings');
const { createDictationRun } = require('../src/main/dictation-run');

const RATE = 16000;
const audio = (s = 1) => new Float32Array(Math.round(RATE * s)).fill(0.1);

/**
 * The run with real History and text clean-up; engines, windows and keys are scripted.
 * `heard` is what the speech engine returns, `chat` what the AI answers in command mode.
 */
function rig({ heard = { text: 'hello there', language: 'en' }, chat = async () => 'Edited.', selection = 'old text', pasteMode = 'paste', nllb = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-run-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new History(path.join(dir, 'history.json'));
  const s = structuredClone(DEFAULTS);
  const controller = { command: false, translate: false, cancelled: false };
  const calls = { recognised: [], translated: [], pasted: [], actions: [], enters: 0, flashed: [], states: [], saved: [], recorded: 0, fed: [], chats: [] };
  const typing = {
    enterAfterPaste: false,
    paste: async (text) => { calls.pasted.push(text); return { mode: pasteMode }; },
    runVoiceAction: async (c, alone) => { calls.actions.push([c.action, c.arg, alone]); },
    pressEnterNow: async () => { calls.enters++; typing.enterAfterPaste = false; },
    selectedText: async () => selection,
  };
  const run = createDictationRun({
    settings: { get: () => s, getApiKey: () => 'key' },
    controller, history, typing,
    recognise: async (a, task) => { calls.recognised.push(task); return { ...heard }; },
    translateText: async (text, source, target) => { calls.translated.push([text, source, target]); return `[${target}] ${text}`; },
    needsNllb: () => nllb,
    sessionApp: () => ({ exe: 'notepad.exe' }),
    engineLabel: () => 'whisper-base',
    saveRecording: (id, a) => calls.saved.push([id, a.length]),
    onRecorded: () => { calls.recorded++; },
    feedLanguage: (hint) => calls.fed.push(hint),
    chatComplete: async (opts, messages) => { calls.chats.push({ opts, messages }); return chat(); },
    sendOverlayState: (state) => calls.states.push(state),
    flash: (...a) => calls.flashed.push(a),
    log: { info() {}, warn() {}, error() {} },
  });
  return { run, history, controller, typing, calls, s };
}

test('transcribe: plain speech is recognised once and returned as heard', async () => {
  const { run, calls } = rig();
  assert.deepEqual(await run.transcribe(audio()), { text: 'hello there', language: 'en' });
  assert.deepEqual(calls.recognised, ['transcribe']);
});

test("transcribe: to English without the translator, Whisper's own translate task does it in one pass", async () => {
  const { run, calls } = rig({ heard: { text: 'Hello', language: 'de', translatedTo: 'en' } });
  const r = await run.transcribe(audio(), { translate: true });
  assert.deepEqual(calls.recognised, ['translate']);
  assert.equal(r.translatedTo, 'en');
  assert.equal(calls.translated.length, 0);
});

test('transcribe: with the translator, the cleaned-up speech is translated and its voice commands kept', async () => {
  const { run, calls } = rig({ nllb: true, heard: { text: 'um hallo welt press enter', language: 'de' } });
  const r = await run.transcribe(audio(), { translate: true });
  assert.deepEqual(calls.recognised, ['transcribe']);
  assert.deepEqual(calls.translated, [['Hallo welt', 'de', 'en']]);
  assert.equal(r.text, '[en] Hallo welt');
  assert.equal(r.original, 'Hallo welt');
  assert.equal(r.translatedTo, 'en');
  assert.deepEqual(r.after.map((c) => c.action), ['key']);
});

test('transcribe: speech already in the target language is not translated', async () => {
  const { run, calls } = rig({ nllb: true, heard: { text: 'hello', language: 'en' } });
  const r = await run.transcribe(audio(), { translate: true });
  assert.equal(r.text, 'hello');
  assert.equal(calls.translated.length, 0);
});

test('translatingNow: the translate shortcut or "always translate", never in command mode', () => {
  const { run, controller, s } = rig();
  assert.equal(run.translatingNow(), false);
  controller.translate = true;
  assert.equal(run.translatingNow(), true);
  controller.command = true;
  assert.equal(run.translatingNow(), false);
  controller.command = false;
  controller.translate = false;
  s.translation.always = true;
  assert.ok(run.translatingNow());
});

test('runDictation: cleaned text is pasted, put in History with its recording, and the language hint fed', async () => {
  const { run, history, calls } = rig({ heard: { text: 'um hello there', language: 'en' } });
  await run.runDictation(audio(2), 2, Date.now(), null, audio(3));
  assert.deepEqual(calls.pasted, ['Hello there ']);
  const [item] = history.list();
  assert.equal(item.text, 'Hello there');
  assert.equal(item.rawText, 'um hello there');
  assert.equal(item.durationMs, 2000);
  assert.equal(item.app, 'notepad.exe');
  assert.equal(item.engine, 'whisper-base');
  assert.equal(calls.recorded, 1);
  assert.deepEqual(calls.saved, [[item.id, RATE * 3]]);
  assert.deepEqual(calls.fed, [{ chosen: [], likely: 'en' }]);
  assert.deepEqual(calls.states.at(-1), { state: 'idle' });
});

test('runDictation: a retry fills in its failed History entry instead of adding one', async () => {
  const { run, history } = rig();
  const failed = history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'whisper-base', error: 'boom' });
  await run.runDictation(audio(), 1, Date.now(), failed.id);
  const items = history.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, failed.id);
  assert.equal(items[0].text, 'Hello there');
});

test('runDictation: "scratch that" at the end drops it: nothing pasted or kept', async () => {
  const { run, history, calls } = rig({ heard: { text: 'hello there scratch that', language: 'en' } });
  await run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(calls.pasted, []);
  assert.equal(history.list().length, 0);
  assert.deepEqual(calls.flashed, [['Dropped that dictation']]);
});

test('runDictation: nothing said, a message; cancelled meanwhile, the pill just goes idle', async () => {
  const quiet = rig({ heard: { text: '', language: null } });
  await quiet.run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(quiet.calls.flashed, [['No speech detected']]);

  const cancelled = rig();
  cancelled.controller.cancelled = true;
  await cancelled.run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(cancelled.calls.pasted, []);
  assert.deepEqual(cancelled.calls.states, [{ state: 'idle' }]);
});

test('runDictation: commands at the end run after the paste, and "Press Enter" during it presses Enter once', async () => {
  const { run, calls } = rig({ heard: { text: 'hello there press enter', language: 'en' } });
  await run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(calls.pasted, ['Hello there']);
  assert.deepEqual(calls.actions, [['key', 'Enter', false]]);
  assert.equal(calls.enters, 0, 'the spoken Enter is the Enter');

  const second = rig();
  second.typing.enterAfterPaste = true;
  await second.run.runDictation(audio(), 1, Date.now());
  assert.equal(second.calls.enters, 1);
});

test('runDictation: only a command said ("press enter"): nothing pasted or kept, the command runs', async () => {
  const { run, calls, history } = rig({ heard: { text: 'press enter', language: 'en' } });
  await run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(calls.pasted, []);
  assert.equal(history.list().length, 0);
  assert.equal(calls.actions.length, 1);
});

test('runDictation: when the app only got a copy (administrator), the commands after it do not run', async () => {
  const { run, calls } = rig({ pasteMode: 'copy-only', heard: { text: 'hello there press enter', language: 'en' } });
  await run.runDictation(audio(), 1, Date.now());
  assert.deepEqual(calls.pasted, ['Hello there']);
  assert.deepEqual(calls.actions, []);
});

test('dictationText: a translation is only polished, its commands come from before translating', () => {
  const { run } = rig();
  const after = [{ action: 'key', arg: 'Enter' }];
  const out = run.dictationText({ text: 'hello world', original: 'hallo welt', before: [], after }, 'default');
  assert.equal(out.text, 'Hello world');
  assert.deepEqual(out.after, after);
  assert.deepEqual(out.before, []);
});

test('runCommand: the instruction edits the selection, goes into History as a command and the result is pasted', async () => {
  const { run, history, calls, s } = rig({ heard: { text: 'make it formal', language: 'en' } });
  await run.runCommand(audio(2), 2, null);
  assert.equal(calls.chats.length, 1);
  assert.equal(calls.chats[0].opts.model, s.command.model);
  assert.equal(calls.chats[0].opts.apiKey, 'key');
  assert.ok(JSON.stringify(calls.chats[0].messages).includes('old text'));
  assert.deepEqual(calls.pasted, ['Edited.']);
  const [item] = history.list();
  assert.equal(item.kind, 'command');
  assert.equal(item.text, 'Edited.');
  assert.equal(item.original, 'old text');
  assert.equal(item.engine, s.command.model);
  assert.equal(item.durationMs, 2000);
  assert.equal(calls.recorded, 1);
});

test('runCommand: nothing said, or the AI answers nothing, is said so and nothing is pasted', async () => {
  const quiet = rig({ heard: { text: '', language: null } });
  await quiet.run.runCommand(audio(), 1);
  assert.deepEqual(quiet.calls.flashed, [['No speech detected']]);
  assert.equal(quiet.calls.chats.length, 0);

  const empty = rig({ chat: async () => '' });
  await empty.run.runCommand(audio(), 1);
  assert.deepEqual(empty.calls.flashed, [['The AI returned nothing - try rephrasing', 'error']]);
  assert.deepEqual(empty.calls.pasted, []);
});

test('runCommand: "Press Enter" during it presses Enter after the paste', async () => {
  const { run, typing, calls } = rig();
  typing.enterAfterPaste = true;
  await run.runCommand(audio(), 1);
  assert.equal(calls.enters, 1);
});

test('keptMeta: how a kept recording is to be run again', () => {
  const { run, controller, s } = rig();
  assert.deepEqual(run.keptMeta(1.5), { durationMs: 1500, engine: 'whisper-base', command: false, translate: false, app: { exe: 'notepad.exe' } });
  controller.command = true;
  assert.equal(run.keptMeta(1).engine, s.command.model);
});
