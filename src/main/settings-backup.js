'use strict';
// Export and import of the settings a person would want on a new computer: shortcuts, voice commands,
// dictionary, snippets and per-app styles. Never the cloud settings, so no API key can end up in a file.
// Pure functions; the dialogs and file access are in welcome-ipc.js.

const { runMigrations, MIGRATIONS } = require('./settings');

const BACKUP_KEYS = Object.freeze(['bindings', 'voiceCommands', 'voiceCommandsEnabled', 'dictionary', 'snippets', 'appStyles']);

const NOT_A_BACKUP = "This isn't a Pauli Speaks backup.";
const TOO_NEW = 'This backup is from a newer Pauli Speaks. Update first.';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What each backup key must be at the top level. */
const TYPE_OK = {
  bindings: Array.isArray,
  voiceCommands: Array.isArray,
  voiceCommandsEnabled: (v) => typeof v === 'boolean',
  dictionary: Array.isArray,
  snippets: Array.isArray,
  appStyles: isPlainObject,
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
    return { ok: false, error: NOT_A_BACKUP };
  }
  if (json.settingsVersion > currentVersion) return { ok: false, error: TOO_NEW };
  let migrated;
  try {
    migrated = runMigrations({ ...json.settings, settingsVersion: json.settingsVersion }, MIGRATIONS, currentVersion);
  } catch {
    return { ok: false, error: NOT_A_BACKUP };
  }
  const patch = {};
  for (const key of BACKUP_KEYS) {
    if (Object.hasOwn(migrated, key) && TYPE_OK[key](migrated[key])) patch[key] = migrated[key];
  }
  return { ok: true, patch };
}

module.exports = { BACKUP_KEYS, exportBackup, importBackup, NOT_A_BACKUP, TOO_NEW };
