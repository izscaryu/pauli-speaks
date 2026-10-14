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
  assert.deepEqual(rec[1], { keys: ['AltRight'], isRelease: true, remaining: [] });
});
