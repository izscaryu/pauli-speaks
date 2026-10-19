'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUtterance, cleanTranscript } = require('../src/main/text-cleanup');
const { DEFAULT_VOICE_COMMANDS, VOICE_PACKS, normalizeVoiceCommands, addPacks } = require('../src/main/voice-commands');

const opts = { removeFillers: true, capitalize: true, voiceCommandsEnabled: true, voiceCommands: DEFAULT_VOICE_COMMANDS };
const actions = (list) => list.map((c) => `${c.action}:${c.arg}`);

test('English and Croatian defaults ship', () => {
  const phrases = DEFAULT_VOICE_COMMANDS.flatMap((c) => c.phrases);
  for (const p of ['new line', 'novi red', 'press enter', 'send it', 'pošalji', 'scratch that', 'obriši to']) {
    assert.ok(phrases.includes(p), p);
  }
});

test('a command at the end runs after the text is pasted', () => {
  const u = cleanUtterance('Hello there, send it.', opts);
  assert.equal(u.text, 'Hello there');
  assert.deepEqual(actions(u.after), ['key:Enter']);
  assert.deepEqual(u.before, []);
});

test('a command on its own is only the action', () => {
  const u = cleanUtterance(' Pošalji.', opts);
  assert.equal(u.text, '');
  assert.deepEqual(actions(u.before), ['key:Enter']);
});

test('a command in the middle of a sentence stays as text', () => {
  const u = cleanUtterance("I'll send it tomorrow.", opts);
  assert.equal(u.text, "I'll send it tomorrow.");
  assert.deepEqual([...u.before, ...u.after], []);
});

test('scratch that: at the start for the previous dictation, at the end for this one', () => {
  let u = cleanUtterance('Scratch that. I meant Tuesday.', opts);
  assert.deepEqual(actions(u.before), ['undo:']);
  assert.equal(u.text, 'I meant Tuesday.');
  u = cleanUtterance('ovo je krivo, obriši to', opts);
  assert.deepEqual(actions(u.after), ['undo:']);
  assert.equal(u.text, 'Ovo je krivo');
});

test('missing diacritics and filler words do not hide a command', () => {
  const u = cleanUtterance('Hvala, um, posalji.', opts);
  assert.deepEqual(actions(u.after), ['key:Enter']);
  assert.equal(u.text, 'Hvala');
});

test('commands at both ends', () => {
  const u = cleanUtterance('Scratch that, see you at five, press enter', opts);
  assert.deepEqual(actions(u.before), ['undo:']);
  assert.deepEqual(actions(u.after), ['key:Enter']);
  assert.equal(u.text, 'See you at five');
});

test('no trailing space before a key press', () => {
  assert.equal(cleanUtterance('Hello send it', { ...opts, addTrailingSpace: true }).text, 'Hello');
  assert.equal(cleanUtterance('Hello', { ...opts, addTrailingSpace: true }).text, 'Hello ');
});

test('line breaks still work anywhere in the sentence', () => {
  assert.equal(cleanUtterance('First line new line second line', opts).text, 'First line\nSecond line');
  assert.equal(cleanUtterance('prvi red novi red drugi red', opts).text, 'Prvi red\nDrugi red');
});

test('user commands: insert text, a snippet, a Tab', () => {
  const voiceCommands = [
    ...DEFAULT_VOICE_COMMANDS,
    { phrases: ['bullet point'], action: 'insert', arg: '\n- ' },
    { phrases: ['my signature'], action: 'snippet', arg: 'sign off' },
    { phrases: ['next field'], action: 'key', arg: 'Tab' },
  ];
  const o = { ...opts, voiceCommands, snippets: [{ trigger: 'sign off', text: 'Best,\nPatrik' }] };
  assert.equal(cleanUtterance('Groceries bullet point milk bullet point eggs', o).text, 'Groceries\n- milk\n- eggs');
  assert.equal(cleanUtterance('Thanks for everything my signature', o).text, 'Thanks for everything Best,\nPatrik');
  const u = cleanUtterance('Name next field', o);
  assert.equal(u.text, 'Name');
  assert.deepEqual(actions(u.after), ['key:Tab']);
});

test('voice commands can be switched off', () => {
  const u = cleanUtterance('Hello send it new line', { ...opts, voiceCommandsEnabled: false });
  assert.equal(u.text, 'Hello send it new line');
  assert.deepEqual([...u.before, ...u.after], []);
});

