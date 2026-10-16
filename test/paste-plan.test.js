'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planPaste, clipboardFormatsFor } = require('../src/main/paste-plan');

const MEDIUM = 0x2000;
const HIGH = 0x3000;

test('planPaste: a window run as administrator gets copy-only', () => {
  assert.deepStrictEqual(planPaste({ ourLevel: MEDIUM, targetLevel: HIGH }), { mode: 'copy-only', restoreClipboard: false });
});

test('planPaste: same integrity level pastes', () => {
  assert.deepStrictEqual(planPaste({ ourLevel: MEDIUM, targetLevel: MEDIUM }), { mode: 'paste', restoreClipboard: true });
});

test('planPaste: unknown levels paste, as before', () => {
  for (const levels of [
    { ourLevel: null, targetLevel: HIGH },
    { ourLevel: MEDIUM, targetLevel: null },
    { ourLevel: null, targetLevel: null },
    {},
  ]) {
    assert.strictEqual(planPaste(levels).mode, 'paste', JSON.stringify(levels));
  }
});

test('planPaste: we run elevated, target is a normal app -> paste', () => {
  assert.strictEqual(planPaste({ ourLevel: HIGH, targetLevel: MEDIUM }).mode, 'paste');
});

test('elevated plan never restores', () => {
  for (const ourLevel of [0x1000, MEDIUM, HIGH]) {
    const plan = planPaste({ ourLevel, targetLevel: ourLevel + 0x1000 });
    assert.strictEqual(plan.mode, 'copy-only');
    assert.strictEqual(plan.restoreClipboard, false);
  }
});

test('clipboardFormatsFor: the text plus the history/cloud exclusion formats as DWORD 0', async () => {
  const formats = clipboardFormatsFor('hello');
  assert.strictEqual(formats['text/plain'], 'hello');
  const names = ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'ExcludeClipboardContentFromMonitorProcessing'];
  for (const name of names) {
    const key = Object.keys(formats).find((k) => k.endsWith(`format="${name}"`));
    assert.ok(key, `missing ${name}`);
    const bytes = new Uint8Array(await formats[key].arrayBuffer());
    assert.deepStrictEqual([...bytes], [0, 0, 0, 0], name);
  }
  assert.strictEqual(Object.keys(formats).length, 1 + names.length);
});
