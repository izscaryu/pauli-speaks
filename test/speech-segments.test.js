'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FRAME, SAMPLE_RATE, segmentsFromProbabilities, joinSegments, rms } = require('../src/main/speech-segments');

const MS = SAMPLE_RATE / 1000;

/** n frames of silence with `blocks` ([firstFrame, lastFrame, prob]) painted in. */
function probs(n, blocks) {
  const p = new Float32Array(n);
  for (const [a, b, v] of blocks) p.fill(v, a, b + 1);
  return p;
}

test('constants: 16 kHz and 512-sample frames', () => {
  assert.equal(FRAME, 512);
  assert.equal(SAMPLE_RATE, 16000);
});

test('no frame above the threshold gives no segments', () => {
  assert.deepEqual(segmentsFromProbabilities(probs(100, [[10, 30, 0.49]]), {}, 100 * FRAME), []);
  assert.deepEqual(segmentsFromProbabilities([], {}, 0), []);
});

test('one block of frames is padded 200 ms before and 300 ms after', () => {
  const total = 200 * FRAME;
  const segs = segmentsFromProbabilities(probs(200, [[10, 30, 0.9]]), {}, total);
  assert.deepEqual(segs, [{ start: 10 * FRAME - 3200, end: 31 * FRAME + 4800 }]);
});

test('a 0.25 s burst yields one segment', () => {
  const segs = segmentsFromProbabilities(probs(100, [[20, 27, 0.8]]), {}, 100 * FRAME);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { start: 20 * FRAME - 3200, end: 28 * FRAME + 4800 });
});

test('two blocks 200 ms apart merge into one segment', () => {
  // 200 ms = 3200 samples = 6.25 frames; leave 6 silent frames (192 ms).
  const segs = segmentsFromProbabilities(probs(300, [[10, 30, 0.9], [37, 60, 0.9]]), {}, 300 * FRAME);
  assert.deepEqual(segs, [{ start: 10 * FRAME - 3200, end: 61 * FRAME + 4800 }]);
});

test('two blocks 600 ms apart stay two segments', () => {
  // 600 ms = 9600 samples = 18.75 frames; leave 19 silent frames.
  const segs = segmentsFromProbabilities(probs(400, [[10, 30, 0.9], [50, 70, 0.9]]), {}, 400 * FRAME);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { start: 10 * FRAME - 3200, end: 31 * FRAME + 4800 });
  assert.deepEqual(segs[1], { start: 50 * FRAME - 3200, end: 71 * FRAME + 4800 });
  assert.ok(segs[0].end < segs[1].start);
});

test('blocks whose padding overlaps never produce overlapping segments', () => {
  // 15 silent frames = 480 ms: farther apart than mergeGapMs, but 500 ms of padding overlaps.
  const segs = segmentsFromProbabilities(probs(300, [[10, 30, 0.9], [46, 60, 0.9]]), {}, 300 * FRAME);
  assert.deepEqual(segs, [{ start: 10 * FRAME - 3200, end: 61 * FRAME + 4800 }]);
});

test('padding clamps at 0 and at totalSamples', () => {
  const total = 40 * FRAME;
  const segs = segmentsFromProbabilities(probs(40, [[2, 38, 0.9]]), {}, total);
  assert.deepEqual(segs, [{ start: 0, end: total }]);
});

test('speech still running at the last frame closes at totalSamples', () => {
  const total = 50 * FRAME - 100; // the last frame was a partial one
  const segs = segmentsFromProbabilities(probs(50, [[40, 49, 0.9]]), {}, total);
  assert.deepEqual(segs, [{ start: 40 * FRAME - 3200, end: total }]);
});

