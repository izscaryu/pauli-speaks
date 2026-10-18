'use strict';
// Recordings kept in memory so nothing you said is lost: a dictation that couldn't be
// transcribed (Retry on the pill and in History) and a cancelled one (Undo for 4 seconds).
// Never written to disk. The oldest goes once there are more than `maxItems`
// recordings or more than `maxSeconds` of audio in total; the newest is always kept.

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
  const items = new Map(); // id -> { audio, meta }, oldest first
  let totalSamples = 0;

  function remove(id) {
    const item = items.get(id);
    if (!item) return null;
    items.delete(id);
    totalSamples -= item.audio.length;
    return item;
  }

  function evict() {
    while (items.size > 1 && (items.size > maxItems || totalSamples > maxSeconds * sampleRate)) {
      const [id] = items.keys();
      const { meta } = remove(id);
      onEvict(id, meta);
    }
  }

  return {
    /** @param {Float32Array} audio  16 kHz mono @returns {string} id, unique across runs (History saves it) */
    put(audio, meta = {}) {
      const id = crypto.randomUUID();
      items.set(id, { audio, meta });
      totalSamples += audio.length;
      evict();
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

    get size() {
      return items.size;
    },
  };
}

module.exports = { createPendingAudio };
