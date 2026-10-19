'use strict';
// Second chances for a dictation, on top of the in-memory pending-audio store:
//   - it couldn't be transcribed: the audio is kept, History lists it as failed, and the
//     pill offers Retry (History has its own Retry button);
//   - it was cancelled while listening: the pill offers Undo for 4 seconds, then the audio
//     is dropped and onExpire runs (main finishes the crash-recovery file there).
// Only the action on the pill right now can be clicked; an older one is stale.

const UNDO_MS = 4000;

/**
 * @param {object} o
 * @param {ReturnType<import('./pending-audio').createPendingAudio>} o.pending
 * @param {import('./history').History} o.history
 * @param {(item: object, audio: Float32Array) => void} [o.onFailed]  a failed entry was added (main saves its recording when those are kept)
 */
function createRetryOffers({ pending, history, onFailed = () => {}, undoMs = UNDO_MS, timers = { setTimeout, clearTimeout } }) {
  let offer = null; // what the pill's button does now: { id, kind: 'retry'|'undo', audioId }
  let undo = null; // the cancelled dictation held for Undo: { onExpire, audioId, timer, expired }
  let nextId = 1;

  function show(kind, audioId) {
    offer = { id: `${kind}-${nextId++}`, kind, audioId };
    return { id: offer.id, label: kind === 'retry' ? 'Retry' : 'Undo' };
  }

  const failedItem = (historyId) => history.list().find((i) => i.id === historyId && i.status === 'failed') || null;
  const itemFor = (audioId) => history.list().find((i) => i.status === 'failed' && i.audioId === audioId) || null;

  function retryJob(audioId, historyId) {
    const kept = pending.get(audioId);
    return kept ? { kind: 'retry', audioId, historyId, audio: kept.audio, meta: kept.meta } : null;
  }

  /** A recording kept on disk (Privacy → recordings): the History entry is `historyId`, failed or not. */
  function savedJob(historyId, saved) {
    if (!history.list().some((i) => i.id === historyId)) return null;
    const kept = saved(historyId);
    return kept ? { kind: 'retry', audioId: null, historyId, audio: kept.audio, meta: kept.meta } : null;
  }

  /** The held undo ends: its audio goes (unless it was taken) and onExpire runs, once. */
  function endUndo(held) {
    if (held.expired) return;
    held.expired = true;
    if (held.timer) timers.clearTimeout(held.timer);
    if (held.audioId) pending.drop(held.audioId);
    if (undo === held) undo = null;
    if (offer && offer.kind === 'undo' && offer.audioId === held.audioId) offer = null;
    held.onExpire();
  }

  /** History's Retry. @returns {object|null} null when the audio is gone */
  function forHistory(historyId) {
    const item = failedItem(historyId);
    return item ? retryJob(item.audioId, item.id) : null;
  }

  /** The retry ran to the end: the audio goes; an entry still failed (nothing was said) goes too. */
  function settled(job) {
    pending.drop(job.audioId);
    if (job.historyId && failedItem(job.historyId)) history.remove(job.historyId);
  }

  return {
    forHistory,
    settled,

    /**
     * History's Retry button: transcribe the kept audio, fill in the entry, copy the text. Nothing is typed.
     * @param {string} historyId
     * @param {object} d
     * @param {(run: () => Promise<void>, mode: object) => Promise<boolean>} d.process  the controller's: false when busy
     * @param {(job) => Promise<object|null>} d.transcribe  the History entry, null when nothing was said
     * @param {() => boolean} d.isCancelled
     * @param {(historyId: string) => ({audio: Float32Array, meta: object}|null)} [d.saved]  the recording saved on disk, when the one in memory is gone or the entry is a normal one
     * @param {(text: string) => void} d.copy
     * @param {(err: Error) => void} [d.onError]
     * @returns {Promise<{copied: true} | {error: string}>}
     */
    async retryInHistory(historyId, { process, transcribe, isCancelled, copy, saved = () => null, onError = () => {} }) {
      const job = forHistory(historyId) || savedJob(historyId, saved);
      if (!job) return { error: 'That recording is no longer available' };
      let out = { error: 'Cancelled' };
      const ran = await process(async () => {
        try {
          const entry = await transcribe(job);
          if (isCancelled()) return;
          if (entry) {
            history.resolve(job.historyId, entry);
            await copy(entry.text);
            out = { copied: true };
          } else out = { error: 'No speech detected' };
          settled(job);
        } catch (err) {
          onError(err);
          out = { error: err.message };
        }
      }, job.meta);
      return ran ? out : { error: 'Still working on the last dictation…' };
    },

    /**
     * @param {Float32Array} audio  the whole recording (Retry runs the speech gate again)
     * @param {{durationMs: number, engine: string, command: boolean, translate: boolean, app: object|null}} meta
     * @param {string} error
     * @returns {{id: string, label: string}} the pill's action
     */
    failed(audio, meta, error) {
      const audioId = pending.put(audio, meta);
      onFailed(history.addFailed({ audioId, durationMs: meta.durationMs, engine: meta.engine, error, translate: !!meta.translate }), audio);
      return show('retry', audioId);
    },

    /** A retry failed again: same audio, same History entry. @returns {{id, label}|null} */
    failedAgain(audioId) {
      return pending.get(audioId) ? show('retry', audioId) : null;
    },

    /**
     * Esc while listening: call this before waiting for the recording, so a new dictation
     * (expireUndo) can end it at once. offer() then keeps the audio for undoMs.
     * @param {() => void} onExpire
     */
    holdForUndo(onExpire) {
      if (undo) endUndo(undo);
      const held = { onExpire, audioId: null, timer: null, expired: false };
      undo = held;
      return {
        /** @returns {{id, label}|null} null when a new dictation already took over */
        offer(audio, meta) {
          if (held.expired) return null;
          held.audioId = pending.put(audio, meta, { capped: false }); // never pushes out a recording kept for Retry
          held.timer = timers.setTimeout(() => endUndo(held), undoMs);
          return show('undo', held.audioId);
        },
        /** Nothing worth undoing. */
        cancel: () => endUndo(held),
      };
    },

    /** A new dictation starts: a held cancel can't be undone any more. */
    expireUndo() {
      if (undo) endUndo(undo);
    },

    /**
     * The pill's button was clicked.
     * Retry: the audio stays kept until settled(); Undo: handed over once, call done() when finished.
     */
    take(actionId) {
      if (!offer || offer.id !== actionId) return null;
      if (offer.kind === 'retry') {
        const item = itemFor(offer.audioId);
        return retryJob(offer.audioId, item ? item.id : null);
      }
      const held = undo;
      offer = null;
      if (!held || held.expired) return null;
      const kept = pending.take(held.audioId);
      held.audioId = null;
      timers.clearTimeout(held.timer);
      held.timer = null;
      undo = null;
      if (!kept) return null;
      return { kind: 'undo', audio: kept.audio, meta: kept.meta, done: () => endUndo(held) };
    },

    /** @param {object} item  a History item */
    canRetry(item) {
      return !!item && item.status === 'failed' && !!pending.get(item.audioId);
    },

    /** A failed entry was deleted: so is its audio. */
    forget(historyId) {
      const item = failedItem(historyId);
      if (item) pending.drop(item.audioId);
    },

    forgetAll() {
      for (const i of history.list()) if (i.status === 'failed') pending.drop(i.audioId);
    },

    /** Delete all my data: every recording in memory goes, a held Undo ends (its crash file goes) and the pill's button is stale. */
    clear() {
      if (undo) endUndo(undo);
      offer = null;
      pending.clear();
    },
  };
}

module.exports = { createRetryOffers, UNDO_MS };
