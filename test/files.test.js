'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFileTranscriber } = require('../src/main/files');

const RATE = 16000;
const tone = (seconds, level = 0.2) => new Float32Array(Math.round(RATE * seconds)).fill(level);

function rig({ busy = false, nllb = false, heard = (i) => ({ text: `part ${i}`, language: 'de' }), pieces = null } = {}) {
  const calls = { recognised: [], translated: [], progress: [] };
  const s = { translation: { target: 'en', quality: 'fast' }, removeFillers: true, capitalize: true, dictionary: [], voiceCommandsEnabled: true, voiceCommands: [] };
  let n = 0;
  const files = createFileTranscriber({
    settings: { get: () => s },
    dictationBusy: () => busy,
    needsNllb: () => nllb,
    recognisePiece: async (samples, fast) => { calls.recognised.push({ seconds: samples.length / RATE, fast }); return heard(n++); },
    translateText: async (text, source, target) => { calls.translated.push([text, source, target]); return `[${target}] ${text}`; },
    progress: (done, total) => calls.progress.push([done, total]),
    split: pieces ? () => pieces : undefined,
  });
  return { files, calls, s };
}

test('a file is transcribed piece by piece, with progress, into text and subtitle segments', async () => {
  const { files, calls } = rig({ pieces: [{ start: 0, samples: tone(2) }, { start: 2, samples: tone(3) }] });
  const r = await files.transcribe(tone(5));
  assert.deepEqual(calls.progress, [[0, 2], [1, 2], [2, 2]]);
  assert.equal(r.text, 'Part 0 Part 1');
  assert.deepEqual(r.segments, [{ start: 0, end: 2, text: 'Part 0' }, { start: 2, end: 5, text: 'Part 1' }]);
  assert.equal(r.language, 'de');
  assert.equal(r.translatedTo, null);
});

test('silent pieces are skipped', async () => {
  const { files, calls } = rig({ pieces: [{ start: 0, samples: tone(2, 0) }, { start: 2, samples: tone(1) }] });
  const r = await files.transcribe(tone(3));
  assert.equal(calls.recognised.length, 1);
  assert.equal(r.segments.length, 1);
});

test('translated into English by Whisper in one pass, or by the translator for other targets', async () => {
  const fast = rig({ pieces: [{ start: 0, samples: tone(1) }], heard: () => ({ text: 'hello', language: 'de', translatedTo: 'en' }) });
  const a = await fast.files.transcribe(tone(1), { translate: true });
  assert.equal(fast.calls.recognised[0].fast, true);
  assert.equal(fast.calls.translated.length, 0);
  assert.equal(a.translatedTo, 'en');

  const best = rig({ nllb: true, pieces: [{ start: 0, samples: tone(1) }] });
  best.s.translation.target = 'it';
  const b = await best.files.transcribe(tone(1), { translate: true });
  assert.equal(best.calls.recognised[0].fast, false);
  assert.deepEqual(best.calls.translated, [['part 0', 'de', 'it']]);
  assert.equal(b.text, '[it] part 0');
  assert.equal(b.translatedTo, 'it');
});

test('one file at a time, and not while dictating', async () => {
  const busy = rig({ busy: true });
  await assert.rejects(busy.files.transcribe(tone(1)), /Finish the current dictation/);

  let release;
  const gate = new Promise((r) => (release = r));
  const files = createFileTranscriber({
    settings: { get: () => ({ translation: { target: 'en', quality: 'fast' } }) }, dictationBusy: () => false, needsNllb: () => false,
    recognisePiece: async () => { await gate; return { text: 'x', language: 'en' }; },
    translateText: async (x) => x, progress() {}, split: () => [{ start: 0, samples: tone(1) }],
  });
  const first = files.transcribe(tone(1));
  assert.equal(files.busy, true);
  await assert.rejects(files.transcribe(tone(1)), /already being transcribed/);
  release();
  await first;
  assert.equal(files.busy, false);
});
