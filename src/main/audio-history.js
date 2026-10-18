'use strict';
// Recordings kept for 24 hours when Settings → Privacy → "Keep recordings for 24 hours" is on:
// one 16-bit mono 16 kHz WAV per History item in <userData>\audio\<History id>.wav. They are
// not encrypted. They go when the setting is turned off, when the item is deleted, and
// from the hourly sweep once they are 24 hours old.

const fs = require('node:fs');
const path = require('node:path');
const { encodeWav, SAMPLE_RATE } = require('./audio-utils');

const MAX_AGE_MS = 24 * 3600 * 1000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // crypto.randomUUID()
const EXT = '.wav';

const isId = (id) => typeof id === 'string' && ID.test(id);

/** @param {string} dir  <userData>\audio */
function createAudioHistory(dir) {
  const file = (id) => path.join(dir, `${id}${EXT}`);

  function names() {
    try {
      return fs.readdirSync(dir);
    } catch {
      return []; // no folder yet
    }
  }

  return {
    /**
     * @param {string} historyId
     * @param {Float32Array} audio  16 kHz mono
     * @returns {string} the file
     */
    save(historyId, audio) {
      if (!isId(historyId)) throw new Error('Not a History id');
      fs.mkdirSync(dir, { recursive: true });
      const target = file(historyId);
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, encodeWav(audio, SAMPLE_RATE));
      fs.renameSync(tmp, target);
      return target;
    },

    /** @returns {string|null} the recording's file, null when there is none */
    path(historyId) {
      if (!isId(historyId)) return null;
      const target = file(historyId);
      return fs.existsSync(target) ? target : null;
    },

    /** @returns {Buffer|null} the WAV bytes (for playing it in the window) */
    read(historyId) {
      if (!isId(historyId)) return null;
      try {
        return fs.readFileSync(file(historyId));
      } catch {
        return null;
      }
    },

    /** The History ids that have a recording. @returns {Set<string>} */
    ids() {
      return new Set(names().filter((n) => n.endsWith(EXT) && isId(n.slice(0, -EXT.length))).map((n) => n.slice(0, -EXT.length)));
    },

    remove(historyId) {
      if (isId(historyId)) fs.rmSync(file(historyId), { force: true });
    },

    /**
     * Deletes recordings older than 24 hours (and unfinished temporary files). Files that are not recordings stay.
     * @param {number} [now]
     * @param {{keep?: Set<string>}} [opts]  with keep: recordings of any other History id go too
     * @returns {number} how many recordings were deleted
     */
    sweep(now = Date.now(), { keep } = {}) {
      let removed = 0;
      for (const name of names()) {
        const isTmp = name.endsWith(`${EXT}.tmp`);
        const id = name.slice(0, -(isTmp ? EXT.length + 4 : EXT.length));
        if (!(isTmp || name.endsWith(EXT)) || !isId(id)) continue;
        const full = path.join(dir, name);
        try {
          const old = now - fs.statSync(full).mtimeMs > MAX_AGE_MS;
          if (isTmp || old || (keep && !keep.has(id))) {
            fs.rmSync(full, { force: true });
            if (!isTmp) removed++;
          }
        } catch {
          // gone already
        }
      }
      return removed;
    },

    /** Every recording, and the folder. */
    clear() {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

module.exports = { createAudioHistory, MAX_AGE_MS };
