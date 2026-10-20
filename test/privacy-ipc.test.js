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
    retentionDrops: (r) => ({ keep: 0, '24h': 2, off: 5 })[r],
    audioBytes: (id) => (id === 'good' ? Buffer.from([1, 2, 3]) : null),
    log: { warn: (...a) => calls.push(['warn', ...a]) },
    ...over,
  };
  registerPrivacyIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, deps);
  return { handlers, calls, models };
}

test('registers the privacy channels', () => {
  const { handlers } = setup();
  assert.deepEqual(Object.keys(handlers).sort(), ['history:audio', 'privacy:delete-all', 'privacy:delete-model', 'privacy:delete-models', 'privacy:models', 'privacy:retention-drops']);
});

test('privacy:models lists what is on disk with the total size', async () => {
  const { handlers } = setup();
  const r = await handlers['privacy:models']();
  assert.deepEqual(r.models.map((m) => m.label), ['Whisper Tiny', 'Offline translator']);
  assert.equal(r.bytes, 2 * (2048 + 1));
  assert.ok(r.models.every((m) => !Number.isNaN(Date.parse(m.lastUsed))), 'when each was last loaded');
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

test('C4: privacy:delete-models refuses while a file is transcribed or a model downloads', async () => {
  for (const [over, re] of [[{ fileActive: () => true }, /file/i], [{ modelsBusy: () => true }, /download/i]]) {
    const { handlers, calls, models } = setup(over);
    const r = await handlers['privacy:delete-models']();
    assert.equal(r.ok, false);
    assert.match(r.error, re);
    assert.deepEqual(calls, []);
    assert.ok(fs.existsSync(path.join(models, 'onnx-community', 'whisper-tiny')));
  }
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

test('A6: privacy:delete-all refuses while a dictation is running, and deletes nothing', async () => {
  const { handlers, calls } = setup({ dictationActive: () => true });
  const r = await handlers['privacy:delete-all']();
  assert.equal(r.ok, false);
  assert.match(r.error, /dictation/i);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(calls, []);
});

test('B3: privacy:retention-drops says how many saved transcripts a retention deletes now', async () => {
  const { handlers } = setup();
  assert.equal(await handlers['privacy:retention-drops']({}, 'off'), 5);
  assert.equal(await handlers['privacy:retention-drops']({}, '24h'), 2);
  assert.equal(await handlers['privacy:retention-drops']({}, 'keep'), 0);
  assert.equal(await handlers['privacy:retention-drops']({}, 'nonsense'), 0);
  assert.equal(await handlers['privacy:retention-drops']({}, { not: 'a string' }), 0);
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

test('privacy:delete-model deletes one model, after unloading the engine, and leaves the others', async () => {
  const { handlers, calls, models } = setup();
  const r = await handlers['privacy:delete-model'](null, 'onnx-community/whisper-tiny');
  assert.deepEqual(r, { ok: true, removed: ['onnx-community/whisper-tiny'], failed: [] });
  assert.deepEqual(calls, ['unload', 'after']);
  assert.equal(fs.existsSync(path.join(models, 'onnx-community', 'whisper-tiny')), false);
  assert.ok(fs.existsSync(path.join(models, 'Xenova', 'nllb-200-distilled-600M')));
});

test('privacy:delete-model only deletes a model from the catalog that is on disk', async () => {
  const { handlers, calls, models } = setup();
  for (const id of ['../../etc', 'onnx-community', 42, null, 'onnx-community/whisper-small']) {
    assert.deepEqual(await handlers['privacy:delete-model'](null, id), { ok: true, removed: [], failed: [] }, String(id));
  }
  assert.deepEqual(calls, []);
  assert.ok(fs.existsSync(path.join(models, 'onnx-community', 'whisper-tiny')));
});

test('privacy:delete-model refuses while a dictation, a file or a download is running', async () => {
  for (const over of [{ dictationActive: () => true }, { fileActive: () => true }, { modelsBusy: () => true }]) {
    const { handlers, calls } = setup(over);
    const r = await handlers['privacy:delete-model'](null, 'onnx-community/whisper-tiny');
    assert.equal(r.ok, false);
    assert.deepEqual(calls, []);
  }
});
