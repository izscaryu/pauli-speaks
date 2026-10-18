'use strict';
// Recordings kept in memory so nothing you said is lost: a dictation that couldn't be
// transcribed (Retry on the pill and in History) and a cancelled one (Undo for 4 seconds).
// Never written to disk. The oldest goes once there are more than `maxItems`
// recordings or more than `maxSeconds` of audio in total; the newest is always kept.
// A recording put with `capped: false` (the one cancelled dictation held for Undo, 4 seconds
// at most) doesn't count toward the caps, so it never pushes out a recording kept for Retry.

const crypto = require('node:crypto');

const DEFAULT_SAMPLE_RATE = 16000;

/**
 * @param {object} [o]
 * @param {number} [o.maxItems]
 * @param {number} [o.maxSeconds]  total audio kept, in seconds
 * @param {number} [o.sampleRate]
 * @param {(id: string, meta: object) => void} [o.onEvict]  a recording went because of a cap (not take/drop)
 */
function createPendingAudio({ maxItems = 5, maxSeconds = 600, sampleRate = DEFAULT_SAMPLE_RATE, onEvict = () => {} } = {}) {
  const items = new Map(); // id -> { audio, meta, capped }, oldest first
  let totalSamples = 0; // of the capped recordings

  function remove(id) {
    const item = items.get(id);
    if (!item) return null;
    items.delete(id);
    if (item.capped) totalSamples -= item.audio.length;
    return { audio: item.audio, meta: item.meta };
  }

  function evict() {
    const capped = () => [...items].filter(([, i]) => i.capped).map(([id]) => id);
    for (let ids = capped(); ids.length > 1 && (ids.length > maxItems || totalSamples > maxSeconds * sampleRate); ids = capped()) {
      const { meta } = remove(ids[0]);
      onEvict(ids[0], meta);
    }
  }

  return {
    /**
     * @param {Float32Array} audio  16 kHz mono
     * @param {object} [meta]
     * @param {{capped?: boolean}} [opts]  capped false: outside the caps (never evicted, evicts nothing)
     * @returns {string} id, unique across runs (History saves it)
     */
    put(audio, meta = {}, { capped = true } = {}) {
      const id = crypto.randomUUID();
      items.set(id, { audio, meta, capped });
      if (capped) {
        totalSamples += audio.length;
        evict();
      }
      return id;
    },

    /** @returns {{audio: Float32Array, meta: object} | null} */
    get(id) {
      return items.get(id) || null;
    },

    /** Hands the recording over and forgets it. @returns {{audio: Float32Array, meta: object} | null} */
    take(id) {
      return remove(id);
    },

    drop(id) {
      remove(id);
    },

    /** Delete all my data: every recording goes. */
    clear() {
      items.clear();
      totalSamples = 0;
    },

    get size() {
      return items.size;
    },
  };
}

module.exports = { createPendingAudio };
