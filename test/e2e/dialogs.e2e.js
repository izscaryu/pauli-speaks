'use strict';
// Everything that deletes or resets asks first, in the app's own ContentDialog (src/renderer/dialog.js), never
// the browser's confirm(): it starts on Cancel, Esc cancels, focus goes back to the button that opened it, and
// nothing is deleted until the red button is pressed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, waitFor } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settingsOf = (page) => page.evaluate(() => window.pauli.getSettings());

/** The open dialog: its title, its buttons and which one has focus; null when none is open. */
const openDialog = (page) => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  if (!d) return null;
  return {
    title: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
    described: !!(d.getAttribute('aria-describedby') && document.getElementById(d.getAttribute('aria-describedby'))),
    buttons: [...d.querySelectorAll('button')].map((b) => b.textContent),
    focused: document.activeElement?.dataset.dialog || null,
    modal: d.matches(':modal'),
  };
});

/**
 * Opens a dialog from `trigger`, checks it, presses Esc and checks that focus went back to the trigger.
 * Returns what the dialog showed.
 */
async function openAndEscape(page, trigger) {
  await page.click(trigger);
  const shown = await waitFor(() => openDialog(page), { what: `a dialog from ${trigger}` });
  assert.equal(await page.getByRole('dialog').count(), 1, 'one dialog, with the dialog role');
  assert.equal(shown.modal, true, 'modal: the page behind can not be reached');
  assert.equal(shown.focused, 'cancel', 'a dangerous dialog starts on Cancel');
  assert.equal(shown.described, true, 'the text is tied to the dialog');
  await page.keyboard.press('Escape');
  await waitFor(async () => (await openDialog(page)) === null, { what: 'Esc to close it' });
  await waitFor(() => page.evaluate((sel) => document.activeElement === document.querySelector(sel), trigger), { what: `focus back on ${trigger}`, timeout: 2000 });
  return shown;
}

const confirmOpen = (page) => page.click('dialog[open] [data-dialog="confirm"]');

test('History: Clear history asks, Esc and Cancel keep every transcript, the red button clears them', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  page.on('dialog', () => assert.fail('a native confirm() opened'));
  await sleep(1500);
  await run.set('transcript', 'keep me please');
  await run.dictate();
  await waitFor(async () => (await page.evaluate(() => window.pauli.listHistory())).length === 1, { what: 'a transcript' });
  await page.click('.nav[data-page="history"]');
  await waitFor(() => page.evaluate(() => !document.querySelector('#clear-history').disabled), { what: 'Clear history enabled' });

  const shown = await openAndEscape(page, '#clear-history');
  assert.deepEqual(shown.buttons, ['Clear history', 'Cancel'], 'the red button first, Windows order');
  assert.equal(shown.title, 'Clear your history?');
  assert.equal((await page.evaluate(() => window.pauli.listHistory())).length, 1, 'nothing deleted on Esc');

  await page.click('#clear-history');
  await waitFor(() => openDialog(page), { what: 'the dialog again' });
  await page.click('dialog[open] [data-dialog="cancel"]');
  await waitFor(async () => (await openDialog(page)) === null, { what: 'Cancel to close it' });
  assert.equal((await page.evaluate(() => window.pauli.listHistory())).length, 1, 'nothing deleted on Cancel');

  await page.click('#clear-history');
  await waitFor(() => openDialog(page), { what: 'the dialog a third time' });
  await confirmOpen(page);
  await waitFor(async () => (await page.evaluate(() => window.pauli.listHistory())).length === 0, { what: 'the history cleared' });
});

