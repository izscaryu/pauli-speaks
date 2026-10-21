'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPolisher, acceptPolish, isLocalUrl, timeoutFor, LOCAL_TIMEOUT_MS, CLOUD_TIMEOUT_MS, WARM_EVERY_MS,
} = require('../src/main/polish');

const MODE = { id: 'chat', aiPolish: 'medium', prompt: 'Use British spelling.' };
const SAID = 'so um we meet on tuesday no wait wednesday at the office ';

/** Timers the test fires by hand: what was scheduled, and advance(ms) to fire those due. */
function fakeTimers() {
  let clock = 0;
  const due = [];
  return {
    now: () => clock,
    timers: {
      setTimeout: (fn, ms) => { const t = { fn, at: clock + ms, ms }; due.push(t); return t; },
      clearTimeout: (t) => { const i = due.indexOf(t); if (i >= 0) due.splice(i, 1); },
    },
    scheduled: () => due.map((t) => t.ms),
    advance(ms) {
      clock += ms;
      for (const t of due.filter((x) => x.at <= clock)) { due.splice(due.indexOf(t), 1); t.fn(); }
    },
  };
}

function setup({ polish = {}, reply = 'We meet on Wednesday at the office.', chat, foundry } = {}) {
  const calls = [];
  const lines = [];
  const time = fakeTimers();
  const s = {
    cloud: { baseUrl: 'https://api.groq.com/openai/v1' },
    polish: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:1.5b', ...polish },
  };
  const polisher = createPolisher({
    settings: { get: () => s },
    keys: { cloud: () => 'gsk-cloud', polish: () => 'own-key' },
    chat: chat || (async (cfg, messages, opts) => { calls.push({ cfg, messages, opts }); return reply; }),
    foundry,
    log: { info: (l) => lines.push(l), warn: (l) => lines.push(l) },
    now: time.now,
    timers: time.timers,
  });
  return { polisher, calls, lines, time, s };
}

test('isLocalUrl / timeoutFor: 2.5 s for a server on this PC, 4 s for anything that leaves it', () => {
  for (const u of ['http://127.0.0.1:11434/v1', 'http://localhost:1234/v1', 'http://[::1]:5273/v1', 'http://127.0.0.5:80']) {
    assert.equal(isLocalUrl(u), true, u);
    assert.equal(timeoutFor(u), LOCAL_TIMEOUT_MS);
  }
  for (const u of ['https://api.groq.com/openai/v1', 'http://192.168.1.20:11434/v1', 'http://localhost.example.com/v1', 'not a url', '']) {
    assert.equal(isLocalUrl(u), false, u);
    assert.equal(timeoutFor(u), CLOUD_TIMEOUT_MS);
  }
  assert.equal(LOCAL_TIMEOUT_MS, 2500);
  assert.equal(CLOUD_TIMEOUT_MS, 4000);
});

test('acceptPolish: empty, chatty, far longer or (Light) far shorter answers are refused', () => {
  const said = 'we meet on wednesday at the office to go over the budget';
  assert.deepEqual(acceptPolish(said, 'We meet on Wednesday at the office to go over the budget.', 'light'), { ok: true, text: 'We meet on Wednesday at the office to go over the budget.' });
  assert.equal(acceptPolish(said, '   ', 'medium').reason, 'empty');
  assert.equal(acceptPolish(said, 'Sure! Here is the polished text: We meet on Wednesday.', 'medium').reason, 'chatty');
  assert.equal(acceptPolish(said, "Here's the corrected version: We meet.", 'high').reason, 'chatty');
  assert.equal(acceptPolish(said, 'x'.repeat(said.length * 2 + 61), 'high').reason, 'too-long');
  assert.equal(acceptPolish(said, 'We meet.', 'light').reason, 'too-short');
  assert.equal(acceptPolish(said, 'We meet Wednesday at the office about the budget.', 'high').ok, true, 'High may shorten');
  assert.equal(acceptPolish('sure we can do that next week then', 'Sure, we can do that next week then.', 'light').ok, true, 'said "sure" itself');
  assert.deepEqual(acceptPolish(said, '<transcript>\nWe meet on Wednesday at the office to go over the budget.\n</transcript>', 'light').text, 'We meet on Wednesday at the office to go over the budget.');
});

