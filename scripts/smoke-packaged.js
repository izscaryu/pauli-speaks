'use strict';
// Starts the packaged app and checks that it gets all the way through startup:
// the log says it started as a portable copy and reached the keyboard hook,
// the process is still running, and its floating bar and tray windows exist.
// Unit and end-to-end tests run the unpacked sources, so only this catches
// what breaks in the packed app (1.3.0-1.5.0 read build.publish, which
// electron-builder leaves out of the packed package.json, and stopped before
// the tray, the bar and the hook).
//
//   npx electron-builder --win dir --publish never
//   node scripts/smoke-packaged.js [dist/win-unpacked] [--timeout=30]
//
// An empty "portable" file next to the exe keeps the app's data in
// win-unpacked/Pauli Speaks Data (see src/main/portable.js); both are removed
// afterwards. --user-data-dir points at a folder outside win-unpacked, so a
// build whose portable mode is broken still never touches %APPDATA%.
// Run by .github/workflows/release.yml (before anything is published) and ci.yml.

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXE_NAME = 'Pauli Speaks.exe';
const DATA_DIR_NAME = 'Pauli Speaks Data';
const STARTED = 'starting (portable copy)';
const HOOK_STARTED = 'Global keyboard hook started';
const HOOK_FAILED = 'Could not start the global keyboard hook';
const OVERLAY_TITLE = 'Pauli Speaks Overlay';
const TRAY_CLASS = 'Electron_NotifyIconHostWindow'; // Electron's hidden window behind every tray icon

/** Where things are for the win-unpacked folder `dir`. */
function smokePaths(dir) {
  const dataDir = path.join(dir, DATA_DIR_NAME);
  return {
    exe: path.join(dir, EXE_NAME),
    marker: path.join(dir, 'portable'),
    dataDir,
    log: path.join(dataDir, 'logs', 'pauli-speaks.log'),
    fallbackDir: path.join(path.dirname(dir), 'smoke-user-data'),
  };
}

/** How far startup got, from the log text. hook: 'started' | 'failed' | null (not reached). */
function readLog(text) {
  const hook = text.includes(HOOK_STARTED) ? 'started' : text.includes(HOOK_FAILED) ? 'failed' : null;
  return { started: text.includes(STARTED), hook };
}

const hasOverlay = (windows) => windows.some((w) => w.title === OVERLAY_TITLE);
const hasTray = (windows) => windows.some((w) => w.className === TRAY_CLASS);

/**
 * @param {{log: string, alive: boolean, exitCode?: number|null, windows: {title: string, className: string}[]|null}} run
 *   windows: the app's top-level windows, or null when they weren't listed
 * @returns {string[]} problems; empty when the app started fully
 */
function checkStartup({ log, alive, exitCode = null, windows }) {
  const problems = [];
  const state = readLog(log);
  if (!state.started) problems.push(`The log never says "${STARTED}": the app did not start, or not as a portable copy.`);
  else if (!state.hook) problems.push('The app started but never reached the keyboard hook: startup (init() in main.js) stopped early.');
  if (!alive) problems.push(`The app exited during startup (exit code ${exitCode}).`);
  if (windows) {
    if (!hasOverlay(windows)) problems.push(`No "${OVERLAY_TITLE}" window: the floating bar was not created.`);
    if (!hasTray(windows)) problems.push('No tray icon window: the tray icon was not created.');
  }
  return problems;
}

/** The last `n` lines of `text`. */
function logTail(text, n = 40) {
  const lines = text.split(/\r?\n/).filter((l) => l !== '');
  return lines.length ? lines.slice(-n).join('\n') : '(empty)';
}

let user32 = null; // bound on first use, so the unit tests never load koffi

