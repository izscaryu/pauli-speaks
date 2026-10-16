'use strict';
// Voice-activity detection with the Silero VAD ONNX model (assets/models/silero_vad.onnx).
// Runs in the ASR worker. No Electron here, so it can be unit tested with plain Node.
//
// How the model is fed (from the reference OnnxWrapper in silero-vad v6.2.3,
// src/silero_vad/utils_vad.py), at 16 kHz:
// - inputs: `input` float32 [1, 64 + 512] = the last 64 samples of the previous frame
//   (zeros for the first one) followed by the 512-sample frame; `state` float32
//   [2, 1, 128] (zeros at the start); `sr` int64 scalar 16000.
// - outputs: `output` float32 [1, 1], the speech probability, and `stateN`, the state
//   for the next frame. A partial last frame is padded with zeros.
// Frames quieter than the energy floor count as silence without running the model.

const { FRAME, SAMPLE_RATE, rms, segmentsFromProbabilities } = require('../speech-segments');

const ENERGY_FLOOR = 0.0015; // frame RMS below this -> probability 0
const CONTEXT = 64; // samples carried over from the previous frame at 16 kHz
const STATE_SIZE = 2 * 1 * 128;
const FRAME_MS = (FRAME * 1000) / SAMPLE_RATE; // 32
// Same hysteresis as segmentsFromProbabilities' defaults: speech starts at >= 0.5, ends below 0.35.
const THRESHOLD = 0.5;
const NEG_THRESHOLD = 0.35;

function createVad({ modelBuffer, ort }) {
  let sessionPromise = null;
  const session = () =>
    (sessionPromise ??= Promise.resolve().then(() =>
      ort.InferenceSession.create(modelBuffer, { intraOpNumThreads: 1, interOpNumThreads: 1 }),
    ));
  const srTensor = () => new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);

  /** Recurrent state for one pass over audio (a recording or a live stream). */
  function createRunner() {
    let state = new Float32Array(STATE_SIZE);
    const input = new Float32Array(CONTEXT + FRAME); // [context | frame]
    return {
      /** frame: Float32Array of exactly FRAME samples -> probability in [0, 1]. */
      async frame(frame) {
        let p = 0;
        const level = rms(frame);
        if (level >= ENERGY_FLOOR) {
          input.set(frame, CONTEXT);
          const s = await session();
          const out = await s.run({
            input: new ort.Tensor('float32', input, [1, CONTEXT + FRAME]),
            state: new ort.Tensor('float32', state, [2, 1, 128]),
            sr: srTensor(),
          });
          const value = out.output.data[0];
          p = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
          const next = out.stateN.data;
          state = next.length === STATE_SIZE && next.every(Number.isFinite) ? Float32Array.from(next) : new Float32Array(STATE_SIZE);
        }
        input.set(frame.subarray(FRAME - CONTEXT), 0); // context for the next frame, quiet or not
        return p;
      },
    };
  }

  const asFloat32 = (audio) => (audio instanceof Float32Array ? audio : Float32Array.from(audio || []));

  /** One probability per 512-sample frame (the partial last frame counts, zero-padded). */
  async function probabilities(audio) {
    const samples = asFloat32(audio);
    const runner = createRunner();
    const frames = Math.ceil(samples.length / FRAME);
    const probs = new Float32Array(frames);
    const padded = new Float32Array(FRAME);
    for (let i = 0; i < frames; i++) {
      let frame = samples.subarray(i * FRAME, (i + 1) * FRAME);
      if (frame.length < FRAME) {
        padded.fill(0);
        padded.set(frame);
        frame = padded;
      }
      probs[i] = await runner.frame(frame);
    }
    return probs;
  }

  /** Speech segments [{ start, end }] in samples, padded and merged (see speech-segments.js). */
  async function detect(audio) {
    const samples = asFloat32(audio);
    return segmentsFromProbabilities(await probabilities(samples), {}, samples.length);
  }

  /**
   * Live detection for hands-free dictation. push() takes any number of samples; whole
   * frames are processed and the remainder waits for the next push. It returns the
   * speech frames in this push, the ms of audio since the last speech frame (since the
   * start while nothing was heard) and whether any speech has been heard yet.
   */
  function createStream() {
    const runner = createRunner();
    let pending = new Float32Array(0);
    let inSpeech = false;
    let heardSpeech = false;
    let silentFrames = 0;
    let chain = Promise.resolve();

    async function process(samples) {
      const incoming = asFloat32(samples);
      const all = new Float32Array(pending.length + incoming.length);
      all.set(pending);
      all.set(incoming, pending.length);
      let speechFrames = 0;
      let at = 0;
      for (; at + FRAME <= all.length; at += FRAME) {
        const p = await runner.frame(all.subarray(at, at + FRAME));
        inSpeech = inSpeech ? p >= NEG_THRESHOLD : p >= THRESHOLD;
        if (inSpeech) {
          speechFrames++;
          heardSpeech = true;
          silentFrames = 0;
        } else {
          silentFrames++;
        }
      }
      pending = all.slice(at);
      return { speechFrames, silentMsSinceSpeech: silentFrames * FRAME_MS, heardSpeech };
    }

    return {
      push(samples) {
        const result = chain.then(() => process(samples)); // keep pushes in order
        chain = result.catch(() => {});
        return result;
      },
    };
  }

  return { probabilities, detect, createStream };
}

module.exports = { createVad, ENERGY_FLOOR };
