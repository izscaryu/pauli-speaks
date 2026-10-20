'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MODES, normalizeModes, resolveMode, pinsMode, nextMode, newModeId, modeLabel, v6to7, MAX_MODES, withModesFor,
} = require('../src/main/modes');

const ids = (modes) => modes.map((m) => m.id);
const byId = (modes, id) => modes.find((m) => m.id === id);

// --- the data model ----------------------------------------------------------

test('the default modes: Default first, then Chat, Code, Formal (with the old app-style apps) and Translate to English', () => {
  assert.deepEqual(ids(DEFAULT_MODES), ['default', 'chat', 'code', 'formal', 'translate']);
  const def = DEFAULT_MODES[0];
  assert.deepEqual(def, {
    id: 'default', name: '', color: '#8b867b', language: null, translateTo: null, style: 'normal',
    voiceCommands: true, aiPolish: 'off', prompt: '', apps: [],
  });
  assert.equal(byId(DEFAULT_MODES, 'chat').style, 'casual');
  assert.ok(byId(DEFAULT_MODES, 'chat').apps.includes('slack.exe'));
  assert.equal(byId(DEFAULT_MODES, 'code').style, 'code');
  assert.ok(byId(DEFAULT_MODES, 'code').apps.includes('code.exe'));
  assert.equal(byId(DEFAULT_MODES, 'formal').style, 'formal');
  assert.ok(byId(DEFAULT_MODES, 'formal').apps.includes('outlook.exe'));
  assert.equal(byId(DEFAULT_MODES, 'translate').translateTo, 'en');
  assert.deepEqual(byId(DEFAULT_MODES, 'translate').apps, []);
});

