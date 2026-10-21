'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowLook, MICA_BUILD } = require('../src/main/window-look');

test('Windows 11 22H2 and later get Mica: a see-through window the page lets show', () => {
  assert.equal(MICA_BUILD, 22621);
  for (const release of ['10.0.22621', '10.0.26300', '10.0.22631.4317']) {
    assert.deepEqual(windowLook({ platform: 'win32', release, dark: false }), { mica: true, window: { backgroundMaterial: 'mica', backgroundColor: '#00000000' } }, release);
  }
});

test('older Windows and anything else keep the solid paper colour, light or dark', () => {
  assert.deepEqual(windowLook({ platform: 'win32', release: '10.0.19045', dark: false }), { mica: false, window: { backgroundColor: '#f3f1ec' } });
  assert.deepEqual(windowLook({ platform: 'win32', release: '10.0.22000', dark: true }), { mica: false, window: { backgroundColor: '#191917' } }, 'Windows 11 21H2 has no Mica for apps');
  assert.equal(windowLook({ platform: 'linux', release: '6.8.0', dark: false }).mica, false);
  assert.equal(windowLook({ platform: 'win32', release: 'garbage', dark: false }).mica, false);
});

test('the no-Mica window colour is the window token of tokens.css, in both themes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'tokens.css'), 'utf8');
  const base = [...css.matchAll(/--bg-base:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(base, [
    windowLook({ platform: 'win32', release: '10.0.19045', dark: false }).window.backgroundColor,
    windowLook({ platform: 'win32', release: '10.0.19045', dark: true }).window.backgroundColor,
  ]);
});
