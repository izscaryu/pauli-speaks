'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');
const { Settings, DEFAULTS } = require('../src/main/settings');
const { sweepHistory, deleteAllData, modelsOnDisk, deleteModels, createPrivacy, DAY_MS } = require('../src/main/privacy');

const HOUR = 3600e3;
const NOW = Date.parse('2026-10-18T12:00:00Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();
const entry = (text) => ({ text, rawText: text, durationMs: 2000, words: 2, engine: 'base', language: 'en' });

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-privacy-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const diskItems = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ------------------------------------------------------------------ sweepHistory

test('sweepHistory keep: everything stays', () => {
  const items = [{ id: 'a', createdAt: at(1) }, { id: 'b', createdAt: at(500) }];
  assert.deepEqual(sweepHistory(items, 'keep', NOW), items);
});

test('sweepHistory 24h: items older than 24 hours go, newer ones stay', () => {
  const items = [{ id: 'new', createdAt: at(1) }, { id: 'edge', createdAt: at(23.9) }, { id: 'old', createdAt: at(24.1) }, { id: 'older', createdAt: at(100) }];
  assert.deepEqual(sweepHistory(items, '24h', NOW).map((i) => i.id), ['new', 'edge']);
  assert.equal(DAY_MS, 24 * HOUR);
});

test('sweepHistory 24h: an item whose time cannot be read is dropped', () => {
  assert.deepEqual(sweepHistory([{ id: 'x', createdAt: 'not a date' }, { id: 'y' }], '24h', NOW), []);
});

test('sweepHistory off: nothing is kept', () => {
  assert.deepEqual(sweepHistory([{ id: 'a', createdAt: at(0) }], 'off', NOW), []);
});

test('sweepHistory does not change the list it is given', () => {
  const items = [{ id: 'old', createdAt: at(100) }];
  sweepHistory(items, '24h', NOW);
  assert.equal(items.length, 1);
});

test('sweepHistory with an unknown retention keeps everything', () => {
  const items = [{ id: 'a', createdAt: at(100) }];
  assert.deepEqual(sweepHistory(items, 'weird', NOW), items);
});

// ------------------------------------------------------------------ History with a retention

test('retention off keeps the last item in memory only', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.setRetention('off');
  const item = history.add(entry('only in memory'));
  assert.equal(history.last(), item, 'Paste last / Undo last still have it');
  assert.equal(history.list().length, 1);
  assert.deepEqual(diskItems(file), []);
  assert.deepEqual(new History(file).list(), []);
});

test('retention off: a failed entry stays in memory only, and a retry that resolves it too', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.setRetention('off');
  const failed = history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' });
  assert.equal(history.list().length, 1);
  assert.deepEqual(diskItems(file), []);
  history.resolve(failed.id, entry('now text'));
  assert.equal(history.last().text, 'now text');
  assert.deepEqual(diskItems(file), []);
});

test("switching to 'off' removes what was saved, from the file and from the list", () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.add(entry('saved one'));
  history.add(entry('saved two'));
  assert.equal(diskItems(file).length, 2);
  history.setRetention('off');
  assert.deepEqual(diskItems(file), []);
  assert.deepEqual(history.list(), []);
  assert.equal(history.last(), null);
});

test("switching to 'off' keeps what was only in memory", () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.add(entry('saved'));
  history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' }, { persist: false });
  history.setRetention('off');
  assert.deepEqual(history.list().map((i) => i.status), ['failed']);
});

test("switching from 'off' back to 'keep' saves the dictations made from then on", () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.setRetention('off');
  history.add(entry('private'));
  history.setRetention('keep');
  history.add(entry('kept'));
  assert.deepEqual(diskItems(file).map((i) => i.text), ['kept']);
  assert.deepEqual(history.list().map((i) => i.text), ['kept', 'private']);
});

test('B3: wouldDrop counts what a retention would delete now, without deleting it', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.add(entry('new'));
  history.add(entry('old'));
  history.addFailed({ audioId: 'a1', durationMs: 1000, engine: 'x', error: 'boom' }, { persist: false });
  history.items[1].createdAt = at(30); // "old"
  history.items[2].createdAt = at(1);
  assert.equal(history.wouldDrop('keep', NOW), 0);
  assert.equal(history.wouldDrop('24h', NOW), 1);
  assert.equal(history.wouldDrop('off', NOW), 2, 'the saved ones; the one in memory stays');
  assert.equal(history.list().length, 3);
  assert.equal(diskItems(file).length, 2);
});