test('normalizeModes fills in missing fields and keeps Default first, with no apps', () => {
  const out = normalizeModes([{ id: 'code', style: 'code', apps: ['Code.EXE'] }, { id: 'default', apps: ['x.exe'], color: '#123456' }]);
  assert.deepEqual(ids(out), ['default', 'code']);
  assert.deepEqual(out[0].apps, []);
  assert.equal(out[0].color, '#123456');
  assert.deepEqual(out[1], {
    id: 'code', name: '', color: out[1].color, language: null, translateTo: null, style: 'code',
    voiceCommands: true, aiPolish: 'off', prompt: '', apps: ['code.exe'],
  });
  assert.match(out[1].color, /^#[0-9a-f]{6}$/);
});

test('normalizeModes adds Default when it is missing, and returns the defaults for anything that is not a list', () => {
  assert.deepEqual(ids(normalizeModes([{ id: 'chat', name: 'Chat' }])), ['default', 'chat']);
  assert.deepEqual(normalizeModes(null), DEFAULT_MODES);
  assert.deepEqual(normalizeModes('modes'), DEFAULT_MODES);
  assert.deepEqual(ids(normalizeModes([])), ['default']);
});

test('normalizeModes repairs bad values instead of dropping the mode', () => {
  const [, m] = normalizeModes([{
    id: 'x', name: '  Notes  ', color: 'red', language: 'Croatian', translateTo: 7, style: 'loud',
    voiceCommands: 'yes', aiPolish: 'max', prompt: 42, apps: ['Obsidian.exe', 'obsidian.exe', '', 3, 'bad/name.exe', 'notepad'],
  }]);
  assert.equal(m.name, 'Notes');
  assert.match(m.color, /^#[0-9a-f]{6}$/);
  assert.equal(m.language, null);
  assert.equal(m.translateTo, null);
  assert.equal(m.style, 'normal');
  assert.equal(m.voiceCommands, true);
  assert.equal(m.aiPolish, 'off');
  assert.equal(m.prompt, '');
  assert.deepEqual(m.apps, ['obsidian.exe', 'notepad.exe']);
});

test('normalizeModes keeps languages and polish settings that are valid', () => {
  const [, m] = normalizeModes([{ id: 'hr', language: 'HR', translateTo: 'de', voiceCommands: false, aiPolish: 'medium', prompt: 'Short.' }]);
  assert.equal(m.language, 'hr');
  assert.equal(m.translateTo, 'de');
  assert.equal(m.voiceCommands, false);
  assert.equal(m.aiPolish, 'medium');
  assert.equal(m.prompt, 'Short.');
});

test('normalizeModes gives every mode a unique id made from its name, and skips things that are not objects', () => {
  const out = normalizeModes([null, 'x', { name: 'Bilješke (HR)' }, { name: 'Bilješke (HR)' }, { id: 'Bad Id!', name: 'Code' }, { id: 'default' }]);
  assert.deepEqual(ids(out), ['default', 'biljeske-hr', 'biljeske-hr-2', 'code']);
});

test(`normalizeModes keeps at most ${MAX_MODES} modes`, () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}` }));
  assert.equal(normalizeModes(many).length, MAX_MODES);
});

test('newModeId: a slug of the name that no mode uses yet', () => {
  assert.equal(newModeId('Email in English', DEFAULT_MODES), 'email-in-english');
  assert.equal(newModeId('Code', DEFAULT_MODES), 'code-2');
  assert.equal(newModeId('???', DEFAULT_MODES), 'mode');
  assert.equal(newModeId('Čćžšđ', []), 'cczsd');
});

test('modeLabel: a name the user gave, or the built-in name in the UI language', () => {
  const t = (key, vars) => `${key}${vars && vars.language ? `:${vars.language}` : ''}`;
  const languageName = (c) => c.toUpperCase();
  assert.equal(modeLabel({ id: 'code', name: 'Coding' }, { t, languageName }), 'Coding');
  assert.equal(modeLabel({ id: 'code', name: '' }, { t, languageName }), 'modes.builtin.code');
  assert.equal(modeLabel({ id: 'translate', name: '', translateTo: 'de' }, { t, languageName }), 'modes.builtin.translate:DE');
  assert.equal(modeLabel({ id: 'my-mode', name: '' }, { t, languageName }), 'my-mode');
});

// --- which mode a dictation uses --------------------------------------------

const MODES = normalizeModes([
  { id: 'default' },
  { id: 'email', translateTo: 'en', style: 'formal', apps: ['outlook.exe'] },
  { id: 'code', style: 'code', apps: ['code.exe', 'windowsterminal.exe'] },
  { id: 'chat', style: 'casual', language: 'hr', apps: ['code.exe', 'slack.exe'] },
]);

test('resolveMode: the shortcut\'s mode comes first', () => {
  const m = resolveMode({ binding: { action: 'dictate', mode: 'chat' }, link: 'email', switched: 'code', exe: 'outlook.exe', modes: MODES });
  assert.equal(m.id, 'chat');
});

test('resolveMode: then a ?mode= link or --mode= flag (any case)', () => {
  assert.equal(resolveMode({ binding: { action: 'dictate' }, link: 'EMAIL', switched: 'code', exe: 'slack.exe', modes: MODES }).id, 'email');
});

test('resolveMode: then the mode chosen with Switch mode', () => {
  assert.equal(resolveMode({ binding: { action: 'dictate' }, switched: 'code', exe: 'outlook.exe', modes: MODES }).id, 'code');
});

test('resolveMode: then the first mode whose apps has the app in front (any case)', () => {
  assert.equal(resolveMode({ exe: 'OUTLOOK.EXE', modes: MODES }).id, 'email');
  assert.equal(resolveMode({ exe: 'Code.exe', modes: MODES }).id, 'code', 'code comes before chat in the list');
});

test('resolveMode: Default when nothing else fits', () => {
  assert.equal(resolveMode({ exe: 'chrome.exe', modes: MODES }).id, 'default');
  assert.equal(resolveMode({ modes: MODES }).id, 'default');
  assert.equal(resolveMode({}).id, 'default');
});

test('resolveMode: a mode that no longer exists is skipped, not an error', () => {
  assert.equal(resolveMode({ binding: { action: 'dictate', mode: 'gone' }, link: 'gone', switched: 'gone', exe: 'slack.exe', modes: MODES }).id, 'chat');
});

test('resolveMode: the old Talk & translate action uses the Translate mode, or translates Default to the target', () => {
  const withTranslate = normalizeModes([...MODES, { id: 'translate', translateTo: 'de' }]);
  assert.equal(resolveMode({ binding: { action: 'translate' }, modes: withTranslate }).translateTo, 'de');
  const m = resolveMode({ binding: { action: 'translate' }, modes: MODES, translateTarget: 'it' });
  assert.equal(m.translateTo, 'it');
  assert.equal(m.style, 'normal');
});

test('pinsMode: only a shortcut that names a mode (or the old translate action) fixes the mode', () => {
  assert.equal(pinsMode({ action: 'dictate', mode: 'code' }), true);
  assert.equal(pinsMode({ action: 'translate' }), true);
  assert.equal(pinsMode({ action: 'dictate' }), false);
  assert.equal(pinsMode(null), false);
});

test('nextMode: Switch mode goes Automatic → each mode in turn → Automatic', () => {
  assert.equal(nextMode(MODES, null), 'default');
  assert.equal(nextMode(MODES, 'default'), 'email');
  assert.equal(nextMode(MODES, 'chat'), null);
  assert.equal(nextMode(MODES, 'gone'), 'default');
});

// --- settings v6 → v7 --------------------------------------------------------

const V6_BINDINGS = [
  { id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'Meta'], behaviour: 'both' },
  { id: 'translate-1', action: 'translate', keys: ['Ctrl', 'Meta', 'Shift'], behaviour: 'hold' },
  { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
];

test('v6 → v7: app styles become one mode per style that has apps, each with those apps', () => {
  const out = v6to7({
    appStyles: { enabled: true, rules: [{ app: 'Slack.exe', style: 'casual' }, { app: 'code.exe', style: 'code' }, { app: 'chrome.exe', style: 'normal' }, { app: 'x.exe', style: 'odd' }] },
    bindings: [V6_BINDINGS[0]],
  });
  assert.deepEqual(ids(out.modes), ['default', 'chat', 'code']);
  assert.deepEqual(byId(out.modes, 'chat').apps, ['slack.exe']);
  assert.equal(byId(out.modes, 'chat').style, 'casual');
  assert.deepEqual(byId(out.modes, 'code').apps, ['code.exe']);
  assert.equal('appStyles' in out, false);
});

test('v6 → v7: app styles that were switched off become modes without apps', () => {
  const out = v6to7({ appStyles: { enabled: false, rules: [{ app: 'outlook.exe', style: 'formal' }] }, bindings: [] });
  assert.deepEqual(ids(out.modes), ['default', 'formal']);
  assert.deepEqual(byId(out.modes, 'formal').apps, []);
});

test('v6 → v7: a file without app styles gets the default app modes', () => {
  const out = v6to7({ bindings: [V6_BINDINGS[0]] });
  assert.deepEqual(ids(out.modes), ['default', 'chat', 'code', 'formal']);
  assert.deepEqual(byId(out.modes, 'code').apps, byId(DEFAULT_MODES, 'code').apps);
});

test('v6 → v7: Talk & translate shortcuts become Dictate shortcuts for a Translate mode in the target language', () => {
  const out = v6to7({ bindings: V6_BINDINGS, translation: { always: false, target: 'de', quality: 'best' } });
  assert.deepEqual(out.bindings[1], { id: 'translate-1', action: 'dictate', keys: ['Ctrl', 'Meta', 'Shift'], behaviour: 'hold', mode: 'translate' });
  assert.deepEqual(out.bindings[0], V6_BINDINGS[0]);
  assert.equal(byId(out.modes, 'translate').translateTo, 'de');
  assert.equal(byId(out.modes, 'default').translateTo, null);
  assert.deepEqual(out.translation, { target: 'de', quality: 'best' }, '"always" leaves, the rest stays');
});

test('v6 → v7: a file without bindings had the default Talk & translate shortcut, so it gets the Translate mode', () => {
  assert.ok(byId(v6to7({}).modes, 'translate'));
  assert.equal(byId(v6to7({ bindings: [V6_BINDINGS[0]] }).modes, 'translate'), undefined);
});

test('v6 → v7: "Always translate" makes every migrated mode translate, so no app stops being translated', () => {
  const out = v6to7({ translation: { always: true, target: 'en' }, bindings: [V6_BINDINGS[0]] });
  assert.ok(out.modes.every((m) => m.translateTo === 'en'));
});

test('v6 → v7: modes that are already there are kept; nothing else changes', () => {
  const modes = [{ id: 'default' }, { id: 'mine', style: 'code' }];
  const out = v6to7({ modes, sounds: false, bindings: [V6_BINDINGS[0]] });
  assert.equal(out.modes, modes);
  assert.equal(out.sounds, false);
});

test('withModesFor: built-in modes that shortcuts point to come back (Reset to defaults), others are left alone', () => {
  const modes = normalizeModes([{ id: 'default' }, { id: 'code', style: 'code' }]);
  const bindings = [{ action: 'dictate', mode: 'translate' }, { action: 'dictate', mode: 'mine' }, { action: 'dictate' }];
  const out = withModesFor(modes, bindings);
  assert.deepEqual(ids(out), ['default', 'code', 'translate']);
  assert.equal(out.at(-1).translateTo, 'en');
  assert.equal(withModesFor(out, bindings), out, 'nothing missing: the same list');
});
