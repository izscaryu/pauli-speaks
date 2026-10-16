'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('registers the welcome and health channels', () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), [
    'health:state', 'model:redownload', 'welcome:finish', 'welcome:recommend', 'welcome:system', 'whatsnew:get', 'whatsnew:seen',
  ]);
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

// ---------------------------------------------------------------- health, What's new, Download again

const CHANGELOG = ['# Changelog', '', '## 1.2.0', '', '- Guided setup.', '- Health banners.', '', '## 1.1.3', '', '- Old.', ''].join('\n');
const SECTION_1_2_0 = ['- Guided setup.', '- Health banners.'].join('\n');

test('health:state reports the hook error and the running conflicting apps', async () => {
  const { handlers } = setup({ hookError: () => 'hook failed', processNames: async () => ['wispr flow.exe', 'chrome.exe'] });
  assert.deepEqual(await handlers['health:state']({}), { hookError: 'hook failed', conflicts: ['Wispr Flow'] });
});

test('health:state is clean when the hook started and nothing conflicts', async () => {
  const { handlers } = setup({ hookError: () => null });
  assert.deepEqual(await handlers['health:state']({}), { hookError: null, conflicts: [] });
});

test('health:state checks the processes again on every call', async () => {
  const { handlers, calls } = setup();
  await handlers['health:state']({});
  await handlers['health:state']({});
  assert.equal(calls.procs, 2);
});

test('whatsnew:get returns the section once for an onboarded user on a new version', () => {
  const { handlers } = setup({ getSettings: () => ({ onboarded: true, lastSeenVersion: '1.1.3' }), changelog: () => CHANGELOG });
  assert.deepEqual(handlers['whatsnew:get']({}), { version: '1.2.0', text: SECTION_1_2_0 });
});

test('whatsnew:get is null for a new install, a seen version or a missing section', () => {
  const log = () => CHANGELOG;
  const get = (settings, extra = {}) => setup({ getSettings: () => settings, changelog: log, ...extra }).handlers['whatsnew:get']({});
  assert.equal(get({ onboarded: false, lastSeenVersion: '' }), null);
  assert.equal(get({ onboarded: true, lastSeenVersion: '1.2.0' }), null);
  assert.equal(get({ onboarded: true, lastSeenVersion: '' }, { appVersion: () => '9.9.9' }), null);
  assert.equal(get({ onboarded: true, lastSeenVersion: '' }, { changelog: () => '' }), null);
});

test('whatsnew:get shows a pre-release the section of its base version', () => {
  const { handlers } = setup({
    getSettings: () => ({ onboarded: true, lastSeenVersion: '' }), changelog: () => CHANGELOG, appVersion: () => '1.2.0-beta.1',
  });
  assert.deepEqual(handlers['whatsnew:get']({}), { version: '1.2.0-beta.1', text: SECTION_1_2_0 });
});

test('whatsnew:seen stores the running app version, not what the window sends', () => {
  const { handlers, calls } = setup();
  handlers['whatsnew:seen']({}, '0.0.1');
  assert.deepEqual(calls.update, [{ lastSeenVersion: '1.2.0' }]);
});

function redownloadSetup({ status = 'error', model = SMALL, localModel = SMALL, preload } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-redownload-'));
  const modelFolder = path.join(dir, 'onnx-community', 'whisper-small');
  fs.mkdirSync(modelFolder, { recursive: true });
  fs.writeFileSync(path.join(modelFolder, '.pauli-ready'), 'x');
  const outside = path.join(dir, 'keep.txt');
  fs.writeFileSync(outside, 'keep');
  const preloads = [];
  const ctx = setup({
    getSettings: () => ({ onboarded: true, localModel, engine: 'local' }),
    modelsDir: () => dir,
    getModelState: () => ({ model, status }),
    preloadModel: preload || (async () => { preloads.push(1); }),
  });
  return { ...ctx, dir, modelFolder, outside, preloads, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('model:redownload removes only the failed model folder, then loads it again', async () => {
  const t = redownloadSetup();
  try {
    assert.deepEqual(await t.handlers['model:redownload']({}), { ok: true });
    assert.equal(fs.existsSync(t.modelFolder), false);
    assert.equal(fs.existsSync(t.outside), true);
    assert.equal(t.preloads.length, 1);
  } finally {
    t.cleanup();
  }
});

test('model:redownload does nothing unless the configured model is in the error state', async () => {
  for (const opts of [{ status: 'ready' }, { status: 'loading' }, { status: 'downloading' }, { model: BASE }]) {
    const t = redownloadSetup(opts);
    try {
      assert.equal((await t.handlers['model:redownload']({})).ok, false, JSON.stringify(opts));
      assert.equal(fs.existsSync(t.modelFolder), true);
      assert.equal(t.preloads.length, 0);
    } finally {
      t.cleanup();
    }
  }
});

test('model:redownload never deletes for a model id that is not in the list', async () => {
  for (const localModel of ['../..', '__proto__', 'constructor', 'onnx-community/whisper-small/../..']) {
    const t = redownloadSetup({ localModel, model: localModel });
    try {
      assert.equal((await t.handlers['model:redownload']({})).ok, false, localModel);
      assert.equal(fs.existsSync(t.dir), true);
      assert.equal(fs.existsSync(t.modelFolder), true);
      assert.equal(t.preloads.length, 0);
    } finally {
      t.cleanup();
    }
  }
});

test('model:redownload reports a folder that cannot be removed instead of throwing', async () => {
  const t = redownloadSetup();
  try {
    const { handlers, calls } = setup({
      getSettings: () => ({ localModel: SMALL }),
      modelsDir: () => t.dir,
      getModelState: () => ({ model: SMALL, status: 'error' }),
      preloadModel: async () => {},
      removeDir: () => { throw new Error('EBUSY'); },
    });
    const r = await handlers['model:redownload']({});
    assert.equal(r.ok, false);
    assert.match(r.error, /EBUSY/);
    assert.ok(calls.log.length >= 1);
  } finally {
    t.cleanup();
  }
});