test('polishes with the mode\'s level and instructions, and keeps the spacing around the text', async () => {
  const { polisher, calls } = setup();
  const out = await polisher.polish({ text: SAID, mode: MODE, language: 'en' });
  assert.equal(out.text, 'We meet on Wednesday at the office. ');
  assert.equal(out.polished, true);
  assert.equal(out.outcome, 'polished');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cfg.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(calls[0].cfg.model, 'qwen2.5:1.5b');
  assert.equal(calls[0].cfg.apiKey, '', 'no key goes to a server on this PC');
  assert.equal(calls[0].opts.requireKey, false);
  assert.match(calls[0].messages[0].content, /false starts/);
  assert.match(calls[0].messages[0].content, /Use British spelling\.$/);
  assert.match(calls[0].messages.at(-1).content, /so um we meet on tuesday/);
  assert.ok(!calls[0].messages.at(-1).content.endsWith(' \n</transcript>'), 'trimmed before sending');
});

test('cloud uses the Speech recognition API key and URL; a custom URL its own key', async () => {
  const cloud = setup({ polish: { provider: 'cloud', model: 'llama-3.1-8b-instant' } });
  await cloud.polisher.polish({ text: SAID, mode: MODE });
  assert.deepEqual([cloud.calls[0].cfg.baseUrl, cloud.calls[0].cfg.apiKey], ['https://api.groq.com/openai/v1', 'gsk-cloud']);
  assert.equal(cloud.calls[0].opts.requireKey, true);
  const custom = setup({ polish: { provider: 'custom', baseUrl: 'https://llm.example.org/v1', model: 'm' } });
  await custom.polisher.polish({ text: SAID, mode: MODE });
  assert.deepEqual([custom.calls[0].cfg.baseUrl, custom.calls[0].cfg.apiKey], ['https://llm.example.org/v1', 'own-key']);
});

test('skipped without a network call: polish off, mode off, Command mode, under four words, no model chosen', async () => {
  const cases = [
    [{ polish: { provider: 'off' } }, { text: SAID, mode: MODE }, 'skipped:off'],
    [{}, { text: SAID, mode: { ...MODE, aiPolish: 'off' } }, 'skipped:off'],
    [{}, { text: SAID, mode: MODE, command: true }, 'skipped:command'],
    [{}, { text: 'see you tomorrow ', mode: MODE }, 'skipped:short'],
    [{ polish: { model: '' } }, { text: SAID, mode: MODE }, 'not-set-up'],
  ];
  for (const [opts, input, outcome] of cases) {
    const { polisher, calls } = setup(opts);
    const out = await polisher.polish(input);
    assert.deepEqual([out.text, out.polished, out.outcome, calls.length], [input.text, false, outcome, 0], outcome);
  }
});

test('timeout: the raw text after 2.5 s on this PC (the request is aborted); 4 s in the cloud', async () => {
  for (const [polish, ms] of [[{}, 2500], [{ provider: 'cloud', model: 'm' }, 4000]]) {
    let signal = null;
    const { polisher, time } = setup({ polish, chat: (_c, _m, opts) => { signal = opts.signal; return new Promise(() => {}); } });
    const pending = polisher.polish({ text: SAID, mode: MODE });
    await Promise.resolve();
    assert.deepEqual(time.scheduled(), [ms]);
    time.advance(ms);
    const out = await pending;
    assert.deepEqual([out.text, out.polished, out.outcome], [SAID, false, 'timeout']);
    assert.equal(signal.aborted, true);
  }
});

