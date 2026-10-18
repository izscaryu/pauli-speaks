'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History } = require('../src/main/history');
const { createPendingAudio } = require('../src/main/pending-audio');
const { createRetryOffers, UNDO_MS } = require('../src/main/retry-offers');

function setup({ maxItems } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-retry-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new History(path.join(dir, 'history.json'));
  const pending = createPendingAudio({ maxItems });
  let now = 0;
  const timers = [];
  const fake = {
    setTimeout: (fn, ms) => {
      const t = { fn, at: now + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.done = true;
    },
  };
  const advance = (ms) => {
    now += ms;
    for (const t of timers) if (!t.done && t.at <= now) { t.done = true; t.fn(); }
  };
  const offers = createRetryOffers({ pending, history, timers: fake });
  return { history, pending, offers, advance };
}

const audio = (s = 1) => new Float32Array(16000 * s);
const meta = { durationMs: 1000, engine: 'whisper-large-v3-turbo', command: false, translate: false, app: null };

test('UNDO_MS is 4 seconds', () => {
  assert.equal(UNDO_MS, 4000);
});

test('failed: the audio is kept, History gets a failed entry, the pill gets a Retry action', () => {
  const { history, pending, offers } = setup();
  const a = audio();
  const action = offers.failed(a, meta, 'Invalid API key');
  assert.equal(action.label, 'Retry');
  assert.equal(typeof action.id, 'string');
  const item = history.list()[0];
  assert.equal(item.status, 'failed');
  assert.equal(item.error, 'Invalid API key');
  assert.equal(item.durationMs, 1000);
  assert.equal(item.engine, 'whisper-large-v3-turbo');
  assert.equal(pending.get(item.audioId).audio, a);
  assert.equal(offers.canRetry(item), true);

  const job = offers.take(action.id);
  assert.equal(job.kind, 'retry');
  assert.equal(job.audio, a);
  assert.equal(job.historyId, item.id);
  assert.equal(job.meta.command, false);
  assert.ok(pending.get(item.audioId), 'the audio stays until the retry settles');
});

test('take of an unknown or stale action id is null', () => {
  const { offers } = setup();
  const first = offers.failed(audio(), meta, 'boom');
  offers.failed(audio(), meta, 'boom');
  assert.equal(offers.take(first.id), null, 'only the action on the pill now works');
  assert.equal(offers.take('nope'), null);
  assert.equal(offers.take(undefined), null);
});

test('forHistory finds the kept audio of a failed entry; null once it was evicted', () => {
  const { history, offers } = setup({ maxItems: 1 });
  offers.failed(audio(), meta, 'first');
  const first = history.list()[0];
  const job = offers.forHistory(first.id);
  assert.equal(job.historyId, first.id);
  assert.equal(job.audioId, first.audioId);
  offers.failed(audio(), meta, 'second'); // evicts the first recording
  assert.equal(offers.forHistory(first.id), null);
  assert.equal(offers.canRetry(first), false);
  assert.equal(offers.forHistory('missing'), null);
});

test('forHistory of a normal entry is null', () => {
  const { history, offers } = setup();
  const ok = history.add({ text: 'hi', words: 1, durationMs: 500 });
  assert.equal(offers.forHistory(ok.id), null);
  assert.equal(offers.canRetry(ok), false);
});

test('settled: the audio goes, and a failed entry nobody resolved goes too (nothing was said)', () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'boom');
  const item = history.list()[0];
  offers.settled(offers.forHistory(item.id));
  assert.equal(pending.get(item.audioId), null);
  assert.equal(history.list().length, 0);
});

test('settled after resolve keeps the resolved entry', () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'boom');
  const item = history.list()[0];
  const job = offers.forHistory(item.id);
  history.resolve(item.id, { text: 'said', words: 1, durationMs: 1000 });
  offers.settled(job);
  assert.equal(pending.get(item.audioId), null);
  assert.equal(history.list()[0].text, 'said');
});

test('failedAgain offers Retry on the same audio while it is still kept', () => {
  const { history, offers, pending } = setup();
  const first = offers.failed(audio(), meta, 'boom');
  const job = offers.take(first.id);
  const again = offers.failedAgain(job.audioId);
  assert.equal(again.label, 'Retry');
  assert.equal(offers.take(again.id).audioId, job.audioId);
  assert.equal(history.list().length, 1, 'no second History entry');
  pending.drop(job.audioId);
  assert.equal(offers.failedAgain(job.audioId), null);
});

test('forget drops the audio of a deleted failed entry; forgetAll drops all of them', () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'a');
  offers.failed(audio(), meta, 'b');
  const [b, a] = history.list();
  offers.forget(a.id);
  assert.equal(pending.get(a.audioId), null);
  assert.ok(pending.get(b.audioId));
  offers.forget('missing'); // no throw
  offers.forgetAll();
  assert.equal(pending.get(b.audioId), null);
});

test('undo: kept for 4 s behind an Undo action, then dropped and onExpire runs', () => {
  const { pending, offers, advance, history } = setup();
  let expired = 0;
  const hold = offers.holdForUndo(() => expired++);
  const action = hold.offer(audio(), meta);
  assert.equal(action.label, 'Undo');
  assert.equal(pending.size, 1);
  assert.equal(history.list().length, 0, 'a cancel is not a History entry');
  advance(UNDO_MS - 1);
  assert.equal(expired, 0);
  advance(1);
  assert.equal(expired, 1);
  assert.equal(pending.size, 0);
  assert.equal(offers.take(action.id), null);
});

