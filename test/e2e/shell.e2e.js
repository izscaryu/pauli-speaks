'use strict';
// The Windows 11 shell: the navigation (History has its own page, Home shows the recent dictations) and the
// Settings search that keeps only the rows that match.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, setUpSettings, waitFor } = require('./helpers');

const visiblePanels = (page) => page.evaluate(() => [...document.querySelectorAll('#page-settings > section.panel')]
  .filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.querySelector('h2').textContent));

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
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#page-settings section.panel .row')].filter((r) => r.offsetParent !== null).length), 1);

  await page.fill('#settings-search', 'nothing like this');
  await waitFor(() => page.evaluate(() => !document.querySelector('#page-settings > .empty').hidden), { what: 'the no-match note' });

  const ownHidden = () => page.evaluate(() => [document.getElementById('model-disk-row').hidden, document.getElementById('tr-model-row').hidden]);
  const before = await ownHidden();
  await page.press('#settings-search', 'Escape');
  assert.deepEqual(await visiblePanels(page), all);
  assert.deepEqual(await ownHidden(), before, 'rows hidden by their own code stay hidden after a search');
});

test('Home says a model is needed before one is downloaded, and Files can be opened from the keyboard', async (t) => {
  const run = await launch(); // a fresh data folder: no speech model on disk
  t.after(run.close);
  const { page } = run;
  await waitFor(async () => (await page.textContent('#live-text')) === 'Model needed', { what: '"Model needed" on Home' });
  assert.match(await page.getAttribute('#live', 'class'), /\bwarn\b/, 'shown as a warning, not as ready');

  await page.click('.nav[data-page="files"]'); // focuses the page heading
  let reached = false;
  for (let i = 0; i < 5 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'file-choose');
  }
  assert.ok(reached, 'Tab reaches "Choose file…"');
  assert.equal(await page.textContent('#file-choose'), 'Choose file…');
});

test('History has its own page; Home shows the latest dictations and links to it', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await new Promise((r) => setTimeout(r, 1500));
  await run.set('transcript', 'testing the history page');
  await run.dictate();
  await waitFor(() => page.evaluate(() => document.querySelector('#recent').textContent.includes('Testing the history page')), { what: 'Recent on Home' });
  await page.click('#page-home [data-go="history"]');
  await waitFor(() => page.evaluate(() => !document.getElementById('page-history').hidden), { what: 'the History page' });
  assert.match(await page.locator('#history').textContent(), /Testing the history page/);
});

test('the pill: its language chip picks the language for this dictation, and a dropped pill stays on that side', async (t) => {
  const run = await launch({ settings: setUpSettings({ languages: ['hr', 'en'] }) });
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  const pill = await waitFor(() => run.app.windows().find((w) => w.url().endsWith('overlay.html')), { what: 'the pill' });
  await run.dictate('F13', { ms: 1600, during: async () => {
    await waitFor(() => pill.evaluate(() => !document.getElementById('lang').hidden), { what: 'the language chip' });
    assert.equal(await pill.locator('#lang').textContent(), 'Auto');
    await pill.click('#lang');
    await waitFor(async () => (await pill.locator('#lang').textContent()) === 'HR', { what: 'HR on the chip' });
  } });
  const state = await waitFor(async () => { const s = await run.state(); return s.recognised.length ? s : null; }, { what: 'the transcription' });
  assert.deepEqual(state.recognised[0].languages, ['hr']);

  await pill.evaluate(() => window.pauli.pillMoved(5));
  await waitFor(async () => (await run.page.evaluate(() => window.pauli.getSettings())).pillPosition === 'left', { what: 'the pill on the left' });
});

test('accessibility: keyboard navigation names the current page, contrast themes and reduced motion are respected', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.focus('.nav[data-page="history"]');
  await page.keyboard.press('Enter');
  await waitFor(() => page.evaluate(() => document.activeElement && document.activeElement.closest('#page-history') && document.activeElement.tagName === 'H1'), { what: 'focus on the History heading' });
  assert.equal(await page.getAttribute('.nav[data-page="history"]', 'aria-current'), 'page');
  assert.equal(await page.getAttribute('.nav[data-page="home"]', 'aria-current'), null);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#page-history')).animationDuration) < 0.01), 'no page animation');

  await page.emulateMedia({ forcedColors: 'active' });
  const border = await page.evaluate(() => getComputedStyle(document.querySelector('.nav[data-page="history"]')).outlineStyle);
  assert.notEqual(border, 'none', 'the current page is outlined in a contrast theme');
});