test('retention 24h: setRetention and sweep drop old items, in memory and on disk', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.add(entry('today'));
  history.add(entry('ancient'));
  history.items[0].createdAt = at(30); // "ancient"
  history.items[1].createdAt = at(1);
  history.setRetention('24h', NOW);
  assert.deepEqual(history.list().map((i) => i.text), ['today']);
  assert.deepEqual(diskItems(file).map((i) => i.text), ['today']);
  // later: the remaining item gets old
  history.sweep(NOW + 25 * HOUR);
  assert.deepEqual(history.list(), []);
  assert.deepEqual(diskItems(file), []);
});

test('sweep with nothing to drop does not rewrite or announce a change', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.setRetention('24h');
  history.add(entry('fresh'));
  let changes = 0;
  history.on('change', () => changes++);
  history.sweep();
  assert.equal(changes, 0);
});

test('an invalid retention is treated as keep', () => {
  const file = path.join(scratch(), 'history.json');
  const history = new History(file);
  history.setRetention('whatever');
  history.add(entry('kept'));
  assert.equal(diskItems(file).length, 1);
});

// ------------------------------------------------------------------ deleteAllData

test('deleteAllData calls each part and resets the settings', () => {
  const calls = [];
  const parts = {
    history: { clear: () => calls.push('history') },
    audioHistory: { clear: () => calls.push('audio') },
    recoveryFile: { finish: () => calls.push('recovery') },
    settings: { reset: () => calls.push('settings') },
    forgetInMemory: () => calls.push('memory'),
  };
  const out = deleteAllData(parts);
  assert.deepEqual(out, { ok: true, errors: [] });
  assert.deepEqual([...calls].sort(), ['audio', 'history', 'memory', 'recovery', 'settings']);
  assert.equal(calls[0], 'memory', 'kept recordings are forgotten while History still lists them');
});

test('deleteAllData goes on when one part fails, and says which', () => {
  const calls = [];
  const out = deleteAllData({
    history: { clear: () => { throw new Error('locked'); } },
    audioHistory: { clear: () => calls.push('audio') },
    recoveryFile: { finish: () => calls.push('recovery') },
    settings: { reset: () => calls.push('settings') },
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, [{ part: 'history', error: 'locked' }]);
  assert.deepEqual(calls, ['audio', 'recovery', 'settings']);
});

test('deleteAllData on real files: history emptied, recordings and leftover recording gone, settings reset', () => {
  const dir = scratch();
  const settings = new Settings(path.join(dir, 'settings.json'), { encrypt: (s) => s, decrypt: (s) => s });
  settings.update({ dictionary: [{ from: 'a', to: 'b' }], snippets: [{ trigger: 'x', text: 'y' }], onboarded: true, historyRetention: '24h', cloud: { apiKey: 'sk-test-key' } });
  assert.ok(settings.get().cloud.apiKeyEnc, 'a key is stored before');
  fs.writeFileSync(path.join(dir, 'settings.v4.json'), JSON.stringify({ dictionary: [{ from: 'old', to: 'copy' }] }));
  const history = new History(path.join(dir, 'history.json'));
  history.add(entry('secret words'));
  const { createAudioHistory } = require('../src/main/audio-history');
  const audioHistory = createAudioHistory(path.join(dir, 'audio'));
  audioHistory.save('11111111-1111-4111-8111-111111111111', new Float32Array(1600));
  const { createRecoveryFile } = require('../src/main/recovery-file');
  const recoveryFile = createRecoveryFile(path.join(dir, 'recovery'));
  recoveryFile.begin({ startedAt: 1, mode: 'dictate' });
  recoveryFile.append(new Float32Array(100));

  const out = deleteAllData({ history, audioHistory, recoveryFile, settings });

  assert.deepEqual(out, { ok: true, errors: [] });
  assert.deepEqual(diskItems(path.join(dir, 'history.json')), []);
  assert.equal(fs.existsSync(path.join(dir, 'audio')), false);
  assert.equal(fs.existsSync(path.join(dir, 'recovery', 'current.pcm')), false);
  assert.equal(fs.existsSync(path.join(dir, 'settings.v4.json')), false, 'the older copy of the settings is deleted too');
  const saved = diskItems(path.join(dir, 'settings.json'));
  assert.equal(saved.onboarded, false);
  assert.deepEqual(saved.dictionary, DEFAULTS.dictionary);
  assert.deepEqual(saved.snippets, []);
  assert.equal(saved.historyRetention, 'keep');
  assert.equal(saved.cloud.apiKeyEnc, '', 'the encrypted API key is gone from the file');
  assert.equal(settings.getApiKey(), '');
  assert.equal(settings.get().onboarded, false);
});

test('Settings.reset announces the change without asking for another model download', () => {
  const dir = scratch();
  const settings = new Settings(path.join(dir, 'settings.json'), { encrypt: (s) => s, decrypt: (s) => s });
  settings.update({ engine: 'cloud', localModel: 'onnx-community/whisper-small', launchAtLogin: true });
  const seen = [];
  settings.on('change', (data, patch) => seen.push(patch));
  settings.reset();
  assert.equal(settings.get().engine, 'local');
  assert.equal(seen.length, 1);
  for (const key of ['engine', 'localModel', 'acceleration', 'translation']) assert.equal(key in seen[0], false, `${key} must not be in the patch`);
  assert.equal(seen[0].launchAtLogin, false);
  assert.deepEqual(seen[0].bindings, DEFAULTS.bindings);
});

// ------------------------------------------------------------------ models on disk

function fakeModels(root) {
  for (const id of ['onnx-community/whisper-tiny', 'Xenova/nllb-200-distilled-600M']) {
    const dir = path.join(root, ...id.split('/'));
    fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.pauli-ready'), 'x');
    fs.writeFileSync(path.join(dir, 'onnx', 'model.onnx'), Buffer.alloc(1000));
  }
  // not ready (a download that never finished) and something that is not ours
  fs.mkdirSync(path.join(root, 'onnx-community', 'whisper-base'), { recursive: true });
  fs.writeFileSync(path.join(root, 'onnx-community', 'whisper-base', 'partial.bin'), 'x');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'keep me');
}
const CATALOG = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper Tiny', kind: 'speech' },
  { id: 'onnx-community/whisper-base', label: 'Whisper Base', kind: 'speech' },
  { id: 'Xenova/nllb-200-distilled-600M', label: 'Translator', kind: 'translator' },
];

