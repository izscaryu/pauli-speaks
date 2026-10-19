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

// Phrases per language, added to the matching commands when the user picks languages in the welcome flow.
// Serbian in Latin script, as Whisper usually writes it. Short and unusual enough not to turn up in normal text.
const PACK_COMMANDS = {
  newline: { action: 'insert', arg: '\n' },
  paragraph: { action: 'insert', arg: '\n\n' },
  enter: { action: 'key', arg: 'Enter' },
  undo: { action: 'undo', arg: '' },
};
const VOICE_PACKS = Object.freeze({
  en: { newline: ['new line'], paragraph: ['new paragraph'], enter: ['press enter', 'send it'], undo: ['scratch that'] },
  hr: { newline: ['novi red'], paragraph: ['novi odlomak'], enter: ['pošalji'], undo: ['obriši to'] },
  de: { newline: ['neue Zeile'], paragraph: ['neuer Absatz'], enter: ['abschicken'], undo: ['lösch das'] },
  es: { newline: ['nueva línea'], paragraph: ['nuevo párrafo'], enter: ['envíalo'], undo: ['borra eso'] },
  it: { newline: ['nuova riga'], paragraph: ['nuovo paragrafo'], enter: ['invialo'], undo: ['cancella questo'] },
  pl: { newline: ['nowa linia'], paragraph: ['nowy akapit'], enter: ['wyślij'], undo: ['usuń to'] },
  sl: { newline: ['nova vrstica'], paragraph: ['nov odstavek'], enter: ['pošlji'], undo: ['izbriši to'] },
  sr: { newline: ['novi red'], paragraph: ['novi pasus'], enter: ['pošalji'], undo: ['obriši to'] },
});

/**
 * The commands with the packs of `languages` added: each phrase goes to the command that does the same
 * (a missing command is added), never twice, never past the phrase limit; nothing is removed (pure).
 */
function addPacks(commands, languages) {
  const out = normalizeVoiceCommands(commands).map((c) => ({ ...c, phrases: [...c.phrases] }));
  const known = new Set(out.flatMap((c) => c.phrases.map((p) => p.toLowerCase())));
  for (const lang of Array.isArray(languages) ? languages : []) {
    if (typeof lang !== 'string' || !Object.hasOwn(VOICE_PACKS, lang)) continue;
    for (const [what, phrases] of Object.entries(VOICE_PACKS[lang])) {
      const { action, arg } = PACK_COMMANDS[what];
      let command = out.find((c) => c.action === action && c.arg === arg);
      for (const phrase of phrases) {
        if (known.has(phrase.toLowerCase())) continue;
        if (!command) {
          command = { phrases: [], action, arg };
          out.push(command);
        }
        if (command.phrases.length >= MAX_PHRASES) break;
        command.phrases.push(phrase);
        known.add(phrase.toLowerCase());
      }
    }
  }
  return out;
}

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
  DEFAULT_VOICE_COMMANDS, VOICE_ACTIONS, COMMAND_KEYS, VOICE_PACKS, addPacks,
  normalizeVoiceCommands, activeCommands, applyInsertCommands, extractEdgeCommands, phrasePattern,
};
