'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { cleanTranscript, applySnippets, applyStyle, toSrt } = require('../src/main/text-cleanup');
const { splitAtPauses } = require('../src/main/audio-utils');
const { dailyStats } = require('../src/main/history');
const { resolveStyle, DEFAULT_APP_RULES } = require('../src/main/app-styles');
const { buildCommandMessages, cleanCompletion, chatComplete } = require('../src/main/llm');
const { buildPrompt } = require('../src/main/asr/whisper-local');
const { DictationController } = require('../src/main/dictation-controller');
const { DEFAULTS } = require('../src/main/settings');
const { validateShortcut } = require('../src/main/shortcut-rules');

// ---------------------------------------------------------------- snippets

const snippets = [
  { trigger: 'my email', text: 'patrik@example.com' },
  { trigger: 'sign off', text: 'Best regards,\nPatrik' },
];

test('a dictation that is only the trigger becomes exactly the snippet', () => {
  assert.equal(cleanTranscript('My email.', { capitalize: true, addTrailingSpace: true, snippets }), 'patrik@example.com');
  assert.equal(cleanTranscript('Sign-off!', { snippets }), 'Best regards,\nPatrik');
});

test('triggers inside a sentence are replaced in place', () => {
  assert.equal(
    cleanTranscript('Please write to my email today.', { capitalize: true, snippets }),
    'Please write to patrik@example.com today.',
  );
  assert.equal(applySnippets('emails about my emailing', snippets).text, 'emails about my emailing');
});

// ---------------------------------------------------------------- app styles

test('styles change the end of the text', () => {
  assert.equal(applyStyle('See you soon.', 'casual'), 'See you soon');
  assert.equal(applyStyle('Wait...', 'casual'), 'Wait...');
  assert.equal(applyStyle('Is it?', 'code'), 'Is it?');
  assert.equal(applyStyle('Dear team', 'formal'), 'Dear team.');
  assert.equal(applyStyle('Done.', 'formal'), 'Done.');
});

test('code style skips capitalisation and the final full stop', () => {
  assert.equal(cleanTranscript('git commit amend.', { capitalize: true, style: 'code' }), 'git commit amend');
  assert.equal(cleanTranscript('see you soon.', { capitalize: true, style: 'casual', addTrailingSpace: true }), 'See you soon ');
});

test('focused app resolves to a style', () => {
  const appStyles = { enabled: true, rules: DEFAULT_APP_RULES };
  assert.equal(resolveStyle('Code.exe', appStyles), 'code');
  assert.equal(resolveStyle('Slack.exe', appStyles), 'casual');
  assert.equal(resolveStyle('WINWORD.EXE', appStyles), 'formal');
  assert.equal(resolveStyle('chrome.exe', appStyles), 'normal');
  assert.equal(resolveStyle('Code.exe', { ...appStyles, enabled: false }), 'normal');
  assert.equal(resolveStyle(null, appStyles), 'normal');
});

// ---------------------------------------------------------------- vocabulary prompt

test('dictionary becomes a Whisper prompt', () => {
  assert.equal(buildPrompt([{ from: 'polyspeaks', to: 'Pauli Speaks' }, { from: 'x', to: 'Zagreb' }, { from: 'y', to: 'Zagreb' }]), 'Pauli Speaks, Zagreb.');
  assert.equal(buildPrompt([]), '');
});

// ---------------------------------------------------------------- files

test('SRT output', () => {
  const srt = toSrt([{ start: 0, end: 2.5, text: 'Hello.' }, { start: 3725.04, end: 3727, text: 'Bye.' }, { start: 9, end: 9, text: ' ' }]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,500\nHello.\n\n2\n01:02:05,040 --> 01:02:07,000\nBye.\n');
});

test('long audio is split at the quietest point near each window end', () => {
  const sr = 1000;
  const audio = new Float32Array(sr * 25).fill(0.5);
  audio.fill(0, sr * 8, sr * 8 + 100); // a pause at 8.0-8.1 s
  const pieces = splitAtPauses(audio, { sampleRate: sr, windowSec: 10, searchSec: 3 });
  assert.ok(pieces.length >= 3);
  assert.ok(Math.abs(pieces[1].start - 8.05) < 0.06, `cut at ${pieces[1].start}`);
  assert.equal(pieces.reduce((n, p) => n + p.samples.length, 0), audio.length);
});

// ---------------------------------------------------------------- stats

test('daily words and streak', () => {
  const now = new Date(2026, 9, 14, 15, 0);
  const at = (daysAgo, words) => ({ createdAt: new Date(2026, 9, 14 - daysAgo, 10).toISOString(), words });
  const s = dailyStats([at(0, 10), at(0, 5), at(1, 7), at(2, 1), at(4, 3)], 7, now);
  assert.equal(s.daily.length, 7);
  assert.deepEqual(s.daily.at(-1), { date: '2026-10-14', words: 15 });
  assert.equal(s.streak, 3);
  assert.equal(dailyStats([at(1, 2), at(2, 2)], 7, now).streak, 2, 'yesterday still counts');
  assert.equal(dailyStats([at(3, 2)], 7, now).streak, 0);
});

// ---------------------------------------------------------------- command mode

test('command prompts', () => {
  const edit = buildCommandMessages('make it formal', 'hey whats up');
  assert.equal(edit[0].role, 'system');
  assert.match(edit[1].content, /Instruction: make it formal[\s\S]*hey whats up/);
  const write = buildCommandMessages('write a short thank-you note', '');
  assert.equal(write[1].content, 'write a short thank-you note');
  assert.equal(cleanCompletion('```\nHELLO\n```'), 'HELLO');
  assert.equal(cleanCompletion('"Hello there"'), 'Hello there');
});

test('chatComplete talks to an OpenAI-compatible endpoint', async () => {
  let seen = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '```\nHELLO\n```' } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const out = await chatComplete({ baseUrl: `http://127.0.0.1:${port}/v1/`, apiKey: 'test-key', model: 'm' }, buildCommandMessages('caps', 'hello'));
    assert.equal(out, 'HELLO');
    assert.equal(seen.url, '/v1/chat/completions');
    assert.equal(seen.auth, 'Bearer test-key');
    assert.equal(seen.body.model, 'm');
  } finally {
    server.closeAllConnections();
    server.close();
  }
  await assert.rejects(chatComplete({ baseUrl: 'http://127.0.0.1:1', apiKey: '', model: 'm' }, []), /API key/);
});

test('command shortcut starts or upgrades a session', () => {
  const calls = [];
  const c = new DictationController({ start: () => calls.push('start'), finish: async () => {}, dismiss: () => {} });
  c.pttDown();
  c.commandDown();
  assert.equal(c.command, true);
  assert.equal(c.translate, false);
  assert.deepEqual(calls, ['start']);
  c.dismiss('test');
  c.commandDown();
  assert.equal(c.command, true);
  c.dismiss('test');
  c.pttDown();
  assert.equal(c.command, false);
  c.dismiss('test'); // clears the 20-minute max-duration timer
});

test('new default shortcuts are valid and unique', () => {
  for (const action of ['command', 'readAloud']) {
    const b = DEFAULTS.bindings.find((x) => x.action === action);
    assert.equal(validateShortcut(b.keys, action, DEFAULTS.bindings, { ignoreId: b.id }), null, action);
  }
});
