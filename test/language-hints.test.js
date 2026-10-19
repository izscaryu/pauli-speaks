'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextLanguageHint, createLanguageHints } = require('../src/main/language-hints');
const { cloudRetryLanguages, confidence } = require('../src/main/asr/cloud');
const { pickLanguage } = require('../src/main/asr/whisper-local');

const fresh = () => ({ streak: {}, shown: [] });
const CHOSEN = ['en', 'hr'];

/** Feed a run of detections; returns the final state and every hint on the way. */
function feed(state, likelies, chosen = CHOSEN) {
  const hints = [];
  for (const likely of likelies) {
    const r = nextLanguageHint(state, { chosen, likely });
    state = r.state;
    hints.push(r.hint);
  }
  return { state, hints };
}

test('a hint comes after three out-of-list detections in a row', () => {
  const { hints } = feed(fresh(), ['de', 'de', 'de']);
  assert.deepEqual(hints, [null, null, 'de']);
});

test('an in-list detection resets the streak', () => {
  const { hints, state } = feed(fresh(), ['de', 'de', 'en', 'de', 'de']);
  assert.deepEqual(hints, [null, null, null, null, null]);
  assert.deepEqual(state.streak, { de: 2 });
});

test('a different out-of-list language starts its own streak', () => {
  const { hints } = feed(fresh(), ['de', 'de', 'fr', 'de', 'de']);
  assert.deepEqual(hints, [null, null, null, null, null]);
});

test('each language is hinted once, ever', () => {
  const { hints, state } = feed(fresh(), ['de', 'de', 'de', 'de', 'de', 'de', 'de']);
  assert.deepEqual(hints, [null, null, 'de', null, null, null, null]);
  assert.deepEqual(state.shown, ['de']);
  assert.deepEqual(feed(state, ['fr', 'fr', 'fr']).hints, [null, null, 'fr']);
});

test('a language already shown (saved earlier) is never hinted again', () => {
  const { hints } = feed({ streak: {}, shown: ['de'] }, ['de', 'de', 'de', 'de']);
  assert.deepEqual(hints, [null, null, null, null]);
});

test('no hint when no language is chosen (auto-detect) or nothing was detected', () => {
  assert.deepEqual(feed(fresh(), ['de', 'de', 'de', 'de'], []).hints, [null, null, null, null]);
  assert.deepEqual(feed(fresh(), [null, undefined, '', null]).hints, [null, null, null, null]);
});

test('an unknown detection does not break a running streak', () => {
  const { hints } = feed(fresh(), ['de', null, 'de', 'de']);
  assert.deepEqual(hints, [null, null, null, 'de']);
});

test('the given state is not changed', () => {
  const shown = ['hr'];
  const state = { streak: { de: 2 }, shown };
  const { state: next, hint } = nextLanguageHint(state, { chosen: ['en'], likely: 'de' });
  assert.equal(hint, 'de');
  assert.deepEqual(state, { streak: { de: 2 }, shown: ['hr'] });
  assert.notEqual(next.shown, shown);
  assert.deepEqual(next.shown, ['hr', 'de']);
});

test('B2: a close relative of a chosen language counts as yours: no streak, no hint', () => {
  assert.deepEqual(feed(fresh(), ['sr', 'sr', 'sr', 'bs', 'bs', 'bs'], ['hr', 'en']).hints, [null, null, null, null, null, null]);
  const { hints, state } = feed(fresh(), ['de', 'de', 'sr', 'de'], ['hr', 'en']);
  assert.deepEqual(hints, [null, null, null, null], 'a relative resets the streak like one of yours');
  assert.deepEqual(state.streak, { de: 1 });
  assert.deepEqual(feed(fresh(), ['de', 'de', 'de'], ['hr', 'en']).hints, [null, null, 'de']);
});

test('languages named like object properties are plain counters', () => {
  const { hints } = feed(fresh(), ['__proto__', '__proto__', '__proto__', 'constructor']);
  assert.deepEqual(hints, [null, null, '__proto__', null]);
});

// ---------------------------------------------------------------- cloud retry

test('cloudRetryLanguages: with several chosen languages, every one of them when the answer is outside them', () => {
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], 'pl'), ['en', 'hr'], 'unrelated: each chosen language is tried');
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], 'bs'), ['en', 'hr'], 'a close relative too');
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], 'hr'), []);
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], 'en'), []);
  assert.deepEqual(cloudRetryLanguages(['hr'], 'bs'), [], 'one language is sent as the request language already');
  assert.deepEqual(cloudRetryLanguages([], 'bs'), [], 'auto-detect accepts anything');
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], null), [], 'nothing returned: nothing to compare');
  assert.deepEqual(cloudRetryLanguages(['en', 'hr'], ''), []);
});

