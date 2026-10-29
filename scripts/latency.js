'use strict';
// Dictation latency on this PC, stage by stage, with the speech worker's own code (asr/whisper-local.js, asr/vad.js):
//   npm run latency -- <clip.wav> [--models <folder>] [--model onnx-community/whisper-base] [--cpu] [--runs 5]
// What it times, as a dictation does after you let go of the shortcut:
//   vad      the silence check over the whole recording (cold = its first run after the worker starts)
//   load     loading the Whisper model (the app does this at start)
//   first    the first transcription after the load (what the first dictation of a session waits for)
//   warm     later transcriptions, for no language chosen (detect among all), two languages, and one language
// --models: a folder holding onnx-community/<model> (default: Pauli Speaks' own models folder). Only timings are
// printed, never what was recognised.

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { decodeWav } = require('../src/main/audio-utils');
const { createLocalWhisper } = require('../src/main/asr/whisper-local');
const { createVad } = require('../src/main/asr/vad');

function args(argv) {
  const out = { clip: null, models: path.join(process.env.APPDATA || '', 'Pauli Speaks', 'models'), model: 'onnx-community/whisper-base', cpu: false, runs: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--models') out.models = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--runs') out.runs = Number(argv[++i]) || 5;
    else if (a === '--cpu') out.cpu = true;
    else out.clip = a;
  }
  return out;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function time(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t0), value };
}

async function repeat(n, fn) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push((await time(fn)).ms);
  return xs;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.clip) {
    console.error('Usage: npm run latency -- <clip.wav> [--models <folder>] [--model <id>] [--cpu] [--runs 5]');
    process.exit(2);
  }
  const { samples } = decodeWav(fs.readFileSync(o.clip));
  const rows = [];
  const row = (stage, ms, note = '') => rows.push({ stage, ms, note });

  const vad = createVad({ modelBuffer: fs.readFileSync(path.join(__dirname, '..', 'assets', 'models', 'silero_vad.onnx')), ort: require('onnxruntime-node') });
  row('vad cold', (await time(() => vad.detect(samples))).ms, 'its session is made on first use');
  row('vad warm', median(await repeat(3, () => vad.detect(samples))));

  const whisper = createLocalWhisper({ cacheDir: o.models });
  const acceleration = o.cpu ? 'cpu' : 'auto';
  const load = await time(() => whisper.load(o.model, acceleration));
  row('load', load.ms, `${o.model.split('/').pop()} on ${load.value.device}`);

  const opts = (languages) => ({ model: o.model, acceleration, languages, prompt: '' });
  row('first', (await time(() => whisper.transcribe(samples, opts(['en'])))).ms, 'the first dictation after the load');
  for (const [label, languages] of [['warm, detect', []], ['warm, 2 langs', ['hr', 'en']], ['warm, 1 lang', ['en']]]) {
    const xs = await repeat(o.runs, () => whisper.transcribe(samples, opts(languages)));
    row(label, median(xs), `median of ${o.runs}: ${xs.join(' ')}`);
  }

  console.log(`${path.basename(o.clip)}: ${(samples.length / 16000).toFixed(1)} s of audio`);
  for (const r of rows) console.log(`${r.stage.padEnd(14)} ${String(r.ms).padStart(6)} ms  ${r.note}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
