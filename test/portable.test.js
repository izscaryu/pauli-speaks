'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DATA_DIR_NAME, detectPortable, setupPortable } = require('../src/main/portable');

const installedExe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Pauli Speaks\\Pauli Speaks.exe';
const tempExe = 'C:\\Users\\me\\AppData\\Local\\Temp\\2abc\\Pauli Speaks.exe';
const nothing = () => false;

test('the single-file portable exe is detected from the launcher\'s environment, not the temp path it runs from', () => {
  const found = detectPortable({
    env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools', PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\Pauli-Speaks-Portable-1.2.0.exe' },
    execPath: tempExe,
    isPackaged: true,
    exists: nothing,
  });
  assert.deepEqual(found, {
    exeFile: 'D:\\Tools\\Pauli-Speaks-Portable-1.2.0.exe',
    dataDir: `D:\\Tools\\${DATA_DIR_NAME}`,
  });
});

test('an unpacked copy is portable when a "portable" file sits next to its exe', () => {
  const dir = 'E:\\PauliSpeaks';
  const seen = [];
  const found = detectPortable({
    env: {},
    execPath: `${dir}\\Pauli Speaks.exe`,
    isPackaged: true,
    exists: (p) => (seen.push(p), p === `${dir}\\portable`),
  });
  assert.deepEqual(found, { exeFile: `${dir}\\Pauli Speaks.exe`, dataDir: `${dir}\\${DATA_DIR_NAME}` });
  assert.deepEqual(seen, [`${dir}\\portable`]);
});

test('an installed copy is not portable', () => {
  assert.equal(detectPortable({ env: {}, execPath: installedExe, isPackaged: true, exists: nothing }), null);
  assert.equal(detectPortable({ env: { PORTABLE_EXECUTABLE_DIR: '' }, execPath: installedExe, isPackaged: true, exists: nothing }), null);
});

test('a source checkout ignores a marker next to electron.exe but honours the launcher variables (to try portable mode)', () => {
  const electron = 'C:\\dev\\pauli-speaks\\node_modules\\electron\\dist\\electron.exe';
  assert.equal(detectPortable({ env: {}, execPath: electron, isPackaged: false, exists: () => true }), null);
  const found = detectPortable({ env: { PORTABLE_EXECUTABLE_DIR: 'C:\\scratch' }, execPath: electron, isPackaged: false, exists: nothing });
  assert.equal(found.dataDir, `C:\\scratch\\${DATA_DIR_NAME}`);
  assert.equal(found.exeFile, null, 'no launcher file: nothing to point links or start-at-login at');
});

// --- setupPortable ------------------------------------------------------------

function fakeApp({ isPackaged = true } = {}) {
  const paths = {};
  return { isPackaged, paths, setPath: (name, value) => (paths[name] = value) };
}

test('an installed copy keeps the default data folder', () => {
  const app = fakeApp();
  const info = setupPortable(app, { env: {}, execPath: installedExe });
  assert.deepEqual(info, { active: false });
  assert.deepEqual(app.paths, {});
});

test('a portable copy creates its data folder next to the exe and points userData at it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-portable-'));
  const app = fakeApp();
  const info = setupPortable(app, { env: { PORTABLE_EXECUTABLE_DIR: dir, PORTABLE_EXECUTABLE_FILE: path.join(dir, 'P.exe') }, execPath: tempExe });
  const dataDir = path.win32.join(dir, DATA_DIR_NAME);
  assert.deepEqual(info, { active: true, exeFile: path.join(dir, 'P.exe'), dataDir });
  assert.deepEqual(app.paths, { userData: dataDir });
  assert.ok(fs.statSync(dataDir).isDirectory());
  assert.deepEqual(fs.readdirSync(dataDir), [], 'the write test leaves nothing behind');
});

test('a portable copy that cannot write next to its exe falls back to the default folder and says why', () => {
  const app = fakeApp();
  const readOnly = {
    existsSync: () => false,
    mkdirSync: () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
  };
  const info = setupPortable(app, { env: { PORTABLE_EXECUTABLE_DIR: 'Z:\\ReadOnly' }, execPath: tempExe, fs: readOnly });
  assert.equal(info.active, true, 'still portable: no links or start-at-login for a temp path');
  assert.equal(info.dataDir, null);
  assert.match(info.error, /Z:\\ReadOnly.*EPERM/);
  assert.deepEqual(app.paths, {});
});
