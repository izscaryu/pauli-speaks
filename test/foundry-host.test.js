'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFoundryHost, chatModels, RECOMMENDED } = require('../src/main/foundry/host');

/** A model as the SDK shows it. */
function fakeModel({ alias, id, task = 'chat-completion', sizeMb = 1000, cached = false, license = 'apache-2.0' }, log) {
  const m = {
    alias, id, isCached: cached, loaded: false,
    info: { task, fileSizeMb: sizeMb, license },
    async download(onProgress, signal) {
      log.push(['download', id]);
      for (const p of [10, 50, 100]) {
        if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        onProgress(p);
        await Promise.resolve();
      }
      m.isCached = true;
    },
    async load() { log.push(['load', id]); m.loaded = true; },
    async unload() { log.push(['unload', id]); m.loaded = false; },
    async isLoaded() { return m.loaded; },
    removeFromCache() { log.push(['remove', id]); m.isCached = false; },
  };
  return m;
}

function fakeSdk(models) {
  const log = [];
  const list = models.map((m) => fakeModel(m, log));
  let running = false;
  const manager = {
    catalog: {
      getModels: async () => list,
      getModelVariant: async (id) => { const m = list.find((x) => x.id === id); if (!m) throw new Error(`Model not found: ${id}`); return m; },
    },
    get isWebServiceRunning() { return running; },
    get urls() { return running ? ['http://127.0.0.1:55545'] : []; },
    startWebService() { log.push(['web', 'start']); running = true; },
    stopWebService() { log.push(['web', 'stop']); running = false; },
    dispose() { log.push(['dispose']); },
  };
  const configs = [];
  const sdk = { FoundryLocalManager: { create: (config) => { configs.push(config); return manager; } } };
  return { sdk, log, list, configs };
}

const CATALOG = [
  { alias: 'qwen2.5-1.5b', id: 'qwen2.5-1.5b-instruct-generic-cpu:4', sizeMb: 1822 },
  { alias: 'qwen2.5-0.5b', id: 'qwen2.5-0.5b-instruct-generic-cpu:4', sizeMb: 822, cached: true },
  { alias: 'phi-4-mini-reasoning', id: 'Phi-4-mini-reasoning-generic-cpu:3', sizeMb: 4628 },
  { alias: 'deepseek-r1-7b', id: 'deepseek-r1-distill-qwen-7b-generic-cpu:4', sizeMb: 6584 },
  { alias: 'whisper-small', id: 'openai-whisper-small-generic-cpu:4', task: 'automatic-speech-recognition', sizeMb: 438 },
  { alias: 'qwen3-embedding-0.6b', id: 'qwen3-embedding-0.6b-generic-cpu:1', task: 'embeddings', sizeMb: 495 },
  { alias: 'qwen2.5-14b', id: 'qwen2.5-14b-instruct-generic-cpu:4', sizeMb: 11325 },
  { alias: 'phi-4-mini', id: 'Phi-4-mini-instruct-generic-cpu:5', sizeMb: 4915, license: 'MIT' },
];

const host = (models = CATALOG) => {
  const f = fakeSdk(models);
  const progress = [];
  const h = createFoundryHost({ load: async () => f.sdk, config: { appName: 'pauli-speaks' }, onProgress: (p) => progress.push(p) });
  return { ...f, h, progress };
};

test('chatModels: chat models that answer quickly enough to polish, smallest first; no reasoning, speech, embedding or huge models', () => {
  const list = chatModels(CATALOG.map((m) => ({ ...m, task: m.task || 'chat-completion', cached: !!m.cached, license: m.license || 'apache-2.0' })));
  assert.deepEqual(list.map((m) => m.alias), ['qwen2.5-0.5b', 'qwen2.5-1.5b', 'phi-4-mini']);
  assert.deepEqual(list[0], { alias: 'qwen2.5-0.5b', id: 'qwen2.5-0.5b-instruct-generic-cpu:4', sizeMb: 822, cached: true, license: 'apache-2.0', recommended: true });
  assert.equal(list.filter((m) => m.recommended).length, 1);
  assert.equal(RECOMMENDED, 'qwen2.5-0.5b');
});

