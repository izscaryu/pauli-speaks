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
