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

test('set up in the window: another server on this PC, a test, and a mode that polishes', async (t) => {
  const server = await chatServer({ reply: 'So this is a test of the polish.' });
  t.after(server.close);
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.click('.nav[data-page="settings"]');
  await page.selectOption('#polish-provider', 'custom');
  await page.fill('#polish-url', server.url);
  await page.press('#polish-url', 'Tab');
  await waitFor(() => page.evaluate(() => /Stays on this PC/.test(document.getElementById('polish-where').textContent)), { what: 'the note that the text stays here' });
  await page.fill('#polish-model', 'fake-model');
  await page.press('#polish-model', 'Tab');
  await page.click('#polish-test');
  await waitFor(() => page.evaluate(() => /Polished in/.test(document.getElementById('polish-rows').textContent)), { what: 'the test result' });
  const saved = await page.evaluate(() => window.pauli.getSettings());
  assert.deepEqual([saved.polish.provider, saved.polish.baseUrl, saved.polish.model, saved.polish.apiKeyEnc], ['custom', server.url, 'fake-model', undefined]);

  await page.click('.nav[data-page="modes"]');
  await page.selectOption('#mode-polish', 'prompt');
  await page.waitForSelector('#mode-prompt');
  await page.fill('#mode-prompt', 'Keep it short.');
  await page.press('#mode-prompt', 'Tab');
  await waitFor(async () => {
    const s = await page.evaluate(() => window.pauli.getSettings());
    return s.modes[0].aiPolish === 'prompt' && s.modes[0].prompt === 'Keep it short.';
  }, { what: 'the mode saved' });
});
