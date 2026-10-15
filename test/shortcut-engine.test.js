'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ShortcutEngine } = require('../src/main/shortcut-engine');

function setup() {
  let now = 0;
  const engine = new ShortcutEngine({ now: () => now });
  engine.setBindings([
    { action: 'ptt', keys: ['Ctrl', 'Meta'] },
    { action: 'handsFree', keys: ['Ctrl', 'Meta', 'Space'] },
    { action: 'cancel', keys: ['Escape'] },
    { action: 'pasteLast', keys: ['Shift', 'Alt', 'Z'] },
  ]);
  const events = [];
  engine.on('action', (e) => events.push(`${e.action}:${e.phase}`));
  engine.on('chord', () => events.push('chord'));
  return { engine, events, tick: (ms) => (now += ms) };
}

test('exact combination fires down, releasing any key fires up', () => {
  const { engine, events } = setup();
  engine.handleKey('Ctrl', true);
  assert.deepEqual(events, []);
  engine.handleKey('Meta', true);
  assert.deepEqual(events, ['ptt:down']);
  engine.handleKey('Meta', false);
  assert.deepEqual(events, ['ptt:down', 'ptt:up']);
  engine.handleKey('Ctrl', false);
  assert.deepEqual(events, ['ptt:down', 'ptt:up']);
});

test('order of key presses does not matter', () => {
  const { engine, events } = setup();
  engine.handleKey('Meta', true);
  engine.handleKey('Ctrl', true);
  assert.deepEqual(events, ['ptt:down']);
});

test('auto-repeat key downs are ignored', () => {
  const { engine, events } = setup();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Ctrl', true);
  assert.deepEqual(events, ['ptt:down']);
});

test('adding Space while holding PTT triggers hands-free', () => {
  const { engine, events } = setup();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Space', true);
  assert.deepEqual(events, ['ptt:down', 'handsFree:down']);
  engine.handleKey('Space', false);
  assert.deepEqual(events, ['ptt:down', 'handsFree:down', 'handsFree:up']);
});

test('unbound superset of an active binding emits chord', () => {
  const { engine, events } = setup();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('D', true);
  assert.deepEqual(events, ['ptt:down', 'chord']);
});

test('shortcut upgrade keeps the same action alive', () => {
  const engine = new ShortcutEngine();
  engine.setBindings([
    { action: 'ptt', keys: ['Ctrl'] },
    { action: 'ptt', keys: ['Ctrl', 'Meta'] },
  ]);
  const events = [];
  engine.on('action', (e) => events.push(`${e.action}:${e.phase}`));
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  assert.deepEqual(events, ['ptt:down']);
  engine.handleKey('Meta', false);
  assert.deepEqual(events, ['ptt:down', 'ptt:up']);
});

test('cancel fires even while other keys are held', () => {
  const { engine, events } = setup();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Escape', true);
  assert.deepEqual(events, ['ptt:down', 'cancel:down']);
});

test('mouse buttons and undefined keys', () => {
  const engine = new ShortcutEngine();
  engine.setBindings([{ action: 'ptt', keys: ['Mouse4'] }]);
  const events = [];
  engine.on('action', (e) => events.push(`${e.action}:${e.phase}`));
  engine.handleKey(undefined, true); // e.g. our own injected masking key (keycode 0)
  engine.handleKey('Mouse4', true);
  engine.handleKey('Mouse4', false);
  assert.deepEqual(events, ['ptt:down', 'ptt:up']);
});

test('stale keys are evicted when the OS says they are up', () => {
  const { engine, events, tick } = setup();
  engine.handleKey('Ctrl', true); // key-up lost, e.g. behind a UAC prompt
  tick(3000);
  engine.sweepStale(() => false);
  assert.equal(engine.pressed.size, 0);
  engine.handleKey('Meta', true);
  engine.handleKey('Ctrl', true);
  assert.deepEqual(events, ['ptt:down']);
});

test('stale sweep keeps keys that are really held, and fresh keys', () => {
  const { engine, tick } = setup();
  engine.handleKey('Ctrl', true);
  tick(500);
  engine.sweepStale(() => false);
  assert.equal(engine.pressed.size, 1);
  tick(3000);
  engine.sweepStale(() => true);
  assert.equal(engine.pressed.size, 1);
});

test('stale sweep of an active binding key ends the action', () => {
  const { engine, events, tick } = setup();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  tick(5000);
  engine.sweepStale((k) => k !== 'Meta');
  assert.deepEqual(events, ['ptt:down', 'ptt:up']);
});