test('catalog: the SDK is started once, with our settings, and lists the chat models', async () => {
  const { h, configs } = host();
  const list = await h.handle({ type: 'catalog' });
  assert.equal(list.length, 3);
  await h.handle({ type: 'catalog' });
  assert.deepEqual(configs, [{ appName: 'pauli-speaks' }]);
});

test('download: progress goes to the window, the model ends up cached', async () => {
  const { h, progress, list } = host();
  await h.handle({ type: 'download', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' });
  assert.deepEqual(progress, [10, 50, 100].map((percent) => ({ id: 'qwen2.5-1.5b-instruct-generic-cpu:4', percent })));
  assert.equal(list[0].isCached, true);
});

test('download: only a model from the list can be downloaded, and a download can be cancelled', async () => {
  const { h } = host();
  await assert.rejects(h.handle({ type: 'download', id: 'Phi-4-mini-reasoning-generic-cpu:3' }), /not one of the models/);
  await assert.rejects(h.handle({ type: 'download', id: '../../evil' }), /not one of the models/);
  const pending = h.handle({ type: 'download', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' });
  await h.handle({ type: 'cancel' });
  await assert.rejects(pending, (err) => err.name === 'AbortError');
});

test('start: loads the chosen downloaded model and its web service on this PC; the URL is OpenAI-style', async () => {
  const { h, log } = host();
  assert.deepEqual(await h.handle({ type: 'start', id: 'qwen2.5-0.5b-instruct-generic-cpu:4' }), { url: 'http://127.0.0.1:55545/v1' });
  assert.deepEqual(log, [['load', 'qwen2.5-0.5b-instruct-generic-cpu:4'], ['web', 'start']]);
  await h.handle({ type: 'start', id: 'qwen2.5-0.5b-instruct-generic-cpu:4' });
  assert.equal(log.filter((l) => l[0] === 'web').length, 1, 'started once');
});

test('start: a model that is not downloaded is not downloaded behind the user\'s back', async () => {
  const { h, log } = host();
  await assert.rejects(h.handle({ type: 'start', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' }), (err) => err.code === 'not-downloaded');
  assert.deepEqual(log, []);
});

test('start with another model unloads the one before; stop and remove let go of everything', async () => {
  const { h, log, list } = host([...CATALOG.slice(0, 2).map((m) => ({ ...m, cached: true }))]);
  await h.handle({ type: 'start', id: 'qwen2.5-0.5b-instruct-generic-cpu:4' });
  await h.handle({ type: 'start', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' });
  assert.deepEqual(log.slice(2), [['unload', 'qwen2.5-0.5b-instruct-generic-cpu:4'], ['load', 'qwen2.5-1.5b-instruct-generic-cpu:4']]);
  await h.handle({ type: 'remove', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' });
  assert.equal(list[0].isCached, false);
  assert.ok(log.some((l) => l[0] === 'unload' && l[1] === 'qwen2.5-1.5b-instruct-generic-cpu:4'));
  await h.handle({ type: 'stop' });
  assert.deepEqual(log.at(-1), ['web', 'stop']);
});

test('an unknown request is an error, not a crash', async () => {
  const { h } = host();
  await assert.rejects(h.handle({ type: 'format-disk' }), /Unknown request/);
});

test('download progress is sent only when the whole percent changes', async () => {
  const f = fakeSdk(CATALOG);
  f.list[0].download = async (onProgress) => { for (const p of [1.1, 1.4, 1.9, 2.2, 2.4, 100]) onProgress(p); };
  const progress = [];
  const h = createFoundryHost({ load: async () => f.sdk, config: {}, onProgress: (p) => progress.push(p.percent) });
  await h.handle({ type: 'download', id: 'qwen2.5-1.5b-instruct-generic-cpu:4' });
  assert.deepEqual(progress, [1, 2, 100]);
});
