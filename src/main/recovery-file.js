'use strict';
// The crash-recovery copy of the dictation in progress: raw little-endian float32
// samples (16 kHz mono) in recovery\current.pcm and what kind of dictation it was
// in recovery\current.json. It exists only while dictating and until the text is
// pasted; whatever is left on start belongs to a dictation that never finished.

const fs = require('node:fs');
const path = require('node:path');

const BYTES_PER_SAMPLE = 4;

/**
 * @param {string} dir  <userData>\recovery
 */
function createRecoveryFile(dir) {
  const pcm = path.join(dir, 'current.pcm');
  const json = path.join(dir, 'current.json');
  let recording = false;

  function remove() {
    recording = false;
    fs.rmSync(pcm, { force: true });
    fs.rmSync(json, { force: true });
  }

  return {
    /** Starts a new recording (an older one is replaced). @param {{startedAt: number, mode: string}} meta */
    begin(meta) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(pcm, Buffer.alloc(0));
      fs.writeFileSync(json, JSON.stringify(meta));
      recording = true;
    },

    /** Adds samples to the recording begun in this run; ignored when there is none. @param {Float32Array} samples */
    append(samples) {
      if (!recording || !samples || !samples.length) return;
      fs.appendFileSync(pcm, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    },

    /** The dictation ended (pasted, cancelled, nothing said): the recording is deleted. */
    finish: remove,

    /** Deletes a recording, also one left behind by an earlier run. */
    discard: remove,

    /**
     * The recording on disk, if any. A cut-off last sample is dropped; unreadable meta is null.
     * @returns {{meta: object|null, audio: Float32Array} | null}
     */
    read() {
      let bytes;
      try {
        bytes = fs.readFileSync(pcm);
      } catch {
        return null;
      }
      const count = Math.floor(bytes.length / BYTES_PER_SAMPLE);
      const audio = new Float32Array(count);
      new Uint8Array(audio.buffer).set(bytes.subarray(0, count * BYTES_PER_SAMPLE));
      let meta = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(json, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
      } catch { /* missing or corrupt: the audio is still worth having */ }
      return { meta, audio };
    },
  };
}

module.exports = { createRecoveryFile };
