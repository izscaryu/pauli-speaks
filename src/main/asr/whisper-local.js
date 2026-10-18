'use strict';
// Offline speech-to-text with Whisper via transformers.js + onnxruntime-node.
// The model runs on this PC, so no audio is sent anywhere.
//
// Measured on an RTX 3060 laptop, 7.6 s of speech:
//   Base  CPU 2.2 s  | GPU (DirectML) 0.8 s
//   Small CPU 3.1 s  | GPU (DirectML) 1.5 s

const fs = require('node:fs');
const path = require('node:path');

const MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Tiny', size: '~75 MB', note: 'Fastest, lowest accuracy' },
  { id: 'onnx-community/whisper-base', label: 'Base', size: '~150 MB', note: 'Fast, good for English' },
  { id: 'onnx-community/whisper-small', label: 'Small', size: '~500 MB', note: 'Much better for Croatian and other languages' },
  { id: 'onnx-community/whisper-large-v3-turbo', label: 'Large v3 Turbo', size: '~1 GB', note: 'Best accuracy - use with a GPU' },
];

const DEFAULT_MODEL = 'onnx-community/whisper-base';
const READY_MARKER = '.pauli-ready';
const MAX_DECODER_TOKENS = 448;
const MAX_PROMPT_TOKENS = 120;

function modelDir(cacheDir, model) {
  return path.join(cacheDir, ...model.split('/'));
}

function isModelDownloaded(cacheDir, model) {
  return fs.existsSync(path.join(modelDir(cacheDir, model), READY_MARKER));
}

/** Large v3 Turbo was fine-tuned without translation data, so it can't use Whisper's translate task. */
const canWhisperTranslate = (model) => !/turbo/i.test(model);

/**
 * Words the user cares about, as a Whisper "previous text" prompt. Whisper
 * conditions on it and spells those names the same way (OpenAI's prompting
 * guide; verified: "polyspeaks" -> "Pauli Speaks").
 */
function buildPrompt(dictionary) {
  const words = [...new Set((dictionary || []).map((d) => String(d.to || '').trim()).filter(Boolean))];
  return words.length ? `${words.join(', ')}.` : '';
}

/**
 * The most likely language token among `candidates` (empty = all) and, from the same scores, among all of them.
 * @param {ArrayLike<number>} scores the decoder's logits; the last step starts at `base`
 * @param {Record<string, number>} langToId Whisper's "<|en|>" -> token id
 * @returns {{language: string, likely: string}}
 */
function pickLanguage(scores, base, langToId, candidates) {
  let best = null;
  let any = null;
  for (const [token, id] of Object.entries(langToId)) {
    const code = token.slice(2, -2);
    const score = scores[base + id];
    if (!any || score > any.score) any = { code, score };
    if (candidates.length && !candidates.includes(code)) continue;
    if (!best || score > best.score) best = { code, score };
  }
  return { language: best ? best.code : 'en', likely: any ? any.code : 'en' };
}

