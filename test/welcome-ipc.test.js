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

test("What's new shows once across the pre-releases of a version and the release itself", () => {
  const state = { onboarded: true, lastSeenVersion: '1.1.3' };
  let version = '1.2.0-beta.1';
  const { handlers, calls } = setup({
    getSettings: () => ({ ...state }),
    updateSettings: (patch) => { calls.update.push(patch); Object.assign(state, patch); },
    changelog: () => CHANGELOG,
    appVersion: () => version,
  });
  assert.deepEqual(handlers['whatsnew:get']({}), { version: '1.2.0-beta.1', text: SECTION_1_2_0 });
  handlers['whatsnew:seen']({});
  assert.equal(state.lastSeenVersion, '1.2.0');
  for (version of ['1.2.0-beta.2', '1.2.0', '1.2.0+build.7']) assert.equal(handlers['whatsnew:get']({}), null, version);
  version = '1.3.0-beta.1';
  assert.equal(handlers['whatsnew:get']({}), null); // no 1.3.0 section in this changelog, but not because it was seen
  assert.notEqual(state.lastSeenVersion, '1.3.0');
});

test('a full pre-release version stored by an older build counts as its base version', () => {
  const get = (lastSeenVersion, appVersion) => setup({
    getSettings: () => ({ onboarded: true, lastSeenVersion }), changelog: () => CHANGELOG, appVersion: () => appVersion,
  }).handlers['whatsnew:get']({});
  assert.equal(get('1.2.0-beta.1', '1.2.0'), null);
  assert.equal(get('1.2.0-beta.1', '1.2.0-beta.2'), null);
  assert.deepEqual(get('1.1.3-beta.1', '1.2.0'), { version: '1.2.0', text: SECTION_1_2_0 });
});

