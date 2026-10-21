'use strict';
// Home's notices are InfoBars in one place, one at a time: the most important first (src/renderer/notice-queue.js),
// "1 of 3" with ‹ › for the others, a severity icon so it isn't colour alone, ✕ on those that can be dismissed,
// and What's new as one line that opens the notes in a dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, setUpSettings, waitFor, version } = require('./helpers');

const shown = (page) => page.evaluate(() => {
  const bars = [...document.querySelectorAll('#notices .infobar')];
  const bar = bars[0];
  if (!bar) return null;
  return {
    count: bars.length,
    id: bar.dataset.notice,
    severity: bar.dataset.severity,
    title: bar.querySelector('.infobar-title').textContent,
    icon: !!bar.querySelector('.infobar-icon svg'),
    pager: document.querySelector('#notices .infobar-pager')?.textContent ?? null,
    dismiss: !!bar.querySelector('[data-notice-dismiss]'),
  };
});

test('Home shows one notice at a time, the most important first, with 1 of 3 and ‹ ›; ✕ dismisses', async (t) => {
  const run = await launch({ settings: setUpSettings({ setupCard: true, lastSeenVersion: '0.9.0' }) });
  t.after(run.close);
  const { page } = run;
  await waitFor(async () => (await shown(page))?.pager === '1 of 3', { what: 'three notices' });
  assert.deepEqual(await shown(page), {
    count: 1, id: 'model', severity: 'warning', title: 'The speech model is not downloaded yet.', icon: true, pager: '1 of 3', dismiss: false,
  }, 'the missing model first; it can\'t be dismissed');
  assert.equal(await page.locator('#page-home .banner').count(), 0, 'no stacked banners any more');
  assert.equal(await page.isDisabled('#notices [data-notice-step="-1"]'), true, '‹ can\'t go before the first');

  await page.click('#notices [data-notice-step="1"]');
  await waitFor(async () => (await shown(page)).id === 'setup', { what: 'the setup notice' });
  assert.equal((await shown(page)).pager, '2 of 3');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.noticeStep), '1', 'focus stays on ›');
  await page.click('#notices [data-notice-step="1"]');
  await waitFor(async () => (await shown(page)).id === 'whatsNew', { what: 'What\'s new' });
  assert.equal((await shown(page)).title, `What's new in Pauli Speaks ${version}`);
  assert.equal(await page.isDisabled('#notices [data-notice-step="1"]'), true, '› can\'t go past the last');

  // What's new opens the notes in a dialog.
  await page.click('#notices .infobar [data-notice-action]');
  const notes = await waitFor(() => page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return d && { title: d.querySelector('h2').textContent, items: d.querySelectorAll('li').length, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) };
  }), { what: 'the notes' });
  assert.equal(notes.title, `What's new in Pauli Speaks ${version}`);
  assert.ok(notes.items > 0, 'the notes as a list');
  assert.deepEqual(notes.buttons, ['Close'], 'one button: nothing to decide');
  await page.keyboard.press('Escape');
  await waitFor(() => page.evaluate(() => !document.querySelector('dialog[open]')), { what: 'the notes closed' });

  // ✕ dismisses: What's new goes, and the setup card goes for good.
  await page.click('#notices [data-notice-dismiss]');
  await waitFor(async () => (await shown(page)).pager === '1 of 2', { what: 'two left' });
  await page.click('#notices [data-notice-step="1"]');
  await waitFor(async () => (await shown(page)).id === 'setup', { what: 'the setup notice again' });
  await page.click('#notices [data-notice-dismiss]');
  await waitFor(async () => (await page.evaluate(() => window.pauli.getSettings())).setupCard === false, { what: 'the setup card dismissed' });
  await waitFor(async () => (await shown(page)).pager === null, { what: 'one notice: no pager' });
  assert.equal((await shown(page)).id, 'model');
});
