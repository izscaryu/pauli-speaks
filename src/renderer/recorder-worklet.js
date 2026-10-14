// AudioWorklet that collects mono 16 kHz samples in ~40 ms chunks
// (Wispr: CHUNK_DURATION_MS = 40, RECORDING_SAMPLE_RATE = 16000).

const CHUNK = 640;

class PauliRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.len = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.len > 0) this.#emit(this.buf.slice(0, this.len));
        this.len = 0;
        this.port.postMessage({ flushed: true });
      }
    };
  }

  #emit(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    this.port.postMessage({ samples, rms: Math.sqrt(sum / samples.length) }, [samples.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.len++] = ch[i];
      if (this.len === CHUNK) {
        this.#emit(this.buf);
        this.buf = new Float32Array(CHUNK);
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor('pauli-recorder', PauliRecorder);
