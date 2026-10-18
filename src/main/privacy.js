'use strict';
// Settings → Privacy: how long transcripts and recordings are kept, "Delete all my data" and
// "Delete downloaded models". Never logs what was said, only that something failed.
//
//   - sweepHistory: the retention rule for History items (pure).
//   - createPrivacy: applies the settings (retention, recordings), sweeps every hour, saves a
//     recording next to its History item when "Keep recordings for 24 hours" is on.
//   - deleteAllData / modelsOnDisk / deleteModels: the two delete buttons.

const fs = require('node:fs');
const path = require('node:path');
const { READY_MARKER, modelDir } = require('./asr/whisper-local');
const { decodeWav } = require('./audio-utils');

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const RETENTIONS = ['keep', '24h', 'off'];

/**
 * Which History items stay: 'keep' all, '24h' those from the last 24 hours, 'off' none (nothing is kept on disk).
 * @param {{createdAt: string}[]} items
 * @param {'keep'|'24h'|'off'} retention
 * @param {number} [now]
 */
function sweepHistory(items, retention, now = Date.now()) {
  if (retention === 'off') return [];
  if (retention !== '24h') return items;
  return items.filter((i) => now - Date.parse(i && i.createdAt) <= DAY_MS); // an unreadable time is NaN: dropped
}

const message = (err) => String((err && err.message) || err);

/**
 * Deletes everything about the user: History, recordings, a leftover crash recording, and the settings
 * (dictionary, snippets and API key included; they go back to the defaults, with the welcome flow to run again).
 * One part failing doesn't stop the rest.
 * @param {object} p
 * @param {{clear: () => void}} p.history
 * @param {{clear: () => void}} p.audioHistory
 * @param {{reset: () => void}} p.settings
 * @param {{finish: () => void}} p.recoveryFile
 * @param {() => void} [p.forgetInMemory]  recordings and text kept in memory (Retry, Paste last); runs first
 * @returns {{ok: boolean, errors: {part: string, error: string}[]}}
 */
function deleteAllData({ history, audioHistory, settings, recoveryFile, forgetInMemory }) {
  const errors = [];
  const run = (part, fn) => {
    try {
      fn();
    } catch (err) {
      errors.push({ part, error: message(err) });
    }
  };
  if (forgetInMemory) run('memory', forgetInMemory);
  run('history', () => history.clear());
  run('audio', () => audioHistory.clear());
  run('recovery', () => recoveryFile.finish());
  run('settings', () => settings.reset());
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- downloaded models

/** Size of a folder, in bytes. */
function folderBytes(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    try {
      total += e.isDirectory() ? folderBytes(full) : fs.statSync(full).size;
    } catch {
      // vanished while counting
    }
  }
  return total;
}

/** Inside `root`, strictly below it (never `root` itself or a path that climbs out). */
function insideRoot(root, dir) {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The downloaded models, as in "Delete downloaded models".
 * @param {string} root  <userData>\models
 * @param {{id: string, label: string, kind: string}[]} catalog  the models the app knows
 * @returns {{id: string, label: string, kind: string, bytes: number}[]}
 */
function modelsOnDisk(root, catalog) {
  const out = [];
  for (const m of catalog) {
    const dir = modelDir(root, m.id);
    try {
      if (!insideRoot(root, dir) || !fs.existsSync(path.join(dir, READY_MARKER))) continue;
      out.push({ ...m, bytes: folderBytes(dir) });
    } catch {
      // unreadable: not listed
    }
  }
  return out;
}

/**
 * Deletes those model folders and nothing else.
 * @param {string} root
 * @param {{id: string}[]} models  from modelsOnDisk
 * @returns {{removed: string[], failed: {id: string, error: string}[]}}
 */
function deleteModels(root, models) {
  const removed = [];
  const failed = [];
  for (const m of models) {
    const dir = modelDir(root, String(m.id || ''));
    if (!m.id || !insideRoot(root, dir)) {
      failed.push({ id: String(m.id), error: 'Unknown model' });
      continue;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removed.push(m.id);
    } catch (err) {
      failed.push({ id: m.id, error: message(err) });
    }
  }
  return { removed, failed };
}

// ---------------------------------------------------------------- the settings at work

/**
 * @param {object} o
 * @param {import('./history').History} o.history
 * @param {ReturnType<import('./audio-history').createAudioHistory>} o.audioHistory
 * @param {() => {historyRetention: string, audioHistory: string}} o.getSettings
 * @param {{warn: Function}} [o.log]
 */
function createPrivacy({ history, audioHistory, getSettings, timers = { setInterval, clearInterval }, log = { warn() {} } }) {
  let timer = null;
  const guard = (what, fn) => {
    try {
      return fn();
    } catch (err) {
      log.warn(`privacy: ${what} failed:`, message(err));
    }
  };

  /** Recordings that History no longer lists, or that are 24 hours old, go. */
  const sweepAudio = () => guard('sweeping recordings', () => audioHistory.sweep(Date.now(), { keep: new Set(history.list().map((i) => i.id)) }));

  return {
    /** At start: apply the settings now, then sweep every hour. */
    start() {
      const s = getSettings();
      guard('applying the history setting', () => history.setRetention(s.historyRetention));
      if (s.audioHistory === '24h') sweepAudio();
      else guard('deleting recordings', () => audioHistory.clear());
      timer = timers.setInterval(() => {
        guard('sweeping history', () => history.sweep());
        if (getSettings().audioHistory === '24h') sweepAudio();
      }, HOUR_MS);
      timer.unref?.();
    },

    stop() {
      if (timer) timers.clearInterval(timer);
      timer = null;
    },

    /** A setting changed (`patch` holds the keys). */
    apply(patch) {
      const s = getSettings();
      if ('historyRetention' in patch) guard('applying the history setting', () => history.setRetention(s.historyRetention));
      if ('audioHistory' in patch && s.audioHistory !== '24h') guard('deleting recordings', () => audioHistory.clear());
    },

    /** The recording of a dictation, next to its History item - only when recordings are on. */
    saveRecording(historyId, audio) {
      if (getSettings().audioHistory !== '24h' || !audio) return;
      guard('saving the recording', () => audioHistory.save(historyId, audio));
    },

    /**
     * The saved recording of a History item, ready to be transcribed again (Retry); null when there is none.
     * @returns {{audio: Float32Array, meta: object}|null}
     */
    savedRecording(historyId) {
      const item = history.list().find((i) => i.id === historyId);
      const wav = item && item.kind !== 'command' ? audioHistory.read(historyId) : null;
      if (!wav) return null;
      return guard('reading the recording', () => ({
        audio: decodeWav(wav).samples,
        meta: { durationMs: item.durationMs, engine: item.engine, command: false, translate: false, app: item.app ? { exe: item.app } : null },
      })) || null;
    },
  };
}

module.exports = {
  sweepHistory, deleteAllData, modelsOnDisk, deleteModels, createPrivacy, DAY_MS, HOUR_MS, RETENTIONS,
};
