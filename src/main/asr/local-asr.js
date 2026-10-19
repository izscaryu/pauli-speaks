'use strict';
// Main-process side of the ASR utility process: request/response by id,
// download progress aggregation, automatic restart if the worker dies.
// Every request has a time limit; a worker that does not answer in time is
// restarted, so a hung engine fails the dictation (which offers Retry) instead
// of leaving it processing until the app restarts.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const log = require('../logger');

const SAMPLE_RATE = 16000;
const LOAD_IDLE_MS = 10 * 60_000; // a load (often a download) may take long, but not 10 minutes without progress
const TIMEOUT_MESSAGE = 'Speech engine did not answer in time';
const RESTARTED_MESSAGE = 'Speech engine restarted after it stopped answering';

const isVadJob = (type) => type === 'vad' || type === 'vad-stream';
const audioSeconds = (samples) => (samples ? samples.length / SAMPLE_RATE : 0);

/**
 * How long the worker may take to answer a request, counted from when the job could start
 * (the worker runs Whisper jobs, and voice-activity jobs, one at a time; see asr-worker.js).
 * Loads count from the last progress report instead.
 */
function requestTimeoutMs(msg) {
  switch (msg.type) {
    case 'load':
    case 'load-translator':
      return LOAD_IDLE_MS;
    case 'transcribe': // 30 s, plus 3x real time for a slow CPU
      return Math.round(30_000 + 3000 * audioSeconds(msg.audio));
    case 'translate':
      return Math.round(30_000 + 20 * String(msg.text || '').length);
    case 'vad':
      return Math.round(10_000 + 50 * audioSeconds(msg.audio));
    default: // vad-stream: about a second of audio at a time
      return 10_000;
  }
}

const forkWorker = (modulePath, options) => require('electron').utilityProcess.fork(modulePath, [], options);

class LocalAsr extends EventEmitter {
  /** @param {string} cacheDir  @param {{fork?: (modulePath: string, options: object) => object}} [o]  fork: tests pass a fake worker */
  constructor(cacheDir, { fork = forkWorker } = {}) {
    super();
    this.cacheDir = cacheDir;
    this.fork = fork;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.files = new Map();
  }

  #ensure() {
    if (this.child) return this.child;
    const child = this.fork(path.join(__dirname, 'asr-worker.js'), {
      serviceName: 'Pauli Speaks Speech Engine',
      stdio: 'pipe',
    });
    child.stdout?.on('data', (d) => log.debug(`[asr] ${String(d).trim()}`));
    child.stderr?.on('data', (d) => log.warn(`[asr] ${String(d).trim()}`));
    child.on('message', (msg) => this.#onMessage(msg));
    child.on('exit', (code) => {
      if (this.child !== child) return; // restarted after a timeout: its requests already failed
      log.warn(`Speech engine exited (code ${code})`);
      this.child = null;
      this.#failAll(child, 'Speech engine stopped unexpectedly');
      this.emit('restarted', 'exit');
    });
    this.child = child;
    return child;
  }

  /** Rejects every request waiting on `child`. */
  #failAll(child, message) {
    for (const [id, p] of this.pending) {
      if (p.child !== child) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new Error(message));
    }
  }

  /** (Re)starts a request's clock. */
  #arm(id, p) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.#timedOut(id), p.limitMs);
    p.timer.unref?.();
  }

  /** Restarts the clocks of requests on `child` that `which` selects: the worker is alive and moving on to them. */
  #rearm(child, which) {
    for (const [id, p] of this.pending) if (p.child === child && which(p)) this.#arm(id, p);
  }

  #timedOut(id) {
    const p = this.pending.get(id);
    if (!p) return;
    log.warn(`Speech engine did not answer a ${p.type} request within ${Math.round(p.limitMs / 1000)}s: restarting it`);
    this.pending.delete(id);
    p.reject(new Error(TIMEOUT_MESSAGE));
    const child = p.child;
    if (this.child === child) this.child = null; // the next request starts a fresh worker
    this.#failAll(child, RESTARTED_MESSAGE);
    child.kill();
    this.emit('restarted', 'timeout');
  }

  #onMessage(msg) {
    if (msg.type === 'progress') {
      this.#rearm(this.child, (p) => !p.vad); // downloading or loading: alive
      return this.#onProgress(msg.progress);
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    this.#rearm(p.child, (q) => q.vad === p.vad); // the next job in its queue starts now
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  #onProgress(p) {
    if (p.status === 'ready') {
      this.files.delete(p.model);
      this.emit('progress', { model: p.model, status: 'ready', percent: 100, device: p.device, gpuError: p.gpuError });
      return;
    }
    if (p.file && (p.status === 'progress' || p.status === 'download' || p.status === 'done')) {
      if (!this.files.has(p.model)) this.files.set(p.model, new Map());
      const files = this.files.get(p.model);
      const f = files.get(p.file) || { loaded: 0, total: 0 };
      if (p.total) f.total = p.total;
      if (p.loaded != null) f.loaded = p.loaded;
      if (p.status === 'done' && f.total) f.loaded = f.total;
      files.set(p.file, f);
      let loaded = 0;
      let total = 0;
      for (const v of files.values()) {
        loaded += v.loaded;
        total += v.total;
      }
      const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
      this.emit('progress', { model: p.model, status: 'downloading', percent, loaded, total });
    }
  }

  #request(msg, transfer) {
    const child = this.#ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, child, type: msg.type, vad: isVadJob(msg.type), limitMs: requestTimeoutMs(msg), timer: null };
      this.pending.set(id, p);
      this.#arm(id, p);
      child.postMessage({ ...msg, id, cacheDir: this.cacheDir }, transfer);
    });
  }

  /** @returns {Promise<{model: string, device: 'dml'|'cpu', gpuError: string|null}>} */
  load(model, acceleration) {
    return this.#request({ type: 'load', model, acceleration });
  }

  /**
   * @param {Float32Array} audio
   * @param {{model, acceleration, languages, task?, prompt?, timestamps?}} opts
   * @returns {Promise<{text: string, language: string, translatedTo: string|null, chunks: object[]|null, device: string}>}
   */
  transcribe(audio, opts) {
    return this.#request({ type: 'transcribe', audio, opts });
  }

  loadTranslator() {
    return this.#request({ type: 'load-translator' });
  }

  /** @returns {Promise<string>} */
  translate(text, source, target) {
    return this.#request({ type: 'translate', text, source, target });
  }

  /**
   * Speech segments of a whole recording (Silero VAD, padded and merged), in samples.
   * @param {Float32Array} audio 16 kHz mono
   * @returns {Promise<Array<{start: number, end: number}>>}
   */
  detectSpeech(audio) {
    return this.#request({ type: 'vad', audio });
  }

  /**
   * Live voice-activity detection: feed the recording as it arrives. A new `session`
   * id starts from a clean state.
   * @param {string|number} session
   * @param {Float32Array} samples 16 kHz mono
   * @returns {Promise<{speechFrames: number, silentMsSinceSpeech: number, heardSpeech: boolean}>}
   */
  vadStream(session, samples) {
    return this.#request({ type: 'vad-stream', session, samples });
  }

  /** Stops the worker and waits until it has exited, so it no longer holds the model files open. A later request starts a fresh one. */
  async stop(timeoutMs = 5000) {
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }

  dispose() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.#failAll(child, 'Speech engine stopped unexpectedly');
    child.kill();
  }
}

module.exports = { LocalAsr, requestTimeoutMs, LOAD_IDLE_MS };
