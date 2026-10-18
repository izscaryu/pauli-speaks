'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerPrivacyIpc } = require('../src/main/privacy-ipc');

const CATALOG = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper Tiny', kind: 'speech' },
  { id: 'Xenova/nllb-200-distilled-600M', label: 'Offline translator', kind: 'translator' },
];

function setup(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-privacy-ipc-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const models = path.join(root, 'models');
  for (const m of CATALOG) {
    fs.mkdirSync(path.join(models, ...m.id.split('/')), { recursive: true });
    fs.writeFileSync(path.join(models, ...m.id.split('/'), '.pauli-ready'), 'x');
    fs.writeFileSync(path.join(models, ...m.id.split('/'), 'model.onnx'), Buffer.alloc(2048));
  }
  const handlers = {};
  const calls = [];
  const deps = {
    catalog: () => CATALOG,
    modelsDir: () => models,
    dictationActive: () => false,
    unloadModels: async () => { calls.push('unload'); },
    afterModelsDeleted: () => { calls.push('after'); },
    deleteAll: () => { calls.push('deleteAll'); return { ok: true, errors: [] }; },
    audioBytes: (id) => (id === 'good' ? Buffer.from([1, 2, 3]) : null),
    log: { warn: (...a) => calls.push(['warn', ...a]) },
    ...over,
  };
  registerPrivacyIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, deps);
  return { handlers, calls, models };
}

test('registers the privacy channels', () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), ['history:audio', 'privacy:delete-all', 'privacy:delete-models', 'privacy:models']);
});

test('privacy:models lists what is on disk with the total size', async () => {
  const { handlers } = setup();
  const r = await handlers['privacy:models']();
  assert.deepEqual(r.models.map((m) => m.label), ['Whisper Tiny', 'Offline translator']);
  assert.equal(r.bytes, 2 * (2048 + 1));
});

test('privacy:delete-models unloads the engine, deletes the listed folders and tells main', async () => {
  const { handlers, calls, models } = setup();
  const r = await handlers['privacy:delete-models']();
  assert.equal(r.ok, true);
  assert.equal(r.removed.length, 2);
  assert.deepEqual(calls, ['unload', 'after']);
  assert.equal(fs.existsSync(path.join(models, 'onnx-community', 'whisper-tiny')), false);
});

test('privacy:delete-models refuses while a dictation is running', async () => {
  const { handlers, calls, models } = setup({ dictationActive: () => true });
  const r = await handlers['privacy:delete-models']();
  assert.equal(r.ok, false);
  assert.match(r.error, /dictation/i);
  assert.deepEqual(calls, []);
  assert.ok(fs.existsSync(path.join(models, 'onnx-community', 'whisper-tiny')));
});

test('privacy:delete-models with nothing downloaded is fine', async () => {
  const { handlers, models } = setup();
  fs.rmSync(models, { recursive: true });
  assert.deepEqual(await handlers['privacy:delete-models'](), { ok: true, removed: [], failed: [] });
});

test('privacy:delete-models reports a speech engine that will not stop, and deletes nothing', async () => {
  const { handlers, calls } = setup({ unloadModels: async () => { throw new Error('worker stuck'); } });
  const r = await handlers['privacy:delete-models']();
  assert.equal(r.ok, false);
  assert.match(r.error, /worker stuck/);
  assert.ok(!calls.includes('after'));
});

test('privacy:delete-all runs the deletion and reports it', async () => {
  const { handlers, calls } = setup();
  assert.deepEqual(await handlers['privacy:delete-all'](), { ok: true, errors: [] });
  assert.deepEqual(calls, ['deleteAll']);
});

test('privacy:delete-all passes on what failed', async () => {
  const { handlers } = setup({ deleteAll: () => ({ ok: false, errors: [{ part: 'audio', error: 'locked' }] }) });
  const r = await handlers['privacy:delete-all']();
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].part, 'audio');
});

test('history:audio gives the recording bytes, or null', async () => {
  const { handlers } = setup();
  const bytes = await handlers['history:audio']({}, 'good');
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(await handlers['history:audio']({}, 'missing'), null);
  assert.equal(await handlers['history:audio']({}, { not: 'a string' }), null);
});