test('cleanTranscript never runs action commands, and the old on/off option means the defaults', () => {
  assert.equal(cleanTranscript('Hello send it', opts), 'Hello send it');
  assert.equal(cleanTranscript('a new line b', { voiceCommands: true }), 'A\nB');
  assert.equal(cleanTranscript('a new line b', { ...opts, voiceCommands: false }), 'A new line b');
});

test('broken commands from disk or the window are dropped', () => {
  const list = normalizeVoiceCommands([
    { phrases: ['  send   it ', 'send it'], action: 'key', arg: 'Enter' },
    { phrases: ['launch'], action: 'key', arg: 'F13' },
    { phrases: [], action: 'insert', arg: 'x' },
    { phrases: ['blank'], action: 'insert', arg: '' },
    { phrases: ['undo please'], action: 'undo', arg: 'whatever' },
    { phrases: ['x'], action: 'format-disk' },
  ]);
  assert.deepEqual(list, [
    { phrases: ['send it'], action: 'key', arg: 'Enter' },
    { phrases: ['undo please'], action: 'undo', arg: '' },
  ]);
});

// --- per-language packs (added when the user picks languages in the welcome flow) ---------------

const phrasesFor = (list, action, arg) => (list.find((c) => c.action === action && c.arg === arg) || { phrases: [] }).phrases;

test('packs ship for English, Croatian, German, Spanish, Italian, Polish, Slovenian and Serbian', () => {
  assert.deepEqual(Object.keys(VOICE_PACKS).sort(), ['de', 'en', 'es', 'hr', 'it', 'pl', 'sl', 'sr']);
  for (const [lang, pack] of Object.entries(VOICE_PACKS)) {
    for (const what of ['newline', 'paragraph', 'enter', 'undo']) assert.ok(pack[what] && pack[what].length, `${lang} ${what}`);
  }
});

test('addPacks() adds the phrases of a language to the matching commands', () => {
  const out = addPacks(DEFAULT_VOICE_COMMANDS, ['de']);
  assert.deepEqual(phrasesFor(out, 'insert', '\n'), ['new line', 'novi red', 'neue Zeile']);
  assert.ok(phrasesFor(out, 'key', 'Enter').includes('abschicken'));
  assert.ok(phrasesFor(out, 'undo', '').includes('lösch das'));
  assert.equal(out.length, DEFAULT_VOICE_COMMANDS.length, 'no new commands, only phrases');
  assert.deepEqual(phrasesFor(DEFAULT_VOICE_COMMANDS, 'insert', '\n'), ['new line', 'novi red'], 'the input is not changed');
});

test('addPacks() never repeats a phrase, never removes one, and keeps your own commands', () => {
  const mine = [
    { phrases: ['new line', 'zeilenumbruch'], action: 'insert', arg: '\n' },
    { phrases: ['tab please'], action: 'key', arg: 'Tab' },
  ];
  const out = addPacks(mine, ['en', 'hr', 'sr', 'de']);
  assert.deepEqual(phrasesFor(out, 'insert', '\n'), ['new line', 'zeilenumbruch', 'novi red', 'neue Zeile']);
  assert.deepEqual(phrasesFor(out, 'key', 'Tab'), ['tab please']);
  const all = out.flatMap((c) => c.phrases.map((p) => p.toLowerCase()));
  assert.equal(all.length, new Set(all).size, 'every phrase once');
  assert.ok(out.some((c) => c.action === 'undo'), 'a missing command is added with the pack phrases');
});

test('addPacks() ignores languages without a pack and stays within the phrase limit', () => {
  assert.deepEqual(addPacks(DEFAULT_VOICE_COMMANDS, ['ja', 'xx', 42]), normalizeVoiceCommands(DEFAULT_VOICE_COMMANDS));
  const full = [{ phrases: Array.from({ length: 12 }, (_, i) => `line ${i}`), action: 'insert', arg: '\n' }];
  assert.equal(phrasesFor(addPacks(full, ['de']), 'insert', '\n').length, 12);
});

test('a German pack phrase works as a command', () => {
  const commands = addPacks(DEFAULT_VOICE_COMMANDS, ['de']);
  const r = cleanUtterance('bis morgen abschicken', { ...opts, voiceCommands: commands });
  assert.equal(r.text.trim(), 'Bis morgen');
  assert.deepEqual(actions(r.after), ['key:Enter']);
  assert.equal(cleanTranscript('Hallo neue Zeile Welt', { ...opts, voiceCommands: commands }), 'Hallo\nWelt');
});
