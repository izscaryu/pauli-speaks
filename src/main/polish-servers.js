'use strict';
// AI polish, "Find servers": Ollama and LM Studio on their default ports on this PC, and the chat models each
// one offers. Foundry Local picks a new port every time it starts, so it isn't looked for here: the app runs it
// itself (foundry-local.js). Only 127.0.0.1 is asked, each with a short deadline. `fetch` is passed in for tests.

const { DEFAULT_URLS } = require('./polish');

const PROBE_TIMEOUT_MS = 1500;
const MAX_MODELS = 200;
const PROBES = Object.freeze([
  { provider: 'ollama', baseUrl: DEFAULT_URLS.ollama, fallback: 'http://127.0.0.1:11434/api/tags' },
  { provider: 'lmstudio', baseUrl: DEFAULT_URLS.lmstudio },
]);

/** Model names from an OpenAI-style list ({data: [{id}]}) or Ollama's own ({models: [{name}]}); no embedding models. */
function parseModels(json) {
  const list = json && typeof json === 'object' && !Array.isArray(json)
    ? (Array.isArray(json.data) ? json.data.map((m) => m && m.id) : Array.isArray(json.models) ? json.models.map((m) => m && (m.name || m.model)) : [])
    : [];
  const out = [];
  for (const name of list) {
    if (typeof name !== 'string' || !name || name.length > 200 || /embed/i.test(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** @returns {Promise<object|null>} the JSON, or null when nothing answers there */
async function getJson(fetch, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok ? await res.json() : { status: res.status };
  } catch {
    return null;
  }
}

/**
 * @param {{fetch?: typeof globalThis.fetch}} [o]
 * @returns {Promise<{provider: string, baseUrl: string, running: boolean, models: string[]}[]>}
 */
async function detectServers({ fetch = globalThis.fetch } = {}) {
  return Promise.all(PROBES.map(async ({ provider, baseUrl, fallback }) => {
    let json = await getJson(fetch, `${baseUrl}/models`);
    if (json && json.status && fallback) json = (await getJson(fetch, fallback)) || json;
    return { provider, baseUrl, running: !!json, models: json ? parseModels(json) : [] };
  }));
}

module.exports = { parseModels, detectServers, PROBES };
