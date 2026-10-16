'use strict';
// Runs inside an Electron utilityProcess so model loading and inference never
// block the main process (which owns the keyboard hook and windows).
// Jobs run one at a time: ONNX sessions are not shared safely between
// concurrent generate() calls, and live previews must not race the final pass.

const fs = require('node:fs');
const path = require('node:path');
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
let queue = Promise.resolve();

/** Created on first use. Throws (failing only that job) if the model can't be read or loaded. */
function getVad() {
  vad ??= createVad({ modelBuffer: fs.readFileSync(VAD_MODEL), ort: require('onnxruntime-node') });
  return vad;
}

function vadStream(session, samples) {
  if (!vadSession || vadSession.id !== session) vadSession = { id: session, stream: getVad().createStream() };
  return vadSession.stream.push(samples);
}

async function handle(data) {
  const { id, type } = data;
  const onProgress = (progress) => port.postMessage({ type: 'progress', progress });
  try {
    engine ??= createLocalWhisper({ cacheDir: data.cacheDir, onProgress });
    translator ??= createTranslator({ cacheDir: data.cacheDir, onProgress });
    let result;
    if (type === 'load') result = await engine.load(data.model, data.acceleration);
    else if (type === 'transcribe') result = await engine.transcribe(data.audio, data.opts);
    else if (type === 'load-translator') result = await translator.load();
    else if (type === 'translate') result = await translator.translate(data.text, data.source, data.target);
    else if (type === 'vad') result = await getVad().detect(data.audio);
    else if (type === 'vad-stream') result = await vadStream(data.session, data.samples);
    port.postMessage({ id, ok: true, result });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
}

port.on('message', ({ data }) => {
  queue = queue.then(() => handle(data));
});
