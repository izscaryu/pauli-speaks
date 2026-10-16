'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  baseLanguageCodes, classifyGpu, recommendModel, shouldOfferSmallerModel,
  KNOWN_CONFLICTS, parseTasklistCsv, findConflicts, shouldPreloadAtStartup,
} = require('../src/main/system-check');

const BASE = 'onnx-community/whisper-base';
const SMALL = 'onnx-community/whisper-small';
const BIG = 'onnx-community/whisper-large-v3-turbo';

test('baseLanguageCodes keeps order and dedupes', () => {
  assert.deepEqual(baseLanguageCodes(['hr-HR', 'en-US', 'en-GB', 42]), ['hr', 'en']);
});

test('baseLanguageCodes lower-cases and copes with bad input', () => {
  assert.deepEqual(baseLanguageCodes(['EN', 'de_DE', '', null]), ['en', 'de']);
  assert.deepEqual(baseLanguageCodes(undefined), []);
});

test('classifyGpu: NVIDIA is usable, Intel and Basic Render are not', () => {
  assert.deepEqual(classifyGpu({ gpuDevice: [{ active: true, vendorId: 0x10de }] }), { usable: true, vendor: 'nvidia' });
  assert.equal(classifyGpu({ gpuDevice: [{ active: true, vendorId: 0x8086 }] }).usable, false);
  assert.deepEqual(classifyGpu({ gpuDevice: [{ active: true, vendorId: 0x1414 }] }), { usable: false, vendor: 'other' });
  assert.deepEqual(classifyGpu(null), { usable: false, vendor: null });
});

test('classifyGpu: AMD is usable, the active device wins, the first is the fallback', () => {
  assert.deepEqual(classifyGpu({ gpuDevice: [{ vendorId: 0x1002 }] }), { usable: true, vendor: 'amd' });
  assert.deepEqual(
    classifyGpu({ gpuDevice: [{ vendorId: 0x8086 }, { active: true, vendorId: 0x10de }] }),
    { usable: true, vendor: 'nvidia' },
  );
  assert.deepEqual(
    classifyGpu({ gpuDevice: [{ vendorId: 0x8086 }, { vendorId: 0x10de }] }),
    { usable: false, vendor: 'intel' },
  );
});

test('classifyGpu: missing or empty device lists mean no GPU', () => {
  assert.deepEqual(classifyGpu({}), { usable: false, vendor: null });
  assert.deepEqual(classifyGpu({ gpuDevice: [] }), { usable: false, vendor: null });
  assert.deepEqual(classifyGpu({ gpuDevice: [{ active: true }] }), { usable: false, vendor: 'other' });
});

test('recommendModel follows the M2 table', () => {
  assert.equal(recommendModel({ languages: ['en'], gpu: { usable: false } }).model, BASE);
  assert.equal(recommendModel({ languages: ['hr'], gpu: { usable: false } }).model, SMALL);
  assert.equal(recommendModel({ languages: ['en', 'hr'], gpu: { usable: false } }).model, SMALL);
  assert.equal(recommendModel({ languages: [], gpu: { usable: false } }).model, SMALL);
  assert.equal(recommendModel({ languages: ['en'], gpu: { usable: true } }).model, BIG);
});

test('recommendModel reports why', () => {
  assert.equal(recommendModel({ languages: ['en'], gpu: { usable: true } }).reason, 'gpu');
  assert.equal(recommendModel({ languages: ['en'], gpu: { usable: false } }).reason, 'english');
  assert.equal(recommendModel({ languages: ['hr'], gpu: { usable: false } }).reason, 'other-languages');
  assert.equal(recommendModel({ languages: [], gpu: { usable: false } }).reason, 'other-languages');
});

test('shouldOfferSmallerModel only for Large Turbo running on the CPU', () => {
  assert.equal(shouldOfferSmallerModel({ model: BIG, status: 'ready', device: 'cpu' }), true);
  assert.equal(shouldOfferSmallerModel({ model: BIG, status: 'ready', device: 'dml' }), false);
  assert.equal(shouldOfferSmallerModel({ model: BIG, status: 'loading', device: null }), false);
  assert.equal(shouldOfferSmallerModel({ model: SMALL, status: 'ready', device: 'cpu' }), false);
});

