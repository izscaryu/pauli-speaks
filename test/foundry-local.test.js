'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createFoundryLocal } = require('../src/main/foundry-local');

/** A worker that records requests; the test answers them with reply(). */
function fakeFork() {
  const forks = [];
  const fork = (modulePath, options) => {
    const child = new EventEmitter();
    child.sent = [];
    child.killed = false;
    child.postMessage = (msg) => child.sent.push(msg);
    child.kill = () => { child.killed = true; child.emit('exit', 1); };
    child.reply = (i, answer) => child.emit('message', { id: child.sent[i].id, ...answer });
    forks.push({ modulePath, options, child });
    return child;
  };
  return { fork, forks };
}

function setup({ model = 'qwen2.5-0.5b-instruct-generic-cpu:4' } = {}) {
  const f = fakeFork();
  const progress = [];
  const used = [];
  const s = { polish: { provider: 'foundry', model } };
  const foundry = createFoundryLocal({
    fork: f.fork, workerPath: 'C:\\app\\src\\main\\foundry\\worker.js', modelsDir: 'C:\\data\\models', logsDir: 'C:\\data\\logs',
    getModel: () => s.polish.model, onProgress: (p) => progress.push(p), onUsed: () => used.push(Date.now()), log: { info() {}, warn() {} },
  });
  return { foundry, ...f, progress, s, used };
}

const tick = () => new Promise((r) => setImmediate(r));

test('the worker starts on the first request, with where models and logs go', async () => {
  const { foundry, forks } = setup();
  assert.equal(forks.length, 0, 'nothing runs until it is needed');
  const pending = foundry.catalog();
  assert.equal(forks.length, 1);
  assert.equal(forks[0].modulePath, 'C:\\app\\src\\main\\foundry\\worker.js');
  assert.deepEqual(JSON.parse(forks[0].options.env.PAULI_FOUNDRY), { modelsDir: 'C:\\data\\models', logsDir: 'C:\\data\\logs' });
  assert.equal(forks[0].options.serviceName, 'Pauli Speaks Foundry Local');
  forks[0].child.reply(0, { ok: true, result: [{ id: 'm' }] });
  assert.deepEqual(await pending, [{ id: 'm' }]);
});

test('start loads the model chosen in Settings once, and url() is its web service', async () => {
  const { foundry, forks } = setup();
  assert.equal(foundry.url(), null);
  const a = foundry.start();
  const b = foundry.start();
  const { child } = forks[0];
  assert.equal(child.sent.length, 1, 'one start, however often it is asked');
  assert.deepEqual([child.sent[0].type, child.sent[0].modelId], ['start', 'qwen2.5-0.5b-instruct-generic-cpu:4']);
  child.reply(0, { ok: true, result: { url: 'http://127.0.0.1:55545/v1' } });
  await Promise.all([a, b]);
  assert.equal(foundry.url(), 'http://127.0.0.1:55545/v1');
});

test('after the model is changed in Settings, url() is null until that one is started', async () => {
  const { foundry, forks, s } = setup();
  const started = foundry.start();
  forks[0].child.reply(0, { ok: true, result: { url: 'http://127.0.0.1:55545/v1' } });
  await started;
  s.polish.model = 'Phi-4-mini-instruct-generic-cpu:5';
  assert.equal(foundry.url(), null);
});

test('start without a model chosen does nothing', async () => {
  const { foundry, forks } = setup({ model: '' });
  await assert.rejects(foundry.start(), (err) => err.code === 'not-set-up');
  assert.equal(forks.length, 0);
});

test('download progress reaches the window; errors keep their code', async () => {
  const { foundry, forks, progress } = setup();
  const d = foundry.download('qwen2.5-1.5b-instruct-generic-cpu:4');
  const { child } = forks[0];
  assert.deepEqual([child.sent[0].type, child.sent[0].modelId], ['download', 'qwen2.5-1.5b-instruct-generic-cpu:4']);
  child.emit('message', { type: 'progress', progress: { id: 'qwen2.5-1.5b-instruct-generic-cpu:4', percent: 40 } });
  assert.deepEqual(progress, [{ id: 'qwen2.5-1.5b-instruct-generic-cpu:4', percent: 40 }]);
  child.reply(0, { ok: false, error: 'cancelled', code: 'AbortError' });
  await assert.rejects(d, (err) => err.message === 'cancelled' && err.code === 'AbortError');
});

test('the worker stopping fails what it was doing and forgets the URL; the next request starts a new one', async () => {
  const { foundry, forks } = setup();
  const started = foundry.start();
  forks[0].child.reply(0, { ok: true, result: { url: 'http://127.0.0.1:55545/v1' } });
  await started;
  const pending = foundry.catalog();
  forks[0].child.emit('exit', 3);
  await assert.rejects(pending, /stopped/);
  assert.equal(foundry.url(), null);
  foundry.catalog().catch(() => {});
  await tick();
  assert.equal(forks.length, 2);
});

test('dispose ends the worker (quit, or before its models are deleted)', async () => {
  const { foundry, forks } = setup();
  foundry.catalog().catch(() => {});
  foundry.dispose();
  assert.equal(forks[0].child.killed, true);
  assert.equal(foundry.url(), null);
  foundry.dispose(); // nothing running: fine
});

test('a finished download and every start mark the models folder as used (Settings lists it, with its size)', async () => {
  const { foundry, forks, used } = setup();
  const d = foundry.download('qwen2.5-0.5b-instruct-generic-cpu:4');
  forks[0].child.reply(0, { ok: true, result: { cached: true } });
  await d;
  assert.equal(used.length, 1);
  const st = foundry.start();
  forks[0].child.reply(1, { ok: true, result: { url: 'http://127.0.0.1:1/v1' } });
  await st;
  assert.equal(used.length, 2);
});

test('dispose waits until the worker has really exited, so its model files are free before they are deleted', async () => {
  const f = fakeFork();
  const foundry = createFoundryLocal({ fork: f.fork, workerPath: 'w.js', modelsDir: 'm', logsDir: 'l', getModel: () => 'x', onProgress() {}, log: { info() {}, warn() {} } });
  foundry.catalog().catch(() => {});
  const { child } = f.forks[0];
  child.kill = () => { child.killed = true; setTimeout(() => child.emit('exit', 1), 30); }; // a real process takes a moment
  let exited = false;
  const done = foundry.dispose().then(() => { exited = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(exited, false);
  await done;
  assert.equal(exited, true);
  await foundry.dispose(); // nothing running: resolves at once
});

test('busy while a download or a start is under way (Delete downloaded models waits for it)', async () => {
  const { foundry, forks } = setup();
  assert.equal(foundry.busy, false);
  const d = foundry.download('m');
  assert.equal(foundry.busy, true);
  forks[0].child.reply(0, { ok: true, result: { cached: true } });
  await d;
  assert.equal(foundry.busy, false);
});
