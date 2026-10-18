'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');
const { createPendingAudio } = require('../src/main/pending-audio');
const { createRetryOffers } = require('../src/main/retry-offers');
const { DictationController } = require('../src/main/dictation-controller');
const { createDictationFlow, MIN_AUDIO_SECONDS } = require('../src/main/dictation-flow');

const RATE = 16000;
const audio = (s = 1) => new Float32Array(Math.round(RATE * s)).fill(0.1);

/**
 * The flow with real History, pending audio, retry offers and controller; everything else is scripted.
 * `gate` and `run` decide what the speech gate and the transcription do.
 */
function rig({ gate = async (a) => ({ audio: a, trimmed: false }), run = async () => {}, stop = async () => audio(1), saved = () => null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-flow-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new History(path.join(dir, 'history.json'));
  const pending = createPendingAudio();
  const timers = [];
  const retry = createRetryOffers({
    pending, history,
    timers: { setTimeout: (fn) => { const t = { fn, done: false }; timers.push(t); return t; }, clearTimeout: (t) => { if (t) t.done = true; } },
  });
  const controller = new DictationController({ start() {}, finish: async () => {}, dismiss() {} });
  const calls = { flashed: [], errors: [], runs: [], copied: [], ended: 0, idle: 0, begun: 0, after: 0, logs: [] };
  const session = { end: () => { calls.ended++; } };
  let listening = session;
  const flow = createDictationFlow({
    retry, history, controller,
    speechGate: (a) => gate(a),
    runDictation: async (a, seconds, t0, historyId, recording) => {
      calls.runs.push({ kind: 'dictation', seconds, historyId, recording });
      await run(flow, { historyId });
    },
    runCommand: async (a, seconds, historyId) => {
      calls.runs.push({ kind: 'command', seconds, historyId });
      await run(flow, { historyId });
    },
    transcribe: async () => ({ text: 'hello there', language: 'en' }),
    translatingNow: () => controller.translate,
    styleFor: () => 'default',
    dictationText: (result) => ({ text: result.text, before: [], after: [] }),
    dictationEntry: (result, text, seconds) => ({ text, rawText: result.text, durationMs: Math.round(seconds * 1000), words: 2 }),
    keptMeta: (seconds) => ({ durationMs: Math.round(seconds * 1000), engine: 'whisper-base', command: controller.command, translate: controller.translate, app: null }),
    takeListening: () => { const s = listening; listening = null; return s; },
    stopForUndo: () => stop(),
    beginRun: () => { calls.begun++; },
    afterRun: () => { calls.after++; },
    showIdle: () => { calls.idle++; },
    showError: (message) => calls.errors.push(message),
    flash: (...a) => calls.flashed.push(a),
    copy: async (text) => { calls.copied.push(text); },
    savedRecording: saved,
    audioIds: () => new Set(),
    log: { info() {}, warn: (...a) => calls.logs.push(a.join(' ')), error: (...a) => calls.logs.push(String(a[0])) },
  });
  const expireTimers = () => { for (const t of timers) if (!t.done) { t.done = true; t.fn(); } };
  return { flow, history, pending, retry, controller, calls, expireTimers };
}

const lastAction = (calls) => calls.flashed.map((f) => f[3]).filter(Boolean).pop() || null;

test('MIN_AUDIO_SECONDS is 0.3', () => {
  assert.equal(MIN_AUDIO_SECONDS, 0.3);
});

test('too short or nothing heard: a message, nothing kept', async () => {
  const { flow, calls, history } = rig({ gate: async () => ({ skip: 'no-speech' }) });
  await flow.processDictation(audio(0.2), 0);
  await flow.processDictation(audio(1), 0);
  assert.deepEqual(calls.flashed.map((f) => f[0]), ['No speech detected', 'No speech detected']);
  assert.equal(calls.runs.length, 0);
  assert.equal(history.list().length, 0);
});

test('a dead microphone says so', async () => {
  const { flow, calls } = rig({ gate: async () => ({ skip: 'no-sound' }) });
  await flow.processDictation(audio(1), 0);
  assert.equal(calls.flashed[0][0], 'No sound. Is your mic muted?');
});

test('a failed transcription keeps the audio: failed History entry and Retry on the pill', async () => {
  const { flow, calls, history, pending } = rig({ run: async () => { throw new Error('Invalid API key'); } });
  const a = audio(1);
  await flow.processDictation(a, 0);
  assert.equal(history.list()[0].status, 'failed');
  assert.equal(history.list()[0].error, 'Invalid API key');
  assert.equal(pending.get(history.list()[0].audioId).audio, a);
  assert.deepEqual(calls.errors, ['Invalid API key']);
  const [text, kind, ms, action] = calls.flashed[0];
  assert.deepEqual([text, kind, ms, action.label], ["Couldn't transcribe.", 'error', 6000, 'Retry']);
  assert.equal(calls.after, 1);
});

test('an error after the entry went into History is shown, without a Retry', async () => {
  const { flow, calls, history } = rig({
    run: async (f) => { f.noteRecorded(); throw new Error('paste failed'); },
  });
  await flow.processDictation(audio(1), 0);
  assert.equal(history.list().length, 0);
  assert.deepEqual(calls.flashed, [['paste failed', 'error', 4500]]);
});

test('A4: cancelled while processing, then an error: no failed entry, no Retry, nothing kept', async () => {
  const { flow, calls, history, pending, controller } = rig({
    run: async () => { controller.cancel(); throw new Error('aborted'); },
  });
  controller.status = 'processing'; // as during a stop
  await flow.processDictation(audio(1), 0);
  assert.equal(controller.cancelled, true);
  assert.equal(history.list().length, 0);
  assert.equal(pending.size, 0);
  assert.equal(lastAction(calls), null);
  assert.deepEqual(calls.flashed, []);
  assert.deepEqual(calls.errors, [], 'nothing to tell the window: the user cancelled');
});

// ---------------------------------------------------------------- the pill's Retry

test('pill Retry: transcribed this time, the failed entry and the audio are settled', async () => {
  let fail = true;
  const { flow, calls, history, pending } = rig({ run: async () => { if (fail) throw new Error('offline'); } });
  await flow.processDictation(audio(1), 0);
  const failed = history.list()[0];
  fail = false;
  await flow.runPillAction(lastAction(calls).id);
  assert.equal(calls.begun, 1);
  assert.equal(calls.runs[1].historyId, failed.id, 'the retry fills in the failed entry');
  assert.equal(pending.get(failed.audioId), null);
});

test('pill Retry failing again: same entry, Retry offered again', async () => {
  const { flow, calls, history } = rig({ run: async () => { throw new Error('offline'); } });
  await flow.processDictation(audio(1), 0);
  await flow.runPillAction(lastAction(calls).id);
  assert.equal(history.list().length, 1);
  assert.equal(calls.flashed.length, 2);
  assert.equal(lastAction(calls).label, 'Retry');
});

test('C5: pill Retry where the gate finds no speech removes the failed entry, like History Retry', async () => {
  let gateSays = null;
  const { flow, calls, history, pending } = rig({
    gate: async (a) => gateSays || { audio: a, trimmed: false },
    run: async () => { throw new Error('offline'); },
  });
  await flow.processDictation(audio(1), 0);
  const failed = history.list()[0];
  gateSays = { skip: 'no-speech' };
  await flow.runPillAction(lastAction(calls).id);
  assert.equal(history.list().length, 0);
  assert.equal(pending.get(failed.audioId), null);
  assert.equal(calls.flashed.pop()[0], 'No speech detected');
});

test('C5: History Retry where the gate finds no speech removes the failed entry too', async () => {
  let gateSays = null;
  const { flow, calls, history } = rig({
    gate: async (a) => gateSays || { audio: a, trimmed: false },
    run: async () => { throw new Error('offline'); },
  });
  await flow.processDictation(audio(1), 0);
  gateSays = { skip: 'no-speech' };
  assert.deepEqual(await flow.retryFromHistory(history.list()[0].id), { error: 'No speech detected' });
  assert.equal(history.list().length, 0);
  assert.equal(calls.idle, 1);
});

test('a stale pill action says the recording is gone', async () => {
  const { flow, calls } = rig();
  await flow.runPillAction('retry-99');
  assert.deepEqual(calls.flashed, [['That recording is no longer available']]);
});

// ---------------------------------------------------------------- Undo

test('offerUndo: the cancelled recording is held behind Undo; Undo transcribes it and then ends the session', async () => {
  const { flow, calls, controller } = rig();
  await flow.offerUndo();
  assert.equal(calls.flashed[0][0], 'Cancelled.');
  const action = lastAction(calls);
  assert.equal(action.label, 'Undo');
  assert.equal(calls.ended, 0, 'the crash file stays while Undo is possible');
  await flow.runPillAction(action.id);
  assert.equal(calls.runs.length, 1);
  assert.equal(calls.ended, 1);
  assert.equal(controller.status, 'idle');
});

test('offerUndo: too short to undo ends the session at once', async () => {
  const { flow, calls } = rig({ stop: async () => audio(0.1) });
  await flow.offerUndo();
  assert.equal(calls.ended, 1);
  assert.equal(lastAction(calls), null);
});

test('A3: offerUndo when taking the recording fails: the hold ends and the crash file goes', async () => {
  const { flow, calls, pending } = rig({ stop: async () => { throw new Error('recorder gone'); } });
  await assert.doesNotReject(flow.offerUndo());
  assert.equal(calls.ended, 1);
  assert.equal(pending.size, 0);
  assert.equal(lastAction(calls), null);
  assert.match(calls.logs.join('\n'), /recorder gone/);
});

test('A2: Undo while busy takes nothing: the audio and the crash file stay, and Undo still works after', async () => {
  const { flow, calls, controller, pending } = rig();
  await flow.offerUndo();
  const action = lastAction(calls);
  controller.status = 'processing'; // a retry from History is running
  await flow.runPillAction(action.id);
  assert.equal(calls.flashed.pop()[0], 'Still working on the last dictation…');
  assert.equal(pending.size, 1, 'the audio is still held');
  assert.equal(calls.ended, 0, 'the crash file stays');
  assert.equal(calls.runs.length, 0);
  controller.status = 'idle';
  await flow.runPillAction(action.id);
  assert.equal(calls.runs.length, 1);
  assert.equal(calls.ended, 1);
});

test('Undo held expires after its time: audio and crash file go', async () => {
  const { flow, calls, pending, expireTimers } = rig();
  await flow.offerUndo();
  expireTimers();
  assert.equal(pending.size, 0);
  assert.equal(calls.ended, 1);
});

// ---------------------------------------------------------------- History

test('History Retry copies the text with the copy it was given', async () => {
  const { flow, calls, history } = rig({ run: async () => { throw new Error('offline'); } });
  await flow.processDictation(audio(1), 0);
  assert.deepEqual(await flow.retryFromHistory(history.list()[0].id), { copied: true });
  assert.deepEqual(calls.copied, ['hello there']);
  assert.equal(history.list()[0].text, 'hello there');
});

test('transcribeKept: null when the gate finds nothing or the text is empty', async () => {
  const { flow } = rig({ gate: async () => ({ skip: 'no-speech' }) });
  assert.equal(await flow.transcribeKept({ audio: audio(1), meta: { app: null } }), null);
});

test('historyList marks what can be retried and played', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-flow-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new History(path.join(dir, 'history.json'));
  const pending = createPendingAudio();
  const retry = createRetryOffers({ pending, history });
  const ok = history.add({ text: 'a', words: 1, durationMs: 1 });
  const played = history.add({ text: 'b', words: 1, durationMs: 1 });
  retry.failed(audio(1), { durationMs: 1000, engine: 'x' }, 'boom');
  const failed = history.list()[0];
  const flow = createDictationFlow({ retry, history, audioIds: () => new Set([played.id]) });
  const list = flow.historyList();
  assert.equal(list.find((i) => i.id === ok.id).hasAudio, undefined);
  assert.equal(list.find((i) => i.id === played.id).hasAudio, true);
  assert.deepEqual([list.find((i) => i.id === failed.id).canRetry, list.find((i) => i.id === failed.id).hasAudio], [true, false]);
});
