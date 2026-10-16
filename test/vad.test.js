'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODEL = path.join(__dirname, '..', 'assets', 'models', 'silero_vad.onnx');
const FIXTURE = path.join(__dirname, 'fixtures', 'vad-speech.wav');
const SAMPLE_RATE = 16000;
const haveModel = fs.existsSync(MODEL);
const skip = haveModel ? false : 'assets/models/silero_vad.onnx is missing';

/** Minimal WAV reader: PCM 16-bit mono only, returns Float32Array in [-1, 1). */
function readWav(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      assert.deepEqual(fmt, { format: 1, channels: 1, rate: SAMPLE_RATE, bits: 16 });
      const n = Math.floor(Math.min(size, buf.length - body) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + i * 2) / 32768;
      return out;
    }
    at = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function makeVad() {
  const { createVad } = require('../src/main/asr/vad');
  return createVad({ modelBuffer: fs.readFileSync(MODEL), ort: require('onnxruntime-node') });
}

test('3 s of silence: no speech segments', { skip }, async () => {
  const vad = makeVad();
  const segments = await vad.detect(new Float32Array(3 * SAMPLE_RATE));
  assert.deepEqual(segments, []);
});

test('probabilities: one value per 512-sample frame, never NaN, quiet frames are 0', { skip }, async () => {
  const vad = makeVad();
  const audio = new Float32Array(512 * 4 + 100); // the partial last frame counts as a frame
  audio.fill(0.0005, 0, 512); // below the energy floor
  const probs = await vad.probabilities(audio);
  assert.equal(probs.length, 5);
  for (const p of probs) assert.ok(p === 0, `expected 0, got ${p}`);
});

// The fixture (scripts/make-vad-fixture.ps1) is 1 s of silence, a Windows voice saying
// "Testing one two three", then 1.5 s of silence. The voice adds its own short lead-in and
// about 0.8 s of trailing silence, so the file is 4.58 s and the voice is audible from
// 1.09 s to 2.30 s. Detected (with the 200 ms / 300 ms padding): about 0.95 s to 2.60 s.
// Bounds: start 0.7-1.2 s, end 2.3-3.0 s.
test('the generated recording: exactly one speech segment around the words', { skip }, async () => {
  const vad = makeVad();
  const audio = readWav(FIXTURE);
  const segments = await vad.detect(audio);
  assert.equal(segments.length, 1, JSON.stringify(segments));
  const [{ start, end }] = segments;
  assert.ok(start >= 0.7 * SAMPLE_RATE && start <= 1.2 * SAMPLE_RATE, `start ${start / SAMPLE_RATE}s`);
  assert.ok(end >= 2.3 * SAMPLE_RATE && end <= 3.0 * SAMPLE_RATE, `end ${end / SAMPLE_RATE}s`);
});

test('stream fed 1 s chunks: heard speech, then at least 1 s without it', { skip }, async () => {
  const vad = makeVad();
  const audio = readWav(FIXTURE);
  const stream = vad.createStream();
  let result;
  let speechFrames = 0;
  for (let at = 0; at < audio.length; at += SAMPLE_RATE) {
    result = await stream.push(audio.slice(at, at + SAMPLE_RATE));
    speechFrames += result.speechFrames;
  }
  assert.equal(result.heardSpeech, true);
  assert.ok(result.silentMsSinceSpeech >= 1000, `silentMsSinceSpeech ${result.silentMsSinceSpeech}`);
  assert.ok(speechFrames > 0);
});

test('stream: frames split across pushes are buffered until a full frame arrives', { skip }, async () => {
  const vad = makeVad();
  const stream = vad.createStream();
  const first = await stream.push(new Float32Array(300));
  assert.deepEqual(first, { speechFrames: 0, silentMsSinceSpeech: 0, heardSpeech: false });
  const second = await stream.push(new Float32Array(300)); // 600 samples: one 512 frame, 88 carried over
  assert.equal(second.heardSpeech, false);
  assert.equal(second.speechFrames, 0);
});

