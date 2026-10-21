'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolishUndo, UNDO_MS } = require('../src/main/polish-undo');

const POLISHED = 'We meet on Wednesday at the office. ';
const UNPOLISHED = 'So we meet on Tuesday, no wait, Wednesday at the office. ';

function setup({ undoLast = true, lastPasted = POLISHED } = {}) {
  const calls = [];
  const due = [];
  const item = { id: 'h1', createdAt: '2026-10-21T10:00:00.000Z', text: POLISHED.trim(), polished: POLISHED.trim(), unpolished: UNPOLISHED.trim(), words: 7, mode: 'chat' };
  const history = {
    items: [item],
    list() { return this.items; },
    resolve(id, entry) { calls.push(['resolve', id, entry]); this.items = this.items.map((i) => (i.id === id ? { ...entry, id, createdAt: i.createdAt } : i)); return entry; },
  };
  const undo = createPolishUndo({
    typing: {
      undoLast: async () => { calls.push(['undoLast']); return undoLast; },
      paste: async (text) => { calls.push(['paste', text]); return { mode: 'paste' }; },
    },
    history,
    lastPasted: () => lastPasted,
    flash: (text) => calls.push(['flash', text]),
    timers: { setTimeout: (fn, ms) => { const t = { fn, ms }; due.push(t); return t; }, clearTimeout: (t) => { const i = due.indexOf(t); if (i >= 0) due.splice(i, 1); } },
  });
  return { undo, calls, history, due };
}

test('the pill offers Undo for 4 seconds after a polished paste', () => {
  const { undo, due } = setup();
  const action = undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.match(action.id, /^unpolish-\d+$/);
  assert.equal(action.label, 'Undo');
  assert.deepEqual(due.map((t) => t.ms), [UNDO_MS]);
  assert.equal(UNDO_MS, 4000);
});

test('Undo takes the polished text back with Backspace and pastes what was said; History keeps both', async () => {
  const { undo, calls, history } = setup();
  const { id } = undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.equal(await undo.take(id), true);
  assert.deepEqual(calls.slice(0, 2), [['undoLast'], ['paste', UNPOLISHED]]);
  const item = history.list()[0];
  assert.equal(item.text, UNPOLISHED.trim());
  assert.equal(item.polished, POLISHED.trim());
  assert.equal(item.unpolished, UNPOLISHED.trim());
  assert.equal(item.words, 11);
  assert.equal(item.createdAt, '2026-10-21T10:00:00.000Z');
});

test('Undo works once; after 4 seconds, or once another offer took its place, it does nothing', async () => {
  const once = setup();
  const a = once.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  await once.undo.take(a.id);
  assert.equal(await once.undo.take(a.id), false);
  assert.equal(once.calls.filter((c) => c[0] === 'paste').length, 1);

  const late = setup();
  const b = late.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  late.due[0].fn();
  assert.equal(await late.undo.take(b.id), false);
  assert.deepEqual(late.calls.filter((c) => c[0] !== 'flash'), []);

  const replaced = setup();
  const c = replaced.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  replaced.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.equal(await replaced.undo.take(c.id), false);
  assert.equal(replaced.due.length, 1, 'the old timer is gone');
});

test('a new dictation (expire) or Delete all my data (clear) ends the offer', async () => {
  for (const end of ['expire', 'clear']) {
    const { undo, calls } = setup();
    const { id } = undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
    undo[end]();
    assert.equal(await undo.take(id), false, end);
    assert.deepEqual(calls.filter((c) => c[0] === 'undoLast' || c[0] === 'paste'), []);
  }
});

test('nothing is typed when the polished text is no longer the last paste, or Backspace may not run there', async () => {
  const moved = setup({ lastPasted: 'something newer ' });
  const a = moved.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.equal(await moved.undo.take(a.id), false);
  assert.deepEqual(moved.calls.filter((c) => c[0] === 'undoLast' || c[0] === 'paste'), []);
  assert.ok(moved.calls.some((c) => c[0] === 'flash'));

  const refused = setup({ undoLast: false }); // another app in front, or Enter sent it: undoLast says why
  const b = refused.undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.equal(await refused.undo.take(b.id), false);
  assert.deepEqual(refused.calls.map((c) => c[0]), ['undoLast']);
  assert.equal(refused.history.list()[0].text, POLISHED.trim(), 'History unchanged');
});

test('if pasting what was said fails after the Backspaces, it goes to the clipboard and the pill says so', async () => {
  const calls = [];
  const item = { id: 'h1', text: POLISHED.trim(), polished: POLISHED.trim(), unpolished: UNPOLISHED.trim(), words: 7 };
  const undo = createPolishUndo({
    typing: { undoLast: async () => true, paste: async () => { throw new Error('SendInput blocked'); } },
    history: { list: () => [item], resolve: (id, e) => calls.push(['resolve', e.text]) },
    lastPasted: () => POLISHED,
    flash: (text) => calls.push(['flash', text]),
    copy: async (text) => calls.push(['copy', text]),
    timers: { setTimeout: () => ({}), clearTimeout() {} },
  });
  const { id } = undo.offer({ historyId: 'h1', polished: POLISHED, unpolished: UNPOLISHED });
  assert.equal(await undo.take(id), false);
  assert.deepEqual(calls.filter((c) => c[0] === 'copy'), [['copy', UNPOLISHED.trim()]]);
  assert.ok(calls.some((c) => c[0] === 'flash' && /clipboard/i.test(c[1])));
});
