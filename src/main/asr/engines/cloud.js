'use strict';
// A cloud speech service (any OpenAI-compatible /audio/transcriptions, Groq by default) behind the engine
// interface (engines/index.js). Nothing to load: each request carries the audio (see PRIVACY.md).

const cloud = require('../cloud');

/**
 * @param {object} d
 * @param {() => {baseUrl: string, apiKey: string, model: string}} d.options  from settings
 * @param {Function} [d.transcribeCloud]  tests pass fakes for the two requests
 * @param {Function} [d.translateCloud]
 */
function createCloudEngine(d) {
  const transcribeCloud = d.transcribeCloud || cloud.transcribeCloud;
  const translateCloud = d.translateCloud || cloud.translateCloud;
  return {
    id: 'cloud',
    label: 'Cloud',
    languages: null, // whatever the service's model knows
    sizes: [],
    load: async () => {},
    /**
     * @param {Float32Array} audio mono 16 kHz
     * @param {{languages?: string[], prompt?: string, task?: 'transcribe'|'translate', timestamps?: boolean}} opts
     *   timestamps (a file): no extra requests for a language outside your list, as each piece may be any language
     */
    transcribe(audio, { languages = [], prompt = '', task = 'transcribe', timestamps = false } = {}) {
      const opts = d.options();
      if (task === 'translate') return translateCloud(audio, opts);
      return transcribeCloud(audio, { ...opts, languages, prompt, retryOutsideList: !timestamps });
    },
    dispose() {},
  };
}

module.exports = { createCloudEngine };
