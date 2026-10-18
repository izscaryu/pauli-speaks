'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRecoveryIpc, MIN_RECOVER_SECONDS } = require('../src/main/recovery-ipc');

const RATE = 16000;
const seconds = (n) => new Float32Array(Math.round(n * RATE)).fill(0.1);

function setup({ file = { meta: { startedAt: 1000, mode: 'dictate' }, audio: seconds(2) }, ...overrides } = {}) {
  const handlers = {};
  const ipcMain = { handle(ch, fn) { handlers[ch] = fn; } };
  const calls = { finish: 0, added: [], copied: [], kept: [], flashed: [], transcribed: [], modes: [], logs: [] };
  const deps = {
    recovery: { read: () => file, finish: () => { calls.finish++; } },
    crashRecoveryOn: () => true,
    dictationActive: () => false,
    process: async (run, mode) => { calls.modes.push(mode); await run(); return true; },
    transcribe: async (kept) => {
      calls.transcribed.push(kept);
      return { text: 'hello there', durationMs: 2000, engine: 'whisper-base' };
    },
    isCancelled: () => false,
    addEntry: (entry, audio) => { calls.added.push(entry); calls.addedAudio = audio; },
    copy: async (text) => { calls.copied.push(text); },
    keep: (audio, meta, error) => { calls.kept.push({ audio, meta, error }); return { id: 'retry-1', label: 'Retry' }; },
    flash: (...a) => { calls.flashed.push(a); },
    engineLabel: () => 'whisper-base',
    log: { warn: (...a) => calls.logs.push(a), error: (...a) => calls.logs.push(a) },
    ...overrides,
  };
  const ipc = registerRecoveryIpc(ipcMain, deps);
  return { handlers, calls, ipc };
}

test('registers the recovery channels', () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), ['recovery:discard', 'recovery:recover', 'recovery:state']);
});

test('a leftover recording of at least half a second is offered', () => {
  const { handlers, ipc, calls } = setup();
  ipc.check();
  assert.deepEqual(handlers['recovery:state'](), { seconds: 2, startedAt: 1000 });
  assert.equal(calls.finish, 0, 'the file stays until the user chooses');
});

test('a recording shorter than half a second is deleted without a banner', () => {
  const { handlers, ipc, calls } = setup({ file: { meta: null, audio: seconds(MIN_RECOVER_SECONDS - 0.1) } });
  ipc.check();
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.finish, 1);
});

test('no file means no banner', () => {
  const { handlers, ipc } = setup({ file: null });
  ipc.check();
  assert.equal(handlers['recovery:state'](), null);
});

test('with crash recovery off any leftover file is deleted and nothing is offered', () => {
  const { handlers, ipc, calls } = setup({ crashRecoveryOn: () => false });
  ipc.check();
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.finish, 1);
});

test('turning crash recovery off deletes the leftover file at once and takes the banner away', () => {
  let on = true;
  const { handlers, ipc, calls } = setup({ crashRecoveryOn: () => on });
  ipc.check();
  assert.ok(handlers['recovery:state']());
  on = false;
  ipc.crashRecoveryChanged();
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.finish, 1);
});

test('turning crash recovery off during a dictation leaves the file to that dictation, but the banner goes', () => {
  let on = true;
  let active = false;
  const { handlers, ipc, calls } = setup({ crashRecoveryOn: () => on, dictationActive: () => active });
  ipc.check();
  active = true;
  on = false;
  ipc.crashRecoveryChanged();
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.finish, 0, 'the file belongs to the running dictation');
});

test('forget (Delete all my data) drops the offer and deletes the file even with crash recovery on', () => {
  const { handlers, ipc, calls } = setup();
  ipc.check();
  ipc.forget();
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.finish, 1);
});

test('turning crash recovery on changes nothing', () => {
  const { ipc, calls } = setup();
  ipc.crashRecoveryChanged();
  assert.equal(calls.finish, 0);
});

test('a recovered dictation is handed to History together with its audio', async () => {
  const { handlers, ipc, calls } = setup();
  ipc.check();
  await handlers['recovery:recover']();
  assert.equal(calls.addedAudio.length, 2 * RATE);
});

test('the state has no startedAt when the meta file was lost', () => {
  const { handlers, ipc } = setup({ file: { meta: null, audio: seconds(1) } });
  ipc.check();
  assert.deepEqual(handlers['recovery:state'](), { seconds: 1, startedAt: null });
});

