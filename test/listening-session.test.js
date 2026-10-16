'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createListeningSession } = require('../src/main/listening-session');

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

const ON = { crashRecovery: true, autoStopSilence: 2, silenceDetection: true };

/** A recorder that grows by `n` samples per tick, a fake recovery file and a scripted VAD. */
function rig(t, { settings = ON, vadResults = [], handsFree = true, recoveryFails = null } = {}) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let length = 0;
  const froms = [];
  const calls = [];
  const vadCalls = [];
  const events = { silence: 0, vadErrors: [], recoveryErrors: [] };
  const recovery = {
    begin: (meta) => { if (recoveryFails === 'begin') throw new Error('no access'); calls.push(['begin', meta]); },
    append: (s) => { if (recoveryFails === 'append') throw new Error('disk full'); calls.push(['append', s.length, s[0]]); },
    finish: () => calls.push(['finish']),
  };
  const session = createListeningSession({
    settings,
    recovery,
    mode: 'dictate',
    now: () => 1234,
    intervalMs: 1000,
    requestTail: async (from) => {
      froms.push(from);
      return Float32Array.from({ length: Math.max(0, length - from) }, (_, i) => from + i);
    },
    vadStream: async (id, samples) => {
      vadCalls.push([id, samples.length]);
      const r = vadResults.shift();
      if (r instanceof Error) throw r;
      return r || { speechFrames: 0, silentMsSinceSpeech: 0, heardSpeech: false };
    },
    isHandsFree: () => handsFree,
    onSilence: () => { events.silence++; },
    onVadError: (err) => events.vadErrors.push(err.message),
    onRecoveryError: (err) => events.recoveryErrors.push(err.message),
  });
  return {
    session, froms, calls, vadCalls, events,
    async tick(n = 16000) {
      length += n;
      t.mock.timers.tick(1000);
      await settle();
    },
    setHandsFree(v) { handsFree = v; },
  };
}

test('vadAutoStop: only with auto-stop seconds and Silence detection on', () => {
  const make = (settings) => createListeningSession({ settings, requestTail: async () => new Float32Array(0) }).vadAutoStop;
  assert.equal(make(ON), true);
  assert.equal(make({ ...ON, autoStopSilence: 0 }), false);
  assert.equal(make({ ...ON, silenceDetection: false }), false);
});

test('nothing to do (crash recovery off, no VAD auto-stop): no tap at all', async (t) => {
  const r = rig(t, { settings: { crashRecovery: false, autoStopSilence: 0, silenceDetection: true } });
  r.session.start();
  await r.tick();
  await r.tick();
  await r.session.stop();
  r.session.end();
  assert.deepEqual(r.froms, []);
  assert.deepEqual(r.calls, []);
});

test('crash recovery: begin with the meta, append every chunk, top up with the final audio, finish at the end', async (t) => {
  const r = rig(t, { settings: { ...ON, autoStopSilence: 0 } });
  r.session.start();
  await r.tick();
  await r.tick(8000);
  await r.session.stop(); // final pull: nothing new
  const final = Float32Array.from({ length: 26000 }, (_, i) => i); // the recorder's last 2000 samples (flush)
  r.session.complete(final);
  r.session.end();
  assert.deepEqual(r.calls, [
    ['begin', { startedAt: 1234, mode: 'dictate' }],
    ['append', 16000, 0],
    ['append', 8000, 16000],
    ['append', 2000, 24000],
    ['finish'],
  ]);
  assert.deepEqual(r.vadCalls, [], 'no VAD when auto-stop is off');
});

test('crash recovery off: the file is never touched, the VAD still gets the audio', async (t) => {
  const r = rig(t, { settings: { ...ON, crashRecovery: false } });
  r.session.start();
  await r.tick();
  await r.session.stop();
  r.session.complete(new Float32Array(20000));
  r.session.end();
  assert.deepEqual(r.calls, []);
  assert.equal(r.vadCalls.length, 1);
});

test('auto-stop fires once, after speech, when the silence reaches the setting, while hands-free', async (t) => {
  const r = rig(t, {
    vadResults: [
      { speechFrames: 0, silentMsSinceSpeech: 5000, heardSpeech: false }, // long silence before any speech: no
      { speechFrames: 20, silentMsSinceSpeech: 0, heardSpeech: true },
      { speechFrames: 0, silentMsSinceSpeech: 1984, heardSpeech: true }, // just under 2 s
      { speechFrames: 0, silentMsSinceSpeech: 2016, heardSpeech: true },
      { speechFrames: 0, silentMsSinceSpeech: 3000, heardSpeech: true },
    ],
  });
  r.session.start();
  for (let i = 0; i < 3; i++) await r.tick();
  assert.equal(r.events.silence, 0);
  await r.tick();
  assert.equal(r.events.silence, 1);
  await r.tick();
  assert.equal(r.events.silence, 1, 'only once');
  const ids = new Set(r.vadCalls.map(([id]) => id));
  assert.equal(ids.size, 1, 'one VAD session per dictation');
  await r.session.stop();
});

