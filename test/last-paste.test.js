'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LastPaste, MAX_UNDO_CHARS } = require('../src/main/last-paste');

test('nothing pasted yet', () => {
  assert.deepEqual(new LastPaste().undoPlan('Code.exe'), { error: 'Nothing to undo' });
});

test('undo is one Backspace per character, counting emoji and accents as one', () => {
  const p = new LastPaste();
  p.remember('Bok 👋 čovječe\n', 'Slack.exe');
  assert.deepEqual(p.undoPlan('Slack.exe'), { backspaces: 14 });
});

test('undo works once', () => {
  const p = new LastPaste();
  p.remember('hello ', 'Code.exe');
  p.undoPlan('Code.exe');
  assert.deepEqual(p.undoPlan('Code.exe'), { error: 'Nothing to undo' });
});

test('only in the app it was typed into', () => {
  const p = new LastPaste();
  p.remember('hello ', 'Code.exe');
  assert.match(p.undoPlan('chrome.exe').error, /Go back to Code/);
  assert.deepEqual(p.undoPlan('Code.exe'), { backspaces: 6 }, 'a refused undo can still be done there');
  p.remember('hi', null);
  assert.deepEqual(p.undoPlan('chrome.exe'), { backspaces: 2 }, 'unknown app: allowed');
});

test('not after Enter sent it', () => {
  const p = new LastPaste();
  p.remember('see you', 'Teams.exe');
  p.markSent();
  assert.match(p.undoPlan('Teams.exe').error, /already sent/);
});

test('very long text is left to Ctrl+Z', () => {
  const p = new LastPaste();
  p.remember('x'.repeat(MAX_UNDO_CHARS + 1), 'Code.exe');
  assert.match(p.undoPlan('Code.exe').error, /Too long/);
});

test('a dictation left on the clipboard (copy-only) leaves nothing to undo', () => {
  const p = new LastPaste();
  p.remember('earlier ', 'Code.exe');
  p.forget();
  assert.deepEqual(p.undoPlan('Code.exe'), { error: 'Nothing to undo' });
});
