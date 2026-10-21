'use strict';
// AI polish, the run: the cleaned-up dictation goes to the chosen chat model (Settings → AI polish) with its mode's
// level and instructions (polish-prompts.js), and comes back polished - or as it was, so polish never makes a
// dictation slow or wrong:
//   - a hard deadline: 2.5 s for a server on this PC, 4 s for one that isn't; the request is aborted;
//   - an error, an empty or chatty answer ("Sure! Here is…") or one far longer than what was said: as it was;
//   - Foundry Local not running yet: it is started for the next dictation, this one is pasted as said.
// warm() loads a local model while the user is still speaking (Ollama unloads idle models after a few minutes).
// The chat client, keys, Foundry Local and the clock come in through `deps`, so it is unit tested with fakes.
// Logs carry the level, provider, outcome, lengths and time, never the words.

const { buildPolishMessages, skipReason } = require('./polish-prompts');
const { countWords } = require('./text-cleanup');

const LOCAL_TIMEOUT_MS = 2500;
const CLOUD_TIMEOUT_MS = 4000;
const WARM_EVERY_MS = 4 * 60 * 1000;
const WARM_TIMEOUT_MS = 60 * 1000; // a cold load of a bigger model takes a while; nobody waits for it
const PROVIDERS = ['off', 'ollama', 'lmstudio', 'foundry', 'cloud', 'custom'];
const DEFAULT_URLS = Object.freeze({ ollama: 'http://127.0.0.1:11434/v1', lmstudio: 'http://127.0.0.1:1234/v1' });

/**
 * settings.polish, every field present and valid (from the file or the window): a known provider, an http(s) URL,
 * a model name of sensible length. apiKeyEnc is the custom URL's own key, encrypted like the Cloud API key.
 */
function normalizePolish(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const url = typeof p.baseUrl === 'string' ? p.baseUrl.trim() : '';
  const model = typeof p.model === 'string' ? p.model.trim() : '';
  return {
    provider: typeof p.provider === 'string' && PROVIDERS.includes(p.provider) ? p.provider : 'off',
    baseUrl: url.length <= 500 && /^https?:\/\/[^\s]+$/i.test(url) ? url : '',
    model: model.length <= 200 ? model : '',
    apiKeyEnc: typeof p.apiKeyEnc === 'string' ? p.apiKeyEnc : '',
  };
}

/** localhost, 127.x.x.x or ::1: the text stays on this PC. */
function isLocalUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

const timeoutFor = (url) => (isLocalUrl(url) ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS);