test('a new dictation gets a new VAD session id', () => {
  const a = createListeningSession({ settings: ON, requestTail: async () => new Float32Array(0) });
  const b = createListeningSession({ settings: ON, requestTail: async () => new Float32Array(0) });
  assert.notEqual(a.vadSession, b.vadSession);
});

test('no auto-stop while not hands-free (holding the shortcut)', async (t) => {
  const r = rig(t, { handsFree: false, vadResults: [{ speechFrames: 0, silentMsSinceSpeech: 9000, heardSpeech: true }] });
  r.session.start();
  await r.tick();
  assert.equal(r.events.silence, 0);
  await r.session.stop();
});

test('a VAD error is reported once and the VAD is not asked again in that dictation', async (t) => {
  const r = rig(t, { vadResults: [new Error('model missing')] });
  r.session.start();
  await r.tick();
  await r.tick();
  await r.session.stop();
  assert.deepEqual(r.events.vadErrors, ['model missing']);
  assert.equal(r.vadCalls.length, 1);
  assert.deepEqual(r.calls.filter((c) => c[0] === 'append').length, 2, 'the crash file keeps being written');
});

test('after stop() the VAD gets nothing more and cannot stop the dictation', async (t) => {
  const r = rig(t, { vadResults: [{ speechFrames: 0, silentMsSinceSpeech: 9000, heardSpeech: true }] });
  r.session.start();
  const stopped = r.session.stop();
  await r.tick();
  await stopped;
  assert.equal(r.events.silence, 0);
  assert.equal(r.vadCalls.length, 0);
});

test('a crash file that cannot be written is reported once; dictation and VAD carry on', async (t) => {
  const r = rig(t, { recoveryFails: 'append' });
  r.session.start();
  await r.tick();
  await r.tick();
  await r.session.stop();
  r.session.complete(new Float32Array(40000));
  r.session.end();
  assert.deepEqual(r.events.recoveryErrors, ['disk full']);
  assert.equal(r.vadCalls.length, 2);
  assert.deepEqual(r.calls.map((c) => c[0]), ['begin', 'finish'], 'still finished, so a partial file is removed');
});

test('a crash file that cannot be started is reported and never written or finished', async (t) => {
  const r = rig(t, { recoveryFails: 'begin', settings: { ...ON, autoStopSilence: 0 } });
  r.session.start();
  await r.tick();
  await r.session.stop();
  r.session.end();
  assert.deepEqual(r.events.recoveryErrors, ['no access']);
  assert.deepEqual(r.calls, []);
});

test('a speech detector that never answers cannot hold up the end of a dictation', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let length = 0;
  const calls = [];
  const vadCalls = [];
  const session = createListeningSession({
    settings: ON,
    recovery: { begin: () => calls.push('begin'), append: (s) => calls.push(`append ${s.length}`), finish: () => calls.push('finish') },
    intervalMs: 1000,
    requestTail: async (from) => new Float32Array(Math.max(0, length - from)),
    vadStream: () => { vadCalls.push(1); return new Promise(() => {}); }, // a wedged worker
    isHandsFree: () => true,
  });
  session.start();
  length += 16000;
  t.mock.timers.tick(1000);
  await settle();
  length += 16000;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(vadCalls.length, 2, 'the tap kept pulling while the first VAD push hung');
  length += 4000;
  let timer;
  const result = await Promise.race([
    session.stop().then(() => 'stopped'),
    new Promise((r) => { timer = setTimeout(() => r('stuck'), 500); }),
  ]);
  clearTimeout(timer);
  assert.equal(result, 'stopped');
  session.complete(new Float32Array(37000));
  session.end();
  assert.deepEqual(calls, ['begin', 'append 16000', 'append 16000', 'append 4000', 'append 1000', 'finish']);
});

test('the tap reports its own failures through onError', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const errors = [];
  const session = createListeningSession({
    settings: { ...ON, autoStopSilence: 0 },
    recovery: { begin() {}, append() {}, finish() {} },
    intervalMs: 1000,
    requestTail: async () => { throw new Error('overlay gone'); },
    onError: (err) => errors.push(err.message),
  });
  session.start();
  t.mock.timers.tick(1000);
  await settle();
  await session.stop();
  assert.deepEqual(errors, ['overlay gone', 'overlay gone']);
});

test('end() without stop() (cancel): the file is finished at once and late chunks are ignored', async (t) => {
  const r = rig(t);
  r.session.start();
  await r.tick();
  r.session.end();
  await r.tick();
  assert.deepEqual(r.calls.map((c) => c[0]), ['begin', 'append', 'finish']);
  assert.equal(r.events.silence, 0);
});
