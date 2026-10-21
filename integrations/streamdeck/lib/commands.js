'use strict';
// What each Stream Deck button does, as plain data: a pauli-speaks:// link to open, or the
// app's exe with a flag. The app reads both in src/main/remote.js; links only control
// dictation, so Paste last needs the exe. Pure (no Stream Deck, no files) so it can be
// unit tested from the app's own `npm test`.

const path = require('node:path');

const PROTOCOL = 'pauli-speaks';
const UUID_PREFIX = 'com.pauli.speaks.streamdeck.';
const PRODUCT = 'Pauli Speaks';
const EXE_NAME = `${PRODUCT}.exe`;

// Button name -> the last part of its action UUID in manifest.json.
const ACTIONS = {
  toggle: 'toggle',
  start: 'start',
  stop: 'stop',
  cancel: 'cancel',
  pasteLast: 'paste-last',
};
const TAKES_MODE = new Set(['toggle', 'start']);
const EXE_FLAGS = { pasteLast: ['--paste-last'] };

// Same rule as MODE_NAME in src/main/remote.js.
const MODE_NAME = /^[A-Za-z0-9_-]{1,40}$/;

/** @returns {string | null} '' for no mode, the mode, or null when it isn't a plain name */
function cleanMode(mode) {
  if (mode === undefined || mode === null) return '';
  if (typeof mode !== 'string') return null;
  const trimmed = mode.trim();
  if (trimmed === '') return '';
  return MODE_NAME.test(trimmed) ? trimmed : null;
}

/**
 * A full local path to the app's own exe (Pauli Speaks.exe, not a network share), with nothing that could smuggle
 * in more arguments. Only the app is ever started, whatever is typed into the button's settings.
 */
function isAppExe(file) {
  return (
    typeof file === 'string' &&
    file.length < 1024 &&
    /^[A-Za-z]:\\/.test(file) &&
    path.win32.basename(file).toLowerCase() === EXE_NAME.toLowerCase() &&
    !/["\x00-\x1f]/.test(file)
  );
}

/**
 * @param {string} action a key of ACTIONS
 * @param {{mode?: string, exePath?: string}} [settings]
 * @returns {{kind: 'link', url: string} | {kind: 'exe', file: string, args: string[]} | {error: string}}
 */
function commandFor(action, settings) {
  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) return { error: 'unknown-action' };
  const { mode, exePath } = settings || {};
  if (Object.hasOwn(EXE_FLAGS, action)) {
    return isAppExe(exePath) ? { kind: 'exe', file: exePath, args: [...EXE_FLAGS[action]] } : { error: 'no-app' };
  }
  const url = `${PROTOCOL}://dictate/${action}`;
  if (!TAKES_MODE.has(action)) return { kind: 'link', url };
  const clean = cleanMode(mode);
  if (clean === null) return { error: 'bad-mode' };
  return { kind: 'link', url: clean ? `${url}?mode=${clean}` : url };
}

/** The process to start for a command, or null for anything that isn't one of ours. */
function launchFor(command, env = process.env) {
  if (!command) return null;
  if (command.kind === 'link' && typeof command.url === 'string' && command.url.startsWith(`${PROTOCOL}://`)) {
    // Asks Windows to open the link, which hands it to the running app (or starts it). rundll32 by its full path,
    // so a rundll32.exe in the current folder is never the one that runs.
    const rundll32 = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'rundll32.exe');
    return { file: rundll32, args: ['url.dll,FileProtocolHandler', command.url] };
  }
  if (command.kind === 'exe' && isAppExe(command.file)) return { file: command.file, args: command.args };
  return null;
}

/** The default value from `reg query <key> /ve` output, e.g. '"C:\...\Pauli Speaks.exe" "%1"'. */
function parseRegQuery(output) {
  if (typeof output !== 'string') return null;
  const match = output.match(/^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);
  return match ? match[1] : null;
}

/** The installed app's exe from the link handler's command; null for a dev checkout (electron.exe). */
function exeFromProtocolCommand(command) {
  if (typeof command !== 'string') return null;
  const match = command.match(/^"([^"]+)"/) || command.match(/^(\S+)/);
  const file = match && match[1];
  return isAppExe(file) && path.win32.basename(file).toLowerCase() === EXE_NAME.toLowerCase() ? file : null;
}

/**
 * Where the app may be, best first: the exe the pauli-speaks link opens (it knows a changed
 * install folder), then the installer's default per-user folder, then Program Files.
 * electron-builder's NSIS installer (perMachine: false) uses %LOCALAPPDATA%\Programs\<productName>.
 */
function exeCandidates(env, protocolExe) {
  const list = [];
  if (protocolExe) list.push(protocolExe);
  if (env && env.LOCALAPPDATA) list.push(path.win32.join(env.LOCALAPPDATA, 'Programs', PRODUCT, EXE_NAME));
  if (env && env.ProgramFiles) list.push(path.win32.join(env.ProgramFiles, PRODUCT, EXE_NAME));
  return list.filter((file, i) => isAppExe(file) && list.findIndex((f) => f.toLowerCase() === file.toLowerCase()) === i);
}

module.exports = {
  ACTIONS,
  UUID_PREFIX,
  PROTOCOL,
  cleanMode,
  isAppExe,
  commandFor,
  launchFor,
  parseRegQuery,
  exeFromProtocolCommand,
  exeCandidates,
};
