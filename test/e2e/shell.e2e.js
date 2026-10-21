'use strict';
// The Windows 11 shell: the navigation (History has its own page, Home shows the recent dictations) and the
// Settings search that keeps only the rows that match.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor } = require('./helpers');

const visiblePanels = (page) => page.evaluate(() => [...document.querySelectorAll('#page-settings > section.panel')]
  .filter((p) => !p.hidden).map((p) => p.querySelector('h2').textContent));

test('Settings search keeps the sections and rows that match, and Esc brings everything back', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.click('.nav[data-page="settings"]');
  const all = await visiblePanels(page);
  assert.ok(all.length >= 8, `${all.length} sections`);
  assert.equal(await page.locator('.settings-sections a').count(), all.length, 'one link per section');

  await page.fill('#settings-search', 'filler');
  assert.deepEqual(await visiblePanels(page), ['Text']);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#page-settings section.panel:not([hidden]) .row')].filter((r) => !r.hidden).length), 1);

  await page.fill('#settings-search', 'nothing like this');
  await waitFor(() => page.evaluate(() => !document.querySelector('#page-settings > .empty').hidden), { what: 'the no-match note' });

  await page.press('#settings-search', 'Escape');
  assert.deepEqual(await visiblePanels(page), all);
});

test('History has its own page; Home shows the latest dictations and links to it', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'testing the history page');
  await run.key('F13', true);
  await new Promise((r) => setTimeout(r, 1500));
  await run.key('F13', false);
  await waitFor(() => page.evaluate(() => document.querySelector('#recent').textContent.includes('Testing the history page')), { what: 'Recent on Home' });
  await page.click('#page-home [data-go="history"]');
  await waitFor(() => page.evaluate(() => !document.getElementById('page-history').hidden), { what: 'the History page' });
  assert.match(await page.locator('#history').textContent(), /Testing the history page/);
});
