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

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  baseLanguageCodes, classifyGpu, recommendModel, findConflicts, parseTasklistCsv, redownloadPath,
} = require('./system-check');
const { changelogSection } = require('./changelog');

const TASKLIST_TIMEOUT_MS = 5000;
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

module.exports = { registerWelcomeIpc, runningProcessNames };
