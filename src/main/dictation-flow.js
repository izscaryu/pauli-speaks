'use strict';
// What happens to a recording once the microphone stops, and the second chances around it:
//   - processDictation: speech gate -> transcribe -> paste; when that fails the audio is kept
//     (a failed History entry, Retry on the pill), unless the user cancelled;
//   - offerUndo: Esc while listening keeps the recording behind "Cancelled. Undo" for 4 seconds;
//   - runPillAction: the pill's Retry / Undo; retryFromHistory / transcribeKept: History's Retry
//     (and crash recovery's Recover), which copy instead of paste;
//   - historyList: History items marked with what can be retried and played.
// Everything Electron- or engine-specific comes in through `deps`, so it is unit tested with fakes.

const { UNDO_MS } = require('./retry-offers');

const SAMPLE_RATE = 16000;
const MIN_AUDIO_SECONDS = 0.3;
const BUSY = 'Still working on the last dictation…';

/**
 * @param {object} d
 * @param {ReturnType<import('./retry-offers').createRetryOffers>} d.retry
 * @param {import('./history').History} d.history
 * @param {import('./dictation-controller').DictationController} d.controller
 * @param {(audio: Float32Array) => Promise<object>} d.speechGate  speech-gate.js gateSpeech with the app's options
 * @param {(audio, seconds, t0, historyId, recording) => Promise<void>} d.runDictation  transcribe, clean up, paste
 * @param {(audio, seconds, historyId) => Promise<void>} d.runCommand  command mode
 * @param {(audio, opts) => Promise<object>} d.transcribe  speech -> text (translated when asked)
 * @param {() => boolean} d.translatingNow
 * @param {(app: object|null) => string} d.styleFor  the per-app style
 * @param {(result, style) => {text: string, before: object[], after: object[]}} d.dictationText
 * @param {(result, text, seconds, style, app) => object} d.dictationEntry  a History entry
 * @param {(seconds: number) => object} d.keptMeta  how a kept recording is to be run again
 * @param {() => object|null} d.takeListening  the listening session of the cancelled dictation (main forgets it)
 * @param {(session: object|null) => Promise<Float32Array>} d.stopForUndo  the cancelled recording, with the cancel sound
 * @param {() => void} d.beginRun  a pill Retry / Undo starts: the app in front, the pill shows processing
 * @param {() => void} [d.afterRun]  after a transcription ran (main resets "press Enter after")
 * @param {() => void} d.showIdle
 * @param {(message: string) => void} d.showError  tell the window
 * @param {(text, kind?, ms?, action?) => void} d.flash
 * @param {(text: string) => Promise<void>} d.copy  kept out of clipboard history
 * @param {(historyId: string) => object|null} d.savedRecording  Privacy's saved WAV, ready to retry
 * @param {() => Set<string>} d.audioIds  History ids with a saved recording
 * @param {{info: Function, warn: Function, error: Function}} d.log
 * @param {() => number} [d.now]
 */