test('Recover transcribes the audio, adds a History entry, copies the text and deletes the file', async () => {
  const { handlers, ipc, calls } = setup();
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.deepEqual(r, { copied: true });
  assert.equal(calls.transcribed.length, 1);
  assert.equal(calls.transcribed[0].audio.length, 2 * RATE);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].text, 'hello there');
  assert.deepEqual(calls.copied, ['hello there']);
  assert.equal(calls.finish, 1);
  assert.equal(handlers['recovery:state'](), null, 'the banner is gone');
});

test('Recover runs a translate recording in translate mode and keeps meta for the kept copy', async () => {
  const { handlers, ipc, calls } = setup({ file: { meta: { startedAt: 5, mode: 'translate' }, audio: seconds(1) } });
  ipc.check();
  await handlers['recovery:recover']();
  assert.deepEqual(calls.modes, [{ translate: true, command: false }]);
  assert.equal(calls.transcribed[0].meta.engine, 'whisper-base');
  assert.equal(calls.transcribed[0].meta.durationMs, 1000);
});

test('a failing transcription keeps the audio for Retry, with a failed History entry, and still deletes the file', async () => {
  const { handlers, ipc, calls } = setup({ transcribe: async () => { throw new Error('No API key'); } });
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.equal(r.failed, true);
  assert.equal(calls.kept.length, 1);
  assert.equal(calls.kept[0].audio.length, 2 * RATE);
  assert.equal(calls.kept[0].error, 'No API key');
  assert.equal(calls.kept[0].meta.durationMs, 2000);
  assert.equal(calls.added.length, 0);
  assert.deepEqual(calls.copied, []);
  assert.deepEqual(calls.flashed[0], ["Couldn't transcribe.", 'error', 6000, { id: 'retry-1', label: 'Retry' }]);
  assert.equal(calls.finish, 1);
  assert.equal(handlers['recovery:state'](), null);
});

test('a failing copy reports the error; the entry is already in History so the audio is not kept', async () => {
  const { handlers, ipc, calls } = setup({ copy: async () => { throw new Error('clipboard busy'); } });
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.equal(r.failed, undefined);
  assert.equal(r.error, 'clipboard busy');
  assert.equal(calls.added.length, 1);
  assert.equal(calls.kept.length, 0);
  assert.equal(calls.finish, 1);
});

test('nothing said in the recording: no entry, the file is deleted', async () => {
  const { handlers, ipc, calls } = setup({ transcribe: async () => null });
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.deepEqual(r, { error: 'No speech detected' });
  assert.equal(calls.added.length, 0);
  assert.equal(calls.kept.length, 0);
  assert.equal(calls.finish, 1);
});

test('cancelling the transcription keeps the audio for Retry', async () => {
  const { handlers, ipc, calls } = setup({ isCancelled: () => true });
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.equal(r.failed, true);
  assert.equal(r.cancelled, true);
  assert.equal(calls.kept.length, 1);
  assert.equal(calls.added.length, 0);
  assert.equal(calls.finish, 1);
});

test('Recover while busy changes nothing and the banner stays', async () => {
  const { handlers, ipc, calls } = setup({ process: async () => false });
  ipc.check();
  const r = await handlers['recovery:recover']();
  assert.match(r.error, /Still working/);
  assert.equal(calls.finish, 0);
  assert.deepEqual(handlers['recovery:state'](), { seconds: 2, startedAt: 1000 });
});

test('Recover with nothing on offer answers without running anything', async () => {
  const { handlers, calls } = setup();
  const r = await handlers['recovery:recover']();
  assert.equal(typeof r.error, 'string');
  assert.equal(calls.transcribed.length, 0);
});

test('a second Recover click while the first runs does not transcribe twice', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { handlers, ipc, calls } = setup({ transcribe: async () => { await gate; return { text: 'x' }; } });
  ipc.check();
  const first = handlers['recovery:recover']();
  const second = await handlers['recovery:recover']();
  assert.equal(typeof second.error, 'string');
  release();
  await first;
  assert.equal(calls.added.length, 1);
});

test('Discard deletes the file and hides the banner', async () => {
  const { handlers, ipc, calls } = setup();
  ipc.check();
  await handlers['recovery:discard']();
  assert.equal(calls.finish, 1);
  assert.equal(handlers['recovery:state'](), null);
  assert.equal(calls.transcribed.length, 0);
});

test('Discard leaves the file alone when a new dictation is using it', async () => {
  let active = false;
  const { handlers, ipc, calls } = setup({ dictationActive: () => active });
  ipc.check();
  active = true; // the user started dictating before choosing: current.pcm is that dictation's now
  await handlers['recovery:discard']();
  assert.equal(calls.finish, 0);
  assert.equal(handlers['recovery:state'](), null);
});