test('parseTasklistCsv and findConflicts', () => {
  const csv = '"Wispr Flow.exe","1234","Console","1","90,000 K"\r\n"explorer.exe","2","Console","1","1 K"\r\n';
  assert.deepEqual(parseTasklistCsv(csv), ['wispr flow.exe', 'explorer.exe']);
  assert.deepEqual(findConflicts(['wispr flow.exe', 'wisprflow.exe', 'notepad.exe']), ['Wispr Flow']);
  assert.deepEqual(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.\r\n'), []);
});

test('findConflicts matches every known app once and ignores case and junk', () => {
  assert.deepEqual(
    findConflicts(['HANDY.EXE', 'Willow Voice.exe', 'superwhisper.exe', 42]),
    ['Superwhisper', 'Handy', 'Willow'],
  );
  assert.deepEqual(findConflicts([]), []);
  assert.deepEqual(findConflicts('not an array'), []);
});

test('KNOWN_CONFLICTS lists the four apps', () => {
  assert.deepEqual(KNOWN_CONFLICTS.map((c) => c.name), ['Wispr Flow', 'Superwhisper', 'Handy', 'Willow']);
});

test('the model ids exist in whisper-local MODELS', () => {
  const { MODELS } = require('../src/main/asr/whisper-local');
  const { MODEL_BASE, MODEL_SMALL, MODEL_LARGE_TURBO } = require('../src/main/system-check');
  for (const id of [MODEL_BASE, MODEL_SMALL, MODEL_LARGE_TURBO]) {
    assert.ok(MODELS.some((m) => m.id === id), id);
  }
});

test('the model loads at startup only for onboarded users on the local engine with the model on disk', () => {
  const onDisk = () => true;
  const notOnDisk = () => false;
  assert.equal(shouldPreloadAtStartup({ onboarded: false, engine: 'local', localModel: BASE }, onDisk), false);
  assert.equal(shouldPreloadAtStartup({ onboarded: true, engine: 'local', localModel: BASE }, onDisk), true);
  assert.equal(shouldPreloadAtStartup({ onboarded: true, engine: 'cloud', localModel: BASE }, onDisk), false);
  assert.equal(shouldPreloadAtStartup({ onboarded: 'true', engine: 'local', localModel: BASE }, onDisk), false);
  assert.equal(shouldPreloadAtStartup(undefined, onDisk), false);
});

test('a user who finished the flow early does not get a download at the next start', () => {
  const asked = [];
  const notOnDisk = (id) => (asked.push(id), false);
  assert.equal(shouldPreloadAtStartup({ onboarded: true, engine: 'local', localModel: BASE }, notOnDisk), false);
  assert.deepEqual(asked, [BASE]);
  // Truthy but not exactly true does not count, and a missing check never preloads.
  assert.equal(shouldPreloadAtStartup({ onboarded: true, engine: 'local', localModel: BASE }, () => 'yes'), false);
  assert.equal(shouldPreloadAtStartup({ onboarded: true, engine: 'local', localModel: BASE }), false);
});

test('baseLanguageCodes maps the Norwegian variants to no', () => {
  assert.deepEqual(baseLanguageCodes(['nb-NO', 'en-US']), ['no', 'en']);
  assert.deepEqual(baseLanguageCodes(['nn-NO', 'nb-NO', 'no']), ['no']);
});

test('redownloadPath maps a known model id to its folder under the models folder', () => {
  const path = require('node:path');
  const { redownloadPath } = require('../src/main/system-check');
  assert.equal(redownloadPath('C:/m', 'onnx-community/whisper-small'), path.join('C:/m', 'onnx-community', 'whisper-small'));
  assert.equal(redownloadPath('C:/m', BASE), path.join('C:/m', 'onnx-community', 'whisper-base'));
});

test('redownloadPath refuses anything that is not a known model id', () => {
  const { redownloadPath } = require('../src/main/system-check');
  for (const bad of ['../../x', '__proto__', 'constructor', 'onnx-community/whisper-small/../../x', '', undefined, null, 42, 'onnx-community/nllb']) {
    assert.equal(redownloadPath('C:/m', bad), null, String(bad));
  }
  assert.equal(redownloadPath('', 'onnx-community/whisper-small'), null);
  assert.equal(redownloadPath(undefined, 'onnx-community/whisper-small'), null);
});