test('modelsOnDisk lists the downloaded models with their size', () => {
  const root = path.join(scratch(), 'models');
  fakeModels(root);
  const list = modelsOnDisk(root, CATALOG);
  assert.deepEqual(list.map((m) => m.id), ['onnx-community/whisper-tiny', 'Xenova/nllb-200-distilled-600M']);
  assert.equal(list[0].bytes, 1000 + 1);
  assert.equal(list[0].label, 'Whisper Tiny');
});

test('modelsOnDisk of a folder that is not there is empty', () => {
  assert.deepEqual(modelsOnDisk(path.join(scratch(), 'nope'), CATALOG), []);
});

test('deleteModels removes only the listed model folders', () => {
  const root = path.join(scratch(), 'models');
  fakeModels(root);
  const out = deleteModels(root, modelsOnDisk(root, CATALOG));
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.removed.sort(), ['Xenova/nllb-200-distilled-600M', 'onnx-community/whisper-tiny']);
  assert.equal(fs.existsSync(path.join(root, 'onnx-community', 'whisper-tiny')), false);
  assert.equal(fs.existsSync(path.join(root, 'Xenova', 'nllb-200-distilled-600M')), false);
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(root, 'onnx-community', 'whisper-base', 'partial.bin')), 'a folder that was not listed stays');
});

test('deleteModels never leaves the models folder', () => {
  const root = path.join(scratch(), 'models');
  fs.mkdirSync(root, { recursive: true });
  const outside = path.join(path.dirname(root), 'precious.txt');
  fs.writeFileSync(outside, 'x');
  const out = deleteModels(root, [{ id: '../precious.txt', label: 'bad' }, { id: '', label: 'empty' }]);
  assert.deepEqual(out.removed, []);
  assert.equal(out.failed.length, 2);
  assert.ok(fs.existsSync(outside));
});

// ------------------------------------------------------------------ createPrivacy (what the settings do)

function privacySetup(initial = {}) {
  const calls = [];
  const state = { historyRetention: 'keep', audioHistory: 'off', ...initial };
  const history = {
    setRetention: (r) => calls.push(['setRetention', r]),
    sweep: () => calls.push(['historySweep']),
    list: () => [{ id: 'a' }, { id: 'b' }],
  };
  const audioHistory = {
    save: (id, audio) => calls.push(['save', id, audio.length]),
    sweep: (now, opts) => calls.push(['audioSweep', [...opts.keep]]),
    clear: () => calls.push(['clear']),
  };
  const timers = [];
  const fakeTimers = {
    setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; timers.push(t); return t; },
    clearInterval: (t) => { t.cleared = true; },
  };
  const privacy = createPrivacy({ history, audioHistory, getSettings: () => state, timers: fakeTimers, log: { warn: (...a) => calls.push(['warn', ...a]) } });
  return { privacy, calls, state, timers };
}

