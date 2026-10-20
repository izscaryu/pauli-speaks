'use strict';
// Files → transcribe a whole audio or video file (decoded to 16 kHz mono by the window). Long files are split at
// pauses into ~2 minute pieces for progress; silent pieces are skipped. Optionally translated into Settings →
// Translation's language. The engine comes in through `deps` (recognisePiece), so it is unit tested with fakes.

const { cleanTranscript } = require('./text-cleanup');
const { speechLevel, splitAtPauses, SAMPLE_RATE } = require('./audio-utils');
const { SILENCE_LEVEL } = require('./speech-gate');
const { t } = require('./strings');

/**
 * @param {object} d
 * @param {{get: () => object}} d.settings
 * @param {() => boolean} d.dictationBusy  a dictation is running
 * @param {(settings: object, target: string) => boolean} d.needsNllb
 * @param {(samples: Float32Array, fast: boolean) => Promise<{text, language, translatedTo?, chunks?}>} d.recognisePiece
 *   fast: Whisper translates into English itself; otherwise a timestamped transcription
 * @param {(text, source, target) => Promise<string>} d.translateText  NLLB
 * @param {(done: number, total: number) => void} d.progress
 * @param {(audio: Float32Array) => {start: number, samples: Float32Array}[]} [d.split]
 */
function createFileTranscriber(d) {
  const split = d.split || splitAtPauses;
  let busy = false;

  /** @returns {Promise<{text: string, segments: {start,end,text}[], language: string|null, translatedTo: string|null}>} */
  async function transcribe(audio, { translate = false } = {}) {
    if (busy) throw new Error(t('errors.fileBusy'));
    if (d.dictationBusy()) throw new Error(t('errors.finishCurrent'));
    busy = true;
    try {
      const s = d.settings.get();
      const target = s.translation.target;
      const fast = translate && target === 'en' && !d.needsNllb(s, target);
      const pieces = split(audio);
      const segments = [];
      let language = null;
      for (let i = 0; i < pieces.length; i++) {
        d.progress(i, pieces.length);
        const { start, samples } = pieces[i];
        if (speechLevel(samples) < SILENCE_LEVEL) continue;
        const r = await d.recognisePiece(samples, fast);
        const dur = samples.length / SAMPLE_RATE;
        const chunks = r.chunks && r.chunks.length ? r.chunks : [{ start: 0, end: dur, text: r.text }];
        language ??= r.language;
        if (translate && !r.translatedTo && r.language && r.language !== target) {
          for (const c of chunks) if (c.text.trim()) c.text = await d.translateText(c.text, r.language, target);
        }
        for (const c of chunks) {
          const text = cleanTranscript(c.text, { ...s, addTrailingSpace: false, snippets: [], voiceCommands: false });
          if (text.trim()) segments.push({ start: start + c.start, end: start + Math.min(c.end, dur), text });
        }
      }
      d.progress(pieces.length, pieces.length);
      return {
        text: segments.map((x) => x.text).join(' ').replace(/[ \t]+/g, ' ').trim(),
        segments,
        language,
        translatedTo: translate ? target : null,
      };
    } finally {
      busy = false;
    }
  }

  return {
    transcribe,
    /** A file is being transcribed (Privacy waits before deleting models). */
    get busy() { return busy; },
  };
}

module.exports = { createFileTranscriber };
