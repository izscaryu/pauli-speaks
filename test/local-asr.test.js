'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LocalAsr, requestTimeoutMs, LOAD_IDLE_MS } = require('../src/main/asr/local-asr');

/** Workers that answer only when told to (`answer`). */
function fakeWorkers() {
  const workers = [];
  const fork = () => {
    const w = new EventEmitter();
    w.sent = [];
    w.killed = false;
    w.postMessage = (msg) => w.sent.push(msg);
    w.kill = () => {
      if (w.killed) return;
      w.killed = true;
      setImmediate(() => w.emit('exit', 1));
    };
    w.answer = (id, result) => w.emit('message', { id, ok: true, result });
    workers.push(w);
    return w;
  };
  return { fork, workers };
}

const seconds = (n) => new Float32Array(16000 * n);
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

test('limits: transcribe scales with the audio, vad is short, loads only time out when silent for long', () => {
  const short = requestTimeoutMs({ type: 'transcribe', audio: seconds(5) });
  const long = requestTimeoutMs({ type: 'transcribe', audio: seconds(120) });
  assert.ok(short >= 30_000 && short <= 60_000, `5 s of audio: ${short}`);
  assert.ok(long > short * 4, `2 min of audio: ${long}`);
  assert.ok(requestTimeoutMs({ type: 'vad-stream', samples: seconds(1) }) <= 10_000);
  assert.ok(requestTimeoutMs({ type: 'vad', audio: seconds(60) }) <= 15_000);
  assert.ok(requestTimeoutMs({ type: 'translate', text: 'hello there' }) <= 60_000);
  assert.equal(requestTimeoutMs({ type: 'load' }), LOAD_IDLE_MS);
  assert.equal(requestTimeoutMs({ type: 'load-translator' }), LOAD_IDLE_MS);
  assert.ok(LOAD_IDLE_MS >= 5 * 60_000);
});

test('a transcription the worker never answers is rejected within its limit, the worker is restarted and later requests work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const restarted = [];
  asr.on('restarted', (why) => restarted.push(why));

  const audio = seconds(5);
  const job = settle(asr.transcribe(audio, { model: 'm' }));
  t.mock.timers.tick(requestTimeoutMs({ type: 'transcribe', audio }) - 1);
  await new Promise(setImmediate);
  assert.equal(workers[0].killed, false, 'not before the limit');
  t.mock.timers.tick(1);
  const out = await job;
  assert.equal(out.ok, false);
  assert.match(out.e.message, /did not answer/);
  assert.equal(workers[0].killed, true);
  assert.deepEqual(restarted, ['timeout']);

  t.mock.timers.reset();
  await new Promise(setImmediate); // the old worker's exit comes late
  const next = asr.detectSpeech(seconds(1));
  assert.equal(workers.length, 2, 'a fresh worker');
  workers[1].answer(workers[1].sent[0].id, [{ start: 0, end: 100 }]);
  assert.deepEqual(await next, [{ start: 0, end: 100 }]);
  assert.deepEqual(restarted, ['timeout'], 'the killed worker exiting is not another restart');
});

test('the late exit of a restarted worker does not fail the new worker or its requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const stuck = settle(asr.vadStream('s1', seconds(1)));
  t.mock.timers.tick(requestTimeoutMs({ type: 'vad-stream', samples: seconds(1) }));
  assert.equal((await stuck).ok, false);

  const next = settle(asr.vadStream('s1', seconds(1))); // before the old worker has exited
  t.mock.timers.reset();
  await new Promise(setImmediate); // the old worker exits now
  workers[1].answer(workers[1].sent[0].id, { heardSpeech: true });
  assert.deepEqual(await next, { ok: true, v: { heardSpeech: true } });
});

test('a restart fails every request still waiting on the stuck worker, so nothing stays pending', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const vad = settle(asr.vadStream('s', seconds(1)));
  const load = settle(asr.load('m', 'auto'));
  t.mock.timers.tick(requestTimeoutMs({ type: 'vad-stream', samples: seconds(1) }));
  assert.equal((await vad).ok, false);
  const l = await load;
  assert.equal(l.ok, false);
  assert.match(l.e.message, /restarted/);
});

test('a queued transcription is timed from when the job before it finished', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const audio = seconds(5);
  const limit = requestTimeoutMs({ type: 'transcribe', audio });
  const first = asr.transcribe(audio, {});
  const second = settle(asr.transcribe(audio, {}));
  t.mock.timers.tick(limit - 1000);
  workers[0].answer(workers[0].sent[0].id, { text: 'one' });
  assert.deepEqual(await first, { text: 'one' });
  t.mock.timers.tick(limit - 1000); // the second job has run for less than its limit
  await new Promise(setImmediate);
  assert.equal(workers[0].killed, false);
  workers[0].answer(workers[0].sent[1].id, { text: 'two' });
  assert.deepEqual(await second, { ok: true, v: { text: 'two' } });
});

test('a model load keeps going while the worker reports progress, and times out once it falls silent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const load = settle(asr.load('m', 'auto'));
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(LOAD_IDLE_MS - 1000);
    workers[0].emit('message', { type: 'progress', progress: { model: 'm', status: 'progress', file: 'a', loaded: i, total: 10 } });
  }
  await new Promise(setImmediate);
  assert.equal(workers[0].killed, false, 'downloading for longer than the limit is fine');
  t.mock.timers.tick(LOAD_IDLE_MS);
  const out = await load;
  assert.equal(out.ok, false);
  assert.equal(workers[0].killed, true);
});

test('answered requests leave no timers running', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const p = asr.translate('hi', 'en', 'de');
  workers[0].answer(workers[0].sent[0].id, 'hallo');
  assert.equal(await p, 'hallo');
  t.mock.timers.tick(LOAD_IDLE_MS * 2);
  await new Promise(setImmediate);
  assert.equal(workers[0].killed, false);
});

test('a worker that crashes is reported as restarted too, and its requests fail', async () => {
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const restarted = [];
  asr.on('restarted', (why) => restarted.push(why));
  const p = settle(asr.transcribe(seconds(1), {}));
  workers[0].emit('exit', 3);
  assert.match((await p).e.message, /stopped unexpectedly/);
  assert.deepEqual(restarted, ['exit']);
});

test('dispose fails the requests still waiting, and the next request starts a fresh worker', async () => {
  const { fork, workers } = fakeWorkers();
  const asr = new LocalAsr('cache', { fork });
  const p = settle(asr.load('m', 'auto'));
  asr.dispose();
  assert.equal((await p).ok, false);
  assert.equal(workers[0].killed, true);
  asr.vadStream('s', seconds(1));
  assert.equal(workers.length, 2);
});
