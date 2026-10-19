'use strict';
// Optional cloud transcription through any OpenAI-compatible
// /audio/transcriptions endpoint. Defaults to Groq, whose free tier runs
// whisper-large-v3-turbo much faster than a laptop CPU.

const { encodeWav } = require('../audio-utils');
const { relatedChosen } = require('../language-relatives');
const { t } = require('../strings');

/**
 * With several chosen languages, a returned language outside them is usually a mishearing (short
 * Croatian comes back as Polish or Bosnian): the audio is sent again in each chosen language and the
 * answer Whisper is surest of is kept. One chosen language is sent with the request already, and with
 * none chosen the provider's detection is accepted.
 * @returns {string[]} the languages for the extra requests, none when the first answer stands
 */
function cloudRetryLanguages(chosen, returned) {
  if (chosen.length < 2 || !returned || chosen.includes(returned)) return [];
  return [...chosen];
}

/**
 * How sure Whisper was of a verbose_json answer: the average log-probability of its segments, weighted by
 * their length (higher is surer). Null when the provider reports none.
 */
function confidence(json) {
  const segments = (Array.isArray(json && json.segments) ? json.segments : []).filter((seg) => Number.isFinite(seg.avg_logprob));
  if (!segments.length) return null;
  const weights = segments.map((seg) => Math.max(0, Number(seg.end) - Number(seg.start)) || 0);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return segments.reduce((a, seg) => a + seg.avg_logprob, 0) / segments.length;
  return segments.reduce((a, seg, i) => a + seg.avg_logprob * weights[i], 0) / total;
}

/**
 * The answer to keep from the extra requests ({language, json} each, in the chosen order): the surest one,
 * the first listed on a tie. When the provider reports no confidence, the chosen relative of `returned`
 * (Croatian for Bosnian), else null: the first answer stands.
 */
function pickAnswer(answers, returned, chosen) {
  const scored = answers.map((a) => ({ ...a, score: confidence(a.json) })).filter((a) => a.score !== null);
  if (scored.length) return scored.reduce((best, a) => (a.score > best.score ? a : best));
  const related = relatedChosen(returned, chosen);
  return answers.find((a) => a.language === related) || null;
}

/**
 * @param {Float32Array} audio mono 16 kHz
 * @param {{baseUrl: string, apiKey: string, model: string, languages: string[], retryOutsideList?: boolean}} opts
 *   retryOutsideList (default true): the extra request for a language outside the list. Dictation wants it;
 *   file transcription (many pieces, any language) does not.
 */
async function transcribeCloud(audio, { baseUrl, apiKey, model, languages = [], prompt = '', retryOutsideList = true, log = require('../logger') }) {
  if (!apiKey) throw new Error(t('errors.cloudNeedsKey'));
  const request = async (language) => {
    const form = new FormData();
    form.append('file', new Blob([encodeWav(audio)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(t('errors.cloudFailed', { status: String(res.status), body }));
    }
    return res.json();
  };

  let json = await request(languages.length === 1 ? languages[0] : '');
  const returned = languageCode(json.language);
  let language = returned || languages[0] || null;
  const retryIn = retryOutsideList ? cloudRetryLanguages(languages, returned) : [];
  if (retryIn.length) {
    // one more request per chosen language, at once, to the same provider
    const settled = await Promise.allSettled(retryIn.map((lang) => request(lang)));
    const answers = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') answers.push({ language: retryIn[i], json: r.value });
      else log.warn(`Cloud language retry in ${retryIn[i]} failed: ${r.reason && r.reason.message}`);
    });
    const best = pickAnswer(answers, returned, languages);
    if (best) {
      log.info?.(`Cloud heard ${returned}, outside your languages; kept ${best.language} (${answers.map((a) => `${a.language} ${fmt(confidence(a.json))}`).join(', ')})`);
      json = best.json;
      language = best.language;
    } else if (!answers.length) {
      // the first answer is still usable: keep it, with the language it came back in
      log.warn('Cloud language retries failed, keeping the first result');
    }
  }
  return {
    text: String(json.text || '').trim(),
    language,
    likelyLanguage: languages.length > 1 ? returned : null, // what the provider heard, before any retry
    translatedTo: null,
    chunks: Array.isArray(json.segments)
      ? json.segments.map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').trim() }))
      : null,
  };
}

const fmt = (score) => (score === null ? '?' : score.toFixed(2));

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
  if (!apiKey) throw new Error(t('errors.cloudNeedsKey'));
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
    throw new Error(t('errors.cloudTranslationFailed', { status: String(res.status), body }));
  }
  const json = await res.json();
  return { text: String(json.text || '').trim(), language: null, translatedTo: 'en' };
}

module.exports = { transcribeCloud, translateCloud, languageCode, cloudRetryLanguages, confidence };
