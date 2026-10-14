'use strict';
// Main-process side of the ASR utility process: request/response by id,
// download progress aggregation, automatic restart if the worker dies.

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { utilityProcess } = require('electron');
const log = require('../logger');

class LocalAsr extends EventEmitter {
  constructor(cacheDir) {
    super();
    this.cacheDir = cacheDir;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.files = new Map();
  }

  #ensure() {
    if (this.child) return this.child;
    const child = utilityProcess.fork(path.join(__dirname, 'asr-worker.js'), [], {
      serviceName: 'Pauli Speaks Speech Engine',
      stdio: 'pipe',
    });
    child.stdout?.on('data', (d) => log.debug(`[asr] ${String(d).trim()}`));
    child.stderr?.on('data', (d) => log.warn(`[asr] ${String(d).trim()}`));
    child.on('message', (msg) => this.#onMessage(msg));
    child.on('exit', (code) => {
      log.warn(`Speech engine exited (code ${code})`);
      this.child = null;
      for (const { reject } of this.pending.values()) reject(new Error('Speech engine stopped unexpectedly'));
      this.pending.clear();
    });
    this.child = child;
    return child;
  }

  #onMessage(msg) {
    if (msg.type === 'progress') return this.#onProgress(msg.progress);
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
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
      this.pending.set(id, { resolve, reject });
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

  dispose() {
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { LocalAsr };
