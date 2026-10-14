'use strict';
// Optional cloud transcription through any OpenAI-compatible
// /audio/transcriptions endpoint. Defaults to Groq, whose free tier runs
// whisper-large-v3-turbo much faster than a laptop CPU.

const { encodeWav } = require('../audio-utils');

/**
 * @param {Float32Array} audio mono 16 kHz
 * @param {{baseUrl: string, apiKey: string, model: string, languages: string[]}} opts
 */
async function transcribeCloud(audio, { baseUrl, apiKey, model, languages = [], prompt = '' }) {
  if (!apiKey) throw new Error('Add an API key in Settings > Transcription to use cloud mode.');
  const form = new FormData();
  form.append('file', new Blob([encodeWav(audio)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (languages.length === 1) form.append('language', languages[0]);
  if (prompt) form.append('prompt', prompt);

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Cloud transcription failed (HTTP ${res.status}): ${body}`);
  }
  const json = await res.json();
  return {
    text: String(json.text || '').trim(),
    language: languageCode(json.language) || languages[0] || null,
    translatedTo: null,
    chunks: Array.isArray(json.segments)
      ? json.segments.map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').trim() }))
      : null,
  };
}

// verbose_json reports the detected language by name ("croatian"), sometimes by code.
const LANGUAGE_NAMES = {
  english: 'en', croatian: 'hr', german: 'de', spanish: 'es', french: 'fr', italian: 'it',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', serbian: 'sr', bosnian: 'bs', slovenian: 'sl',
  czech: 'cs', slovak: 'sk', hungarian: 'hu', romanian: 'ro', ukrainian: 'uk', russian: 'ru',
  turkish: 'tr', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', greek: 'el',
  arabic: 'ar', hindi: 'hi', japanese: 'ja', korean: 'ko', chinese: 'zh', macedonian: 'mk',
  bulgarian: 'bg', lithuanian: 'lt', latvian: 'lv', estonian: 'et', albanian: 'sq',
};

function languageCode(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return v.length <= 3 ? v : LANGUAGE_NAMES[v] || null;
}

/**
 * Whisper's speech translation (any language -> English) via the
 * OpenAI-compatible /audio/translations endpoint. Groq only serves it with
 * whisper-large-v3 (not turbo).
 */
async function translateCloud(audio, { baseUrl, apiKey, model }) {
  if (!apiKey) throw new Error('Add an API key in Settings > Transcription to use cloud mode.');
  const translateModel = /groq\.com/.test(baseUrl) ? 'whisper-large-v3' : model;
  const form = new FormData();
  form.append('file', new Blob([encodeWav(audio)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', translateModel);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/audio/translations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Cloud translation failed (HTTP ${res.status}): ${body}`);
  }
  const json = await res.json();
  return { text: String(json.text || '').trim(), language: null, translatedTo: 'en' };
}

module.exports = { transcribeCloud, translateCloud, languageCode };
