'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhisperEngine } = require('../src/main/asr/engines/whisper');
const { createCloudEngine } = require('../src/main/asr/engines/cloud');
const { createEngines } = require('../src/main/asr/engines');
const { MODELS } = require('../src/main/asr/whisper-local');

const audio = new Float32Array(16000);

function whisperRig({ loadError = null } = {}) {
  const calls = [];
  const asr = {
    transcribe: async (a, opts) => { calls.push(['transcribe', opts]); return { text: 'hi', language: 'en' }; },
    stop: () => calls.push(['stop']),
  };
  const engine = createWhisperEngine({
    asr,
    options: () => ({ model: 'onnx-community/whisper-small', acceleration: 'auto' }),
    ensureLoaded: async () => { calls.push(['load']); if (loadError) throw new Error(loadError); },
  });
  return { engine, calls };
}

test('every engine has the same shape', () => {
  const engines = [whisperRig().engine, createCloudEngine({ options: () => ({}) })];
  for (const e of engines) {
    assert.equal(typeof e.id, 'string');
    assert.equal(typeof e.label, 'string');
    assert.ok(e.languages === null || Array.isArray(e.languages), `${e.id}: languages`);
    assert.ok(Array.isArray(e.sizes), `${e.id}: sizes`);
    for (const fn of ['load', 'transcribe', 'dispose']) assert.equal(typeof e[fn], 'function', `${e.id}.${fn}`);
  }
});

test('Whisper: the model is loaded first, then the speech goes to the worker with the model, languages, prompt and task', async () => {
  const { engine, calls } = whisperRig();
  const r = await engine.transcribe(audio, { languages: ['hr'], prompt: 'Pauli Speaks.', task: 'translate', timestamps: true });
  assert.deepEqual(r, { text: 'hi', language: 'en' });
  assert.deepEqual(calls, [
    ['load'],
    ['transcribe', { model: 'onnx-community/whisper-small', acceleration: 'auto', languages: ['hr'], prompt: 'Pauli Speaks.', task: 'translate', timestamps: true }],
  ]);
  assert.equal(engine.id, 'local');
  assert.deepEqual(engine.sizes, MODELS);
});

test('Whisper: a model that fails to load fails the transcription with its message', async () => {
  const { engine, calls } = whisperRig({ loadError: 'Model failed to load: boom' });
  await assert.rejects(engine.transcribe(audio, {}), /boom/);
  assert.deepEqual(calls, [['load']]);
});

test('Whisper: dispose stops the worker', () => {
  const { engine, calls } = whisperRig();
  engine.dispose();
  assert.deepEqual(calls, [['stop']]);
});

function cloudRig() {
  const calls = [];
  const engine = createCloudEngine({
    options: () => ({ baseUrl: 'https://api.example.test/v1', apiKey: 'k', model: 'whisper-large-v3-turbo' }),
    transcribeCloud: async (a, opts) => { calls.push(['transcribe', opts]); return { text: 'hi', language: 'hr' }; },
    translateCloud: async (a, opts) => { calls.push(['translate', opts]); return { text: 'hi', language: null, translatedTo: 'en' }; },
  });
  return { engine, calls };
}

test('Cloud: transcribe sends the languages and prompt, and asks again in your languages for dictation only', async () => {
  const { engine, calls } = cloudRig();
  await engine.transcribe(audio, { languages: ['hr', 'en'], prompt: 'P.', task: 'transcribe' });
  await engine.transcribe(audio, { languages: ['hr'], prompt: '', task: 'transcribe', timestamps: true });
  const base = { baseUrl: 'https://api.example.test/v1', apiKey: 'k', model: 'whisper-large-v3-turbo' };
  assert.deepEqual(calls, [
    ['transcribe', { ...base, languages: ['hr', 'en'], prompt: 'P.', retryOutsideList: true }],
    ['transcribe', { ...base, languages: ['hr'], prompt: '', retryOutsideList: false }],
  ]);
});

test('Cloud: the translate task goes to the translations endpoint', async () => {
  const { engine, calls } = cloudRig();
  const r = await engine.transcribe(audio, { languages: ['hr'], task: 'translate' });
  assert.equal(r.translatedTo, 'en');
  assert.equal(calls[0][0], 'translate');
});

test('Cloud: nothing to load or dispose', async () => {
  const { engine, calls } = cloudRig();
  await engine.load();
  engine.dispose();
  assert.deepEqual(calls, []);
});

test('createEngines: picks the engine by id, Whisper for anything unknown, and lists them', () => {
  const whisper = whisperRig().engine;
  const cloud = cloudRig().engine;
  const engines = createEngines([whisper, cloud]);
  assert.equal(engines.get('cloud'), cloud);
  assert.equal(engines.get('local'), whisper);
  assert.equal(engines.get('parakeet'), whisper);
  assert.equal(engines.get(undefined), whisper);
  assert.deepEqual(engines.list().map((e) => e.id), ['local', 'cloud']);
});
