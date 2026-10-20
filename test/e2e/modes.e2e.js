'use strict';
// Modes: the app in front picks one, a shortcut opens one (set up on the Modes and Shortcuts pages, as a user
// would), Switch mode changes it, and settings from before modes come in as modes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, setUpSettings, waitFor } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Holds a key long enough to be push-to-talk, then lets go; `during` runs while it is held. */
async function dictate(run, key = 'F13', during = null) {
  // the last dictation is finished (its text is pasted a moment before it is), or this one would be "busy"
  await waitFor(async () => (await run.page.evaluate(() => window.pauli.getDictationStatus())).status === 'idle', { what: 'an idle dictation' });
  await run.key(key, true);
  await sleep(900);
  const seen = during ? await during() : null;
  await sleep(600);
  await run.key(key, false);
  return seen;
}

async function press(run, key) {
  await run.key(key, true);
  await run.key(key, false);
}

const pastes = (run, n = 1) => waitFor(async () => { const s = await run.state(); return s.pasted.length >= n ? s : null; }, { what: `${n} paste(s)` });

/** The pill's mode chip as shown: { hidden, text }. */
async function pillChip(run) {
  const overlay = run.app.windows().find((w) => w.url().endsWith('overlay.html'));
  return overlay.evaluate(() => {
    const chip = document.getElementById('chip');
    return { hidden: chip.hidden, text: chip.textContent };
  });
}

const MODES = [
  { id: 'default' },
  { id: 'email', name: 'Email in English', style: 'formal', translateTo: 'en', apps: ['outlook.exe'] },
  { id: 'code', style: 'code', apps: ['code.exe'] },
];

test('the app in front picks its mode: Outlook → formal English, VS Code → code style, anything else → Default', async (t) => {
  const run = await launch({ settings: setUpSettings({ modes: MODES }) });
  t.after(run.close);
  await sleep(1500); // the pill and its recorder get ready

  await run.set('transcript', 'hello there');
  await run.set('foreground', 'OUTLOOK.EXE');
  await dictate(run);
  let state = await pastes(run, 1);
  assert.equal(state.recognised[0].task, 'translate', 'to English: Whisper translates while it listens');
  assert.equal(state.pasted[0], 'Hello there. ', 'formal: always punctuated');

  await run.set('transcript', 'npm run test.');
  await run.set('foreground', 'Code.exe');
  await dictate(run);
  state = await pastes(run, 2);
  assert.equal(state.recognised[1].task, 'transcribe');
  assert.equal(state.pasted[1], 'npm run test ', 'code: no capital, no full stop');

  await run.set('foreground', 'notepad.exe');
  await dictate(run);
  state = await pastes(run, 3);
  assert.equal(state.pasted[2], 'Npm run test. ');

  const history = await run.page.evaluate(() => window.pauli.listHistory());
  assert.deepEqual(history.map((i) => i.mode), ['default', 'code', 'email']);
});

