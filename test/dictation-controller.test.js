'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DictationController, DEBOUNCE_MS } = require('../src/main/dictation-controller');

/** A stand-in for mode-session.js: the old translate action → 'translate', a pinned mode, a link, a kept mode, or Default. */
function fakeResolve(requests) {
  return (req = {}) => {
    requests.push(req);
    if (req.kept) return { id: req.kept.mode || (req.kept.translate ? 'translate' : 'default'), translateTo: req.kept.translate ? 'en' : null };
    const b = req.binding || {};
    if (b.action === 'translate' && !b.mode) return { id: 'translate', translateTo: 'en' };
    const id = b.mode || req.link || 'default';
    return { id, translateTo: id === 'translate' ? 'en' : null };
  };
}

function setup() {
  let now = 1000;
  const timers = [];
  const calls = [];
  const requests = [];
  let finishResolve = null;
  const controller = new DictationController(
    {
      resolveMode: fakeResolve(requests),
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
  return { controller, calls, advance, settle, requests };
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

// ---------------------------------------------------------------- per-binding behaviour

test('a hold binding stops on release and drops a quick tap at once', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.talkDown({ behaviour: 'hold' });
  advance(100);
  controller.talkUp({ behaviour: 'hold' });
  assert.equal(controller.status, 'idle', 'no waiting for a second tap');
  controller.talkDown({ behaviour: 'hold' });
  advance(100);
  controller.talkUp({ behaviour: 'hold' });
  controller.talkDown({ behaviour: 'hold' });
  assert.equal(controller.locked, false, 'a hold binding never locks');
  advance(1500);
  controller.talkUp({ behaviour: 'hold' });
  await settle();
  assert.deepEqual(calls, ['start', 'dismiss:tap', 'start', 'dismiss:tap', 'start', 'finish:release']);
});

test('a toggle binding starts hands-free, ignores release and stops on the next press', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.talkDown({ behaviour: 'toggle' });
  assert.equal(controller.locked, true);
  controller.talkUp({ behaviour: 'toggle' });
  advance(3000);
  assert.equal(controller.status, 'listening');
  controller.talkDown({ behaviour: 'toggle' });
  await settle();
  assert.deepEqual(calls, ['start', 'finish:hands-free']);
});

test('both = push-to-talk with double-tap lock', () => {
  const { controller, advance } = setup();
  controller.talkDown({ behaviour: 'both' });
  advance(100);
  controller.talkUp({ behaviour: 'both' });
  advance(100);
  controller.talkDown({ behaviour: 'both' });
  assert.equal(controller.locked, true);
});

// Tester report (1.6.0): with Both on Ctrl+Win, a double-tap never locked and the pill said "Hold Ctrl+Win while
// you speak". Two keys take longer to tap twice: the second press came 550 ms after the first, past a window that
// was counted from the first press instead of from the release.
test('both: a two-key double-tap locks when the second press comes within the window after the release', () => {
  const { controller, calls, advance } = setup();
  controller.talkDown({ behaviour: 'both' });
  advance(250); // Ctrl+Win down together, held a moment
  controller.talkUp({ behaviour: 'both' });
  advance(300); // both keys up, then down again
  controller.talkDown({ behaviour: 'both' });
  assert.equal(controller.locked, true, 'the second press locks hands-free');
  controller.talkUp({ behaviour: 'both' });
  advance(5000);
  assert.equal(controller.status, 'listening', 'still listening hands-free');
  assert.deepEqual(calls, ['start']);
});

test('both: a second press after the window starts a new dictation instead of locking', () => {
  const { controller, calls, advance } = setup();
  controller.talkDown({ behaviour: 'both' });
  advance(100);
  controller.talkUp({ behaviour: 'both' });
  advance(DEBOUNCE_MS + 50);
  assert.deepEqual(calls, ['start', 'dismiss:tap']);
  controller.talkDown({ behaviour: 'both' });
  assert.equal(controller.locked, false, 'a hold, not a lock');
  assert.equal(controller.status, 'listening');
});

test('any talk shortcut finishes a locked session', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.talkDown({ behaviour: 'toggle' });
  advance(2000);
  controller.talkDown({ behaviour: 'hold' });
  await settle();
  assert.deepEqual(calls, ['start', 'finish:hold']);
});

test('a toggle translate binding starts a locked translated session', () => {
  const { controller } = setup();
  controller.talkDown({ behaviour: 'toggle', kind: 'translate' });
  assert.equal(controller.locked, true);
  assert.equal(controller.translate, true);
});

test('a hold command binding upgrades a held session', () => {
  const { controller, calls, advance } = setup();
  controller.talkDown({ behaviour: 'hold' });
  advance(700);
  controller.talkDown({ behaviour: 'hold', kind: 'command' });
  assert.equal(controller.command, true);
  assert.deepEqual(calls, ['start']);
});

test('remote start begins hands-free and is ignored while listening; remote stop finishes', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.start();
  assert.equal(controller.locked, true);
  controller.start();
  advance(1000);
  controller.stop('remote');
  await settle();
  assert.deepEqual(calls, ['start', 'finish:remote']);
});

test('max duration auto-stops', async () => {
  const { controller, calls, advance, settle } = setup();
  controller.handsFreeDown();
  advance(20 * 60 * 1000);
  await settle();
  assert.deepEqual(calls, ['start', 'finish:max-duration']);
});

