'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPolishIpc, TEST_SENTENCE } = require('../src/main/polish-ipc');

function fakeIpc() {
  const handlers = new Map();
  return { handle: (channel, fn) => handlers.set(channel, fn), invoke: (channel, ...args) => handlers.get(channel)({}, ...args) };
}

function setup({ endpoint = { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', requireKey: false, model: 'qwen2.5:1.5b' }, chat, servers = [] } = {}) {
  const ipc = fakeIpc();
  const calls = [];
  let clock = 1000;
  registerPolishIpc(ipc, {
    polisher: { endpoint: () => endpoint },
    detectServers: async () => servers,
    chat: chat || (async (cfg, messages, opts) => { calls.push({ cfg, messages, opts }); clock += 640; return 'This is a test of the polish.'; }),
    now: () => clock,
  });
  return { ipc, calls };
}

test('polish:detect hands the window the servers found on this PC', async () => {
  const servers = [{ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', running: true, models: ['qwen2.5:1.5b'] }];
  assert.deepEqual(await setup({ servers }).ipc.invoke('polish:detect'), servers);
});

test('polish:test polishes a fixed sentence with the chosen model and says how long it took', async () => {
  const { ipc, calls } = setup();
  assert.deepEqual(await ipc.invoke('polish:test'), { ok: true, ms: 640, output: 'This is a test of the polish.' });
  assert.equal(calls[0].cfg.model, 'qwen2.5:1.5b');
  assert.match(calls[0].messages.at(-1).content, new RegExp(TEST_SENTENCE));
  assert.ok(calls[0].opts.signal, 'with a deadline (long enough for a model that still has to load)');
  assert.equal(calls[0].opts.requireKey, false);
});

test('polish:test says what is missing or what went wrong, in words', async () => {
  assert.deepEqual(await setup({ endpoint: { error: 'not-set-up' } }).ipc.invoke('polish:test'), { ok: false, error: 'Choose where AI polish runs and a model first.' });
  assert.deepEqual(await setup({ endpoint: { error: 'starting' } }).ipc.invoke('polish:test'), { ok: false, error: 'Foundry Local is starting. Try again in a moment.' });
  const failing = setup({ chat: async () => { throw new Error('fetch failed'); } });
  assert.deepEqual(await failing.ipc.invoke('polish:test'), { ok: false, error: 'fetch failed' });
});

// ---------------------------------------------------------------- Foundry Local

function foundrySetup(foundryOverrides = {}) {
  const ipc = fakeIpc();
  const calls = [];
  let endpoint = { error: 'starting' };
  const foundry = {
    catalog: async () => [{ id: 'qwen2.5-0.5b-instruct-generic-cpu:4', sizeMb: 822, cached: false, recommended: true }],
    download: async (id) => { calls.push(['download', id]); },
    cancel: async () => { calls.push(['cancel']); },
    remove: async (id) => { calls.push(['remove', id]); },
    start: async () => { calls.push(['start']); endpoint = { baseUrl: 'http://127.0.0.1:55545/v1', apiKey: '', requireKey: false, model: 'q' }; },
    ...foundryOverrides,
  };
  registerPolishIpc(ipc, {
    polisher: { endpoint: () => endpoint }, detectServers: async () => [], foundry,
    chat: async (cfg) => { calls.push(['chat', cfg.baseUrl]); return 'Polished.'; },
  });
  return { ipc, calls };
}

test('foundry:catalog lists the models offered; when Foundry Local can\'t start, the window gets the reason', async () => {
  assert.equal((await foundrySetup().ipc.invoke('foundry:catalog'))[0].recommended, true);
  const broken = foundrySetup({ catalog: async () => { throw new Error('Foundry Local runs on Windows x64 only'); } });
  assert.deepEqual(await broken.ipc.invoke('foundry:catalog'), { error: 'Foundry Local runs on Windows x64 only' });
});

test('foundry:download downloads the model the window names (after it asked the user); cancel stops it', async () => {
  const { ipc, calls } = foundrySetup();
  assert.deepEqual(await ipc.invoke('foundry:download', 'qwen2.5-0.5b-instruct-generic-cpu:4'), { ok: true });
  await ipc.invoke('foundry:cancel');
  assert.deepEqual(calls, [['download', 'qwen2.5-0.5b-instruct-generic-cpu:4'], ['cancel']]);
  const cancelled = foundrySetup({ download: async () => { throw Object.assign(new Error('aborted'), { code: 'AbortError' }); } });
  assert.deepEqual(await cancelled.ipc.invoke('foundry:download', 'x'), { ok: false, cancelled: true, error: 'aborted' });
});

test('foundry:remove deletes one downloaded model', async () => {
  const { ipc, calls } = foundrySetup();
  assert.deepEqual(await ipc.invoke('foundry:remove', 'qwen2.5-0.5b-instruct-generic-cpu:4'), { ok: true });
  assert.deepEqual(calls, [['remove', 'qwen2.5-0.5b-instruct-generic-cpu:4']]);
});

test('polish:test with Foundry Local not running yet starts it and then tests', async () => {
  const { ipc, calls } = foundrySetup();
  const out = await ipc.invoke('polish:test');
  assert.equal(out.ok, true);
  assert.deepEqual(calls, [['start'], ['chat', 'http://127.0.0.1:55545/v1']]);
});