test('confidence: the average log-probability of the segments, weighted by their length; null when there is none', () => {
  assert.ok(Math.abs(confidence({ segments: [{ start: 0, end: 1, avg_logprob: -0.2 }, { start: 1, end: 4, avg_logprob: -0.6 }] }) - -0.5) < 1e-9);
  assert.equal(confidence({ segments: [{ start: 0, end: 0, avg_logprob: -0.4 }] }), -0.4, 'zero-length segments count equally');
  assert.equal(confidence({ segments: [] }), null);
  assert.equal(confidence({ text: 'x' }), null);
  assert.equal(confidence({ segments: [{ start: 0, end: 1 }] }), null);
});

// ---------------------------------------------------------------- local detection

test('pickLanguage reports the best language inside the list and the best overall from one set of scores', () => {
  const langToId = { '<|en|>': 1, '<|hr|>': 2, '<|de|>': 3 };
  const scores = Float32Array.from([0, 1, 2, 5]);
  assert.deepEqual(pickLanguage(scores, 0, langToId, ['en', 'hr']), { language: 'hr', likely: 'de' });
  assert.deepEqual(pickLanguage(scores, 0, langToId, []), { language: 'de', likely: 'de' });
  assert.deepEqual(pickLanguage(scores, 0, langToId, ['de', 'hr']), { language: 'de', likely: 'de' });
});

test('pickLanguage reads the scores from the given offset', () => {
  const langToId = { '<|en|>': 1, '<|de|>': 2 };
  assert.deepEqual(pickLanguage(Float32Array.from([9, 9, 9, 1, 2]), 2, langToId, ['en']), { language: 'en', likely: 'de' });
});

test('pickLanguage falls back to English when no candidate is a Whisper language', () => {
  const langToId = { '<|en|>': 1, '<|de|>': 2 };
  assert.deepEqual(pickLanguage(Float32Array.from([0, 1, 2]), 0, langToId, ['xx']), { language: 'en', likely: 'de' });
});

// ---------------------------------------------------------------- the service

function service({ languages = CHOSEN, shown = [] } = {}) {
  const calls = { updates: [], broadcasts: [] };
  const handlers = {};
  const data = { languages, languageHints: { shown } };
  const hints = createLanguageHints({
    getSettings: () => data,
    updateSettings: (patch) => { calls.updates.push(patch); Object.assign(data, patch); },
    broadcast: (channel, payload) => calls.broadcasts.push([channel, payload]),
  });
  hints.registerIpc({ handle: (ch, fn) => { handlers[ch] = fn; } });
  const hear = (...codes) => codes.forEach((likely) => hints.feed({ chosen: data.languages, likely }));
  return { hints, handlers, calls, data, hear };
}

test('three detections make the hint pending and tell the window', () => {
  const s = service();
  s.hear('de', 'de');
  assert.equal(s.handlers['language-hint:state'](), null);
  s.hear('de');
  assert.equal(s.handlers['language-hint:state'](), 'de');
  assert.deepEqual(s.calls.broadcasts, [['language-hint:changed', 'de']]);
  assert.deepEqual(s.calls.updates, [], 'nothing is saved until the user answers');
});

test('while a hint waits for an answer, no second hint comes', () => {
  const s = service();
  s.hear('de', 'de', 'de', 'fr', 'fr', 'fr');
  assert.equal(s.handlers['language-hint:state'](), 'de');
  assert.equal(s.calls.broadcasts.length, 1);
});

test('Add puts the language in the list, marks it shown and clears the hint', () => {
  const s = service({ shown: ['fr'] });
  s.hear('de', 'de', 'de');
  s.handlers['language-hint:add'](null, 'de');
  assert.deepEqual(s.calls.updates, [{ languages: ['en', 'hr', 'de'], languageHints: { shown: ['fr', 'de'] } }]);
  assert.equal(s.handlers['language-hint:state'](), null);
  assert.deepEqual(s.calls.broadcasts.at(-1), ['language-hint:changed', null]);
});

