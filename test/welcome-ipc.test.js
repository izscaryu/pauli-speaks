'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerWelcomeIpc } = require('../src/main/welcome-ipc');

const BASE = 'onnx-community/whisper-base';
const SMALL = 'onnx-community/whisper-small';
const BIG = 'onnx-community/whisper-large-v3-turbo';

const NVIDIA = { gpuDevice: [{ active: true, vendorId: 0x10de }] };

function setup(overrides = {}) {
  const handlers = {};
  const ipcMain = { handle(ch, fn) { handlers[ch] = fn; } };
  const calls = { update: [], gpu: 0, procs: 0, log: [] };
  const deps = {
    getSettings: () => ({ onboarded: true }),
    updateSettings: (patch) => { calls.update.push(patch); },
    systemLanguages: () => ['hr-HR', 'en-US'],
    gpuInfo: async () => { calls.gpu++; return NVIDIA; },
    processNames: async () => { calls.procs++; return []; },
    appVersion: () => '1.2.0',
    log: { warn: (...a) => calls.log.push(a) },
    ...overrides,
  };
  registerWelcomeIpc(ipcMain, deps);
  return { handlers, calls };
}

test('registers the three welcome channels', () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), ['welcome:finish', 'welcome:recommend', 'welcome:system']);
});

test('welcome:system maps locales to base language codes', async () => {
  const { handlers } = setup();
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.languages, ['hr', 'en']);
  assert.deepEqual(r.gpu, { usable: true, vendor: 'nvidia' });
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.recommendation, { model: BIG, reason: 'gpu' });
});

test('welcome:system degrades a throwing gpuInfo to an unusable GPU', async () => {
  const { handlers, calls } = setup({ gpuInfo: async () => { throw new Error('no gpu'); } });
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.gpu, { usable: false, vendor: null });
  assert.equal(r.recommendation.model, SMALL);
  assert.ok(calls.log.length > 0);
});

test('welcome:system survives a synchronously throwing gpuInfo', async () => {
  const { handlers } = setup({ gpuInfo: () => { throw new Error('boom'); } });
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.gpu, { usable: false, vendor: null });
});

test('welcome:system reports conflicting apps from process names', async () => {
  const { handlers } = setup({ processNames: async () => ['wispr flow.exe', 'explorer.exe'] });
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.conflicts, ['Wispr Flow']);
});

test('welcome:system degrades a failing processNames to no conflicts', async () => {
  const { handlers, calls } = setup({ processNames: async () => { throw new Error('tasklist'); } });
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.conflicts, []);
  assert.ok(calls.log.length > 0);
});

test('welcome:system survives a failing systemLanguages', async () => {
  const { handlers } = setup({ systemLanguages: () => { throw new Error('nope'); } });
  const r = await handlers['welcome:system']({});
  assert.deepEqual(r.languages, []);
});

test('the GPU result is computed once and reused by welcome:recommend', async () => {
  const { handlers, calls } = setup();
  await handlers['welcome:system']({});
  const r = await handlers['welcome:recommend']({}, { languages: ['en'] });
  assert.deepEqual(r, { model: BIG, reason: 'gpu' });
  assert.equal(calls.gpu, 1);
});

test('welcome:recommend without a GPU follows the languages', async () => {
  const { handlers } = setup({ gpuInfo: async () => ({ gpuDevice: [] }) });
  assert.equal((await handlers['welcome:recommend']({}, { languages: ['en'] })).model, BASE);
  assert.equal((await handlers['welcome:recommend']({}, { languages: ['en', 'de'] })).model, SMALL);
  assert.equal((await handlers['welcome:recommend']({}, { languages: [] })).model, SMALL);
});

test('welcome:recommend tolerates a missing or malformed payload', async () => {
  const { handlers } = setup({ gpuInfo: async () => ({ gpuDevice: [] }) });
  assert.equal((await handlers['welcome:recommend']({})).model, SMALL);
  assert.equal((await handlers['welcome:recommend']({}, { languages: 'en' })).model, SMALL);
  assert.equal((await handlers['welcome:recommend']({}, null)).model, SMALL);
});

test('welcome:finish marks onboarding done and returns public settings', async () => {
  const state = { onboarded: false };
  const { handlers, calls } = setup({
    updateSettings: (patch) => { calls.update.push(patch); Object.assign(state, patch); },
    getSettings: () => ({ ...state }),
  });
  const r = await handlers['welcome:finish']({});
  assert.deepEqual(calls.update, [{ onboarded: true, setupCard: false, lastSeenVersion: '1.2.0' }]);
  assert.equal(r.onboarded, true);
  assert.equal(r.lastSeenVersion, '1.2.0');
});
