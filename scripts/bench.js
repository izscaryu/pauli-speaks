'use strict';
// Speech engine benchmark: npm run bench -- <folder> [--engines whisper:base,whisper:small,cloud] [--languages hr]
//                                                    [--models <folder>] [--cpu] [--details]
// The folder holds recordings with what was said: clip.wav (16-bit PCM, any rate) + clip.txt. Your recordings stay
// where they are - the script only reads them - and nothing is written next to them. Whisper models are downloaded
// into --models (default: a folder in your temp directory, never Pauli Speaks' own data folder).
// Prints, per engine: word error rate over all clips, real-time factor, cold start (model load + first clip) and
// warm start (each later clip). The question it answers first: is Parakeet v3 better than Whisper on Croatian?
// The cloud engine sends the recordings to the service: it needs PAULI_BENCH_API_KEY (and --cloud-url, --cloud-model).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SAMPLE_RATE = 16000;

/** Lower-case words without punctuation; "3.5", "it's" and diacritics stay. */
function words(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+(?:['’.][\p{L}\p{N}]+)*/gu) || []);
}

/** Word-level edit distance (substitutions + deletions + insertions) against the reference. */
function wordErrors(reference, hypothesis) {
  const ref = words(reference);
  const hyp = words(hypothesis);
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return { errors: prev[hyp.length], words: ref.length };
}

/** clip.wav + clip.txt pairs, sorted by name; WAV files without a .txt are listed apart. */
function pairClips(fileNames) {
  const txt = new Map(fileNames.filter((f) => /\.txt$/i.test(f)).map((f) => [f.slice(0, -4).toLowerCase(), f]));
  const clips = [];
  const unmatched = [];
  for (const wav of fileNames.filter((f) => /\.wav$/i.test(f)).sort((a, b) => a.localeCompare(b))) {
    const name = wav.slice(0, -4);
    const ref = txt.get(name.toLowerCase());
    if (ref) clips.push({ name, wav, txt: ref });
    else unmatched.push(wav);
  }
  return { clips: clips.sort((a, b) => a.name.localeCompare(b.name)), unmatched };
}

/** decodeWav's result at 16 kHz (linear interpolation). */
function toMono16k({ samples, sampleRate }) {
  if (sampleRate === SAMPLE_RATE) return samples;
  const out = new Float32Array(Math.round((samples.length * SAMPLE_RATE) / sampleRate));
  const step = sampleRate / SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const x = i * step;
    const a = Math.floor(x);
    const b = Math.min(a + 1, samples.length - 1);
    out[i] = samples[a] + (samples[b] - samples[a]) * (x - a);
  }
  return out;
}

function parseArgs(argv) {
  const out = { folder: null, engines: ['whisper:base'], languages: [], models: null, acceleration: 'auto' };
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engines') out.engines = list(argv[++i]);
    else if (a === '--languages') out.languages = list(argv[++i]);
    else if (a === '--models') out.models = argv[++i];
    else if (a === '--cpu') out.acceleration = 'cpu';
    else if (a.startsWith('--')) out[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else if (!out.folder) out.folder = a;
  }
  if (!out.folder) throw new Error('Name the folder with your recordings: npm run bench -- <folder>');
  return out;
}

/**
 * Runs one engine over the clips.
 * @param {{id: string, engine: {load: Function, transcribe: Function}, clips: {name, audio, reference}[], languages?: string[],
 *          clock?: () => number, transcribeOpts?: (clip) => object}} o
 */
async function runBench({ id, engine, clips, languages = [], clock = () => performance.now(), transcribeOpts = () => ({}) }) {
  const t0 = clock();
  await engine.load();
  const loadMs = clock() - t0;
  const perClip = [];
  for (const clip of clips) {
    const start = clock();
    try {
      const r = await engine.transcribe(clip.audio, { languages, task: 'transcribe', ...transcribeOpts(clip) });
      const ms = clock() - start;
      perClip.push({ name: clip.name, ms, seconds: clip.audio.length / SAMPLE_RATE, ...wordErrors(clip.reference, r.text) });
    } catch (err) {
      perClip.push({ name: clip.name, error: String((err && err.message) || err) });
    }
  }
  const ok = perClip.filter((c) => !c.error);
  const sum = (key) => ok.reduce((a, c) => a + c[key], 0);
  const wordsTotal = sum('words');
  return {
    id,
    clips: clips.length,
    failed: perClip.length - ok.length,
    words: wordsTotal,
    errors: sum('errors'),
    wer: ok.length && wordsTotal ? sum('errors') / wordsTotal : null,
    rtf: ok.length ? sum('ms') / (sum('seconds') * 1000) : null,
    loadMs,
    coldMs: ok.length ? loadMs + ok[0].ms : null,
    warmMs: ok.length > 1 ? ok.slice(1).reduce((a, c) => a + c.ms, 0) / (ok.length - 1) : null,
    perClip,
  };
}

const fmt = {
  pct: (v) => (v === null ? '–' : `${(v * 100).toFixed(1)} %`),
  num: (v) => (v === null ? '–' : v.toFixed(2)),
  sec: (ms) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`),
};

function formatReport(results) {
  const rows = [['engine', 'clips', 'WER', 'RTF', 'cold start', 'warm start', '']];
  for (const r of results) {
    rows.push([r.id, String(r.clips), fmt.pct(r.wer), fmt.num(r.rtf), fmt.sec(r.coldMs), fmt.sec(r.warmMs), r.failed ? `${r.failed} failed` : '']);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

// ---------------------------------------------------------------- running it

/** An engine for the bench, in this process (no Electron): whisper:<size> or cloud. */
function benchEngine(spec, args) {
  if (spec === 'cloud') {
    const apiKey = process.env.PAULI_BENCH_API_KEY;
    if (!apiKey) throw new Error('cloud: set PAULI_BENCH_API_KEY (your recordings are sent to the service)');
    const { createCloudEngine } = require('../src/main/asr/engines/cloud');
    const options = () => ({ baseUrl: args.cloudUrl || 'https://api.groq.com/openai/v1', apiKey, model: args.cloudModel || 'whisper-large-v3-turbo' });
    return { engine: createCloudEngine({ options }), opts: () => ({ timestamps: true }) };
  }
  const size = /^whisper:(.+)$/.exec(spec)?.[1];
  const { MODELS, createLocalWhisper } = require('../src/main/asr/whisper-local');
  const model = MODELS.find((m) => m.id.endsWith(`whisper-${size}`));
  if (!model) throw new Error(`Unknown engine "${spec}". Try ${MODELS.map((m) => `whisper:${m.id.split('whisper-')[1]}`).join(', ')} or cloud.`);
  const { ortLibraryPaths, preloadOrtLibraries } = require('../src/main/asr/ort-preload');
  preloadOrtLibraries({
    paths: ortLibraryPaths({ indexPath: require.resolve('onnxruntime-node'), platform: process.platform, arch: process.arch }),
    load: (p) => require('koffi').load(p),
    onError: () => {},
  });
  const cacheDir = args.models || path.join(os.tmpdir(), 'pauli-bench-models');
  let last = -1;
  const whisper = createLocalWhisper({
    cacheDir,
    onProgress: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      const pct = Math.floor((p.loaded / p.total) * 10) * 10;
      if (pct !== last) process.stderr.write(`  downloading ${model.label}: ${(last = pct)} %\n`);
    },
  });
  return {
    engine: {
      load: () => whisper.load(model.id, args.acceleration),
      transcribe: (audio, opts) => whisper.transcribe(audio, { ...opts, model: model.id, acceleration: args.acceleration }),
    },
    opts: () => ({}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { decodeWav } = require('../src/main/audio-utils');
  const { clips: pairs, unmatched } = pairClips(fs.readdirSync(args.folder));
  if (unmatched.length) console.error(`Skipped (no .txt with what was said): ${unmatched.join(', ')}`);
  if (!pairs.length) throw new Error(`No clip.wav + clip.txt pairs in ${args.folder}`);
  const clips = pairs.map((p) => ({
    name: p.name,
    audio: toMono16k(decodeWav(fs.readFileSync(path.join(args.folder, p.wav)))),
    reference: fs.readFileSync(path.join(args.folder, p.txt), 'utf8'),
  }));
  const minutes = clips.reduce((a, c) => a + c.audio.length, 0) / SAMPLE_RATE / 60;
  console.error(`${clips.length} clips, ${minutes.toFixed(1)} min of speech${args.languages.length ? `, languages: ${args.languages.join(', ')}` : ''}`);
  const results = [];
  for (const spec of args.engines) {
    console.error(`${spec}…`);
    const { engine, opts } = benchEngine(spec, args);
    results.push(await runBench({ id: spec, engine, clips, languages: args.languages, transcribeOpts: opts }));
  }
  console.log(formatReport(results));
  if (args.details) {
    for (const r of results) {
      console.log(`\n${r.id}`);
      for (const c of r.perClip) console.log(`  ${c.name}: ${c.error ? `failed (${c.error})` : `${c.errors}/${c.words} words wrong, ${(c.ms / 1000).toFixed(1)} s`}`);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { words, wordErrors, pairClips, toMono16k, parseArgs, runBench, formatReport };