test('model feeding: quiet frames skip the model, loud ones get 64 samples of context, NaN output reads as 0', async () => {
  const { createVad, ENERGY_FLOOR } = require('../src/main/asr/vad');
  assert.equal(ENERGY_FLOOR, 0.0015);
  const calls = [];
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }
  const ort = {
    Tensor,
    InferenceSession: {
      create: async () => ({
        run: async (feeds) => {
          calls.push({
            input: Float32Array.from(feeds.input.data),
            dims: feeds.input.dims,
            state: feeds.state.dims,
            stateData: Float32Array.from(feeds.state.data),
            sr: feeds.sr,
          });
          return { output: { data: Float32Array.of(NaN) }, stateN: { data: new Float32Array(256).fill(NaN) } };
        },
      }),
    },
  };
  const vad = createVad({ modelBuffer: Buffer.alloc(0), ort });
  const audio = new Float32Array(512 * 3);
  audio.fill(0.001, 0, 512); // quiet: below the floor
  audio.fill(0.25, 512, 1024);
  audio.fill(0.5, 1024);
  const probs = await vad.probabilities(audio);
  assert.deepEqual(Array.from(probs), [0, 0, 0]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].dims, [1, 576]);
  assert.deepEqual(calls[0].state, [2, 1, 128]);
  assert.equal(calls[0].sr.type, 'int64');
  assert.deepEqual(calls[0].sr.dims, []);
  assert.equal(calls[0].sr.data[0], 16000n);
  assert.ok(Math.abs(calls[0].input[0] - 0.001) < 1e-9, 'context = end of the quiet frame');
  assert.ok(Math.abs(calls[0].input[64] - 0.25) < 1e-9);
  assert.ok(Math.abs(calls[1].input[0] - 0.25) < 1e-9, 'context = end of the previous frame');
  assert.ok(Math.abs(calls[1].input[575] - 0.5) < 1e-9);
  assert.ok(calls[1].stateData.every((v) => v === 0), 'a NaN state is reset to zeros');
});

test('a broken model buffer rejects instead of throwing synchronously', { skip }, async () => {
  const { createVad } = require('../src/main/asr/vad');
  const vad = createVad({ modelBuffer: Buffer.from('not a model'), ort: require('onnxruntime-node') });
  await assert.rejects(vad.detect(new Float32Array(SAMPLE_RATE).fill(0.1)));
});

/** Loads asr-worker.js against a fake parentPort; send() resolves with the worker's reply. */
function loadWorker() {
  const { EventEmitter } = require('node:events');
  const port = new EventEmitter();
  const replies = new Map();
  port.postMessage = (msg) => {
    if (msg.type === 'progress') return;
    replies.get(msg.id)?.(msg);
  };
  const saved = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { value: port, configurable: true });
  const file = require.resolve('../src/main/asr/asr-worker');
  delete require.cache[file];
  try {
    require(file);
  } finally {
    if (saved) Object.defineProperty(process, 'parentPort', saved);
    else delete process.parentPort;
  }
  let nextId = 1;
  return (data) =>
    new Promise((resolve) => {
      const id = nextId++;
      replies.set(id, resolve);
      port.emit('message', { data: { ...data, id, cacheDir: path.join(__dirname, 'no-models-here') } });
    });
}

test('worker: vad and vad-stream messages, a new session id starts a fresh stream', { skip }, async () => {
  const send = loadWorker();
  const audio = readWav(FIXTURE);
  const detected = await send({ type: 'vad', audio });
  assert.equal(detected.ok, true, detected.error);
  assert.equal(detected.result.length, 1);

  const first = await send({ type: 'vad-stream', session: 'a', samples: audio.slice(16000, 32000) });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.heardSpeech, true);
  const same = await send({ type: 'vad-stream', session: 'a', samples: new Float32Array(16000) });
  assert.equal(same.result.heardSpeech, true);
  assert.ok(same.result.silentMsSinceSpeech >= 900);
  const fresh = await send({ type: 'vad-stream', session: 'b', samples: new Float32Array(16000) });
  assert.equal(fresh.result.heardSpeech, false);
});

test('worker: a VAD model that cannot be read fails that job, and the worker keeps working', async () => {
  const send = loadWorker();
  const realRead = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => {
    if (String(file).endsWith('silero_vad.onnx')) throw new Error('ENOENT: no such file');
    return realRead.call(fs, file, ...rest);
  };
  try {
    const failed = await send({ type: 'vad', audio: new Float32Array(16000) });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /ENOENT/);
    const streamFailed = await send({ type: 'vad-stream', session: 1, samples: new Float32Array(16000) });
    assert.equal(streamFailed.ok, false);
  } finally {
    fs.readFileSync = realRead;
  }
  if (!haveModel) return;
  const recovered = await send({ type: 'vad', audio: new Float32Array(16000) });
  assert.equal(recovered.ok, true, recovered.error);
  assert.deepEqual(recovered.result, []);
});