test('an error or a refused answer pastes the raw text and never throws', async () => {
  const failing = setup({ chat: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); } });
  assert.deepEqual(await failing.polisher.polish({ text: SAID, mode: MODE }).then((o) => [o.text, o.outcome]), [SAID, 'error']);
  const chatty = setup({ reply: 'Sure! Here you go: We meet Wednesday.' });
  assert.deepEqual(await chatty.polisher.polish({ text: SAID, mode: MODE }).then((o) => [o.text, o.outcome]), [SAID, 'rejected:chatty']);
  const same = setup({ reply: SAID.trim() });
  assert.deepEqual(await same.polisher.polish({ text: SAID, mode: MODE }).then((o) => [o.polished, o.outcome]), [false, 'unchanged']);
});

test('the log has the level, provider, outcome, lengths and time, never the words', async () => {
  const { polisher, lines } = setup();
  await polisher.polish({ text: SAID, mode: MODE });
  const failing = setup({ chat: async () => { throw new Error('boom'); } });
  await failing.polisher.polish({ text: SAID, mode: MODE });
  const all = [...lines, ...failing.lines].join('\n');
  assert.match(all, /medium/);
  assert.match(all, /ollama/);
  assert.match(all, /\d+ -> \d+ chars/);
  for (const word of ['tuesday', 'wednesday', 'Wednesday', 'office']) assert.ok(!all.includes(word), word);
});

test('Foundry Local not running yet: it is started, and this dictation is pasted as said', async () => {
  let started = 0;
  const foundry = { url: () => null, start: async () => { started++; } };
  const { polisher, calls } = setup({ polish: { provider: 'foundry', baseUrl: '', model: 'qwen2.5-1.5b-instruct-generic-cpu:4' }, foundry });
  const out = await polisher.polish({ text: SAID, mode: MODE });
  assert.deepEqual([out.text, out.outcome, started, calls.length], [SAID, 'starting', 1, 0]);
  const running = setup({ polish: { provider: 'foundry', model: 'q' }, foundry: { url: () => 'http://127.0.0.1:55545/v1', start: async () => {} } });
  await running.polisher.polish({ text: SAID, mode: MODE });
  assert.equal(running.calls[0].cfg.baseUrl, 'http://127.0.0.1:55545/v1');
});

test('warm-up: a tiny request to a server on this PC when a polished dictation starts, at most every 4 minutes', async () => {
  const { polisher, calls, time } = setup();
  polisher.warm(MODE);
  polisher.warm(MODE);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.maxTokens, 1);
  time.advance(WARM_EVERY_MS);
  polisher.warm(MODE);
  assert.equal(calls.length, 2);
  polisher.warm({ ...MODE, aiPolish: 'off' });
  const cloud = setup({ polish: { provider: 'cloud', model: 'm' } });
  cloud.polisher.warm(MODE);
  assert.equal(cloud.calls.length + calls.length, 2, 'no warm-up in the cloud or for a mode without polish');
  assert.equal(WARM_EVERY_MS, 4 * 60 * 1000);
});

test('warm-up starts Foundry Local when it is not running', () => {
  let started = 0;
  const { polisher } = setup({ polish: { provider: 'foundry', model: 'q' }, foundry: { url: () => null, start: async () => { started++; } } });
  polisher.warm(MODE);
  assert.equal(started, 1);
});

test('onSend runs just before a request goes out (the pill says "Polishing…"), never for a skipped one', async () => {
  const { polisher } = setup();
  let sent = 0;
  await polisher.polish({ text: SAID, mode: MODE, onSend: () => sent++ });
  assert.equal(sent, 1);
  await polisher.polish({ text: 'too short', mode: MODE, onSend: () => sent++ });
  await polisher.polish({ text: SAID, mode: { ...MODE, aiPolish: 'off' }, onSend: () => sent++ });
  assert.equal(sent, 1);
});
