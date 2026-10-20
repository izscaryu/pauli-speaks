'use strict';
// Whisper on this PC, behind the engine interface (engines/index.js): the speech goes to the ASR utility process
// (local-asr.js → asr-worker.js → whisper-local.js). Loading the model, with its state on the pill and in the
// window, stays with main.js (ensureLoaded), which knows the windows.

const { MODELS } = require('../whisper-local');

/**
 * @param {object} d
 * @param {{transcribe: (audio, opts) => Promise<object>, stop: () => void}} d.asr  local-asr.js
 * @param {() => {model: string, acceleration: string}} d.options  from settings
 * @param {() => Promise<void>} d.ensureLoaded  the chosen model is loaded (rejects with the reason when it can't be)
 */
function createWhisperEngine(d) {
  return {
    id: 'local',
    label: 'Whisper',
    languages: null, // every language Whisper knows
    sizes: MODELS,
    load: () => d.ensureLoaded(),
    /**
     * @param {Float32Array} audio mono 16 kHz
     * @param {{languages?: string[], prompt?: string, task?: 'transcribe'|'translate', timestamps?: boolean}} opts
     */
    async transcribe(audio, { languages = [], prompt = '', task = 'transcribe', timestamps = false } = {}) {
      await d.ensureLoaded();
      return d.asr.transcribe(audio, { ...d.options(), languages, prompt, task, timestamps });
    },
    dispose: () => d.asr.stop(),
  };
}

module.exports = { createWhisperEngine };
