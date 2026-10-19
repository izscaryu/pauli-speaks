'use strict';
// Runs inside an Electron utilityProcess so model loading and inference never
// block the main process (which owns the keyboard hook and windows).
// Jobs run one at a time: ONNX sessions are not shared safely between
// concurrent generate() calls, and live previews must not race the final pass.
// The voice-activity detector has its own ONNX session and its own queue, so the
// hands-free auto-stop never waits behind a transcription.

const fs = require('node:fs');
const path = require('node:path');
const { ortLibraryPaths, preloadOrtLibraries } = require('./ort-preload');

// Before anything loads ONNX Runtime: ours, not the older copy in System32 (see ort-preload.js).
preloadOrtLibraries({
  paths: ortLibraryPaths({ indexPath: require.resolve('onnxruntime-node'), platform: process.platform, arch: process.arch }),
  load: (p) => require('koffi').load(p),
  onError: (err, p) => console.error(`Could not preload ${path.basename(p)}: ${err.message}`),
});

const { createLocalWhisper } = require('./whisper-local');
const { createTranslator } = require('./translator-local');
const { createVad } = require('./vad');

// Read into a buffer (fs is asar-aware; native ONNX Runtime can't open a path inside app.asar).
const VAD_MODEL = path.join(__dirname, '..', '..', '..', 'assets', 'models', 'silero_vad.onnx');

const port = process.parentPort;
let engine = null;
let translator = null;
let vad = null;
let vadSession = null; // { id, stream } for the live stream; a new id starts a fresh one
let queue = Promise.resolve(); // Whisper and the translator
let vadQueue = Promise.resolve(); // vad and vad-stream, in order among themselves

/** Created on first use. Throws (failing only that job) if the model can't be read or loaded. */
function getVad() {
  vad ??= createVad({ modelBuffer: fs.readFileSync(VAD_MODEL), ort: require('onnxruntime-node') });
  return vad;
}

function vadStream(session, samples) {
  if (!vadSession || vadSession.id !== session) vadSession = { id: session, stream: getVad().createStream() };
  return vadSession.stream.push(samples);
}

const isVadJob = (type) => type === 'vad' || type === 'vad-stream';

async function handle(data) {
  const { id, type } = data;
  const onProgress = (progress) => port.postMessage({ type: 'progress', progress });
  try {
    if (!isVadJob(type)) {
      engine ??= createLocalWhisper({ cacheDir: data.cacheDir, onProgress });
      translator ??= createTranslator({ cacheDir: data.cacheDir, onProgress });
    }
    let result;
    if (type === 'vad') result = await getVad().detect(data.audio);
    else if (type === 'vad-stream') result = await vadStream(data.session, data.samples);
    else if (type === 'load') result = await engine.load(data.model, data.acceleration);
    else if (type === 'transcribe') result = await engine.transcribe(data.audio, data.opts);
    else if (type === 'load-translator') result = await translator.load();
    else if (type === 'translate') result = await translator.translate(data.text, data.source, data.target);
    port.postMessage({ id, ok: true, result });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
}

port.on('message', ({ data }) => {
  if (isVadJob(data.type)) vadQueue = vadQueue.then(() => handle(data));
  else queue = queue.then(() => handle(data));
});