test('hysteresis: stays in speech until below negThreshold, enters only at threshold', () => {
  const p = probs(100, [[10, 12, 0.9], [13, 20, 0.4], [21, 22, 0.9]]);
  // 0.4 is between negThreshold (0.35) and threshold (0.5): the segment continues through it.
  assert.deepEqual(segmentsFromProbabilities(p, {}, 100 * FRAME), [{ start: 10 * FRAME - 3200, end: 23 * FRAME + 4800 }]);
  // Frames at 0.4 alone never start a segment.
  assert.deepEqual(segmentsFromProbabilities(probs(100, [[10, 30, 0.4]]), {}, 100 * FRAME), []);
  // A frame at exactly the threshold starts one.
  assert.equal(segmentsFromProbabilities(probs(100, [[10, 20, 0.5]]), {}, 100 * FRAME).length, 1);
  // (0.25 is exact in Float32.) Falling to exactly negThreshold keeps speech going; below it ends it.
  const keep = segmentsFromProbabilities(probs(100, [[10, 12, 0.9], [13, 14, 0.25]]), { padAfterMs: 0, negThreshold: 0.25 }, 100 * FRAME);
  assert.equal(keep[0].end, 15 * FRAME);
  const stop = segmentsFromProbabilities(probs(100, [[10, 12, 0.9], [13, 14, 0.24]]), { padAfterMs: 0, negThreshold: 0.25 }, 100 * FRAME);
  assert.equal(stop[0].end, 13 * FRAME);
});

test('speech shorter than minSpeechMs is dropped', () => {
  assert.deepEqual(segmentsFromProbabilities(probs(100, [[10, 10, 0.9]]), {}, 100 * FRAME), []); // 32 ms
  assert.equal(segmentsFromProbabilities(probs(100, [[10, 11, 0.9]]), {}, 100 * FRAME).length, 1); // 64 ms
});

test('options override the defaults', () => {
  const segs = segmentsFromProbabilities(probs(100, [[10, 20, 0.6]]), { threshold: 0.7, padBeforeMs: 0, padAfterMs: 0 }, 100 * FRAME);
  assert.deepEqual(segs, []);
  const segs2 = segmentsFromProbabilities(probs(100, [[10, 20, 0.9]]), { padBeforeMs: 100, padAfterMs: 100 }, 100 * FRAME);
  assert.deepEqual(segs2, [{ start: 10 * FRAME - 1600, end: 21 * FRAME + 1600 }]);
});

test('joinSegments concatenates segments with 100 ms of zeros between them', () => {
  const audio = new Float32Array(10000).fill(0.5);
  const segs = [{ start: 100, end: 600 }, { start: 2000, end: 2300 }, { start: 5000, end: 5100 }];
  const out = joinSegments(audio, segs);
  assert.equal(out.length, 500 + 300 + 100 + 2 * 100 * MS);
  assert.equal(out[499], 0.5);
  assert.ok(out.slice(500, 500 + 1600).every((x) => x === 0));
  assert.equal(out[500 + 1600], 0.5);
  assert.ok(out.slice(800 + 1600, 800 + 3200).every((x) => x === 0));
  assert.equal(out[out.length - 1], 0.5);
});

test('joinSegments: a custom gap, one segment, no segments, and ends past the audio', () => {
  const audio = Float32Array.from({ length: 1000 }, (_, i) => i);
  assert.equal(joinSegments(audio, [{ start: 0, end: 10 }, { start: 20, end: 30 }], 50).length, 10 + 10 + 50 * MS);
  assert.deepEqual(Array.from(joinSegments(audio, [{ start: 5, end: 8 }])), [5, 6, 7]);
  assert.equal(joinSegments(audio, []).length, 0);
  assert.equal(joinSegments(audio, [{ start: 990, end: 5000 }]).length, 10);
});

test('rms is the root mean square of the frame', () => {
  assert.equal(rms(new Float32Array(0)), 0);
  assert.equal(rms(new Float32Array(512)), 0);
  assert.ok(Math.abs(rms(new Float32Array(512).fill(0.5)) - 0.5) < 1e-6);
  assert.ok(Math.abs(rms(Float32Array.from([1, -1, 1, -1])) - 1) < 1e-6);
});
