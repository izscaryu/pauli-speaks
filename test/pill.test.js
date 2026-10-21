'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextLanguage, canSwitchLanguage, pillBounds, snapPosition, POSITIONS } = require('../src/main/pill');

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
