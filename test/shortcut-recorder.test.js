'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ShortcutRecorder } = require('../src/main/shortcut-recorder');
const { DEFAULTS } = require('../src/main/settings');

function setup(start = { action: 'copyLast' }) {
  let now = 0;
  const timers = [];
  const updates = [];
  const saves = [];
  let ended = 0;
  const bindings = structuredClone(DEFAULTS.bindings);
  const rec = new ShortcutRecorder({
    getBindings: () => bindings,
    onUpdate: (u) => updates.push(u),
    onSave: (next, binding) => saves.push({ next, binding }),
    onEnd: () => ended++,
    timers: {
      setTimeout: (fn, ms) => {
        const t = { fn, at: now + ms, done: false };
        timers.push(t);
        return t;
      },
      clearTimeout: (t) => {
        if (t) t.done = true;
      },
    },
  });
  rec.start(start);
  const press = (...keys) => rec.handle({ keys, isRelease: false });
  const release = (keys, remaining = [], doubleTap = false) => rec.handle({ keys, isRelease: true, remaining, doubleTap });
  const advance = (ms) => {
    now += ms;
    for (const t of timers) if (!t.done && t.at <= now) { t.done = true; t.fn(); }
  };
  return { rec, updates, saves, press, release, advance, ended: () => ended };
}

test('keyboard shortcuts save when every key is released', () => {
  const { rec, saves, press, release, updates, ended } = setup();
  press('Ctrl');
  press('Ctrl', 'Shift');
  press('Ctrl', 'Shift', 'K');
  release(['Ctrl', 'Shift', 'K'], ['Ctrl', 'Shift']);
  release(['Ctrl', 'Shift'], ['Ctrl']);
  assert.equal(saves.length, 0);
  release(['Ctrl'], []);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].binding, { id: 'copyLast-1', action: 'copyLast', keys: ['Ctrl', 'Shift', 'K'] });
  assert.equal(saves[0].next.length, DEFAULTS.bindings.length + 1);
  assert.equal(rec.active, false);
  assert.equal(ended(), 1);
  assert.deepEqual(updates.at(-1), { action: 'copyLast', done: true, keys: ['Ctrl', 'Shift', 'K'], binding: saves[0].binding });
});

test('mouse buttons save on press; a new talk shortcut is "both"', () => {
  const { saves, press } = setup({ action: 'dictate' });
  press('Mouse4');
  assert.deepEqual(saves[0].binding, { id: 'dictate-3', action: 'dictate', keys: ['Mouse4'], behaviour: 'both' });
});

test('Esc cancels, except when recording Cancel itself', () => {
  let s = setup();
  s.press('Escape');
  s.release(['Escape']);
  assert.equal(s.saves.length, 0);
  assert.deepEqual(s.updates.at(-1), { action: 'copyLast', done: true, cancelled: true });
  assert.equal(s.rec.active, false);
  s = setup({ action: 'cancel', replaceId: 'cancel-1' });
  s.press('Escape');
  s.release(['Escape']);
  assert.equal(s.saves.length, 1);
});

test('Backspace clears and keeps recording', () => {
  const { rec, updates, press, release, saves } = setup();
  press('Backspace');
  release(['Backspace']);
  assert.deepEqual(updates.at(-1), { action: 'copyLast', keys: [], cleared: true });
  assert.equal(rec.active, true);
  press('F13');
  release(['F13']);
  assert.deepEqual(saves[0].binding.keys, ['F13']);
});

test('a hard error is shown and recording goes on', () => {
  const { rec, updates, press, release, saves } = setup();
  press('Meta');
  press('Meta', 'L');
  release(['Meta', 'L'], ['Meta']);
  release(['Meta']);
  assert.equal(updates.at(-1).error.code, 'reserved');
  assert.equal(rec.active, true);
  press('F13');
  release(['F13']);
  assert.equal(saves.length, 1);
});

test('a common app shortcut waits for "Use anyway"', () => {
  const { rec, updates, press, release, saves } = setup();
  press('Ctrl');
  press('Ctrl', 'C');
  release(['Ctrl', 'C'], ['Ctrl']);
  release(['Ctrl']);
  assert.deepEqual(updates.at(-1).warning, { code: 'common', params: { keys: ['Ctrl', 'C'], what: 'copy' } });
  press('F13');
  release(['F13']);
  assert.equal(saves.length, 0, 'keys are ignored while the warning is up');
  rec.confirm();
  assert.deepEqual(saves[0].binding.keys, ['Ctrl', 'C']);
});

test('"Try another" drops the warned shortcut', () => {
  const { rec, updates, press, release, saves } = setup();
  press('Ctrl', 'V');
  release(['Ctrl', 'V'], ['Ctrl']);
  release(['Ctrl']);
  rec.retry();
  assert.deepEqual(updates.at(-1), { action: 'copyLast', keys: [], cleared: true });
  press('F14');
  release(['F14']);
  assert.deepEqual(saves[0].binding.keys, ['F14']);
});

test('a single modifier waits for a second tap', () => {
  let s = setup({ action: 'dictate' });
  s.press('CtrlRight');
  s.release(['CtrlRight']);
  assert.equal(s.saves.length, 0);
  s.press('CtrlRight');
  s.release(['CtrlRight'], [], true);
  assert.deepEqual(s.saves[0].binding, { id: 'dictate-3', action: 'dictate', keys: ['CtrlRight'], trigger: 'doubleTap', behaviour: 'toggle' });
  s = setup({ action: 'dictate' });
  s.press('CtrlRight');
  s.release(['CtrlRight']);
  s.advance(500);
  assert.deepEqual(s.saves[0].binding.keys, ['CtrlRight'], 'no second tap: Right Ctrl held is the shortcut');
  assert.equal(s.saves[0].binding.trigger, undefined);
});

test('left Ctrl alone suggests a double-tap', () => {
  const { updates, press, release, advance, saves } = setup();
  press('Ctrl');
  release(['Ctrl']);
  advance(500);
  assert.equal(saves.length, 0);
  assert.deepEqual(updates.at(-1).error, { code: 'modifierAlone', params: { keys: ['Ctrl'] } });
});

test('Change replaces a shortcut and keeps its behaviour', () => {
  const { saves, press, release } = setup({ action: 'dictate', replaceId: 'dictate-2' });
  press('F13');
  release(['F13']);
  const b = saves[0].next.find((x) => x.id === 'dictate-2');
  assert.deepEqual(b, { id: 'dictate-2', action: 'dictate', keys: ['F13'], behaviour: 'toggle' });
  assert.equal(saves[0].next.length, DEFAULTS.bindings.length);
});

test('stop() ends recording without saving', () => {
  const { rec, saves, press, ended } = setup();
  press('Ctrl');
  rec.stop();
  assert.equal(rec.active, false);
  assert.equal(ended(), 1);
  assert.equal(saves.length, 0);
});
