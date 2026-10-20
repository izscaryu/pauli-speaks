'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  words, wordErrors, pairClips, toMono16k, parseArgs, runBench, formatReport,
} = require('../scripts/bench');

test('words: lower case, punctuation gone, diacritics kept', () => {
  assert.deepEqual(words('Dobar dan, kako ste?  Hvala - "dobro".'), ['dobar', 'dan', 'kako', 'ste', 'hvala', 'dobro']);
  assert.deepEqual(words('Čovjek ŽIVI u Đakovu.'), ['čovjek', 'živi', 'u', 'đakovu']);
  assert.deepEqual(words("It's 3.5 o'clock"), ["it's", '3.5', "o'clock"]);
  assert.deepEqual(words(''), []);
});

test('wordErrors: substitutions, deletions and insertions against the reference', () => {
  assert.deepEqual(wordErrors('the cat sat on the mat', 'the cat sat on the mat'), { errors: 0, words: 6 });
  assert.deepEqual(wordErrors('the cat sat on the mat', 'the bat sat on mat'), { errors: 2, words: 6 });
  assert.deepEqual(wordErrors('a b', 'a b c d'), { errors: 2, words: 2 });
  assert.deepEqual(wordErrors('Dobar dan.', 'dobar dan'), { errors: 0, words: 2 }, 'case and punctuation do not count');
  assert.deepEqual(wordErrors('', 'extra'), { errors: 1, words: 0 });
});

test('pairClips: each clip.wav with its clip.txt; clips without a reference are listed apart', () => {
  const out = pairClips(['b.wav', 'a.WAV', 'a.txt', 'b.txt', 'c.wav', 'notes.md', 'd.txt']);
  assert.deepEqual(out.clips, [{ name: 'a', wav: 'a.WAV', txt: 'a.txt' }, { name: 'b', wav: 'b.wav', txt: 'b.txt' }]);
  assert.deepEqual(out.unmatched, ['c.wav']);
});

test('toMono16k: other sample rates are resampled to 16 kHz', () => {
  const same = new Float32Array([0, 0.5, 1]);
  assert.equal(toMono16k({ samples: same, sampleRate: 16000 }), same);
  const out = toMono16k({ samples: new Float32Array(48000).fill(0.25), sampleRate: 48000 });
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[100] - 0.25) < 1e-6);
});

test('parseArgs: the folder, engines, languages and the model folder', () => {
  const a = parseArgs(['C:\\rec', '--engines', 'whisper:small,whisper:large-v3-turbo', '--languages', 'hr', '--models', 'D:\\m']);
  assert.deepEqual(a, { folder: 'C:\\rec', engines: ['whisper:small', 'whisper:large-v3-turbo'], languages: ['hr'], models: 'D:\\m', acceleration: 'auto' });
  const d = parseArgs(['rec']);
  assert.deepEqual(d.engines, ['whisper:base']);
  assert.deepEqual(d.languages, []);
  assert.equal(d.models, null);
  assert.throws(() => parseArgs([]), /folder/);
  assert.deepEqual(parseArgs(['rec', '--cpu']).acceleration, 'cpu');
});

test('runBench: word error rate over all clips, real-time factor, cold and warm start', async () => {
  let now = 0;
  const clock = () => now;
  const heard = { a: 'dobar dan', b: 'kako ste vi' };
  const engine = {
    load: async () => { now += 2000; },
    transcribe: async (audio, opts) => { now += audio.length / 16; return { text: heard[opts.clip] }; }, // 1 ms per 16 samples = real time
  };
  const clips = [
    { name: 'a', audio: new Float32Array(16000 * 2), reference: 'Dobar dan.' },
    { name: 'b', audio: new Float32Array(16000 * 3), reference: 'Kako ste?' },
  ];
  const r = await runBench({ id: 'fake', engine, clips, languages: ['hr'], clock, transcribeOpts: (clip) => ({ clip: clip.name }) });
  assert.equal(r.id, 'fake');
  assert.equal(r.clips, 2);
  assert.equal(r.words, 4);
  assert.equal(r.errors, 1);
  assert.equal(r.wer, 0.25);
  assert.equal(r.loadMs, 2000);
  assert.equal(r.coldMs, 4000, 'load plus the first clip');
  assert.equal(r.warmMs, 3000, 'the other clips, each');
  assert.equal(r.rtf, 1);
  assert.deepEqual(r.perClip.map((c) => [c.name, c.errors]), [['a', 0], ['b', 1]]);
});

test('runBench: a failing clip is reported, not fatal', async () => {
  const engine = { load: async () => {}, transcribe: async () => { throw new Error('boom'); } };
  const r = await runBench({ id: 'x', engine, clips: [{ name: 'a', audio: new Float32Array(16000), reference: 'hi' }], clock: () => 0 });
  assert.equal(r.failed, 1);
  assert.equal(r.perClip[0].error, 'boom');
  assert.equal(r.wer, null);
});

test('formatReport: one line per engine with WER, RTF and start times', () => {
  const text = formatReport([
    { id: 'whisper:small', clips: 10, words: 200, errors: 22, wer: 0.11, rtf: 0.31, loadMs: 4100, coldMs: 6000, warmMs: 900, failed: 0 },
    { id: 'cloud', clips: 10, words: 200, errors: 10, wer: 0.05, rtf: 0.1, loadMs: 0, coldMs: 800, warmMs: 700, failed: 1 },
  ]);
  assert.match(text, /whisper:small\s+10\s+11\.0 %\s+0\.31\s+6\.0 s\s+0\.9 s/);
  assert.match(text, /cloud\s+10\s+5\.0 %.*1 failed/);
});
