'use strict';
// AI polish end to end: a fake OpenAI-compatible server on this PC stands in for Ollama. A polished dictation is
// pasted polished and the pill's Undo puts back what was said; a server that is too slow is not waited for; short
// dictations never reach it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { launch, setUpSettings, waitFor } = require('./helpers');

const BACKSPACE = 0x08;

/** A chat server that answers `reply` after `delayMs`, and counts what it was asked. */
async function chatServer({ reply = 'We meet on Wednesday at the office.', delayMs = 0 } = {}) {
  const asked = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      asked.push({ url: req.url, body: JSON.parse(body || '{}') });
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { asked, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => { server.closeAllConnections(); server.close(); } };
}

const polishing = (url) => setUpSettings({
  polish: { provider: 'ollama', baseUrl: url, model: 'fake-model' },
  modes: [{ id: 'default', aiPolish: 'medium' }],
});

async function dictate(run, ms = 1500) {
  await run.key('F13', true);
  await new Promise((r) => setTimeout(r, ms));
  await run.key('F13', false);
}

const pastes = (run, n) => waitFor(async () => { const s = await run.state(); return s.pasted.length >= n ? s : null; }, { what: `${n} paste(s)` });

test('a polished dictation is pasted polished, and the pill\'s Undo puts back what was said', async (t) => {
  const server = await chatServer();
  t.after(server.close);
  const run = await launch({ settings: polishing(server.url) });
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'so um we meet on tuesday no wait wednesday at the office');
  await dictate(run);
  const first = await pastes(run, 1);
  assert.deepEqual(first.pasted, ['We meet on Wednesday at the office. ']);
  const sent = server.asked.find((a) => a.url === '/v1/chat/completions' && a.body.max_tokens > 1);
  assert.equal(sent.body.model, 'fake-model');
  assert.match(sent.body.messages.at(-1).content, /we meet on tuesday no wait wednesday/i);

  const pill = await waitFor(() => run.app.windows().find((w) => w.url().endsWith('overlay.html')), { what: 'the pill' });
  await waitFor(() => pill.evaluate(() => !document.getElementById('action').hidden), { what: 'the Undo button' });
  assert.match(await pill.evaluate(() => document.getElementById('label').textContent), /Polished/);
  await pill.click('#action');
  const after = await pastes(run, 2);
  assert.deepEqual(after.keys.filter((k) => k.vk === BACKSPACE), [{ vk: BACKSPACE, times: [...'We meet on Wednesday at the office. '].length }]);
  assert.equal(after.pasted[1], 'So we meet on tuesday no wait wednesday at the office ');
  const [item] = await run.page.evaluate(() => window.pauli.listHistory());
  assert.equal(item.text, 'So we meet on tuesday no wait wednesday at the office');
  assert.equal(item.polished, 'We meet on Wednesday at the office.');
});

test('a server slower than 2.5 seconds is not waited for: what was said is pasted', async (t) => {
  const server = await chatServer({ delayMs: 6000 });
  t.after(server.close);
  const run = await launch({ settings: polishing(server.url) });
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'please send the report to the whole team today');
  await dictate(run);
  const released = Date.now();
  const state = await pastes(run, 1);
  const waited = Date.now() - released;
  assert.deepEqual(state.pasted, ['Please send the report to the whole team today ']);
  assert.ok(waited < 4500, `pasted ${waited} ms after letting go`);
});

test('a dictation under four words never reaches the server', async (t) => {
  const server = await chatServer();
  t.after(server.close);
  const run = await launch({ settings: polishing(server.url) });
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'see you tomorrow');
  await dictate(run);
  const state = await pastes(run, 1);
  assert.deepEqual(state.pasted, ['See you tomorrow ']);
  assert.equal(server.asked.filter((a) => a.body.max_tokens > 1).length, 0, 'only the warm-up, no polish');
});