test('process runs kept audio like a stop: processing, in the mode it was recorded in, then idle', async () => {
  const { controller } = setup();
  const statuses = [];
  controller.on('status', ({ status }) => statuses.push(status));
  let release;
  let seen = null;
  const done = controller.process(() => {
    seen = { status: controller.status, translate: controller.translate, command: controller.command, cancelled: controller.cancelled };
    return new Promise((r) => (release = r));
  }, { translate: true, command: false });
  assert.deepEqual(seen, { status: 'processing', translate: true, command: false, cancelled: false });
  assert.equal(controller.mode.id, 'translate', 'the mode the kept recording was made in');
  release();
  assert.equal(await done, true);
  assert.equal(controller.status, 'idle');
  assert.deepEqual(statuses, ['processing', 'idle']);
});

test('process while listening or processing is busy and does not run', async () => {
  const { controller, advance } = setup();
  let busy = 0;
  let ran = 0;
  controller.on('busy', () => busy++);
  controller.handsFreeDown();
  assert.equal(await controller.process(() => ran++), false);
  advance(1000);
  controller.stop('hands-free');
  assert.equal(await controller.process(() => ran++), false);
  assert.equal(busy, 2);
  assert.equal(ran, 0);
});

test('cancel during process marks it cancelled; a throwing run still ends idle', async () => {
  const { controller } = setup();
  const done = controller.process(async () => {
    controller.cancel();
    assert.equal(controller.cancelled, true);
    throw new Error('boom');
  }, { command: true });
  await assert.rejects(done, /boom/);
  assert.equal(controller.status, 'idle');
});

// ---------------------------------------------------------------- modes

test('a dictation asks for its mode once, when it starts, with the shortcut that started it', async () => {
  const { controller, requests, advance, settle } = setup();
  const binding = { id: 'd1', action: 'dictate', mode: 'code' };
  controller.talkDown({ behaviour: 'both', binding });
  assert.equal(controller.mode.id, 'code');
  advance(100);
  controller.talkUp({ behaviour: 'both' });
  controller.talkDown({ behaviour: 'both', binding }); // double-tap: lock
  assert.equal(controller.locked, true);
  advance(2000);
  controller.talkDown({ behaviour: 'both', binding });
  await settle();
  assert.equal(requests.length, 1, 'more presses of a shortcut for the same mode do not ask again');
  assert.deepEqual(requests[0], { binding });
});

test('the status says which mode is running', () => {
  const { controller } = setup();
  const seen = [];
  controller.on('status', (s) => seen.push(s));
  controller.talkDown({ binding: { action: 'dictate', mode: 'chat' } });
  assert.equal(seen[0].mode.id, 'chat');
  assert.equal(seen[0].translate, false);
});

test('pressing a shortcut for another mode while one is held switches the running dictation to it', () => {
  const { controller, calls, advance } = setup();
  controller.talkDown({ binding: { action: 'dictate' } });
  advance(900);
  controller.talkDown({ binding: { action: 'dictate', mode: 'translate' } });
  assert.equal(controller.mode.id, 'translate');
  assert.equal(controller.translate, true);
  assert.equal(controller.status, 'listening');
  assert.equal(controller.locked, false);
  assert.deepEqual(calls, ['start']);
});

test('a second Automatic shortcut does not change the mode; it works as before (lock or stop)', () => {
  const { controller, advance } = setup();
  controller.talkDown({ binding: { action: 'dictate', mode: 'code' } });
  advance(100);
  controller.talkDown({ behaviour: 'both', binding: { action: 'dictate' } });
  assert.equal(controller.mode.id, 'code');
  assert.equal(controller.locked, true);
});

test('command mode keeps the mode it started in (for its language)', () => {
  const { controller, advance } = setup();
  controller.talkDown({ binding: { action: 'dictate', mode: 'hr' } });
  advance(700);
  controller.talkDown({ behaviour: 'hold', kind: 'command', binding: { action: 'command' } });
  assert.equal(controller.command, true);
  assert.equal(controller.mode.id, 'hr');
  assert.equal(controller.translate, false, 'command mode never translates');
});

test('links and flags start in their mode', () => {
  const a = setup();
  a.controller.start({ link: 'email' });
  assert.equal(a.controller.mode.id, 'email');
  const b = setup();
  b.controller.toggle({ link: 'email' });
  assert.equal(b.controller.mode.id, 'email');
  const c = setup();
  c.controller.toggle();
  assert.equal(c.controller.mode.id, 'default');
});

test('setMode (Switch mode while talking) changes the running dictation and says so', () => {
  const { controller } = setup();
  controller.setMode({ id: 'code' });
  assert.equal(controller.mode, null, 'nothing running: nothing to change');
  controller.talkDown({});
  const seen = [];
  controller.on('status', (s) => seen.push(s));
  controller.setMode({ id: 'code' });
  assert.equal(controller.mode.id, 'code');
  assert.deepEqual(seen.map((s) => [s.status, s.mode.id]), [['listening', 'code']]);
});

test('process runs a kept recording in the mode it was recorded in', async () => {
  const { controller, requests } = setup();
  await controller.process(async () => {}, { mode: 'chat', command: false, app: { exe: 'slack.exe' } });
  assert.equal(controller.mode.id, 'chat');
  assert.deepEqual(requests.at(-1), { kept: { mode: 'chat', command: false, app: { exe: 'slack.exe' } } });
});

test('without resolveMode (older callers) there is no mode, and translate is false', () => {
  const controller = new DictationController({ start() {}, finish: async () => {}, dismiss() {} });
  controller.pttDown();
  assert.equal(controller.mode, null);
  assert.equal(controller.translate, false);
  controller.cancel(); // clears the 20-minute timer
});
