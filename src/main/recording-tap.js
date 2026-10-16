'use strict';
// Pulls the new part of the recording from the overlay's recorder while the user
// is still speaking, so the main process can use it before the dictation ends
// (the crash-recovery file, the live voice-activity detector). Each pull asks
// only for the samples after the ones already received.

/**
 * @param {object} options
 * @param {(from: number) => Promise<Float32Array>} options.requestTail  the recording from sample `from` on
 * @param {(samples: Float32Array) => Promise<void>|void} options.onSamples  each new piece, in order
 * @param {(err: Error) => void} [options.onError]  onSamples failed (the samples still count as received)
 * @param {number} [options.intervalMs]
 * @returns {{start(): void, stop(): Promise<void>}}
 */
function createRecordingTap({ requestTail, onSamples, onError = () => {}, intervalMs = 1000 }) {
  let from = 0;
  let timer = null;
  let stopped = false;
  let inFlight = null; // the running pull: pulls never overlap

  async function pullOnce() {
    const samples = await requestTail(from);
    if (!samples || !samples.length) return;
    from += samples.length;
    try {
      await onSamples(samples);
    } catch (err) {
      onError(err);
    }
  }

  function pull() {
    inFlight = pullOnce()
      .catch(onError)
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => {
        if (!inFlight) pull();
      }, intervalMs);
    },

    /** Stops the timer, waits for a running pull, then pulls once more. Later calls do nothing. */
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      timer = null;
      if (inFlight) await inFlight;
      await pull();
    },
  };
}

module.exports = { createRecordingTap };
