'use strict';
// IPC for About → "Copy diagnostic info" and "Report a problem": gathers what a bug report needs and
// hands it to diagnostics.js. Everything Electron- or system-specific comes in through `deps`, so it is
// unit tested with fakes. A part that can't be gathered is shown as unknown; the rest is still copied.
//
//   deps = {
//     appVersion, isPortable, getSettings (full settings; only names and switches are read, never the key),
//     hasApiKey, os (node:os), gpuInfo, getModelState, getTranslatorState, modelsDir, modelIds,
//     dirSize?: (dir) => bytes, formatKeys: (keys) => string, hookError, processNames, recentLog: (n) => string[],
//     writeClipboard, openExternal, repo: {owner, repo}, log?,
//   }

const fs = require('node:fs');
const path = require('node:path');
const { buildDiagnostics, scrubLogLine, issueUrl, LOG_LINES } = require('./diagnostics');
const { classifyGpu, findConflicts } = require('./system-check');

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Bytes in a folder and everything under it; 0 when it is missing. */
function folderSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      total += e.isDirectory() ? folderSize(p) : fs.statSync(p).size;
    } catch {
      // a file that went away meanwhile
    }
  }
  return total;
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
};

/** Only what diagnostics.js shows; states keep their status, device and errors (no promises, no paths). */
const pickState = (s) => (s ? { status: s.status, device: s.device || null, gpuError: s.gpuError || null, error: s.error || null } : null);

function registerDiagnosticsIpc(ipcMain, deps) {
  const log = deps.log || { warn() {} };
  const dirSize = deps.dirSize || folderSize;

  const attempt = async (what, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      log.warn(`diagnostics: ${what} failed: ${err && err.message}`);
      return fallback;
    }
  };

  async function gather() {
    const s = deps.getSettings();
    const { os } = deps;
    const home = await attempt('home folder', () => os.homedir(), '');
    const cpus = await attempt('CPU', () => os.cpus(), []);
    return {
      app: { version: deps.appVersion(), portable: !!deps.isPortable(), betaUpdates: !!s.betaUpdates },
      system: await attempt('system', () => ({
        windows: os.release(), arch: os.arch(),
        cpu: String((cpus[0] && cpus[0].model) || 'unknown').trim(), threads: cpus.length,
        ramGb: os.totalmem() / GB, freeRamGb: os.freemem() / GB,
      }), null),
      gpu: await attempt('GPU', async () => classifyGpu(await deps.gpuInfo()), null),
      engine: {
        engine: s.engine, localModel: s.localModel, acceleration: s.acceleration,
        cloudModel: s.cloud && s.cloud.model, cloudHost: hostOf(s.cloud && s.cloud.baseUrl), hasApiKey: !!deps.hasApiKey(),
      },
      model: pickState(deps.getModelState()),
      translator: pickState(deps.getTranslatorState()),
      models: await attempt('model folders', () => deps.modelIds
        .map((id) => ({ id, mb: Math.round(dirSize(path.join(deps.modelsDir(), ...id.split('/'))) / MB) }))
        .filter((m) => m.mb > 0), []),
      languages: s.languages || [],
      switches: {
        silenceDetection: s.silenceDetection, crashRecovery: s.crashRecovery, historyRetention: s.historyRetention,
        audioHistory: s.audioHistory, voiceCommandsEnabled: s.voiceCommandsEnabled, livePreview: s.livePreview,
      },
      bindings: (s.bindings || []).map((b) => ({ action: b.action, keys: deps.formatKeys(b.keys), behaviour: b.behaviour || null })),
      hookError: deps.hookError() || null,
      conflicts: await attempt('running apps', async () => findConflicts(await deps.processNames()), []),
      log: (deps.recentLog(LOG_LINES) || []).map((line) => scrubLogLine(line, home)),
    };
  }

  async function copy() {
    const info = await gather();
    try {
      await deps.writeClipboard(buildDiagnostics(info));
    } catch (err) {
      return { ok: false, error: err && err.message };
    }
    return { ok: true, lines: info.log.length };
  }

  ipcMain.handle('diagnostics:copy', () => copy());
  ipcMain.handle('diagnostics:report', async () => {
    const out = await copy();
    if (out.ok) await deps.openExternal(issueUrl(deps.repo, deps.appVersion()));
    return out;
  });
}

module.exports = { registerDiagnosticsIpc, folderSize };
