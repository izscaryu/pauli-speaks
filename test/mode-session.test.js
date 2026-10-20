'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createModeSession } = require('../src/main/mode-session');
const { normalizeModes } = require('../src/main/modes');

function rig({ exe = 'notepad.exe' } = {}) {
  const s = {
    translation: { target: 'de', quality: 'fast' },
    modes: normalizeModes([{ id: 'default' }, { id: 'code', style: 'code', apps: ['code.exe'] }, { id: 'hr', language: 'hr', style: 'casual' }]),
  };
  const front = { exe };
  const session = createModeSession({ settings: { get: () => s }, foregroundApp: () => (front.exe ? { exe: front.exe, pid: 1 } : null) });
  return { session, s, front };
}

test('resolve: the app in front picks the mode, and is handed back for pasting', () => {
  const { session, front } = rig({ exe: 'Code.exe' });
  const r = session.resolve();
  assert.equal(r.mode.id, 'code');
  assert.deepEqual(r.app, { exe: 'Code.exe', pid: 1 });
  front.exe = null;
  assert.equal(session.resolve().mode.id, 'default');
  assert.equal(session.resolve().app, null);
});

test('resolve: a shortcut\'s mode and a link\'s mode come before the app', () => {
  const { session } = rig({ exe: 'code.exe' });
  assert.equal(session.resolve({ binding: { action: 'dictate', mode: 'hr' } }).mode.id, 'hr');
  assert.equal(session.resolve({ link: 'hr' }).mode.id, 'hr');
  assert.equal(session.resolve({ binding: { action: 'dictate' } }).mode.id, 'code');
});

test('resolve: the old Talk & translate shortcut translates into the translation target', () => {
  const { session } = rig();
  const { mode } = session.resolve({ binding: { action: 'translate' } });
  assert.equal(mode.translateTo, 'de');
});

test('cycle: Switch mode goes through the modes and back to Automatic, and the choice sticks', () => {
  const { session } = rig({ exe: 'code.exe' });
  assert.equal(session.switched, null);
  assert.equal(session.cycle().switched, 'default');
  assert.equal(session.resolve().mode.id, 'default', 'the choice beats the app in front');
  assert.equal(session.cycle().switched, 'code');
  assert.equal(session.cycle().switched, 'hr');
  const back = session.cycle();
  assert.equal(back.switched, null);
  assert.equal(back.mode.id, 'code', 'Automatic: the app in front again');
});

test('cycle from a running dictation goes on from the mode it is in', () => {
  const { session } = rig({ exe: 'code.exe' });
  const r = session.cycle('code');
  assert.equal(r.switched, 'hr');
  assert.equal(r.mode.id, 'hr');
});

test('cycle: Automatic resolves with the app the dictation started in', () => {
  const { session, front } = rig({ exe: 'code.exe' });
  session.resolve();
  front.exe = 'notepad.exe';
  assert.equal(session.cycle('hr').mode.id, 'code');
});

test('cycle forgets a chosen mode that was deleted', () => {
  const { session, s } = rig();
  session.cycle();
  session.cycle(); // code
  s.modes = s.modes.filter((m) => m.id !== 'code');
  assert.equal(session.resolve().mode.id, 'default');
  assert.equal(session.cycle().switched, 'default', 'a mode that is gone counts as Automatic');
});

test('resolve a kept recording: the mode it was recorded in, never the app in front now', () => {
  const { session } = rig({ exe: 'code.exe' });
  assert.equal(session.resolve({ kept: { mode: 'hr' } }).mode.id, 'hr');
  assert.equal(session.resolve({ kept: { mode: 'gone', app: { exe: 'notepad.exe' } } }).mode.id, 'default');
  assert.equal(session.resolve({ kept: { translate: true } }).mode.translateTo, 'de', 'older entries only say they were translated');
  assert.equal(session.resolve({ kept: { app: { exe: 'code.exe' } } }).mode.id, 'code');
  assert.equal(session.resolve({ kept: {} }).app, null, 'the app to paste into is decided by the retry itself');
});
