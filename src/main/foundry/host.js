'use strict';
// Foundry Local inside its worker (worker.js): the requests the app makes of the SDK. The SDK is loaded on the first
// request and passed in, so this is unit tested with a fake one.
//   catalog          the chat models that can polish quickly enough on a CPU, smallest first, with their size
//   download {id}    one of those, with progress; cancel stops it
//   start {id}       load a downloaded model and the SDK's web service on 127.0.0.1 (OpenAI-compatible)
//   stop, remove {id}
// Nothing is ever downloaded without a download request: start refuses a model that isn't on disk yet.

const RECOMMENDED = 'qwen2.5-0.5b'; // answers in about half a second on a laptop CPU, well inside the 2.5 s limit
const MAX_MB = 5000; // bigger models answer too slowly on a CPU to polish within the limit
const SLOW = /reasoning|deepseek-r1|gpt-oss/i; // think before they answer

/** @param {{alias, id, task, sizeMb, cached, license}[]} models  @returns the ones to offer, smallest first */
function chatModels(models) {
  return models
    .filter((m) => m.task === 'chat-completion' && !SLOW.test(`${m.alias} ${m.id}`) && Number(m.sizeMb) > 0 && m.sizeMb <= MAX_MB)
    .sort((a, b) => a.sizeMb - b.sizeMb)
    .map(({ alias, id, sizeMb, cached, license }) => ({ alias, id, sizeMb, cached: !!cached, license: license || '', recommended: alias === RECOMMENDED }));
}

const plain = (m) => ({ alias: m.alias, id: m.id, task: m.info.task, sizeMb: m.info.fileSizeMb, cached: m.isCached, license: m.info.license });

/**
 * @param {object} o
 * @param {() => Promise<object>} o.load  imports the SDK
 * @param {object} o.config  paths.js foundryConfig
 * @param {(p: {id: string, percent: number}) => void} o.onProgress
 */
function createFoundryHost({ load, config, onProgress }) {
  let manager = null;
  let current = null; // the loaded model
  let download = null; // AbortController of the download in progress

  async function getManager() {
    if (!manager) manager = (await load()).FoundryLocalManager.create(config);
    return manager;
  }

  /** A model from the offered list, or an error: the window can't name any other. */
  async function offered(id) {
    const m = await getManager();
    const all = await m.catalog.getModels();
    if (!chatModels(all.map(plain)).some((x) => x.id === id)) throw new Error(`${String(id).slice(0, 80)} is not one of the models offered for polish`);
    return all.find((x) => x.id === id);
  }

  const handlers = {
    async catalog() {
      const m = await getManager();
      return chatModels((await m.catalog.getModels()).map(plain));
    },

    async download({ id }) {
      download?.abort();
      const controller = new AbortController(); // before any await, so cancel can reach it
      download = controller;
      try {
        const model = await offered(id);
        controller.signal.throwIfAborted();
        let last = -1; // the SDK reports many times per percent: the window hears each whole percent once
        await model.download((percent) => {
          const whole = Math.round(percent);
          if (whole !== last) onProgress({ id, percent: (last = whole) });
        }, controller.signal);
        return { cached: true };
      } finally {
        if (download === controller) download = null;
      }
    },

    async cancel() {
      download?.abort();
      return null;
    },

    async start({ id }) {
      const m = await getManager();
      const model = await m.catalog.getModelVariant(String(id));
      if (!model.isCached) throw Object.assign(new Error('That model is not downloaded yet'), { code: 'not-downloaded' });
      if (current && current.id !== model.id) await current.unload();
      if (current !== model) {
        await model.load();
        current = model;
      }
      if (!m.isWebServiceRunning) m.startWebService();
      return { url: `${m.urls[0].replace(/\/+$/, '')}/v1` };
    },

    async stop() {
      if (!manager) return null;
      if (manager.isWebServiceRunning) manager.stopWebService();
      if (current) await current.unload();
      current = null;
      return null;
    },

    async remove({ id }) {
      const model = await offered(id);
      if (current && current.id === model.id) {
        await current.unload();
        current = null;
      }
      model.removeFromCache();
      return null;
    },
  };

  return {
    /** @returns {Promise<any>} the answer; throws for an unknown request */
    async handle(msg) {
      const type = msg && msg.type;
      if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) throw new Error(`Unknown request ${String(type).slice(0, 40)}`);
      return handlers[type](msg);
    },
  };
}

module.exports = { createFoundryHost, chatModels, RECOMMENDED };
