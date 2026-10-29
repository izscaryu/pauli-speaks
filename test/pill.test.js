'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextLanguage, canSwitchLanguage, pillBounds, snapPosition, POSITIONS, micFlash, pillActionTarget, tapHint } = require('../src/main/pill');

test('the language chip steps from "your languages" through each one and back', () => {
  const mine = ['hr', 'en', 'de'];
  assert.equal(nextLanguage(null, mine), 'hr');
  assert.equal(nextLanguage('hr', mine), 'en');
  assert.equal(nextLanguage('de', mine), null);
  assert.equal(nextLanguage('fr', mine), null, 'one that is not on the list goes back to your languages');
  assert.equal(canSwitchLanguage(mine), true);
  assert.equal(canSwitchLanguage(['hr']), false, 'nothing to switch between');
  assert.equal(canSwitchLanguage([]), false);
});

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 420, height: 120 };

test('the pill sits at the bottom, on the left, in the centre or on the right', () => {
  assert.deepEqual(POSITIONS, ['left', 'center', 'right']);
  assert.deepEqual(pillBounds({ position: 'center', workArea: WA, size: SIZE }), { x: 750, y: 914, width: 420, height: 120 });
  assert.equal(pillBounds({ position: 'left', workArea: WA, size: SIZE }).x, 24);
  assert.equal(pillBounds({ position: 'right', workArea: WA, size: SIZE }).x, 1920 - 420 - 24);
  assert.equal(pillBounds({ position: 'nonsense', workArea: WA, size: SIZE }).x, 750, 'unknown: centre');
  const second = { x: 1920, y: 0, width: 1280, height: 984 };
  assert.equal(pillBounds({ position: 'left', workArea: second, size: SIZE }).x, 1944, 'on another screen');
});

test('dropping the pill snaps it to the third of the screen it was dropped in', () => {
  assert.equal(snapPosition(100, WA), 'left');
  assert.equal(snapPosition(960, WA), 'center');
  assert.equal(snapPosition(1800, WA), 'right');
  assert.equal(snapPosition(-50, WA), 'left');
  assert.equal(snapPosition(2000 + 1920, { x: 1920, y: 0, width: 1280, height: 984 }), 'right');
});

const fakeT = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

test('a blocked or missing microphone: a short message, a hint, and a button that fixes it', () => {
  const blocked = micFlash({ problem: 'blocked' }, fakeT);
  assert.deepEqual(blocked, { text: 'overlay.mic.blocked', hint: 'overlay.mic.blockedHint', kind: 'warn', action: { id: 'mic-privacy' }, log: 'blocked' });
  const missing = micFlash({ problem: 'notFound' }, fakeT);
  assert.deepEqual(missing, { text: 'overlay.mic.notFound', hint: 'overlay.mic.notFoundHint', kind: 'warn', action: { id: 'mic-choose' }, log: 'not found' });
});

test('any other microphone error is shown as it is, with nothing to press', () => {
  assert.deepEqual(micFlash({ problem: 'other', detail: 'Device busy' }, fakeT),
    { text: 'mic.error {"error":"Device busy"}', hint: null, kind: 'error', action: null, log: 'Device busy' });
  assert.equal(micFlash('an old-style message', fakeT).text, 'mic.error {"error":"an old-style message"}', 'a plain string still works');
  assert.equal(micFlash({ problem: 'blocked; rm -rf' }, fakeT).action, null, 'an unknown problem gets no button');
  assert.equal(micFlash(null, fakeT).kind, 'error');
});

test('the microphone buttons open exactly two places: Windows\' microphone privacy page, or Settings → Microphone', () => {
  assert.deepEqual(pillActionTarget('mic-privacy'), { url: 'ms-settings:privacy-microphone' });
  assert.deepEqual(pillActionTarget('mic-choose'), { page: 'settings#microphone' });
  assert.equal(pillActionTarget('retry-3'), null, 'Retry and Undo stay with the dictation');
  assert.equal(pillActionTarget('unpolish-1'), null);
  assert.equal(pillActionTarget('https://example.com'), null);
  assert.equal(pillActionTarget(undefined), null);
});

test('a tap too short to talk: a Both shortcut also says it can be double-tapped (tester: "it makes me hold it")', () => {
  const t = (key, p) => `${key}(${p.keys})`;
  const format = (keys) => keys.join('+');
  assert.equal(tapHint({ behaviour: 'both', keys: ['Ctrl', 'Meta'] }, ['F13'], { t, format }), 'flash.holdOrDoubleTap(Ctrl+Meta)');
  assert.equal(tapHint({ behaviour: 'hold', keys: ['F13'] }, ['Ctrl'], { t, format }), 'flash.holdToTalk(F13)');
  assert.equal(tapHint(null, ['Ctrl', 'Meta'], { t, format }), 'flash.holdToTalk(Ctrl+Meta)', 'no shortcut known: the hold keys');
});
