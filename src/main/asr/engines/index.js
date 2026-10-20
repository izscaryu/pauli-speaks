'use strict';
// The speech engines, one file each, all with the same shape:
//   { id, label, languages, sizes, load(), transcribe(audio, { languages, prompt, task, timestamps }), dispose() }
//   transcribe → { text, language, likelyLanguage?, chunks?, translatedTo? }
//   languages: null = whatever the engine's model knows; sizes: the models it can download
// main.js picks one by settings.engine, so recognise() doesn't care which it is.

/** @param {object[]} engines  the first is the fallback for an unknown id */
function createEngines(engines) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  return {
    get: (id) => byId.get(id) || engines[0],
    list: () => [...engines],
  };
}

module.exports = { createEngines };
