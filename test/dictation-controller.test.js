'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DictationController, DEBOUNCE_MS } = require('../src/main/dictation-controller');

function setup() {
  let now = 1000;
  const timers = [];
  const calls = [];
  let finishResolve = null;
  const controller = new DictationController(
    {
      start: () => calls.push('start'),
      finish: (reason) => {
        calls.push(`finish:${reason}`);
        return new Promise((r) => (finishResolve = r));
      },
      dismiss: (reason) => calls.push(`dismiss:${reason}`),
    },
    {
      now: () => now,
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
    },
  );
  const advance = (ms) => {
    now += ms;
    for (const t of timers) {
      if (!t.done && t.at <= now) {
        t.done = true;
        t.fn();
      }
    }
  };
  const settle = async () => {
    finishResolve?.();
    await new Promise((r) => setImmediate(r));
  };
  return { controller, calls, advance, settle };
}

test('hold then release transcribes', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.pttDown();
  assert.equal(controller.status, 'listening');
  advance(2000);
  controller.pttUp();
  assert.equal(controller.status, 'processing');
  await settle();
  assert.equal(controller.status, 'idle');
  assert.deepEqual(calls, ['start', 'finish:release']);
});

test('a quick tap waits for a second tap, then dismisses', () => {
  const { controller, calls, advance } = setup();
  controller.pttDown();
  advance(120);
  controller.pttUp();
  assert.equal(controller.status, 'listening');
  advance(DEBOUNCE_MS);
  assert.equal(controller.status, 'idle');
  assert.deepEqual(calls, ['start', 'dismiss:tap']);
});

test('double tap locks hands-free; next press stops', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.pttDown();
  advance(100);
  controller.pttUp();
  advance(150);
  controller.pttDown();
  assert.equal(controller.locked, true);
  controller.pttUp();
  advance(5000);
  assert.equal(controller.status, 'listening', 'tap timer must not dismiss a locked session');
  controller.pttDown();
  assert.equal(controller.status, 'processing');
  await settle();
  assert.deepEqual(calls, ['start', 'finish:ptt']);
});

test('hands-free shortcut starts locked and toggles off', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.handsFreeDown();
  assert.equal(controller.locked, true);
  advance(3000);
  controller.handsFreeDown();
  await settle();
  assert.deepEqual(calls, ['start', 'finish:hands-free']);
});

test('pressing hands-free while holding PTT converts to locked', () => {
  const { controller, advance } = setup();
  controller.pttDown();
  advance(800);
  controller.handsFreeDown();
  assert.equal(controller.locked, true);
  controller.pttUp();
  assert.equal(controller.status, 'listening');
});

test('cancel discards', () => {
  const { controller, calls, advance } = setup();
  controller.pttDown();
  advance(2000);
  controller.cancel();
  assert.equal(controller.status, 'idle');
  assert.deepEqual(calls, ['start', 'dismiss:cancel']);
});

test('another shortcut right after PTT starts dismisses it', () => {
  const { controller, calls, advance } = setup();
  controller.pttDown();
  advance(300);
  controller.otherChord();
  assert.deepEqual(calls, ['start', 'dismiss:other-shortcut']);
});

test('other chord after 1s is ignored', () => {
  const { controller, calls, advance } = setup();
  controller.pttDown();
  advance(1500);
  controller.otherChord();
  assert.equal(controller.status, 'listening');
  assert.deepEqual(calls, ['start']);
});

test('presses while processing are rejected as busy', () => {
  const { controller, advance } = setup();
  let busy = 0;
  controller.on('busy', () => busy++);
  controller.pttDown();
  advance(1000);
  controller.pttUp();
  controller.pttDown();
  assert.equal(busy, 1);
  assert.equal(controller.status, 'processing');
});

test('translate shortcut starts a translated push-to-talk session', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.translateDown();
  assert.equal(controller.translate, true);
  assert.equal(controller.locked, false);
  advance(1500);
  controller.pttUp();
  await settle();
  assert.deepEqual(calls, ['start', 'finish:release']);
});

test('adding translate to a held PTT upgrades the session without restarting', () => {
  const { controller, calls, advance } = setup();
  controller.pttDown();
  advance(900);
  controller.translateDown();
  assert.equal(controller.translate, true);
  assert.equal(controller.status, 'listening');
  assert.deepEqual(calls, ['start']);
});

test('a new session does not inherit the translate flag', () => {
  const { controller, advance } = setup();
  controller.translateDown();
  advance(100);
  controller.cancel();
  controller.pttDown();
  assert.equal(controller.translate, false);
});

test('double-tapping the translate shortcut locks hands-free translation', () => {
  const { controller, advance } = setup();
  controller.translateDown();
  advance(100);
  controller.pttUp();
  advance(100);
  controller.translateDown();
  assert.equal(controller.locked, true);
  assert.equal(controller.translate, true);
});

test('max duration auto-stops', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.handsFreeDown();
  advance(20 * 60 * 1000);
  await settle();
  assert.deepEqual(calls, ['start', 'finish:max-duration']);
});
