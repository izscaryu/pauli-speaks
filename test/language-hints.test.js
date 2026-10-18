'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextLanguageHint, createLanguageHints } = require('../src/main/language-hints');
const { needsCloudRetry } = require('../src/main/asr/cloud');
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

test('languages named like object properties are plain counters', () => {
  const { hints } = feed(fresh(), ['__proto__', '__proto__', '__proto__', 'constructor']);
  assert.deepEqual(hints, [null, null, '__proto__', null]);
});

// ---------------------------------------------------------------- cloud retry

test('needsCloudRetry: only with several chosen languages and a returned one outside them', () => {
  assert.equal(needsCloudRetry(['en', 'hr'], 'de'), true);
  assert.equal(needsCloudRetry(['en', 'hr'], 'hr'), false);
  assert.equal(needsCloudRetry(['en', 'hr'], 'en'), false);
  assert.equal(needsCloudRetry(['en'], 'de'), false, 'one language is sent as the request language already');
  assert.equal(needsCloudRetry([], 'de'), false, 'auto-detect accepts anything');
  assert.equal(needsCloudRetry(['en', 'hr'], null), false, 'nothing returned: nothing to compare');
  assert.equal(needsCloudRetry(['en', 'hr'], ''), false);
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
    return { ok: true, json: async () => reply };
  };
  try {
    return { result: await fn(), sent };
  } finally {
    globalThis.fetch = real;
  }
}
const cloud = (languages) => ({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', languages });
const audio = new Float32Array(1600);

test('cloud, several languages, answer outside them: one more request with the first language', async () => {
  const { result, sent } = await withProvider(
    [{ text: 'guten Tag', language: 'german' }, { text: 'good day', language: 'english' }],
    () => transcribeCloud(audio, cloud(['en', 'hr'])),
  );
  assert.deepEqual(sent, [null, 'en']);
  assert.equal(result.text, 'good day');
  assert.equal(result.language, 'en');
  assert.equal(result.likelyLanguage, 'de', 'what the provider heard first, for the hint');
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
