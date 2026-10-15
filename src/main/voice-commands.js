'use strict';
// User-editable voice commands, said while dictating (Dragon's "new line",
// "press enter", "scratch that"; Windows Voice Access's "delete that").
//   insert  - type `arg` in place of the phrase ("new line" -> \n), anywhere in the text
//   snippet - type the snippet whose trigger is `arg`, anywhere in the text
//   key     - press the key `arg` (Enter, Tab...); only at the start or end of an utterance
//   undo    - remove text; only at the start or end of an utterance
// Actions only count at the edges so "I'll send it tomorrow" stays as text.
// Pure (no Electron) so it can be unit tested.

const VOICE_ACTIONS = ['insert', 'key', 'undo', 'snippet'];
const COMMAND_KEYS = ['Enter', 'Tab', 'Escape', 'Backspace'];
const MAX_PHRASES = 12;
const MAX_PHRASE_CHARS = 60;
const MAX_ARG_CHARS = 2000;

const DEFAULT_VOICE_COMMANDS = Object.freeze([
  { phrases: ['new line', 'novi red'], action: 'insert', arg: '\n' },
  { phrases: ['new paragraph', 'novi odlomak'], action: 'insert', arg: '\n\n' },
  { phrases: ['press enter', 'send it', 'pošalji'], action: 'key', arg: 'Enter' },
  { phrases: ['scratch that', 'obriši to'], action: 'undo', arg: '' },
]);

/** Repair a command list from disk or from the window. */
function normalizeVoiceCommands(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || !VOICE_ACTIONS.includes(raw.action) || !Array.isArray(raw.phrases)) continue;
    const phrases = [...new Set(raw.phrases
      .filter((p) => typeof p === 'string')
      .map((p) => p.normalize('NFC').replace(/\s+/g, ' ').trim())
      .filter((p) => p && p.length <= MAX_PHRASE_CHARS))].slice(0, MAX_PHRASES);
    if (!phrases.length) continue;
    let arg = typeof raw.arg === 'string' ? raw.arg : '';
    if (arg.length > MAX_ARG_CHARS) continue;
    if (raw.action === 'key' && !COMMAND_KEYS.includes(arg)) continue;
    if ((raw.action === 'insert' || raw.action === 'snippet') && !arg) continue;
    if (raw.action === 'undo') arg = '';
    out.push({ phrases, action: raw.action, arg });
  }
  return out;
}

/**
 * The commands in force for these cleanup options. `voiceCommands: true`
 * (the version 1 switch) still means the defaults; false/absent means none.
 */
function activeCommands(opts = {}) {
  if (opts.voiceCommandsEnabled === false) return [];
  if (Array.isArray(opts.voiceCommands)) return opts.voiceCommands;
  return opts.voiceCommands === true ? DEFAULT_VOICE_COMMANDS : [];
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_WORD = '(?![\\p{L}\\p{N}])';
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}])';

/** Regex source for a phrase: any case, missing diacritics ("posalji"), "new line" = "newline" = "new-line". */
function phrasePattern(phrase) {
  return phrase.normalize('NFC').trim().split(/\s+/).map((word) =>
    [...word].map((ch) => {
      if (ch === 'đ' || ch === 'Đ') return '(?:đ|dj)';
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
      return base && base !== ch ? `(?:${escapeRegExp(ch)}|${escapeRegExp(base)})` : escapeRegExp(ch);
    }).join(''),
  ).join('[\\s-]*');
}

/** [command, phrase] pairs, longest phrase first so "send it" wins over "send". */
function byPhrase(commands) {
  return commands
    .flatMap((c) => c.phrases.map((p) => [c, p]))
    .sort((a, b) => b[1].length - a[1].length);
}

/**
 * Inline commands, anywhere in the text: `insert` and `snippet` are typed
 * in place of their phrase (eating the comma before and the punctuation after).
 */
function applyInsertCommands(text, commands, snippets = []) {
  let out = text;
  for (const [c, phrase] of byPhrase(commands.filter((x) => x.action === 'insert' || x.action === 'snippet'))) {
    const arg = c.action === 'snippet'
      ? (snippets.find((s) => s.trigger && s.trigger.trim().toLowerCase() === c.arg.trim().toLowerCase()) || {}).text
      : c.arg;
    if (!arg) continue;
    const re = new RegExp(`,?[ \\t]*${NOT_AFTER_WORD}${phrasePattern(phrase)}${NOT_WORD}[,.!]?[ \\t]*`, 'giu');
    out = out.replace(re, (_m, offset) => `${/^\s/.test(arg) || offset === 0 ? '' : ' '}${arg}${/\s$/.test(arg) ? '' : ' '}`);
  }
  return out;
}

const LEAD = '^[\\s,.!?;:"\'¡¿-]*';
const TAIL = '[\\s,.!?;:"\'-]*$';

/**
 * Action commands (`key`, `undo`) said at the very start or end of an utterance.
 * @returns {{text: string, before: object[], after: object[]}} before/after in spoken order
 */
function extractEdgeCommands(text, commands) {
  const pairs = byPhrase(commands.filter((c) => c.action === 'key' || c.action === 'undo'));
  const before = [];
  const after = [];
  let rest = text;
  for (let i = 0; i < 3 && rest.trim(); i++) {
    const hit = pairs.find(([, p]) => new RegExp(`${LEAD}${phrasePattern(p)}${NOT_WORD}`, 'iu').test(rest));
    if (!hit) break;
    const m = rest.match(new RegExp(`${LEAD}${phrasePattern(hit[1])}${NOT_WORD}[\\s,.!?;:"'-]*`, 'iu'));
    before.push(hit[0]);
    rest = rest.slice(m[0].length);
  }
  for (let i = 0; i < 3 && rest.trim(); i++) {
    let m = null;
    const hit = pairs.find(([, p]) => (m = rest.match(new RegExp(`${NOT_AFTER_WORD}${phrasePattern(p)}${TAIL}`, 'iu'))));
    if (!hit) break;
    after.unshift(hit[0]);
    rest = rest.slice(0, m.index).replace(/[\s,;:-]+$/u, '');
  }
  return { text: rest, before, after };
}

module.exports = {
  DEFAULT_VOICE_COMMANDS, VOICE_ACTIONS, COMMAND_KEYS,
  normalizeVoiceCommands, activeCommands, applyInsertCommands, extractEdgeCommands, phrasePattern,
};