test('Add and No thanks save new arrays, never the ones from the settings', () => {
  const shown = [];
  const languages = ['en', 'hr'];
  const s = service({ languages, shown });
  s.hear('de', 'de', 'de');
  s.handlers['language-hint:add'](null, 'de');
  assert.deepEqual(shown, []);
  assert.deepEqual(languages, ['en', 'hr']);
  assert.notEqual(s.calls.updates[0].languageHints.shown, shown);
  assert.notEqual(s.calls.updates[0].languages, languages);
});

test('No thanks marks it shown without touching the languages', () => {
  const s = service();
  s.hear('de', 'de', 'de');
  s.handlers['language-hint:dismiss'](null, 'de');
  assert.deepEqual(s.calls.updates, [{ languageHints: { shown: ['de'] } }]);
  assert.equal(s.handlers['language-hint:state'](), null);
  s.hear('de', 'de', 'de', 'de');
  assert.equal(s.handlers['language-hint:state'](), null, 'once per language');
});

test('an answer for a language that is not the pending hint is ignored', () => {
  const s = service();
  s.hear('de', 'de', 'de');
  s.handlers['language-hint:add'](null, 'fr');
  s.handlers['language-hint:add'](null, { toString: () => 'de' });
  s.handlers['language-hint:dismiss'](null, undefined);
  assert.deepEqual(s.calls.updates, []);
  assert.equal(s.handlers['language-hint:state'](), 'de');
});

test('Add does not repeat a language that is in the list already', () => {
  const s = service();
  s.hear('de', 'de', 'de');
  s.data.languages = ['en', 'hr', 'de'];
  s.handlers['language-hint:add'](null, 'de');
  assert.deepEqual(s.calls.updates[0].languages, ['en', 'hr', 'de']);
});

test('forget drops the streak and the pending hint (after Delete all my data)', () => {
  const s = service();
  s.hear('de', 'de', 'de');
  s.data.languageHints = { shown: [] };
  s.hints.forget();
  assert.equal(s.handlers['language-hint:state'](), null);
  s.hear('de', 'de');
  assert.equal(s.handlers['language-hint:state'](), null, 'the streak started over');
});

test('a failure while feeding never reaches the dictation', () => {
  const hints = createLanguageHints({ getSettings: () => { throw new Error('boom'); }, updateSettings() {}, broadcast() {} });
  assert.doesNotThrow(() => hints.feed({ chosen: CHOSEN, likely: 'de' }));
});

// ---------------------------------------------------------------- transcribeCloud with a fake provider

const { transcribeCloud } = require('../src/main/asr/cloud');

