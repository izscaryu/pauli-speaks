'use strict';
// Export and import of the settings a person would want on a new computer: shortcuts, voice commands,
// dictionary, snippets and modes. Never the cloud settings, so no API key can end up in a file.
// Pure functions; the dialogs and file access are in welcome-ipc.js.

const { runMigrations, MIGRATIONS } = require('./settings');
const { normalizeBindings } = require('./shortcut-rules');
const { t } = require('./strings');

const BACKUP_KEYS = Object.freeze(['bindings', 'voiceCommands', 'voiceCommandsEnabled', 'dictionary', 'snippets', 'modes']);

// In English, for the tests; the messages themselves are errors.notBackup and errors.backupTooNew.
const NOT_A_BACKUP = "This isn't a Pauli Speaks backup.";
const TOO_NEW = 'This backup is from a newer Pauli Speaks. Update first.';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const hasStrings = (v, ...keys) => isPlainObject(v) && keys.every((k) => Object.hasOwn(v, k) && typeof v[k] === 'string');

/**
 * Each backup key's value as it may be applied, or undefined to leave the current setting alone.
 * Malformed list elements are dropped: one bad entry must not break dictation or the Settings page.
 */
const CLEAN = {
  // Shortcuts are cleaned by settings.update(); a list that cleans up to nothing would wipe every
  // shortcut, so then the current ones stay.
  bindings: (v) => {
    if (!Array.isArray(v)) return undefined;
    const clean = normalizeBindings(v);
    return v.length && !clean.length ? undefined : clean;
  },
  // The commands themselves are checked by normalizeVoiceCommands() in settings.update().
  voiceCommands: (v) => (Array.isArray(v) ? v.filter(isPlainObject) : undefined),
  voiceCommandsEnabled: (v) => (typeof v === 'boolean' ? v : undefined),
  dictionary: (v) => (Array.isArray(v) ? v.filter((e) => hasStrings(e, 'from', 'to')) : undefined),
  snippets: (v) => (Array.isArray(v) ? v.filter((e) => hasStrings(e, 'trigger', 'text')) : undefined),
  // Each mode is checked by normalizeModes() in settings.update().
  modes: (v) => (Array.isArray(v) ? v.filter(isPlainObject) : undefined),
};

/** The backup file's content for the given settings data (a copy of own BACKUP_KEYS only). */
function exportBackup(data, settingsVersion, appVersion) {
  const settings = {};
  for (const key of BACKUP_KEYS) {
    if (data && Object.hasOwn(data, key)) settings[key] = structuredClone(data[key]);
  }
  return { app: 'pauli-speaks', settingsVersion, appVersion, exportedAt: new Date().toISOString(), settings };
}

/** Check a parsed backup and return the settings patch to apply, or an error to show. */
function importBackup(json, currentVersion) {
  if (!isPlainObject(json) || json.app !== 'pauli-speaks' || !isPlainObject(json.settings)
    || !Number.isInteger(json.settingsVersion) || json.settingsVersion < 1) {
    return { ok: false, error: t('errors.notBackup') };
  }
  if (json.settingsVersion > currentVersion) return { ok: false, error: t('errors.backupTooNew') };
  let migrated;
  try {
    migrated = runMigrations({ ...json.settings, settingsVersion: json.settingsVersion }, MIGRATIONS, currentVersion);
  } catch {
    return { ok: false, error: t('errors.notBackup') };
  }
  const patch = {};
  // Migrating to v7 makes modes from the app styles; a backup that had neither leaves your modes alone.
  const hasModes = Object.hasOwn(json.settings, 'modes') || Object.hasOwn(json.settings, 'appStyles');
  for (const key of BACKUP_KEYS) {
    if (!Object.hasOwn(migrated, key) || (key === 'modes' && !hasModes)) continue;
    const value = CLEAN[key](migrated[key]);
    if (value !== undefined) patch[key] = value;
  }
  return { ok: true, patch };
}

module.exports = { BACKUP_KEYS, exportBackup, importBackup, NOT_A_BACKUP, TOO_NEW };
