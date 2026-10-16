'use strict';
// IPC for the first-run welcome flow (system check, model recommendation, finish) and the
// checks around it on Home: health (shortcut hook, conflicting apps), "Download again" for a
// model that won't load, and What's new. Takes everything Electron-specific through `deps`
// so it can be unit tested with a fake ipcMain.
//
//   deps = {
//     getSettings, updateSettings, systemLanguages, gpuInfo, processNames, appVersion,
//     hookError: () => string|null,        // why the global keyboard hook did not start
//     changelog: () => string,             // CHANGELOG.md text ('' when missing)
//     modelsDir: () => string, getModelState: () => ({ model, status }), preloadModel: () => Promise,
//     removeDir?: (dir) => void,           // default: recursive, forced fs.rmSync
//     log?,
//   }
//
// registerBackupIpc (Settings → Backup) takes
//   deps = { dialog, getWindow, getData: () => settings incl. secrets (only BACKUP_KEYS are written out),
//            updateSettings, appVersion, log? }

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  baseLanguageCodes, classifyGpu, recommendModel, findConflicts, parseTasklistCsv, redownloadPath,
} = require('./system-check');
const { changelogSection } = require('./changelog');
const { exportBackup, importBackup, NOT_A_BACKUP } = require('./settings-backup');
const { SETTINGS_VERSION } = require('./settings');

const TASKLIST_TIMEOUT_MS = 5000;
const MAX_BACKUP_BYTES = 1024 * 1024;
const BACKUP_FILTERS = [{ name: 'Pauli Speaks backup', extensions: ['json'] }];
const NO_GPU = Object.freeze({ usable: false, vendor: null });

/** Lower-cased image names of the running processes (Windows `tasklist`); [] on any error. */
function runningProcessNames() {
  return new Promise((resolve) => {
    try {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: TASKLIST_TIMEOUT_MS }, (err, stdout) => {
        resolve(err ? [] : parseTasklistCsv(String(stdout)));
      });
    } catch {
      resolve([]);
    }
  });
}

function registerWelcomeIpc(ipcMain, deps) {
  const { getSettings, updateSettings, systemLanguages, gpuInfo, processNames, appVersion } = deps;
  const removeDir = deps.removeDir || ((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  const log = deps.log || { warn() {} };

  // The GPU does not change while the app runs: classify once, on first use.
  let gpuPromise = null;
  const gpu = () => {
    if (!gpuPromise) {
      gpuPromise = (async () => classifyGpu(await gpuInfo()))().catch((err) => {
        log.warn('welcome: GPU check failed:', err && err.message);
        return NO_GPU;
      });
    }
    return gpuPromise;
  };

  const languages = () => {
    try {
      return baseLanguageCodes(systemLanguages());
    } catch (err) {
      log.warn('welcome: reading system languages failed:', err && err.message);
      return [];
    }
  };

  const conflicts = async () => {
    try {
      const names = await processNames();
      const found = findConflicts(names);
      if (found.length) log.info?.('welcome: conflicting apps running:', found.join(', '));
      return found;
    } catch (err) {
      log.warn('welcome: process check failed:', err && err.message);
      return [];
    }
  };

  ipcMain.handle('welcome:system', async () => {
    const langs = languages();
    const [g, found] = await Promise.all([gpu(), conflicts()]);
    return { languages: langs, gpu: g, conflicts: found, recommendation: recommendModel({ languages: langs, gpu: g }) };
  });

  ipcMain.handle('welcome:recommend', async (_e, payload) => {
    const langs = payload && Array.isArray(payload.languages) ? payload.languages : [];
    return recommendModel({ languages: langs, gpu: await gpu() });
  });

  ipcMain.handle('health:state', async () => ({
    hookError: (deps.hookError && deps.hookError()) || null,
    conflicts: await conflicts(),
  }));

  ipcMain.handle('whatsnew:get', () => {
    const s = getSettings();
    const version = appVersion();
    if (!s || s.onboarded !== true || s.lastSeenVersion === version) return null;
    const text = changelogSection(deps.changelog ? deps.changelog() : '', version);
    return text ? { version, text } : null;
  });

  // Always the running version, whatever the window sends.
  ipcMain.handle('whatsnew:seen', () => {
    updateSettings({ lastSeenVersion: appVersion() });
  });

  // "Download again": the configured model failed to load although it is marked downloaded. Delete its folder
  // (nothing else) and load it again; the missing ready-marker makes that a fresh download.
  ipcMain.handle('model:redownload', async () => {
    const wanted = (getSettings() || {}).localModel;
    const state = deps.getModelState();
    if (!state || state.status !== 'error' || state.model !== wanted) return { ok: false, error: 'The model is not in an error state.' };
    const root = deps.modelsDir();
    const dir = redownloadPath(root, wanted);
    if (!dir) return { ok: false, error: 'Unknown model.' };
    const rel = path.relative(path.resolve(root), path.resolve(dir));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'Unknown model.' };
    try {
      removeDir(dir);
    } catch (err) {
      log.warn('welcome: removing the model folder failed:', err && err.message);
      return { ok: false, error: String((err && err.message) || err) };
    }
    deps.preloadModel();
    return { ok: true };
  });

  ipcMain.handle('welcome:finish', () => {
    updateSettings({ onboarded: true, setupCard: false, lastSeenVersion: appVersion() });
    return getSettings();
  });
}

/** Settings → Backup: save the portable settings to a .json file, or load them back from one. */
function registerBackupIpc(ipcMain, deps) {
  const { dialog, getWindow, getData, updateSettings, appVersion } = deps;
  const log = deps.log || { warn() {} };
  // dialog.show*Dialog(win, options) when there is a window, dialog.show*Dialog(options) when not.
  const withWindow = (options) => {
    const win = getWindow && getWindow();
    return win ? [win, options] : [options];
  };

  ipcMain.handle('backup:export', async () => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(...withWindow({
        defaultPath: 'pauli-speaks-settings.json',
        filters: BACKUP_FILTERS,
      }));
      if (canceled || !filePath) return { ok: false, canceled: true };
      const backup = exportBackup(getData(), SETTINGS_VERSION, appVersion());
      await fs.promises.writeFile(filePath, JSON.stringify(backup, null, 2), 'utf8');
      return { ok: true };
    } catch (err) {
      log.warn('backup: export failed:', err && err.code);
      return { ok: false, error: "Couldn't save the file." };
    }
  });

  ipcMain.handle('backup:import', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(...withWindow({
        properties: ['openFile'],
        filters: BACKUP_FILTERS,
      }));
      if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
      const file = filePaths[0];
      if ((await fs.promises.stat(file)).size > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is too big to be a Pauli Speaks backup.' };
      let json;
      try {
        json = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch {
        return { ok: false, error: NOT_A_BACKUP };
      }
      const r = importBackup(json, SETTINGS_VERSION);
      if (!r.ok) return r;
      updateSettings(r.patch);
      return { ok: true };
    } catch (err) {
      log.warn('backup: import failed:', err && err.code);
      return { ok: false, error: "Couldn't read the file." };
    }
  });
}

module.exports = { registerWelcomeIpc, registerBackupIpc, runningProcessNames };
