'use strict';
// Decides, before anything is transcribed, whether a recording holds speech and
// which part of it Whisper should hear. Uses the voice-activity detector when it
// is on and available, and today's loudness check otherwise. Pure apart from the
// callbacks it is given, so it can be unit tested without a model.

const { joinSegments } = require('./speech-segments');

const SILENCE_LEVEL = 0.004; // below this the old check calls a recording silence
const NO_SOUND_LEVEL = 0.0005; // below this the microphone is giving essentially nothing

/**
 * @param {Float32Array} audio 16 kHz mono
 * @param {{enabled: boolean,
 *          detect: ((audio: Float32Array) => Promise<Array<{start: number, end: number}>>) | null,
 *          level: (audio: Float32Array) => number,
 *          onError?: (err: Error) => void}} options  onError hears why the detector could not run, before the fallback
 * @returns {Promise<{skip: 'no-speech' | 'no-sound'} | {audio: Float32Array, trimmed: boolean}>}
 */
async function gateSpeech(audio, { enabled, detect, level, onError }) {
  const loudness = level(audio);
  if (loudness < NO_SOUND_LEVEL) return { skip: 'no-sound' };

  if (enabled && typeof detect === 'function') {
    try {
      const segments = await detect(audio);
      if (!segments.length) return { skip: 'no-speech' };
      return { audio: joinSegments(audio, segments), trimmed: true };
    } catch (err) {
      // the detector could not run: say so, then carry on with the loudness check below
      try { if (onError) onError(err); } catch { /* a failing reporter never fails dictation */ }
    }
  }
  if (loudness < SILENCE_LEVEL) return { skip: 'no-speech' };
  return { audio, trimmed: false };
}

/** An onError that reports each distinct message once, so a broken detector does not fill the log. */
function reportOncePerMessage(report) {
  const seen = new Set();
  return (err) => {
    const message = err && err.message ? String(err.message) : String(err);
    if (seen.has(message)) return;
    seen.add(message);
    report(message);
  };
}

module.exports = { gateSpeech, reportOncePerMessage, SILENCE_LEVEL, NO_SOUND_LEVEL };