test('start applies the retention now and sweeps every hour', () => {
  const { privacy, calls, timers } = privacySetup({ historyRetention: '24h', audioHistory: '24h' });
  privacy.start();
  assert.deepEqual(calls, [['setRetention', '24h'], ['audioSweep', ['a', 'b']]]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, HOUR);
  calls.length = 0;
  timers[0].fn();
  assert.deepEqual(calls, [['historySweep'], ['audioSweep', ['a', 'b']]]);
  privacy.stop();
  assert.equal(timers[0].cleared, true);
});

test('at start with recordings off, any recordings left over are cleared', () => {
  const { privacy, calls } = privacySetup();
  privacy.start();
  assert.deepEqual(calls, [['setRetention', 'keep'], ['clear']]);
});

test('a changed historyRetention is applied at once', () => {
  const { privacy, calls, state } = privacySetup();
  state.historyRetention = 'off';
  privacy.apply({ historyRetention: 'off' });
  assert.deepEqual(calls, [['setRetention', 'off']]);
});

test('A5: a changed historyRetention sweeps the recordings of the entries it dropped at once (recordings on)', () => {
  const { privacy, calls, state } = privacySetup({ audioHistory: '24h' });
  state.historyRetention = 'off';
  privacy.apply({ historyRetention: 'off' });
  assert.deepEqual(calls, [['setRetention', 'off'], ['audioSweep', ['a', 'b']]]);
});

test('turning recordings off deletes them all; turning them on does not', () => {
  const { privacy, calls, state } = privacySetup({ audioHistory: '24h' });
  state.audioHistory = 'off';
  privacy.apply({ audioHistory: 'off' });
  assert.deepEqual(calls, [['clear']]);
  calls.length = 0;
  state.audioHistory = '24h';
  privacy.apply({ audioHistory: '24h' });
  assert.deepEqual(calls, []);
});

test('an unrelated setting changes nothing', () => {
  const { privacy, calls } = privacySetup();
  privacy.apply({ sounds: false });
  assert.deepEqual(calls, []);
});

test('saveRecording saves only when recordings are on, and never throws', () => {
  const { privacy, calls, state } = privacySetup();
  privacy.saveRecording('id-1', new Float32Array(10));
  assert.deepEqual(calls, []);
  state.audioHistory = '24h';
  privacy.saveRecording('id-1', new Float32Array(10));
  assert.deepEqual(calls, [['save', 'id-1', 10]]);
});

test('saveRecording logs a failure without the audio and carries on', () => {
  const calls = [];
  const privacy = createPrivacy({
    history: { list: () => [] },
    audioHistory: { save: () => { throw new Error('disk full'); } },
    getSettings: () => ({ audioHistory: '24h' }),
    log: { warn: (...a) => calls.push(a) },
  });
  assert.doesNotThrow(() => privacy.saveRecording('id', new Float32Array(1)));
  assert.equal(calls.length, 1);
  assert.match(calls[0].join(' '), /disk full/);
});

test('savedRecording turns a saved WAV back into audio plus the way it was recorded', () => {
  const { createAudioHistory } = require('../src/main/audio-history');
  const dir = scratch();
  const history = new History(path.join(dir, 'history.json'));
  const audioHistory = createAudioHistory(path.join(dir, 'audio'));
  const privacy = createPrivacy({ history, audioHistory, getSettings: () => ({ audioHistory: '24h' }) });
  const item = history.add({ ...entry('hello'), app: 'chrome.exe' });
  privacy.saveRecording(item.id, new Float32Array(3200).fill(0.25));
  const saved = privacy.savedRecording(item.id);
  assert.equal(saved.audio.length, 3200);
  assert.ok(Math.abs(saved.audio[10] - 0.25) < 1e-3);
  assert.deepEqual(saved.meta, { durationMs: 2000, engine: 'base', command: false, translate: false, app: { exe: 'chrome.exe' } });
  assert.equal(privacy.savedRecording('nope'), null);
  const noAudio = history.add(entry('no recording'));
  assert.equal(privacy.savedRecording(noAudio.id), null);
});
