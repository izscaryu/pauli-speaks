'use strict';
// Offline text translation with Meta's NLLB-200 (distilled 600M, int8) through
// transformers.js. Used for "Best" quality translation and for any target
// language other than English. Benchmarked on a laptop CPU: ~2-3 s per sentence,
// clearly better than Whisper's built-in translate on Croatian.

const fs = require('node:fs');
const path = require('node:path');
const { READY_MARKER, modelDir } = require('./whisper-local');

const NLLB_MODEL = 'Xenova/nllb-200-distilled-600M';
const NLLB_SIZE = '~900 MB';

// Whisper language code -> NLLB (FLORES-200) code
const NLLB_CODES = {
  en: 'eng_Latn', hr: 'hrv_Latn', de: 'deu_Latn', es: 'spa_Latn', fr: 'fra_Latn', it: 'ita_Latn',
  pt: 'por_Latn', nl: 'nld_Latn', pl: 'pol_Latn', sr: 'srp_Cyrl', bs: 'bos_Latn', sl: 'slv_Latn',
  cs: 'ces_Latn', sk: 'slk_Latn', hu: 'hun_Latn', ro: 'ron_Latn', uk: 'ukr_Cyrl', ru: 'rus_Cyrl',
  tr: 'tur_Latn', sv: 'swe_Latn', da: 'dan_Latn', no: 'nob_Latn', fi: 'fin_Latn', el: 'ell_Grek',
  ar: 'arb_Arab', hi: 'hin_Deva', ja: 'jpn_Jpan', ko: 'kor_Hang', zh: 'zho_Hans', mk: 'mkd_Cyrl',
  bg: 'bul_Cyrl', lt: 'lit_Latn', lv: 'lvs_Latn', et: 'est_Latn', sq: 'als_Latn',
};

/**
 * Split text into single sentences, keeping line breaks (from "new line"
 * voice commands) as separators that are passed through untouched.
 * NLLB is a sentence-level model: given several sentences at once it silently
 * drops some, and batched generation in transformers.js degenerates into
 * repetition - so every sentence is translated on its own.
 * @returns {{text: string, translate: boolean}[]}
 */
function splitForTranslation(text) {
  const out = [];
  for (const part of String(text).split(/(\n+)/)) {
    if (!part) continue;
    if (/^\n+$/.test(part)) {
      out.push({ text: part, translate: false });
      continue;
    }
    for (const sentence of part.match(/[^.!?]+[.!?]*\s*/g) || [part]) {
      if (sentence.trim()) out.push({ text: sentence.trim(), translate: true });
    }
  }
  return out;
}

function joinTranslated(pieces) {
  let out = '';
  for (const p of pieces) {
    if (!p.translate) out += p.text;
    else out += (out && !out.endsWith('\n') ? ' ' : '') + p.text;
  }
  return out;
}

function createTranslator({ cacheDir, onProgress = () => {} }) {
  let pipe = null;
  let loading = null;

  async function load() {
    if (pipe) return;
    if (loading) return loading;
    loading = (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = cacheDir;
      transformers.env.allowLocalModels = false;
      pipe = await transformers.pipeline('translation', NLLB_MODEL, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p) => onProgress({ model: NLLB_MODEL, ...p }),
      });
      fs.mkdirSync(modelDir(cacheDir, NLLB_MODEL), { recursive: true });
      fs.writeFileSync(path.join(modelDir(cacheDir, NLLB_MODEL), READY_MARKER), new Date().toISOString());
      onProgress({ model: NLLB_MODEL, status: 'ready' });
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }

  async function translate(text, source, target) {
    if (source === target) return text;
    const src = NLLB_CODES[source];
    const tgt = NLLB_CODES[target];
    if (!src || !tgt) throw new Error(`Translating ${source || '?'} → ${target} isn't supported`);
    await load();
    const pieces = splitForTranslation(text);
    for (const p of pieces) {
      if (!p.translate) continue;
      const [res] = await pipe(p.text, { src_lang: src, tgt_lang: tgt, max_new_tokens: 512 });
      p.text = res.translation_text.trim();
    }
    return joinTranslated(pieces);
  }

  return { load, translate };
}

module.exports = { NLLB_MODEL, NLLB_SIZE, NLLB_CODES, createTranslator, splitForTranslation, joinTranslated };
