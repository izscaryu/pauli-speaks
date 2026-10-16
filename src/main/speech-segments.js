'use strict';
// Turns per-frame speech probabilities from the voice-activity detector into
// padded, merged speech segments, and joins those segments back into the audio
// Whisper gets to hear. Pure (no Electron, no model) so it can be unit tested.

const SAMPLE_RATE = 16000;
const FRAME = 512; // 32 ms at 16 kHz, the frame size the detector takes

const DEFAULTS = {
  threshold: 0.5, // enter speech at or above this
  negThreshold: 0.35, // leave speech below this
  padBeforeMs: 200,
  padAfterMs: 300,
  mergeGapMs: 300, // speech closer than this belongs to one segment
  minSpeechMs: 64, // shorter bursts are noise
};

const msToSamples = (ms) => Math.round((ms * SAMPLE_RATE) / 1000);

/**
 * Per-frame probabilities -> [{ start, end }] in sample indices.
 * Hysteresis: speech starts at a frame >= threshold and lasts until a frame
 * below negThreshold. Bursts shorter than minSpeechMs are dropped, speech
 * closer together than mergeGapMs is merged, then each segment is padded and
 * clamped to [0, totalSamples] (padding that makes neighbours touch merges them too).
 */
function segmentsFromProbabilities(probs, options = {}, totalSamples) {
  const o = { ...DEFAULTS, ...options };
  const frames = probs ? probs.length : 0;
  const total = Number.isFinite(totalSamples) ? totalSamples : frames * FRAME;
  const clamp = (n) => Math.max(0, Math.min(total, n));

  const raw = [];
  let start = -1;
  for (let i = 0; i < frames; i++) {
    const p = probs[i];
    if (start < 0) {
      if (p >= o.threshold) start = i * FRAME;
    } else if (p < o.negThreshold) {
      raw.push({ start, end: i * FRAME });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ start, end: frames * FRAME });

  const minSamples = msToSamples(o.minSpeechMs);
  const gapSamples = msToSamples(o.mergeGapMs);
  const merged = [];
  for (const seg of raw) {
    if (Math.min(seg.end, total) - seg.start < minSamples) continue;
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < gapSamples) last.end = seg.end;
    else merged.push({ start: seg.start, end: seg.end });
  }

  const padBefore = msToSamples(o.padBeforeMs);
  const padAfter = msToSamples(o.padAfterMs);
  const out = [];
  for (const seg of merged) {
    const padded = { start: clamp(seg.start - padBefore), end: clamp(seg.end + padAfter) };
    const last = out[out.length - 1];
    if (last && padded.start <= last.end) last.end = Math.max(last.end, padded.end);
    else if (padded.end > padded.start) out.push(padded);
  }
  return out;
}

/** Concatenate the audio of each segment with gapMs of silence between them (none before the first or after the last). */
function joinSegments(audio, segments, gapMs = 100) {
  const gap = msToSamples(gapMs);
  const parts = [];
  let length = 0;
  for (const seg of segments) {
    const start = Math.max(0, Math.min(audio.length, seg.start));
    const end = Math.max(start, Math.min(audio.length, seg.end));
    parts.push(audio.subarray(start, end));
    length += end - start;
  }
  if (parts.length > 1) length += gap * (parts.length - 1);
  const out = new Float32Array(length);
  let at = 0;
  parts.forEach((part, i) => {
    if (i > 0) at += gap; // out is zero-filled, so the gap stays silent
    out.set(part, at);
    at += part.length;
  });
  return out;
}

/** Root mean square level of a frame (0 for an empty one). */
function rms(frame) {
  if (!frame || frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

module.exports = { FRAME, SAMPLE_RATE, segmentsFromProbabilities, joinSegments, rms };