test('set up on the Modes and Shortcuts pages: F13 opens a Croatian chat mode, and the pill shows it', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await sleep(1000);

  await page.click('.nav[data-page="modes"]');
  await page.click('#mode-new');
  await page.fill('#mode-name', 'Croatian chat');
  await page.press('#mode-name', 'Tab');
  await waitFor(async () => (await page.evaluate(() => window.pauli.getSettings())).modes.some((m) => m.name === 'Croatian chat'), { what: 'the new mode' });
  await page.selectOption('#mode-language', 'hr');
  await waitFor(async () => (await page.evaluate(() => window.pauli.getSettings())).modes.at(-1).language === 'hr', { what: 'the language' });
  await page.selectOption('#mode-style', 'casual');
  await waitFor(async () => (await page.evaluate(() => window.pauli.getSettings())).modes.at(-1).style === 'casual', { what: 'the style' });

  await page.click('.nav[data-page="shortcuts"]');
  await page.selectOption('#g-start .mode-select', 'croatian-chat'); // the id follows the name it was given first
  const settings = await waitFor(async () => {
    const s = await page.evaluate(() => window.pauli.getSettings());
    return s.bindings.find((b) => b.keys[0] === 'F13').mode === 'croatian-chat' ? s : null;
  }, { what: 'F13 pointing to the mode' });
  assert.deepEqual(settings.modes.at(-1), {
    id: 'croatian-chat', name: 'Croatian chat', color: settings.modes.at(-1).color, language: 'hr', translateTo: null,
    style: 'casual', voiceCommands: true, aiPolish: 'off', prompt: '', apps: [],
  });

  await run.set('transcript', 'Bok, kako si.');
  await run.set('language', 'hr');
  const chip = await dictate(run, 'F13', () => pillChip(run));
  assert.deepEqual(chip, { hidden: false, text: 'Croatian chat' });
  const state = await pastes(run, 1);
  assert.deepEqual(state.recognised[0].languages, ['hr'], 'only Croatian is listened for');
  assert.equal(state.pasted[0], 'Bok, kako si ', 'casual: no full stop at the end');

  await page.click('.nav[data-page="modes"]');
  await page.click('.mode-item:has-text("Croatian chat")');
  assert.match(await page.textContent('#mode-detail'), /F13/, 'the mode lists the shortcut that opens it');
});

test('Switch mode goes to the next mode and stays there; the app in front no longer decides', async (t) => {
  const run = await launch({
    settings: setUpSettings({
      modes: MODES,
      bindings: [
        { id: 'dictate-1', action: 'dictate', keys: ['F13'], behaviour: 'both' },
        { id: 'cycleMode-1', action: 'cycleMode', keys: ['F14'] },
        { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
      ],
    }),
  });
  t.after(run.close);
  await sleep(1500);
  await run.set('transcript', 'hello there.');
  await run.set('foreground', 'outlook.exe');
  await press(run, 'F14'); // Default
  await sleep(200);
  await press(run, 'F14'); // Email in English
  await sleep(200);
  await press(run, 'F14'); // Code
  await sleep(300);
  await dictate(run);
  const state = await pastes(run, 1);
  assert.equal(state.pasted[0], 'hello there ', 'Code, although Outlook is in front');
});

test('settings from 1.4 come in as modes: app styles, Always translate and the translate shortcut', async (t) => {
  const v6 = setUpSettings({
    settingsVersion: 6,
    appStyles: { enabled: true, rules: [{ app: 'outlook.exe', style: 'formal' }, { app: 'slack.exe', style: 'casual' }] },
    translation: { always: false, target: 'de', quality: 'best' },
    bindings: [
      { id: 'dictate-1', action: 'dictate', keys: ['F13'], behaviour: 'both' },
      { id: 'translate-1', action: 'translate', keys: ['F14'], behaviour: 'toggle' },
      { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
    ],
  });
  const run = await launch({ settings: v6 });
  t.after(run.close);
  const file = path.join(run.dir, 'settings.json');
  const saved = await waitFor(() => {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s.settingsVersion === 7 ? s : null;
  }, { what: 'the migrated settings' });
  assert.deepEqual(saved.modes.map((m) => [m.id, m.style, m.translateTo, m.apps]), [
    ['default', 'normal', null, []], ['chat', 'casual', null, ['slack.exe']], ['formal', 'formal', null, ['outlook.exe']], ['translate', 'normal', 'de', []],
  ]);
  assert.deepEqual(saved.bindings[1], { id: 'translate-1', action: 'dictate', keys: ['F14'], behaviour: 'toggle', mode: 'translate' });
  assert.equal(saved.appStyles, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.dir, 'settings.v6.json'), 'utf8')).appStyles, v6.appStyles);

  await run.page.click('.nav[data-page="modes"]');
  assert.deepEqual(await run.page.$$eval('.mode-item b', (els) => els.map((e) => e.textContent)), ['Default', 'Chat', 'Formal', 'Translate to German']);
});