test('finishing the welcome flow on a pre-release stores its base version', async () => {
  const { handlers, calls } = setup({ appVersion: () => '1.2.0-beta.3' });
  await handlers['welcome:finish']({});
  assert.equal(calls.update[0].lastSeenVersion, '1.2.0');
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

// ---------------------------------------------------------------- Settings → Backup

const { registerBackupIpc } = require('../src/main/welcome-ipc');
const { SETTINGS_VERSION } = require('../src/main/settings');

function backupSetup(t, { dialog = {}, data = {}, win = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  const ipcMain = { handle(ch, fn) { handlers[ch] = fn; } };
  const calls = { update: [], dialogArgs: [], log: [] };
  registerBackupIpc(ipcMain, {
    dialog: {
      showSaveDialog: async (...a) => { calls.dialogArgs.push(a); return dialog.save || { canceled: true }; },
      showOpenDialog: async (...a) => { calls.dialogArgs.push(a); return dialog.open || { canceled: true }; },
    },
    getWindow: () => win.value || null,
    getData: () => data,
    updateSettings: (patch) => { calls.update.push(patch); },
    appVersion: () => '1.2.0',
    log: { warn: (...a) => calls.log.push(a) },
  });
  return { handlers, calls, dir };
}

test('registers the backup channels', (t) => {
  const { handlers } = backupSetup(t);
  assert.deepEqual(Object.keys(handlers).sort(), ['backup:export', 'backup:import']);
});

test('backup:export writes the portable settings and never the API key', async (t) => {
  const probe = backupSetup(t);
  const file = path.join(probe.dir, 'out.json');
  const { handlers, calls } = backupSetup(t, {
    dialog: { save: { canceled: false, filePath: file } },
    data: { dictionary: [{ from: 'a', to: 'b' }], cloud: { apiKeyEnc: 'SECRET' }, apiKey: 'SECRET' },
  });
  assert.deepEqual(await handlers['backup:export'](), { ok: true });
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('SECRET'));
  const json = JSON.parse(text);
  assert.equal(json.app, 'pauli-speaks');
  assert.equal(json.settingsVersion, SETTINGS_VERSION);
  assert.equal(json.appVersion, '1.2.0');
  assert.deepEqual(json.settings, { dictionary: [{ from: 'a', to: 'b' }] });
  assert.equal(calls.dialogArgs[0].at(-1).defaultPath, 'pauli-speaks-settings.json');
  assert.deepEqual(calls.dialogArgs[0].at(-1).filters[0].extensions, ['json']);
});

test('backup:export passes the window to the dialog only when there is one', async (t) => {
  const win = { id: 'win' };
  const a = backupSetup(t, { win: { value: win } });
  await a.handlers['backup:export']();
  assert.equal(a.calls.dialogArgs[0].length, 2);
  assert.equal(a.calls.dialogArgs[0][0], win);
  const b = backupSetup(t);
  await b.handlers['backup:export']();
  assert.equal(b.calls.dialogArgs[0].length, 1);
});

test('a cancelled dialog changes nothing', async (t) => {
  const { handlers, calls } = backupSetup(t);
  assert.deepEqual(await handlers['backup:export'](), { ok: false, canceled: true });
  assert.deepEqual(await handlers['backup:import'](), { ok: false, canceled: true });
  assert.deepEqual(calls.update, []);
});

test('backup:export reports a file that cannot be written', async (t) => {
  const probe = backupSetup(t);
  const { handlers } = backupSetup(t, { dialog: { save: { canceled: false, filePath: path.join(probe.dir, 'missing-folder', 'x.json') } } });
  const r = await handlers['backup:export']();
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});

function importFrom(t, content) {
  const probe = backupSetup(t);
  const file = path.join(probe.dir, 'in.json');
  fs.writeFileSync(file, content);
  return backupSetup(t, { dialog: { open: { canceled: false, filePaths: [file] } } });
}

test('backup:import applies the patch of a valid backup', async (t) => {
  const backup = { app: 'pauli-speaks', settingsVersion: SETTINGS_VERSION, settings: { dictionary: [{ from: 'x', to: 'y' }], onboarded: false, cloud: { apiKeyEnc: 'k' } } };
  const { handlers, calls } = importFrom(t, JSON.stringify(backup));
  assert.deepEqual(await handlers['backup:import'](), { ok: true });
  assert.deepEqual(calls.update, [{ dictionary: [{ from: 'x', to: 'y' }] }]);
});

test('backup:import says so when the file is not JSON', async (t) => {
  const { handlers, calls } = importFrom(t, 'not json {');
  assert.deepEqual(await handlers['backup:import'](), { ok: false, error: "This isn't a Pauli Speaks backup." });
  assert.deepEqual(calls.update, []);
});

test('backup:import passes on the reason a backup is refused', async (t) => {
  const { handlers, calls } = importFrom(t, JSON.stringify({ app: 'pauli-speaks', settingsVersion: 99, settings: {} }));
  assert.deepEqual(await handlers['backup:import'](), { ok: false, error: 'This backup is from a newer Pauli Speaks. Update first.' });
  assert.deepEqual(calls.update, []);
});

test('backup:import reads a file that starts with a UTF-8 BOM', async (t) => {
  const backup = { app: 'pauli-speaks', settingsVersion: SETTINGS_VERSION, settings: { dictionary: [{ from: 'x', to: 'y' }] } };
  const { handlers, calls } = importFrom(t, `\uFEFF${JSON.stringify(backup)}`);
  assert.deepEqual(await handlers['backup:import'](), { ok: true });
  assert.deepEqual(calls.update, [{ dictionary: [{ from: 'x', to: 'y' }] }]);
});

test('backup:import refuses a file over 1 MB before reading it', async (t) => {
  const { handlers, calls } = importFrom(t, ' '.repeat(1024 * 1024 + 1));
  assert.deepEqual(await handlers['backup:import'](), { ok: false, error: 'This file is too big to be a Pauli Speaks backup.' });
  assert.deepEqual(calls.update, []);
});

test('backup:import reports a file that cannot be read', async (t) => {
  const probe = backupSetup(t);
  const { handlers, calls } = backupSetup(t, { dialog: { open: { canceled: false, filePaths: [path.join(probe.dir, 'nope.json')] } } });
  const r = await handlers['backup:import']();
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
  assert.deepEqual(calls.update, []);
});