/** The top-level windows (hidden ones too) of process `pid`. */
function listWindows(pid) {
  if (!user32) {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    const EnumWindowsProc = koffi.proto('__stdcall', 'SmokeEnumWindowsProc', 'bool', ['void *', 'intptr_t']);
    user32 = {
      EnumWindows: lib.func('__stdcall', 'EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr_t']),
      GetWindowThreadProcessId: lib.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]),
      GetWindowTextW: lib.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int']),
      GetClassNameW: lib.func('__stdcall', 'GetClassNameW', 'int', ['void *', 'void *', 'int']),
    };
  }
  const { EnumWindows, GetWindowThreadProcessId, GetWindowTextW, GetClassNameW } = user32;
  const text = (fn, hwnd) => {
    const buf = Buffer.alloc(512);
    return buf.toString('utf16le', 0, fn(hwnd, buf, 256) * 2);
  };
  const windows = [];
  EnumWindows((hwnd) => {
    const owner = [0];
    GetWindowThreadProcessId(hwnd, owner);
    if (owner[0] === pid) windows.push({ title: text(GetWindowTextW, hwnd), className: text(GetClassNameW, hwnd) });
    return true;
  }, 0);
  return windows;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

async function smoke(dir, timeoutMs) {
  const p = smokePaths(dir);
  if (!fs.existsSync(p.exe)) return { problems: [`${p.exe} is missing. Build it first: npx electron-builder --win dir --publish never`], log: '', output: '' };
  for (const d of [p.dataDir, p.fallbackDir]) fs.rmSync(d, { recursive: true, force: true });
  fs.writeFileSync(p.marker, '');

  let output = '';
  let exitCode = null;
  let alive = true;
  const child = spawn(p.exe, [`--user-data-dir=${p.fallbackDir}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { output = (output + d).slice(-20000); });
  child.on('exit', (code) => { alive = false; exitCode = code; });
  child.on('error', (err) => { alive = false; output += `\n${err.message}`; });

  try {
    const deadline = Date.now() + timeoutMs;
    while (alive && Date.now() < deadline && !readLog(readText(p.log)).hook) await sleep(250);

    // The bar's title comes from its page, which may still be loading when the hook starts.
    let windows = null;
    const windowsDeadline = Date.now() + 10000;
    while (alive) {
      try {
        windows = listWindows(child.pid);
      } catch (err) {
        return { problems: [`Could not list the app's windows: ${err.message}`], log: readText(p.log), output };
      }
      if ((hasOverlay(windows) && hasTray(windows)) || Date.now() > windowsDeadline) break;
      await sleep(500);
    }

    const log = readText(p.log);
    return {
      problems: checkStartup({ log, alive, exitCode, windows }),
      log: log || readText(path.join(p.fallbackDir, 'logs', 'pauli-speaks.log')),
      output,
      hook: readLog(log).hook,
    };
  } finally {
    if (alive) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // already gone
      }
      for (let i = 0; alive && i < 40; i++) await sleep(250);
    }
    // The Chromium processes may hold files for a moment after the kill.
    for (const target of [p.marker, p.dataDir, p.fallbackDir]) fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const timeoutArg = args.find((a) => a.startsWith('--timeout='));
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'dist', 'win-unpacked'));
  const timeoutMs = (timeoutArg ? Number(timeoutArg.slice(10)) : 30) * 1000;
  smoke(dir, timeoutMs).then(({ problems, log, output, hook }) => {
    if (problems.length) {
      for (const x of problems) console.error(`✖ ${x}`);
      console.error(`\n--- last lines of the app's log ---\n${logTail(log)}`);
      if (output.trim()) console.error(`\n--- the app's console output ---\n${logTail(output)}`);
      process.exit(1);
    }
    if (hook === 'failed') console.log('⚠ The keyboard hook could not start on this machine (startup still got past it).');
    console.log(`✔ ${path.join(dir, EXE_NAME)} started as a portable copy, reached the keyboard hook, kept running and created its floating bar and tray icon.`);
  }, (err) => {
    console.error(`✖ ${err.stack}`);
    process.exit(1);
  });
}

module.exports = { smokePaths, readLog, checkStartup, logTail };