/** Runs `fn` with fetch replaced; every answer in `replies` is one verbose_json response. */
async function withProvider(replies, fn) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(init.body.get('language'));
    const reply = replies.shift();
    if (reply instanceof Error) return { ok: false, status: 429, text: async () => 'rate limited' };
    return { ok: true, json: async () => reply };
  };
  try {
    return { result: await fn(), sent };
  } finally {
    globalThis.fetch = real;
  }
}
const logged = [];
const cloud = (languages, more = {}) => ({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', languages, log: { warn: (m) => logged.push(m) }, ...more });
const audio = new Float32Array(1600);

/** A verbose_json answer with one segment Whisper is `logprob` sure of. */
const said = (text, language, logprob) => ({ text, language, segments: [{ start: 0, end: 1, text, avg_logprob: logprob }] });

test('cloud, several languages, answer outside them (Croatian heard as Polish): again in each chosen language, the surest one is kept', async () => {
  logged.length = 0;
  const infos = [];
  const { result, sent } = await withProvider(
    [said('Manoch reakcji', 'polish', -0.7), said('Many reactions', 'english', -1.3), said('Mnogo reakcija', 'croatian', -0.25)],
    () => transcribeCloud(audio, cloud(['en', 'hr'], { log: { warn: (m) => logged.push(m), info: (m) => infos.push(m) } })),
  );
  assert.deepEqual(sent, [null, 'en', 'hr']);
  assert.equal(result.text, 'Mnogo reakcija');
  assert.equal(result.language, 'hr');
  assert.equal(result.likelyLanguage, 'pl', 'what the provider heard first, for the hint');
  assert.deepEqual(result.chunks.map((c) => c.text), ['Mnogo reakcija']);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /pl.*hr/);
  assert.doesNotMatch(infos[0], /reakcij|Many/, 'no dictated text in the log');
});

test('cloud, answer in a close relative (Bosnian): the same comparison, the surer chosen language wins', async () => {
  const { result, sent } = await withProvider(
    [said('dobar dan (bs)', 'bosnian', -0.3), said('the bar done', 'english', -1.5), said('dobar dan', 'croatian', -0.2)],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.deepEqual(sent, [null, 'en', 'hr']);
  assert.equal(result.text, 'dobar dan');
  assert.equal(result.language, 'hr');
  assert.equal(result.likelyLanguage, 'bs');
});

test('cloud, the speaker really used one of the other chosen languages: English wins when Whisper is surer of it', async () => {
  const { result } = await withProvider(
    [said('Hello there', 'welsh', -0.9), said('Hello there', 'english', -0.1), said('Helo der', 'croatian', -1.4)],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.equal(result.text, 'Hello there');
  assert.equal(result.language, 'en');
});

test('cloud, equally sure: the language listed first wins', async () => {
  const { result } = await withProvider(
    [said('x', 'polish', -0.5), said('in en', 'english', -0.4), said('in hr', 'croatian', -0.4)],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.equal(result.language, 'en');
});

test('cloud, the provider gives no confidence: a close relative goes to its chosen language, otherwise the first result stands', async () => {
  const close = await withProvider(
    [{ text: 'dobar dan (bs)', language: 'bosnian' }, { text: 'the bar done', language: 'english' }, { text: 'dobar dan', language: 'croatian' }],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.equal(close.result.text, 'dobar dan');
  assert.equal(close.result.language, 'hr');

  const unrelated = await withProvider(
    [{ text: 'guten Tag', language: 'german' }, { text: 'good day', language: 'english' }, { text: 'dobar dan', language: 'croatian' }],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.equal(unrelated.result.text, 'guten Tag');
  assert.equal(unrelated.result.language, 'de');
});

test('cloud, several languages, answer inside them: a single request', async () => {
  const { result, sent } = await withProvider([{ text: 'dobar dan', language: 'croatian' }], () => transcribeCloud(audio, cloud(['en', 'hr'])));
  assert.deepEqual(sent, [null]);
  assert.equal(result.language, 'hr');
  assert.equal(result.likelyLanguage, 'hr');
});

test('cloud, one or no language: never a second request', async () => {
  const one = await withProvider([{ text: 'x', language: 'german' }], () => transcribeCloud(audio, cloud(['en'])));
  assert.deepEqual(one.sent, ['en']);
  assert.equal(one.result.likelyLanguage, null);
  const none = await withProvider([{ text: 'x', language: 'german' }], () => transcribeCloud(audio, cloud([])));
  assert.deepEqual(none.sent, [null]);
  assert.equal(none.result.language, 'de');
});

test('cloud, file transcription (retryOutsideList false): one request even when the language is outside the list', async () => {
  const { result, sent } = await withProvider(
    [{ text: 'guten Tag', language: 'german' }],
    () => transcribeCloud(audio, cloud(['en', 'hr'], { retryOutsideList: false })),
  );
  assert.deepEqual(sent, [null]);
  assert.equal(result.text, 'guten Tag');
  assert.equal(result.language, 'de');
});

test('cloud, one retry fails: the other answers still compete', async () => {
  logged.length = 0;
  const { result, sent } = await withProvider(
    [said('x', 'polish', -0.7), new Error('HTTP 429'), said('dobar dan', 'croatian', -0.3)],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.deepEqual(sent, [null, 'en', 'hr']);
  assert.equal(result.text, 'dobar dan');
  assert.equal(result.language, 'hr');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /429/);
});

test('cloud, every retry fails: the first result is kept with its own language and the failure is logged without text', async () => {
  logged.length = 0;
  const { result, sent } = await withProvider(
    [said('dobar dan', 'serbian', -0.3), new Error('HTTP 429'), new Error('HTTP 429')],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.deepEqual(sent, [null, 'en', 'hr']);
  assert.equal(result.text, 'dobar dan');
  assert.equal(result.language, 'sr');
  assert.equal(result.likelyLanguage, 'sr');
  assert.ok(logged.length >= 1);
  assert.match(logged.join(' '), /429/);
  assert.doesNotMatch(logged.join(' '), /dobar/);
});

test('cloud, a retry answers outside the list again: it still counts as the language it was asked for, and no more requests follow', async () => {
  const { result, sent } = await withProvider(
    [said('dobar dan', 'bosnian', -0.5), said('good day', 'english', -1.2), said('dobar dan', 'serbian', -0.2), said('never asked', 'english', 0)],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.deepEqual(sent, [null, 'en', 'hr']);
  assert.equal(result.text, 'dobar dan');
  assert.equal(result.language, 'hr');
});
