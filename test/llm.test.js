'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chatComplete, cleanCompletion } = require('../src/main/llm');

/** A one-route OpenAI-compatible server that answers `reply` after `delayMs`. */
async function server(reply = 'OK', delayMs = 0) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      }, delayMs);
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return {
    seen,
    url: `http://127.0.0.1:${s.address().port}/v1`,
    close: () => { s.closeAllConnections(); s.close(); },
  };
}

test('chatComplete: a server on this PC needs no API key and gets no Authorization header', async () => {
  const s = await server('Fine.');
  try {
    const out = await chatComplete({ baseUrl: s.url, apiKey: '', model: 'qwen' }, [{ role: 'user', content: 'x' }], { requireKey: false });
    assert.equal(out, 'Fine.');
    assert.equal(s.seen[0].auth, undefined);
  } finally {
    s.close();
  }
});

test('chatComplete: temperature and max tokens can be set per call', async () => {
  const s = await server();
  try {
    await chatComplete({ baseUrl: s.url, apiKey: 'k', model: 'm' }, [], { temperature: 0, maxTokens: 1 });
    assert.equal(s.seen[0].body.temperature, 0);
    assert.equal(s.seen[0].body.max_tokens, 1);
  } finally {
    s.close();
  }
});

test('chatComplete: the caller\'s signal aborts a slow answer', async () => {
  const s = await server('late', 2000);
  try {
    const started = Date.now();
    await assert.rejects(
      chatComplete({ baseUrl: s.url, apiKey: 'k', model: 'm' }, [], { signal: AbortSignal.timeout(100) }),
      (err) => err.name === 'TimeoutError' || err.name === 'AbortError',
    );
    assert.ok(Date.now() - started < 1500, 'gave up at the deadline, not when the server answered');
  } finally {
    s.close();
  }
});

test('cleanCompletion drops a reasoning model\'s <think> block', () => {
  assert.equal(cleanCompletion('<think>\nThe user wants commas.\n</think>\n\nHello, world.'), 'Hello, world.');
  assert.equal(cleanCompletion('<think></think>Hi.'), 'Hi.');
});

test('chatComplete: redirects can be refused, so a dictation is never re-sent somewhere else', async () => {
  const target = await server('Sent elsewhere.');
  const s = http.createServer((req, res) => { res.statusCode = 307; res.setHeader('Location', `${target.url}/chat/completions`); res.end(); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const cfg = { baseUrl: `http://127.0.0.1:${s.address().port}/v1`, apiKey: '', model: 'm' };
  try {
    assert.equal(await chatComplete(cfg, [], { requireKey: false }), 'Sent elsewhere.', 'followed by default (Command mode)');
    const asked = target.seen.length;
    await assert.rejects(chatComplete(cfg, [], { requireKey: false, redirect: 'error' }));
    assert.equal(target.seen.length, asked, 'nothing reached the other server');
  } finally {
    s.closeAllConnections();
    s.close();
    target.close();
  }
});
