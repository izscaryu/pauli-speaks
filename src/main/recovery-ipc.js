'use strict';
// Crash recovery on Home: when Pauli Speaks starts and finds the recording of a dictation that never
// finished (recovery-file.js), Home offers "Recover your last dictation?". Recover runs it through the
// same speech path as History's Retry (gate, transcribe), adds the result to History and copies it;
// Discard just deletes the file. Takes everything Electron-specific through `deps` so it can be unit
// tested with a fake ipcMain.
//
//   deps = {
//     recovery: { read(), finish() },        // recovery-file.js
//     crashRecoveryOn: () => boolean,        // the `crashRecovery` setting
//     dictationActive: () => boolean,        // a dictation is listening or processing (the file is then its own)
//     process: (run, mode) => Promise<boolean>,       // the controller's: false when busy
//     transcribe: ({ audio, meta }) => Promise<entry|null>,   // gate + transcribe; null when nothing was said
//     isCancelled: () => boolean,
//     addEntry: (entry) => void,             // History
//     copy: (text) => Promise<void>,         // clipboard, kept out of clipboard history
//     keep: (audio, meta, error) => action,  // pending audio + failed History entry; the pill's Retry action
//     flash: (text, kind, ms, action) => void,
//     engineLabel: () => string,
//     settle?: () => void,                   // after a run (the pill may still show a loading message)
//     log?,
//   }

const SAMPLE_RATE = 16000;
const MIN_RECOVER_SECONDS = 0.5;

function registerRecoveryIpc(ipcMain, deps) {
  const { recovery } = deps;
  const log = deps.log || { warn() {}, error() {} };
  let found = null; // the recording read at start, held in memory: a new dictation replaces the file
  let busy = false;

  /** At start, before any dictation can begin. */
  function check() {
    found = null;
    try {
      if (!deps.crashRecoveryOn()) return recovery.finish(); // off: nothing is written, a leftover goes
      const read = recovery.read();
      if (!read) return;
      if (read.audio.length / SAMPLE_RATE < MIN_RECOVER_SECONDS) return recovery.finish();
      found = read;
    } catch (err) {
      log.warn('recovery: start check failed:', err && err.message);
    }
  }

  /** The file is deleted after either choice - unless a new dictation is writing to it by now. */
  function done() {
    found = null;
    if (deps.dictationActive()) return;
    try {
      recovery.finish();
    } catch (err) {
      log.warn('recovery: deleting the file failed:', err && err.message);
    }
  }

  ipcMain.handle('recovery:state', () => {
    if (!found) return null;
    const startedAt = found.meta && Number.isFinite(found.meta.startedAt) ? found.meta.startedAt : null;
    return { seconds: found.audio.length / SAMPLE_RATE, startedAt };
  });

  ipcMain.handle('recovery:discard', () => {
    if (busy) return;
    done();
  });

  ipcMain.handle('recovery:recover', async () => {
    if (!found) return { error: 'That recording is no longer available' };
    if (busy) return { error: 'Still working on the recovery…' };
    busy = true;
    try {
      const { audio, meta: saved } = found;
      const translate = !!saved && saved.mode === 'translate';
      const meta = {
        durationMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
        engine: deps.engineLabel(), command: false, translate, app: null,
      };
      let out = { error: 'Cancelled' };

      /** Nothing is lost: the audio goes to the kept recordings, History lists it as failed, the pill offers Retry. */
      const keepForRetry = (error, announce) => {
        const action = deps.keep(audio, meta, error);
        if (announce) deps.flash("Couldn't transcribe.", 'error', 6000, action);
        return { failed: true, error };
      };

      const ran = await deps.process(async () => {
        let entry;
        try {
          entry = await deps.transcribe({ audio, meta });
        } catch (err) {
          log.error('Recovering the last dictation failed', err);
          out = keepForRetry(err.message, true);
          return;
        }
        if (deps.isCancelled()) {
          out = keepForRetry('Cancelled', false);
          return;
        }
        if (!entry) {
          out = { error: 'No speech detected' };
          return;
        }
        deps.addEntry(entry);
        try {
          await deps.copy(entry.text);
          out = { copied: true };
        } catch (err) {
          log.warn('recovery: copying failed:', err && err.message);
          out = { error: err.message };
        }
      }, { translate, command: false });
      deps.settle?.();
      if (!ran) return { error: 'Still working on the last dictation…' }; // the offer stays
      done();
      return out;
    } finally {
      busy = false;
    }
  });

  return { check };
}

module.exports = { registerRecoveryIpc, MIN_RECOVER_SECONDS };