test('Shortcuts, Modes and Privacy: reset, delete a mode, a history setting that deletes, and delete all data each ask first', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  page.on('dialog', () => assert.fail('a native confirm() opened'));
  // A transcript, so the history setting below has something to delete (with none it doesn't ask).
  await sleep(1500);
  await run.set('transcript', 'keep me please');
  await run.dictate();
  await waitFor(async () => (await page.evaluate(() => window.pauli.listHistory())).length === 1, { what: 'a transcript' });

  // Reset shortcuts: Esc keeps them; the red button resets them.
  await page.click('.nav[data-page="shortcuts"]');
  const before = (await settingsOf(page)).bindings;
  await openAndEscape(page, '#sc-reset');
  assert.deepEqual((await settingsOf(page)).bindings, before);
  await page.click('#sc-reset');
  await waitFor(() => openDialog(page), { what: 'the reset dialog' });
  await confirmOpen(page);
  await waitFor(async () => JSON.stringify((await settingsOf(page)).bindings) !== JSON.stringify(before), { what: 'the shortcuts reset' });

  // Delete a mode: Esc keeps it.
  await page.click('.nav[data-page="modes"]');
  const modes = (await settingsOf(page)).modes.length;
  await page.click('#mode-list li:nth-child(2) .mode-item');
  const shown = await openAndEscape(page, '#mode-detail .mode-head .btn.danger');
  assert.match(shown.title, /^Delete the mode ".+"\?$/);
  assert.equal((await settingsOf(page)).modes.length, modes);
  await page.click('#mode-detail .mode-head .btn.danger');
  await waitFor(() => openDialog(page), { what: 'the mode dialog' });
  await confirmOpen(page);
  await waitFor(async () => (await settingsOf(page)).modes.length === modes - 1, { what: 'the mode deleted' });

  // Privacy: switching to "Don't keep" asks; Esc puts the choice back.
  await page.click('.nav[data-page="settings"]');
  await page.focus('#history-retention'); // selectOption alone changes it without focus, which a person can't
  await page.selectOption('#history-retention', 'off');
  await waitFor(() => openDialog(page), { what: 'the retention dialog' });
  await page.keyboard.press('Escape');
  await waitFor(async () => (await openDialog(page)) === null, { what: 'Esc' });
  // the dialog loses [open] at once and says how it closed a moment later (its close event)
  await waitFor(async () => (await page.inputValue('#history-retention')) === 'keep', { what: 'the choice to go back' });
  assert.equal((await settingsOf(page)).historyRetention, 'keep');
  await waitFor(() => page.evaluate(() => document.activeElement.id === 'history-retention'), { what: 'focus back on the choice', timeout: 2000 });

  // Delete all my data: Esc keeps it all.
  const shownAll = await openAndEscape(page, '#delete-all');
  assert.equal(shownAll.buttons[0], 'Delete everything');
  assert.ok(fs.existsSync(path.join(run.dir, 'settings.json')), 'settings kept');
  assert.equal(await page.locator('#privacy-confirm').count(), 0, 'no inline confirmation any more');
});

test('Settings: deleting one downloaded model or all of them asks first', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  page.on('dialog', () => assert.fail('a native confirm() opened'));
  for (const id of ['onnx-community/whisper-base', 'Xenova/nllb-200-distilled-600M']) {
    const dir = path.join(run.dir, 'models', ...id.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.pauli-ready'), 'x');
    fs.writeFileSync(path.join(dir, 'model.onnx'), Buffer.alloc(4096));
  }
  await page.click('.nav[data-page="settings"]');
  await waitFor(async () => (await page.$$('#model-disk .disk-item')).length === 2, { what: 'the two models' });
  const whisper = path.join(run.dir, 'models', 'onnx-community', 'whisper-base');

  const one = await openAndEscape(page, '#model-disk .disk-item:first-child .icon-btn');
  assert.equal(one.title, 'Delete Whisper Base?');
  assert.ok(fs.existsSync(whisper), 'kept on Esc');

  const all = await openAndEscape(page, '#delete-models');
  assert.equal(all.title, 'Delete downloaded models?');
  assert.ok(fs.existsSync(whisper), 'kept on Esc');

  await page.click('#delete-models');
  await waitFor(() => openDialog(page), { what: 'the models dialog' });
  await confirmOpen(page);
  await waitFor(() => !fs.existsSync(whisper), { what: 'the models deleted' });
});
