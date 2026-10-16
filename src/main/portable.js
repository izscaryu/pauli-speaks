'use strict';
// Portable copies keep their data in a "Pauli Speaks Data" folder next to the
// exe instead of %APPDATA%\Pauli Speaks, so the app can run from a USB stick or
// a PC where you can't install software.
//
// Two kinds of portable copy:
//   - the single-file portable exe (electron-builder "portable" target). Its
//     launcher unpacks the app into a temp folder and runs it from there, so
//     process.execPath is a temp path; the launcher's own location arrives in
//     PORTABLE_EXECUTABLE_DIR / PORTABLE_EXECUTABLE_FILE.
//   - an unpacked copy (the win-unpacked folder) with an empty file named
//     "portable" next to Pauli Speaks.exe.
//
// setupPortable() must run before anything reads userData (logs, settings,
// history, models, Chromium's own files, the single-instance lock).

const nodeFs = require('node:fs');
const path = require('node:path');

const DATA_DIR_NAME = 'Pauli Speaks Data';
const MARKER = 'portable';

/**
 * @param {{env: object, execPath: string, isPackaged: boolean, exists: (p: string) => boolean}} where
 * @returns {{exeFile: string|null, dataDir: string}|null} null for an installed copy
 */
function detectPortable({ env, execPath, isPackaged, exists }) {
  if (env.PORTABLE_EXECUTABLE_DIR) {
    return {
      exeFile: env.PORTABLE_EXECUTABLE_FILE || null,
      dataDir: path.win32.join(env.PORTABLE_EXECUTABLE_DIR, DATA_DIR_NAME),
    };
  }
  if (!isPackaged) return null; // next to electron.exe in node_modules
  const exeDir = path.win32.dirname(execPath);
  if (!exists(path.win32.join(exeDir, MARKER))) return null;
  return { exeFile: execPath, dataDir: path.win32.join(exeDir, DATA_DIR_NAME) };
}

/**
 * Point userData at the folder next to the exe when this is a portable copy.
 * If that folder can't be written (a read-only drive), the default folder is
 * used and `error` says why; the copy still counts as portable.
 *
 * @returns {{active: false} | {active: true, exeFile: string|null, dataDir: string|null, error?: string}}
 */
function setupPortable(app, { env = process.env, execPath = process.execPath, fs = nodeFs } = {}) {
  const found = detectPortable({ env, execPath, isPackaged: app.isPackaged, exists: (p) => fs.existsSync(p) });
  if (!found) return { active: false };
  try {
    fs.mkdirSync(found.dataDir, { recursive: true });
    const probe = path.win32.join(found.dataDir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
  } catch (err) {
    return { active: true, exeFile: found.exeFile, dataDir: null, error: `Cannot write to ${found.dataDir} (${err.code || err.message}); using the default data folder` };
  }
  app.setPath('userData', found.dataDir);
  return { active: true, ...found };
}

module.exports = { DATA_DIR_NAME, detectPortable, setupPortable };
