'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { smokePaths, readLog, checkStartup, logTail } = require('../scripts/smoke-packaged');

const line = (level, text) => `2026-10-20T10:00:00.000Z [${level}] ${text}`;
const started = line('info', 'Pauli Speaks 1.5.0 starting (portable copy)');
const hookOk = line('info', 'Global keyboard hook started');
const hookFailed = line('error', 'Could not start the global keyboard hook Error: no desktop');
const overlay = { title: 'Pauli Speaks Overlay', className: 'Chrome_WidgetWin_1' };
const tray = { title: '', className: 'Electron_NotifyIconHostWindow' };

test('the portable marker, the data folder and the log sit next to the exe', () => {
  const dir = path.join('C:', 'dist', 'win-unpacked');
  const p = smokePaths(dir);
  assert.equal(p.exe, path.join(dir, 'Pauli Speaks.exe'));
  assert.equal(p.marker, path.join(dir, 'portable'));
  assert.equal(p.dataDir, path.join(dir, 'Pauli Speaks Data'));
  assert.equal(p.log, path.join(dir, 'Pauli Speaks Data', 'logs', 'pauli-speaks.log'));
});

test('the fallback data folder is not inside win-unpacked, so it never ships', () => {
  const dir = path.join('C:', 'dist', 'win-unpacked');
  assert.ok(!smokePaths(dir).fallbackDir.startsWith(dir + path.sep));
});

test('an empty log has not started', () => {
  assert.deepEqual(readLog(''), { started: false, hook: null });
});

test('a portable start that reaches the keyboard hook is ready', () => {
  assert.deepEqual(readLog([started, hookOk].join('\n')), { started: true, hook: 'started' });
});

test('a keyboard hook that could not start still means startup got that far', () => {
  assert.deepEqual(readLog([started, hookFailed].join('\n')), { started: true, hook: 'failed' });
});

test('a start that is not a portable copy does not count', () => {
  assert.equal(readLog(line('info', 'Pauli Speaks 1.5.0 starting')).started, false);
});

test('a full start passes', () => {
  assert.deepEqual(checkStartup({ log: [started, hookOk].join('\n'), alive: true, windows: [overlay, tray] }), []);
});

test('1.3.0-1.5.0: started, then init() threw before the hook', () => {
  const problems = checkStartup({ log: started, alive: true, windows: [] });
  assert.ok(problems.some((p) => /keyboard hook/.test(p)));
  assert.ok(problems.some((p) => /floating bar/.test(p)));
  assert.ok(problems.some((p) => /tray/.test(p)));
});

test('no log at all says the app never started as a portable copy', () => {
  const problems = checkStartup({ log: '', alive: true, windows: null });
  assert.ok(problems.some((p) => /portable copy/.test(p)));
});

test('an app that exited is a failure even with a good log', () => {
  const problems = checkStartup({ log: [started, hookOk].join('\n'), alive: false, exitCode: 3, windows: null });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /exited.*3/);
});

test('windows are only checked when they could be listed', () => {
  assert.deepEqual(checkStartup({ log: [started, hookOk].join('\n'), alive: true, windows: null }), []);
});

test('the log tail keeps the last lines', () => {
  const text = ['a', 'b', 'c', 'd', ''].join('\n');
  assert.equal(logTail(text, 2), 'c\nd');
  assert.equal(logTail('', 5), '(empty)');
});
