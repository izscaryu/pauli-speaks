'use strict';
// Audio helpers. Audio is mono 16 kHz in 40 ms chunks, which is what Whisper expects.

const SAMPLE_RATE = 16000;

/** Float32 [-1, 1] mono -> 16-bit PCM WAV buffer (for cloud upload). */
function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

/** 16-bit PCM mono WAV buffer -> Float32Array (used by tests and tools). */
function decodeWav(buf) {
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(offset + 10), sampleRate: buf.readUInt32LE(offset + 12), bits: buf.readUInt16LE(offset + 22) };
    } else if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('Only 16-bit PCM WAV is supported');
      const frames = size / 2 / fmt.channels;
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = buf.readInt16LE(offset + 8 + i * 2 * fmt.channels) / 0x8000;
      return { samples: out, sampleRate: fmt.sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Invalid WAV file');
}

/** Peak of 50 ms RMS windows - used to skip silent recordings before ASR. */
function speechLevel(samples, sampleRate = SAMPLE_RATE) {
  const win = Math.max(1, Math.floor(sampleRate * 0.05));
  let peak = 0;
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    peak = Math.max(peak, Math.sqrt(sum / (end - i)));
  }
  return peak;
}

/**
 * Split long recordings (file transcription) into ~`windowSec` pieces, cutting
 * at the quietest 50 ms inside the last `searchSec` of each window so words
 * are not chopped in half. Lets the UI show progress per piece.
 * @returns {{start: number, samples: Float32Array}[]} start in seconds
 */
function splitAtPauses(samples, { sampleRate = SAMPLE_RATE, windowSec = 120, searchSec = 10 } = {}) {
  const out = [];
  const win = Math.floor(windowSec * sampleRate);
  const search = Math.floor(searchSec * sampleRate);
  const hop = Math.floor(0.05 * sampleRate);
  let pos = 0;
  while (pos < samples.length) {
    let end = Math.min(samples.length, pos + win);
    if (end < samples.length) {
      let best = end;
      let bestEnergy = Infinity;
      for (let i = end - search; i + hop <= end; i += hop) {
        let e = 0;
        for (let j = i; j < i + hop; j++) e += samples[j] * samples[j];
        if (e < bestEnergy) {
          bestEnergy = e;
          best = i + Math.floor(hop / 2);
        }
      }
      end = best;
    }
    out.push({ start: pos / sampleRate, samples: samples.subarray(pos, end) });
    pos = end;
  }
  return out;
}

module.exports = { SAMPLE_RATE, encodeWav, decodeWav, speechLevel, splitAtPauses };
