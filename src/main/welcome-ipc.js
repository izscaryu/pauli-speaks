'use strict';
// IPC for the first-run welcome flow: system check, model recommendation, finish.
// Takes everything Electron-specific through `deps` so it can be unit tested with
// a fake ipcMain.
//
//   deps = { getSettings, updateSettings, systemLanguages, gpuInfo, processNames, appVersion, log? }

const { execFile } = require('node:child_process');
const {
  baseLanguageCodes, classifyGpu, recommendModel, findConflicts, parseTasklistCsv,
} = require('./system-check');

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

  ipcMain.handle('welcome:finish', () => {
    updateSettings({ onboarded: true, setupCard: false, lastSeenVersion: appVersion() });
    return getSettings();
  });
}

module.exports = { registerWelcomeIpc, runningProcessNames };