function createDictationFlow(d) {
  const { retry, history, controller } = d;
  const log = d.log || { info() {}, warn() {}, error() {} };
  const now = d.now || Date.now;
  let recorded = false; // the dictation being processed is in History: a later error must not offer Retry

  /** Nothing to transcribe. A retry of it is over: its failed entry and audio go (History's Retry does the same). */
  function nothingSaid(message, kind, job) {
    if (job?.kind === 'retry') retry.settled(job);
    d.flash(...(kind ? [message, kind] : [message]));
  }

  /** Gate -> transcribe -> paste. If that fails the audio is kept, so the pill and History can retry it. @param {object} [job] a retry or undo */
  async function processDictation(audio, t0, job = null) {
    const seconds = audio.length / SAMPLE_RATE;
    if (seconds < MIN_AUDIO_SECONDS) return nothingSaid('No speech detected', null, job);
    const gate = await d.speechGate(audio);
    if (gate.skip) {
      log.info(`Speech gate: ${gate.skip}`);
      if (gate.skip === 'no-sound') return nothingSaid('No sound. Is your mic muted?', 'warn', job); // amber, like the live warning
      return nothingSaid('No speech detected', null, job);
    }
    if (gate.trimmed) log.info(`Speech gate: ${seconds.toFixed(1)}s -> ${(gate.audio.length / SAMPLE_RATE).toFixed(1)}s of speech`);

    recorded = false;
    try {
      if (controller.command) await d.runCommand(gate.audio, seconds, job?.historyId);
      else await d.runDictation(gate.audio, seconds, t0, job?.historyId, audio);
      if (job?.kind === 'retry' && !controller.cancelled) retry.settled(job);
    } catch (err) {
      log.error('Dictation failed', err);
      if (controller.cancelled) return; // the user cancelled it: nothing to retry, nothing to report
      d.showError(err.message);
      if (recorded) d.flash(err.message.length > 80 ? 'Something went wrong - see Pauli Speaks for details' : err.message, 'error', 4500);
      // the audio is safe in memory for this session, so the crash file can go as usual
      else d.flash("Couldn't transcribe.", 'error', 6000, job?.kind === 'retry' ? retry.failedAgain(job.audioId) : retry.failed(audio, d.keptMeta(seconds), err.message));
    } finally {
      d.afterRun?.();
    }
  }

  /** Esc while listening: "Cancelled. Undo" for 4 s; after that the audio and the crash file go. */
  async function offerUndo() {
    const session = d.takeListening();
    const meta = d.keptMeta(0);
    const hold = retry.holdForUndo(() => session?.end());
    try {
      d.flash('Cancelled.'); // at once; the Undo button follows with the audio
      const audio = await d.stopForUndo(session);
      const seconds = audio.length / SAMPLE_RATE;
      if (seconds < MIN_AUDIO_SECONDS) return hold.cancel();
      const action = hold.offer(audio, { ...meta, durationMs: Math.round(seconds * 1000) });
      if (action) d.flash('Cancelled.', 'info', UNDO_MS, action);
    } catch (err) {
      log.warn(`Undo: ${err.message}`);
      hold.cancel(); // nothing to undo after all: the crash file goes
    }
  }

  /** The pill's Retry / Undo: pasted into the app in front now (the pill never takes the focus). */
  async function runPillAction(actionId) {
    // Busy: nothing is taken, so a held Undo keeps its audio and its crash file until it expires.
    if (controller.status !== 'idle') return d.flash(BUSY);
    const job = retry.take(actionId);
    if (!job) return d.flash('That recording is no longer available');
    try {
      await controller.process(async () => {
        d.beginRun();
        await processDictation(job.audio, now(), job);
      }, job.meta);
    } finally {
      job.done?.(); // undo: the crash file goes now
    }
  }

  /** History's Retry, the speech part: the kept audio as a History entry (voice commands aren't run), null if nothing was said. */
  async function transcribeKept({ audio, meta }) {
    const gate = await d.speechGate(audio);
    if (gate.skip) return null;
    const result = await d.transcribe(gate.audio, { translate: d.translatingNow() });
    const style = d.styleFor(meta.app);
    const { text, after } = d.dictationText(result, style);
    if (!text.trim() || after.some((c) => c.action === 'undo')) return null;
    return d.dictationEntry(result, text, audio.length / SAMPLE_RATE, style, meta.app);
  }

  async function retryFromHistory(id) {
    const out = await retry.retryInHistory(id, {
      process: (run, mode) => controller.process(run, mode), transcribe: transcribeKept, saved: d.savedRecording,
      isCancelled: () => controller.cancelled, copy: d.copy, onError: (err) => log.error('Retry failed', err),
    });
    if (controller.status === 'idle') d.showIdle(); // a local model may have shown "Loading speech model…"
    return out;
  }

  /** History for the window: failed items say whether they can be retried, items with a saved recording can be played. */
  function historyList() {
    const saved = d.audioIds();
    return history.list().map((i) => {
      const hasAudio = saved.has(i.id);
      if (i.status === 'failed') return { ...i, canRetry: retry.canRetry(i) || hasAudio, hasAudio };
      return hasAudio ? { ...i, hasAudio } : i;
    });
  }

  return {
    processDictation, offerUndo, runPillAction, transcribeKept, retryFromHistory, historyList,
    /** The dictation being processed went into History (main's record()). */
    noteRecorded() { recorded = true; },
  };
}

module.exports = { createDictationFlow, MIN_AUDIO_SECONDS, BUSY };