const CHATTY = /^(sure|certainly|of course|absolutely|okay|ok|here(?:'s| is| are)|i(?:'m| am) sorry|as an ai|i can(?:not|'t)|(?:polished|corrected|revised)(?: text| version)?:)/i;

// budget.xlsx, src/main/llm.js, getUserName, max_tokens: words a model must not "correct". Not 10.30 or 3.5.
const IDENTIFIER = /(?:[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*(?:[./\\][\p{L}\p{N}_-]+)+)|\b\p{Ll}+\p{Lu}[\p{L}\p{N}]*\b|\b[\p{L}\p{N}]+_[\p{L}\p{N}_]+\b/gu;

// Pasted as keystrokes into whatever is in front: no escape sequences or other control characters (tab and new line are fine).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const CONTENT_WORD = /\p{L}{4,}/gu;
const lines = (s) => (s.match(/\n/g) || []).length;

/**
 * Is the model's answer a polished version of what was said? Refuses answers that aren't, so neither a confused
 * model nor words that try to instruct it (from a video playing nearby, say) can paste something else:
 *   chatty, control characters, much longer, (Light) much shorter, a file name or identifier changed, most of the
 *   words gone, or new lines anywhere but High (Prompt text may go into a terminal, where a new line runs it).
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
function acceptPolish(said, answer, level) {
  const input = String(said || '').trim();
  const text = String(answer || '').replace(/\r\n?/g, '\n').replace(/^\s*<transcript>\s*/i, '').replace(/\s*<\/transcript>\s*$/i, '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (CHATTY.test(text) && !CHATTY.test(input)) return { ok: false, reason: 'chatty' };
  if (CONTROL.test(text)) return { ok: false, reason: 'control' };
  if (text.length > input.length * 1.5 + 40) return { ok: false, reason: 'too-long' };
  if (lines(text) > lines(input) + (level === 'high' ? 12 : 0)) return { ok: false, reason: 'lines' };
  if (level === 'light' && countWords(text) < countWords(input) * 0.6) return { ok: false, reason: 'too-short' };
  if ((input.match(IDENTIFIER) || []).some((id) => !text.includes(id))) return { ok: false, reason: 'identifiers' };
  const words = [...new Set((input.toLowerCase().match(CONTENT_WORD) || []))];
  const lower = text.toLowerCase();
  const kept = words.filter((w) => lower.includes(w)).length;
  if (words.length && kept / words.length < (level === 'high' || level === 'prompt' ? 0.4 : 0.6)) return { ok: false, reason: 'different' };
  return { ok: true, text };
}

/**
 * @param {object} d
 * @param {{get: () => object}} d.settings  polish: {provider, baseUrl, model}; cloud.baseUrl for 'cloud'
 * @param {{cloud: () => string, polish: () => string}} d.keys  the Cloud API key, the custom URL's own key
 * @param {(cfg, messages, opts) => Promise<string>} d.chat  llm.js chatComplete
 * @param {{url: () => string|null, start: () => Promise<void>}} [d.foundry]  Foundry Local's web service
 * @param {{info: Function, warn: Function}} d.log
 * @param {() => number} [d.now]
 * @param {{setTimeout: Function, clearTimeout: Function}} [d.timers]
 */
function createPolisher(d) {
  const now = d.now || Date.now;
  const timers = d.timers || { setTimeout, clearTimeout };
  const warmed = new Map(); // provider|url|model -> when it last answered (or a warm-up was sent)

  /** Starts Foundry Local for the next dictation; whatever goes wrong is logged, never thrown. */
  function startFoundry() {
    try {
      Promise.resolve(d.foundry.start()).catch((err) => d.log.warn(`Foundry Local didn't start: ${err && err.name}`));
    } catch (err) {
      d.log.warn(`Foundry Local didn't start: ${err && err.name}`);
    }
  }

  /** Where the text goes, or why it can't go anywhere yet. "On this PC" choices only ever go to this PC. */
  function endpoint() {
    const s = d.settings.get();
    const p = s.polish || {};
    if (!p.model || !PROVIDERS.includes(p.provider)) return { error: 'not-set-up' };
    if (p.provider === 'cloud') return { baseUrl: s.cloud.baseUrl, apiKey: d.keys.cloud(), requireKey: true, model: p.model };
    if (p.provider === 'foundry') {
      if (!d.foundry) return { error: 'not-set-up' };
      const url = d.foundry.url();
      if (url) return isLocalUrl(url) ? { baseUrl: url, apiKey: '', requireKey: false, model: p.model } : { error: 'not-set-up' };
      startFoundry();
      return { error: 'starting' };
    }
    if (p.provider === 'custom') {
      if (!p.baseUrl) return { error: 'not-set-up' };
      // The own key goes over https, or to this PC; never in the clear to another machine.
      const safe = /^https:/i.test(p.baseUrl) || isLocalUrl(p.baseUrl);
      return { baseUrl: p.baseUrl, apiKey: safe ? d.keys.polish() : '', requireKey: false, model: p.model };
    }
    const baseUrl = p.baseUrl || DEFAULT_URLS[p.provider];
    if (!isLocalUrl(baseUrl)) return { error: 'not-set-up' }; // Ollama, LM Studio: this PC only
    return { baseUrl, apiKey: '', requireKey: false, model: p.model };
  }

  const keyOf = (s, target) => `${s.polish.provider}|${target.baseUrl}|${target.model}`;

  /**
   * Never throws: whatever goes wrong, the text comes back as it was.
   * @param {{text: string, mode: object, language?: string|null, command?: boolean, onSend?: () => void, signal?: AbortSignal}} o
   *   onSend: the request is about to go out (the pill shows "Polishing…"); signal: Esc, the dictation was cancelled
   * @returns {Promise<{text: string, polished: boolean, outcome: string, ms: number}>} text: what to paste
   */
  async function polish({ text, mode, language = null, command = false, onSend = () => {}, signal = null }) {
    const t0 = now();
    let level = 'off';
    let provider = 'off';
    const done = (outcome, out = text, polished = false) => {
      const ms = now() - t0;
      d.log.info(`Polish ${level || 'off'} via ${provider}: ${outcome} in ${ms}ms (${text.length} -> ${out.length} chars)`);
      return { text: out, polished, outcome, ms };
    };
    let timer = null;
    try {
      const s = d.settings.get();
      provider = (s.polish && s.polish.provider) || 'off';
      level = mode && mode.aiPolish;
      const skip = skipReason({ text, level, provider, command });
      if (skip) return { text, polished: false, outcome: `skipped:${skip}`, ms: 0 }; // not worth a log line each time
      if (signal && signal.aborted) return done('cancelled');
      const target = endpoint();
      if (target.error) return done(target.error);

      const [, lead, core, trail] = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
      const messages = buildPolishMessages({ level, text: core, instructions: mode.prompt, language });
      onSend();
      const controller = new AbortController();
      const stop = new Promise((resolve) => {
        timer = timers.setTimeout(() => { controller.abort(); resolve('timeout'); }, timeoutFor(target.baseUrl));
        signal?.addEventListener('abort', () => { controller.abort(); resolve('cancelled'); }, { once: true });
      });
      const answer = await Promise.race([
        d.chat({ baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model }, messages, {
          signal: controller.signal, requireKey: target.requireKey, temperature: 0.2, maxTokens: Math.ceil(core.length / 2) + 100,
          redirect: 'error', // a dictation is never re-sent somewhere else
        }).then((content) => ({ content })),
        stop,
      ]);
      if (typeof answer === 'string') return done(answer); // timeout, cancelled
      warmed.set(keyOf(s, target), now());
      const verdict = acceptPolish(core, answer.content, level);
      if (!verdict.ok) return done(`rejected:${verdict.reason}`);
      if (verdict.text === core) return done('unchanged');
      return done('polished', lead + verdict.text + trail, true);
    } catch (err) {
      // the message can hold the server's reply, which may quote the dictation: only its kind is logged
      return done(`error (${err && err.name})`.replace(' (Error)', ''));
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /** A dictation that will be polished started: load the local model now, at most every few minutes. Never throws. */
  function warm(mode) {
    let key = null;
    const failed = (err) => {
      if (key) warmed.delete(key); // try again with the next dictation
      d.log.warn(`Polish warm-up failed (${err && err.name})`);
    };
    try {
      const s = d.settings.get();
      const provider = (s.polish && s.polish.provider) || 'off';
      if (skipReason({ text: 'one two three four', level: mode && mode.aiPolish, provider })) return;
      const target = endpoint(); // starts Foundry Local when it isn't running
      if (target.error || !isLocalUrl(target.baseUrl)) return;
      key = keyOf(s, target);
      if (now() - (warmed.get(key) ?? -Infinity) < WARM_EVERY_MS) return;
      warmed.set(key, now());
      Promise.resolve(d.chat({ baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model }, [{ role: 'user', content: 'Hi' }], {
        signal: AbortSignal.timeout(WARM_TIMEOUT_MS), requireKey: false, temperature: 0, maxTokens: 1, redirect: 'error',
      })).catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  return { polish, warm, endpoint };
}

module.exports = {
  createPolisher, acceptPolish, normalizePolish, isLocalUrl, timeoutFor, PROVIDERS, DEFAULT_URLS, LOCAL_TIMEOUT_MS, CLOUD_TIMEOUT_MS, WARM_EVERY_MS,
};
