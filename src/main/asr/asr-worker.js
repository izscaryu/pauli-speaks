'use strict';
// Runs inside an Electron utilityProcess so model loading and inference never
// block the main process (which owns the keyboard hook and windows).
// Jobs run one at a time: ONNX sessions are not shared safely between
// concurrent generate() calls, and live previews must not race the final pass.

const { createLocalWhisper } = require('./whisper-local');
const { createTranslator } = require('./translator-local');

const port = process.parentPort;
let engine = null;
let translator = null;
let queue = Promise.resolve();

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
    port.postMessage({ id, ok: true, result });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
}

port.on('message', ({ data }) => {
  queue = queue.then(() => handle(data));
});
