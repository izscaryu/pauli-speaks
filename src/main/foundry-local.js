'use strict';
// Foundry Local, set up from the app (Settings → AI polish → On this PC): the main-process side of its worker
// (foundry/worker.js, an Electron utilityProcess started the first time it is needed).
//   catalog()          the chat models offered, with their size and whether they are downloaded
//   download(id)       one of them (only after the window asked the user, showing its size); cancel()
//   start()            the model chosen in Settings and its web service; url() is then where polish sends text
//   remove(id), stop(), dispose()
// The worker comes in through `fork`, so it is unit tested with a fake one.

const START_TIMEOUT_MS = 2 * 60 * 1000; // a first load of a bigger model
const CATALOG_TIMEOUT_MS = 60 * 1000;

const forkWorker = (modulePath, options) => require('electron').utilityProcess.fork(modulePath, [], options);

/**
 * @param {object} d
 * @param {string} d.workerPath
 * @param {string} d.modelsDir  the app's models folder (Foundry Local's go in its foundry folder)
 * @param {string} d.logsDir
 * @param {() => string} d.getModel  settings.polish.model
 * @param {(p: {id: string, percent: number}) => void} d.onProgress
 * @param {{info: Function, warn: Function}} d.log
 * @param {(modulePath: string, options: object) => object} [d.fork]
 */
function createFoundryLocal(d) {
  const fork = d.fork || forkWorker;
  let child = null;
  let nextId = 1;
  const pending = new Map();
  let running = null; // { url, model } once started
  let starting = null; // { model, promise }

  function ensure() {
    if (child) return child;
    const c = fork(d.workerPath, {
      serviceName: 'Pauli Speaks Foundry Local',
      stdio: 'pipe',
      env: { ...process.env, PAULI_FOUNDRY: JSON.stringify({ modelsDir: d.modelsDir, logsDir: d.logsDir }) },
    });
    c.stderr?.on('data', (data) => d.log.warn(`[foundry] ${String(data).trim().slice(0, 500)}`));
    c.on('message', (msg) => {
      if (msg && msg.type === 'progress') return d.onProgress(msg.progress);
      const p = msg && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(Object.assign(new Error(msg.error), { code: msg.code || null }));
    });
    c.on('exit', (code) => {
      if (child !== c) return;
      d.log.warn(`Foundry Local stopped (code ${code})`);
      child = null;
      running = null;
      starting = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Foundry Local stopped'));
        pending.delete(id);
      }
    });
    child = c;
    return c;
  }

  function request(type, modelId, timeoutMs = 0) {
    const c = ensure();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, timer: null };
      if (timeoutMs) {
        p.timer = setTimeout(() => { pending.delete(id); reject(new Error(`Foundry Local did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        p.timer.unref?.();
      }
      pending.set(id, p);
      c.postMessage({ id, type, modelId });
    });
  }

  /** The model chosen in Settings, loaded with its web service on this PC. Several calls share one start. */
  function start() {
    const model = d.getModel();
    if (!model) return Promise.reject(Object.assign(new Error('No Foundry Local model chosen'), { code: 'not-set-up' }));
    if (running && running.model === model) return Promise.resolve(running.url);
    if (starting && starting.model === model) return starting.promise;
    const t0 = Date.now();
    const promise = request('start', model, START_TIMEOUT_MS).then(({ url }) => {
      running = { url, model };
      d.log.info(`Foundry Local ready in ${Date.now() - t0}ms`);
      return url;
    }).finally(() => { if (starting && starting.promise === promise) starting = null; });
    starting = { model, promise };
    return promise;
  }

  return {
    start,
    /** Where polish sends text now, or null when the chosen model isn't running. */
    url: () => (running && running.model === d.getModel() ? running.url : null),
    catalog: () => request('catalog', null, CATALOG_TIMEOUT_MS),
    download: (modelId) => request('download', modelId),
    cancel: () => (child ? request('cancel', null) : Promise.resolve(null)),
    remove: (modelId) => request('remove', modelId).then(() => { if (running && running.model === modelId) running = null; }),
    stop: () => (child ? request('stop', null).then(() => { running = null; }) : Promise.resolve()),
    /** Quit, or before its models are deleted: the worker ends and lets go of its files. */
    dispose() {
      const c = child;
      if (!c) return;
      c.kill();
      if (child === c) c.emit?.('exit', null); // a real utility process says so itself
    },
  };
}

module.exports = { createFoundryLocal };