test('recording mode reports keys instead of firing actions', () => {
  const { engine, events } = setup();
  const rec = [];
  engine.on('recording', (e) => rec.push(e));
  engine.setRecording(true);
  engine.handleKey('AltRight', true);
  engine.handleKey('AltRight', false);
  assert.deepEqual(events, []);
  assert.deepEqual(rec[0], { keys: ['AltRight'], isRelease: false });
  assert.deepEqual(rec[1], { keys: ['AltRight'], isRelease: true, remaining: [], doubleTap: false });
});

// ---------------------------------------------------------------- several bindings per action

function multi() {
  let now = 0;
  const engine = new ShortcutEngine({ now: () => now });
  engine.setBindings([
    { id: 'd1', action: 'dictate', keys: ['Ctrl', 'Meta'], behaviour: 'both' },
    { id: 'd2', action: 'dictate', keys: ['Ctrl', 'Meta', 'Space'], behaviour: 'toggle' },
    { id: 'd3', action: 'dictate', keys: ['Mouse4'], behaviour: 'hold' },
    { id: 'd4', action: 'dictate', keys: ['CtrlRight'], behaviour: 'toggle', trigger: 'doubleTap' },
    { id: 'c1', action: 'cancel', keys: ['Escape'] },
    { id: 'e1', action: 'pressEnter', keys: ['F13'] },
  ]);
  const events = [];
  engine.on('action', (e) => events.push(`${e.action}:${e.phase}:${e.binding.id}`));
  return { engine, events, tick: (ms) => (now += ms) };
}

test('every binding of an action fires it and names the binding that matched', () => {
  const { engine, events } = multi();
  engine.handleKey('Mouse4', true);
  engine.handleKey('Mouse4', false);
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Meta', false);
  engine.handleKey('Ctrl', false);
  assert.deepEqual(events, ['dictate:down:d3', 'dictate:up:d3', 'dictate:down:d1', 'dictate:up:d1']);
});

test('a superset binding of the same action but another behaviour fires instead of upgrading silently', () => {
  const { engine, events } = multi();
  engine.handleKey('Ctrl', true);
  engine.handleKey('Meta', true);
  engine.handleKey('Space', true);
  engine.handleKey('Space', false);
  assert.deepEqual(events, ['dictate:down:d1', 'dictate:down:d2', 'dictate:up:d2']);
});

// ---------------------------------------------------------------- double-tap a modifier

test('double-tapping a modifier fires its double-tap binding once', () => {
  const { engine, events, tick } = multi();
  engine.handleKey('CtrlRight', true);
  tick(80);
  engine.handleKey('CtrlRight', false);
  assert.deepEqual(events, [], 'a single tap does nothing');
  tick(120);
  engine.handleKey('CtrlRight', true);
  tick(80);
  engine.handleKey('CtrlRight', false);
  assert.deepEqual(events, ['dictate:down:d4']);
  tick(100);
  engine.handleKey('CtrlRight', true);
  tick(80);
  engine.handleKey('CtrlRight', false);
  assert.deepEqual(events, ['dictate:down:d4'], 'a third tap starts a new pair');
});

test('taps that are too slow, too long or apart do not count', () => {
  const { engine, events, tick } = multi();
  const tap = (holdMs) => {
    engine.handleKey('CtrlRight', true);
    tick(holdMs);
    engine.handleKey('CtrlRight', false);
  };
  tap(300); // held too long to be a tap
  tick(50);
  tap(80);
  tick(500); // second tap too late
  tap(80);
  assert.deepEqual(events, []);
});

test('another key between or during the taps cancels the double-tap', () => {
  const { engine, events, tick } = multi();
  engine.handleKey('CtrlRight', true);
  engine.handleKey('C', true); // Right Ctrl + C is a copy, not a tap
  engine.handleKey('C', false);
  engine.handleKey('CtrlRight', false);
  tick(100);
  engine.handleKey('CtrlRight', true);
  engine.handleKey('CtrlRight', false);
  assert.deepEqual(events, []);
  tick(100);
  engine.handleKey('A', true);
  engine.handleKey('A', false);
  engine.handleKey('CtrlRight', true);
  engine.handleKey('CtrlRight', false);
  assert.deepEqual(events, [], 'a key between taps resets the pair');
});

test('the recorder reports a double-tap', () => {
  const { engine, tick } = multi();
  const rec = [];
  engine.on('recording', (e) => rec.push(e));
  engine.setRecording(true);
  for (let i = 0; i < 2; i++) {
    engine.handleKey('ShiftRight', true);
    tick(60);
    engine.handleKey('ShiftRight', false);
    tick(100);
  }
  assert.deepEqual(rec.filter((e) => e.isRelease).map((e) => e.doubleTap), [false, true]);
});
