'use strict';
// What runs in the background of one dictation while the user speaks: a recording
// tap that writes the crash-recovery file and feeds the live voice-activity
// detector, which ends a hands-free dictation after N seconds without speech.
// Started when listening starts; stop() before the final recording is taken,
// end() once the dictation is over (pasted, cancelled, nothing said).
// A detector that fails, or leaves a push unanswered for VAD_TIMEOUT_MS, is off for the rest of
// the dictation (onVadError): the overlay's loudness auto-stop takes over.

const { createRecordingTap } = require('./recording-tap');

let lastVadSession = 0;
const VAD_TIMEOUT_MS = 3000;

/**
 * @param {object} o
 * @param {{crashRecovery: boolean, autoStopSilence: number, silenceDetection: boolean}} o.settings
 * @param {{begin(meta), append(samples), finish()}} [o.recovery]
 * @param {string} [o.mode]  dictate / translate / command, kept in the crash file
 * @param {(from: number) => Promise<Float32Array>} o.requestTail
 * @param {(session: number, samples: Float32Array) => Promise<{heardSpeech: boolean, silentMsSinceSpeech: number}>} [o.vadStream]
 * @param {() => boolean} [o.isHandsFree]  auto-stop only applies to a locked (hands-free) dictation
 * @param {() => void} [o.onSilence]  N seconds without speech: finish the dictation
 * @param {(err: Error) => void} [o.onVadError]  the VAD failed; it is off for the rest of this dictation
 * @param {(err: Error) => void} [o.onRecoveryError]  the crash file failed; it is off for the rest of this dictation
 * @param {(err: Error) => void} [o.onError]  a pull from the recorder failed, or handling a VAD answer did (the tap keeps going)
 * @param {number} [o.vadTimeoutMs]  a VAD push unanswered this long counts as a VAD failure
 */
function createListeningSession({
  settings, recovery = null, mode = 'dictate', requestTail, vadStream = null,
  isHandsFree = () => false, onSilence = () => {}, onVadError = () => {}, onRecoveryError = () => {},
  onError = () => {}, intervalMs = 500, now = Date.now, vadTimeoutMs = VAD_TIMEOUT_MS, timers = { setTimeout, clearTimeout },
}) {
  const vadAutoStop = Number(settings.autoStopSilence) > 0 && !!settings.silenceDetection;
  const silenceMs = Number(settings.autoStopSilence) * 1000;
  const vadSession = ++lastVadSession;
  let writing = !!settings.crashRecovery && !!recovery;
  let began = false;
  let useVad = vadAutoStop && typeof vadStream === 'function';
  let written = 0;
  let stopping = false;
  let ended = false;
  let silenceSent = false;
  let unanswered = 0; // VAD pushes without an answer yet
  let watchdog = null;

  function clearWatchdog() {
    if (watchdog) timers.clearTimeout(watchdog);
    watchdog = null;
  }

  /** While a push is unanswered, the detector has vadTimeoutMs to answer (counted again after each answer). */
  function armWatchdog() {
    clearWatchdog();
    if (!unanswered || !useVad || ended) return;
    watchdog = timers.setTimeout(() => {
      watchdog = null;
      onVadFailure(new Error('Speech detector did not answer in time'));
    }, vadTimeoutMs);
    watchdog.unref?.();
  }

  function answered() {
    unanswered = Math.max(0, unanswered - 1);
    armWatchdog();
  }

  function recoveryFailed(err) {
    writing = false;
    onRecoveryError(err);
  }

  function write(samples) {
    if (!writing || ended) return;
    try {
      recovery.append(samples);
      written += samples.length;
    } catch (err) {
      recoveryFailed(err);
    }
  }

  function onVadResult(r) {
    answered();
    if (stopping || silenceSent || !isHandsFree()) return;
    if (r && r.heardSpeech && r.silentMsSinceSpeech >= silenceMs) {
      silenceSent = true;
      onSilence();
    }
  }

  function onVadFailure(err) {
    if (!useVad) return; // already reported for this dictation
    useVad = false;
    clearWatchdog();
    if (!ended) onVadError(err); // after end() a fallback would reach the next dictation's overlay
  }

  function onSamples(samples) {
    if (ended) return;
    write(samples);
    if (!useVad || stopping) return;
    // Not awaited: a slow or stuck detector must never hold up the tap, and so the end of the
    // dictation. The worker answers VAD pushes in order; a late answer after stop() is ignored.
    let pushed;
    try {
      pushed = Promise.resolve(vadStream(vadSession, samples));
    } catch (err) {
      pushed = Promise.reject(err);
    }
    unanswered++;
    if (!watchdog) armWatchdog();
    pushed.then(onVadResult, onVadFailure).catch(onError);
  }

  const tap = (writing || useVad) ? createRecordingTap({ requestTail, onSamples, onError, intervalMs }) : null;

  return {
    vadAutoStop,
    vadSession,

    start() {
      if (!tap) return;
      if (writing) {
        try {
          recovery.begin({ startedAt: now(), mode });
          began = true;
        } catch (err) {
          recoveryFailed(err);
        }
      }
      tap.start();
    },

    /** Before the final recording is taken: one last pull into the crash file, no more VAD. */
    async stop() {
      stopping = true;
      clearWatchdog(); // late answers are ignored from here on
      if (tap) await tap.stop();
    },

    /** The final recording: adds what the last pull missed (the flushed end) to the crash file. */
    complete(audio) {
      if (audio && audio.length > written) write(audio.subarray(written));
    },

    /** The dictation is over: the crash file is deleted. Safe to call more than once. */
    end() {
      if (ended) return;
      ended = true;
      stopping = true;
      clearWatchdog();
      if (tap) tap.stop().catch(() => {});
      if (began) {
        try {
          recovery.finish();
        } catch (err) {
          onRecoveryError(err);
        }
      }
    },
  };
}

module.exports = { createListeningSession };
