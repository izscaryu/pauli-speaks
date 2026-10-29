'use strict';
// Decides, before anything is transcribed, whether a recording holds speech and
// which part of it Whisper should hear. Uses the voice-activity detector when it
// is on and available, and today's loudness check otherwise. Pure apart from the
// callbacks it is given, so it can be unit tested without a model.

const { joinSegments } = require('./speech-segments');

const SILENCE_LEVEL = 0.004; // below this the old check calls a recording silence
const NO_SOUND_LEVEL = 0.0005; // below this the microphone is giving essentially nothing
const SAMPLE_RATE = 16000;
const TIMEOUT_MESSAGE = 'Speech detector did not answer in time';

/** How long the detector may take for a recording: 1.5 s, or 20 ms per second of audio when that is longer. */
function detectTimeoutMs(seconds) {
  return Math.max(1500, Math.round(20 * seconds));
}

/** `promise`, or a rejection after `ms` (a busy or hung worker must not hold up the dictation). */
function withTimeout(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * @param {Float32Array} audio 16 kHz mono
 * @param {{enabled: boolean,
 *          detect: ((audio: Float32Array) => Promise<Array<{start: number, end: number}>>) | null,
 *          level: (audio: Float32Array) => number,
 *          onError?: (err: Error) => void,
 *          timeoutMs?: number}} options  onError hears why the detector could not run (or didn't answer within
 *          timeoutMs, detectTimeoutMs of the audio's length by default), before the fallback
 * @returns {Promise<{skip: 'no-speech' | 'no-sound'} | {audio: Float32Array, trimmed: boolean}>}
 */
async function gateSpeech(audio, { enabled, detect, level, onError, timeoutMs = detectTimeoutMs(audio.length / SAMPLE_RATE) }) {
  const loudness = level(audio);
  if (loudness < NO_SOUND_LEVEL) return { skip: 'no-sound' };

  if (enabled && typeof detect === 'function') {
    try {
      const segments = await withTimeout(Promise.resolve().then(() => detect(audio)), timeoutMs);
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

const WARM_SAMPLES = Float32Array.from({ length: 2048 }, (_, i) => 0.1 * Math.sin(i / 10)); // 128 ms, loud enough for the model to run

/**
 * At start: the detector's worker and model get ready now instead of on the first dictation, where loading them
 * took the silence check over its time limit (a cold worker) or added its load to the wait (a warm one).
 * @returns {Promise<boolean>} it ran
 */
async function warmDetector({ enabled, detect, onError }) {
  if (!enabled || typeof detect !== 'function') return false;
  try {
    await detect(WARM_SAMPLES);
    return true;
  } catch (err) {
    try { if (onError) onError(err); } catch { /* a failing reporter never fails start-up */ }
    return false;
  }
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

module.exports = { gateSpeech, reportOncePerMessage, detectTimeoutMs, warmDetector, SILENCE_LEVEL, NO_SOUND_LEVEL };