function createLocalWhisper({ cacheDir, onProgress = () => {} }) {
  let transformers = null;
  let pipe = null;
  let current = null; // { model, device, wanted, gpuError }
  let loading = null;

  async function lib() {
    if (!transformers) {
      transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = cacheDir;
      transformers.env.allowLocalModels = false;
    }
    return transformers;
  }

  async function create(model, device) {
    const { pipeline } = await lib();
    return pipeline('automatic-speech-recognition', model, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      device,
      progress_callback: (p) => onProgress({ model, ...p }),
    });
  }

  /** @param {'auto'|'gpu'|'cpu'} acceleration */
  async function load(model = DEFAULT_MODEL, acceleration = 'auto') {
    const wantGpu = acceleration !== 'cpu' && process.platform === 'win32';
    if (pipe && current.model === model && current.wanted === acceleration) return current;
    const key = `${model}|${acceleration}`;
    if (loading && loading.key === key) return loading.promise;
    const promise = (async () => {
      if (pipe) await pipe.dispose?.();
      pipe = null;
      let device = wantGpu ? 'dml' : 'cpu';
      let gpuError = null;
      try {
        pipe = await create(model, device);
      } catch (err) {
        if (device === 'cpu') throw err;
        gpuError = String(err && err.message ? err.message : err).split('\n')[0];
        device = 'cpu';
        pipe = await create(model, device);
      }
      current = { model, device, wanted: acceleration, gpuError };
      fs.mkdirSync(modelDir(cacheDir, model), { recursive: true });
      fs.writeFileSync(path.join(modelDir(cacheDir, model), READY_MARKER), new Date().toISOString());
      onProgress({ model, status: 'ready', device, gpuError });
      return current;
    })();
    loading = { key, promise };
    try {
      return await promise;
    } finally {
      loading = null;
    }
  }

  /**
   * transformers.js falls back to English when no language is given, so we
   * detect it ourselves: one decoder step after <|startoftranscript|> and pick
   * the most likely language token, limited to the user's languages.
   * @returns {Promise<{language: string, likely: string}>} `likely` is the best of all languages, from the same scores
   */
  async function detectLanguage(input_features, candidates) {
    const { Tensor } = await lib();
    const gc = pipe.model.generation_config;
    const sot = new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
    const { logits } = await pipe.model({ input_features, decoder_input_ids: sot });
    const vocab = logits.dims.at(-1);
    return pickLanguage(logits.data, logits.data.length - vocab, gc.lang_to_id, candidates);
  }

  /** Single-window decode with a vocabulary prompt (transformers.js has no prompt_ids yet). */
  async function generateWithPrompt(input_features, language, task, prompt) {
    const gc = pipe.model.generation_config;
    const promptIds = pipe.tokenizer.encode(` ${prompt}`, { add_special_tokens: false }).slice(-MAX_PROMPT_TOKENS);
    const init = [
      gc.prev_sot_token_id, ...promptIds,
      gc.decoder_start_token_id, gc.lang_to_id[`<|${language}|>`], gc.task_to_id[task], gc.no_timestamps_token_id,
    ];
    const seq = await pipe.model.generate({
      input_features,
      decoder_input_ids: init,
      max_new_tokens: MAX_DECODER_TOKENS - init.length - 1,
    });
    const ids = Array.from(seq.tolist()[0], Number).slice(init.length);
    return pipe.tokenizer.decode(ids, { skip_special_tokens: true });
  }

  /**
   * @param {Float32Array} audio mono 16 kHz
   * @param {{model?: string, acceleration?: string, languages?: string[], task?: 'transcribe'|'translate',
   *          prompt?: string, timestamps?: boolean}} opts
   *   languages: [] = detect among all. task 'translate' = Whisper's built-in X -> English.
   */
  async function transcribe(audio, opts = {}) {
    const { model = DEFAULT_MODEL, acceleration = 'auto', languages = [], prompt = '', timestamps = false } = opts;
    const { device } = await load(model, acceleration);
    const seconds = audio.length / 16000;
    const { input_features } = await pipe.processor(audio.subarray(0, 16000 * 30));
    // One chosen language goes straight to Whisper (nothing to detect, nothing to suggest).
    const { language, likely: likelyLanguage } = languages.length === 1
      ? { language: languages[0], likely: null }
      : await detectLanguage(input_features, languages);
    const task = opts.task === 'translate' && language !== 'en' ? 'translate' : 'transcribe';

    let text;
    let chunks = null;
    if (prompt && seconds <= 30 && !timestamps) {
      text = await generateWithPrompt(input_features, language, task, prompt);
    } else {
      const run = { language, task };
      if (seconds > 28 || timestamps) {
        run.chunk_length_s = 30;
        run.stride_length_s = 5;
      }
      if (timestamps) run.return_timestamps = true;
      const out = await pipe(audio, run);
      text = out.text;
      if (timestamps) {
        chunks = (out.chunks || []).map((c) => ({
          start: c.timestamp[0] ?? 0,
          end: c.timestamp[1] ?? seconds,
          text: c.text.trim(),
        }));
      }
    }
    return { text: (text || '').trim(), language, likelyLanguage, translatedTo: task === 'translate' ? 'en' : null, chunks, device };
  }

  return { load, transcribe };
}

module.exports = {
  MODELS, DEFAULT_MODEL, READY_MARKER, createLocalWhisper, isModelDownloaded, modelDir, canWhisperTranslate, buildPrompt, pickLanguage,
};
