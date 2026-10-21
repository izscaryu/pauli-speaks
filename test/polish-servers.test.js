'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModels, detectServers, PROBES } = require('../src/main/polish-servers');

test('parseModels reads the OpenAI list and Ollama\'s own, without embedding models', () => {
  assert.deepEqual(parseModels({ object: 'list', data: [{ id: 'qwen2.5:1.5b' }, { id: 'llama3.2:3b' }, { id: 'nomic-embed-text:latest' }] }), ['qwen2.5:1.5b', 'llama3.2:3b']);
  assert.deepEqual(parseModels({ models: [{ name: 'gemma3:4b', model: 'gemma3:4b' }, { model: 'phi4-mini' }] }), ['gemma3:4b', 'phi4-mini']);
  assert.deepEqual(parseModels({ data: [{ id: 'a' }, { id: 'a' }, { id: '' }, { id: 42 }, null] }), ['a']);
  for (const junk of [null, 'text', [], { data: 'x' }, { models: {} }]) assert.deepEqual(parseModels(junk), []);
  assert.equal(parseModels({ data: Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` })) }).length, 200, 'capped');
});

test('the servers looked for: Ollama on 11434 and LM Studio on 1234, both on this PC', () => {
  assert.deepEqual(PROBES.map((p) => [p.provider, p.baseUrl]), [
    ['ollama', 'http://127.0.0.1:11434/v1'],
    ['lmstudio', 'http://127.0.0.1:1234/v1'],
  ]);
});

/** A fetch that answers per URL: a JSON body, a status, or a refused connection. */
function fakeFetch(routes) {
  const asked = [];
  const fetch = async (url, opts) => {
    asked.push({ url, signal: opts && opts.signal });
    const r = routes[url];
    if (!r) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
  };
  return { fetch, asked };
}

test('detectServers lists what runs and its models; a server that is off is listed as not running', async () => {
  const { fetch, asked } = fakeFetch({
    'http://127.0.0.1:11434/v1/models': { body: { data: [{ id: 'qwen2.5:1.5b' }] } },
  });
  const found = await detectServers({ fetch });
  assert.deepEqual(found, [
    { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', running: true, models: ['qwen2.5:1.5b'] },
    { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', running: false, models: [] },
  ]);
  assert.ok(asked.every((a) => a.signal), 'every probe has a deadline');
});

test('an older Ollama without /v1/models is asked through its own /api/tags', async () => {
  const { fetch } = fakeFetch({
    'http://127.0.0.1:11434/v1/models': { status: 404, body: {} },
    'http://127.0.0.1:11434/api/tags': { body: { models: [{ name: 'llama3.2:3b' }] } },
    'http://127.0.0.1:1234/v1/models': { body: { data: [] } },
  });
  const found = await detectServers({ fetch });
  assert.deepEqual(found[0].models, ['llama3.2:3b']);
  assert.equal(found[0].running, true);
  assert.deepEqual([found[1].running, found[1].models], [true, []], 'LM Studio runs, no model loaded');
});