test('undo taken in time: the audio is handed over once, the timer stops, done() runs onExpire', () => {
  const { pending, offers, advance } = setup();
  let expired = 0;
  const a = audio();
  const action = offers.holdForUndo(() => expired++).offer(a, { ...meta, translate: true });
  advance(1000);
  const job = offers.take(action.id);
  assert.equal(job.kind, 'undo');
  assert.equal(job.audio, a);
  assert.equal(job.meta.translate, true);
  assert.equal(pending.size, 0);
  assert.equal(offers.take(action.id), null, 'one Undo per cancel');
  advance(UNDO_MS);
  assert.equal(expired, 0, 'the crash file stays while the undone dictation is transcribed');
  job.done();
  assert.equal(expired, 1);
  job.done();
  assert.equal(expired, 1, 'done() runs once');
});

test('expireUndo (a new dictation starts) ends a held undo at once, even before its audio arrived', () => {
  const { pending, offers } = setup();
  let expired = 0;
  const hold = offers.holdForUndo(() => expired++);
  offers.expireUndo();
  assert.equal(expired, 1);
  assert.equal(hold.offer(audio(), meta), null, 'too late: no Undo');
  assert.equal(pending.size, 0);

  const later = offers.holdForUndo(() => expired++);
  const action = later.offer(audio(), meta);
  offers.expireUndo();
  assert.equal(expired, 2);
  assert.equal(pending.size, 0);
  assert.equal(offers.take(action.id), null);
  offers.expireUndo();
  assert.equal(expired, 2, 'nothing held any more');
});

test('a second cancel replaces the first undo (which expires)', () => {
  const { offers, pending } = setup();
  let expired = [];
  const first = offers.holdForUndo(() => expired.push('first')).offer(audio(), meta);
  offers.holdForUndo(() => expired.push('second')).offer(audio(), meta);
  assert.deepEqual(expired, ['first']);
  assert.equal(offers.take(first.id), null);
  assert.equal(pending.size, 1);
});

test('hold.cancel: nothing worth undoing (too short) ends it without an offer', () => {
  const { offers, pending } = setup();
  let expired = 0;
  const hold = offers.holdForUndo(() => expired++);
  hold.cancel();
  assert.equal(expired, 1);
  assert.equal(pending.size, 0);
});

function historyDeps(over = {}) {
  const calls = { copied: [], modes: [], errors: [] };
  const deps = {
    process: async (run, mode) => {
      calls.modes.push(mode);
      await run();
      return true;
    },
    transcribe: async () => ({ text: 'what I said', words: 3, durationMs: 1000 }),
    isCancelled: () => false,
    copy: (text) => calls.copied.push(text),
    onError: (err) => calls.errors.push(err.message),
    ...over,
  };
  return { deps, calls };
}

test('retryInHistory: transcribed, the entry is resolved in place, the text copied and the audio dropped', async () => {
  const { history, pending, offers } = setup();
  history.add({ text: 'older', words: 1, durationMs: 1 });
  offers.failed(audio(), { ...meta, translate: true }, 'boom');
  const failed = history.list()[0];
  const { deps, calls } = historyDeps();
  assert.deepEqual(await offers.retryInHistory(failed.id, deps), { copied: true });
  assert.equal(history.list()[0].id, failed.id);
  assert.equal(history.list()[0].text, 'what I said');
  assert.deepEqual(calls.copied, ['what I said']);
  assert.equal(calls.modes[0].translate, true, 'runs in the mode it was recorded in');
  assert.equal(pending.get(failed.audioId), null);
});

test('retryInHistory: the recording is gone', async () => {
  const { offers } = setup();
  const { deps, calls } = historyDeps();
  assert.deepEqual(await offers.retryInHistory('missing', deps), { error: 'That recording is no longer available' });
  assert.equal(calls.modes.length, 0);
});

test('retryInHistory: failing again keeps the entry and the audio, and says why', async () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'boom');
  const failed = history.list()[0];
  const { deps, calls } = historyDeps({ transcribe: async () => { throw new Error('Invalid API key'); } });
  assert.deepEqual(await offers.retryInHistory(failed.id, deps), { error: 'Invalid API key' });
  assert.deepEqual(calls.errors, ['Invalid API key']);
  assert.equal(history.list()[0].status, 'failed');
  assert.ok(pending.get(failed.audioId));
  assert.equal(offers.canRetry(history.list()[0]), true);
});

test('retryInHistory: nothing was said, so the failed entry and its audio go', async () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'boom');
  const failed = history.list()[0];
  const { deps, calls } = historyDeps({ transcribe: async () => null });
  assert.deepEqual(await offers.retryInHistory(failed.id, deps), { error: 'No speech detected' });
  assert.equal(history.list().length, 0);
  assert.equal(pending.get(failed.audioId), null);
  assert.deepEqual(calls.copied, []);
});

test('retryInHistory: cancelled (Esc) or busy keeps everything for later', async () => {
  const { history, pending, offers } = setup();
  offers.failed(audio(), meta, 'boom');
  const failed = history.list()[0];
  const cancelled = historyDeps({ isCancelled: () => true });
  assert.deepEqual(await offers.retryInHistory(failed.id, cancelled.deps), { error: 'Cancelled' });
  const busy = historyDeps({ process: async () => false });
  assert.deepEqual(await offers.retryInHistory(failed.id, busy.deps), { error: 'Still working on the last dictation…' });
  assert.equal(history.list()[0].status, 'failed');
  assert.ok(pending.get(failed.audioId));
  assert.deepEqual([...cancelled.calls.copied, ...busy.calls.copied], []);
});
