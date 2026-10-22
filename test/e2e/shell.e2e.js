'use strict';
// The Windows 11 shell: the navigation (History has its own page, Home shows the recent dictations) and the
// Settings search that keeps only the rows that match.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, setUpSettings, waitFor } = require('./helpers');

/** The Settings cards on screen, by their titles. */
const visiblePanels = (page) => page.evaluate(() => [...document.querySelectorAll('#page-settings .settings-section > .panel')]
  .filter((p) => p.getClientRects().length).map((p) => p.querySelector('h3').textContent));

test('Settings search looks through every section and the other pages, and Esc brings the section back', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.click('.nav[data-page="settings"]');
  assert.equal(await page.locator('.settings-nav a[data-section]').count(), 8, 'eight sections');
  const general = await visiblePanels(page);
  assert.deepEqual(general, ['Appearance', 'Language', 'Behavior'], 'one section at a time: General first');

  await page.fill('#settings-search', 'filler');
  assert.deepEqual(await visiblePanels(page), ['Text clean-up'], 'found in Speech & microphone, and unfolded');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#page-settings .settings-section .row')].filter((r) => r.offsetParent !== null).length), 1);

  await page.fill('#settings-search', 'read aloud');
  await waitFor(() => page.evaluate(() => !document.getElementById('settings-other').hidden), { what: 'results on other pages' });
  assert.match(await page.textContent('#settings-other-list'), /Shortcuts › Read aloud/);

  await page.fill('#settings-search', 'nothing like this');
  await waitFor(() => page.evaluate(() => !document.getElementById('settings-none').hidden), { what: 'the no-match note' });

  const ownHidden = () => page.evaluate(() => [document.getElementById('cloud-settings').hidden, document.getElementById('tr-model-row').hidden]);
  const before = await ownHidden();
  await page.press('#settings-search', 'Escape');
  assert.deepEqual(await visiblePanels(page), general);
  assert.deepEqual(await ownHidden(), before, 'rows hidden by their own code stay hidden after a search');
});

test('each Settings section opens on its own and takes the focus; a jump to a card brings it to the top', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.emulateMedia({ reducedMotion: 'reduce' }); // a jump without the smooth scroll, so it can be measured at once
  await page.click('.nav[data-page="settings"]');
  const sections = await page.$$eval('.settings-nav a[data-section]', (as) => as.map((a) => a.dataset.section));
  const wrong = [];
  for (const name of sections) {
    await page.click(`.settings-nav a[data-section="${name}"]`);
    const seen = await page.evaluate(() => ({
      shown: [...document.querySelectorAll('.settings-section')].filter((s) => s.getClientRects().length).map((s) => s.dataset.section),
      focused: document.activeElement.classList.contains('section-title') ? document.activeElement.closest('.settings-section').dataset.section : null,
    }));
    if (seen.shown.join() !== name || seen.focused !== name) wrong.push(`${name}: shows ${seen.shown.join()}, focus on ${seen.focused}`);
  }
  assert.deepEqual(wrong, []);

  // The pill's "Choose mic" and the sidebar's status jump to one card: its heading at the top, and focused.
  await page.evaluate(() => window.SettingsSearch.jump('microphone'));
  const where = await waitFor(() => page.evaluate(() => {
    const heading = document.querySelector('#microphone h3');
    const top = heading.getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top;
    return document.activeElement === heading ? { top: Math.round(top) } : null;
  }), { what: 'the Microphone heading focused' });
  assert.ok(where.top >= 0 && where.top <= 24, `heading at ${where.top} px`);

  // A segmented control says which choice is on, to a screen reader too (a radio group, aria-checked).
  await page.click('#accel button[data-accel="cpu"]');
  await waitFor(async () => (await page.getAttribute('#accel button[data-accel="cpu"]', 'aria-checked')) === 'true', { what: 'CPU only checked' });
  assert.equal(await page.getAttribute('#accel button[data-accel="auto"]', 'aria-checked'), 'false');
});

test('the pill: a blocked or missing microphone gets a short message and a button that fixes it', async (t) => {
  const run = await launch();
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500));
  const pill = await waitFor(() => run.app.windows().find((w) => w.url().endsWith('overlay.html')), { what: 'the pill' });
  const shown = () => pill.evaluate(() => ({
    label: document.getElementById('label').textContent,
    action: document.getElementById('action').hidden ? null : document.getElementById('action').textContent,
    tip: document.getElementById('tip').hidden ? null : document.getElementById('tip').textContent,
    warn: document.getElementById('pill').classList.contains('warn'),
    fits: document.getElementById('label').scrollWidth <= document.getElementById('label').clientWidth,
  }));
  await pill.evaluate(() => window.pauli.sendRecorderError({ problem: 'blocked' }));
  await waitFor(async () => (await shown()).action, { what: 'the blocked message' });
  const blocked = await shown();
  assert.deepEqual({ ...blocked, tip: !!blocked.tip }, { label: 'Microphone blocked', action: 'Open settings', tip: true, warn: true, fits: true });

  await pill.evaluate(() => window.pauli.sendRecorderError({ problem: 'notFound' }));
  await waitFor(async () => (await shown()).label === 'No microphone found', { what: 'the not-found message' });
  assert.equal((await shown()).action, 'Choose mic');
  assert.equal((await shown()).fits, true, 'the message is not cut off');
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

test('Settings › General › Theme: Dark and Light switch the window and the pill, and are kept', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await new Promise((r) => setTimeout(r, 1500)); // the pill window is up
  const pill = await waitFor(() => run.app.windows().find((w) => w.url().endsWith('overlay.html')), { what: 'the pill' });
  const dark = (w) => w.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  // Playwright pins prefers-color-scheme to light on the windows it drives: let them follow the app again.
  for (const w of [page, pill]) await w.emulateMedia({ colorScheme: null });
  await page.click('.nav[data-page="settings"]'); // General opens first
  assert.equal(await page.getAttribute('#theme button[data-theme="system"]', 'aria-checked'), 'true', 'System until you choose');

  await page.click('#theme button[data-theme="dark"]');
  await waitFor(async () => (await dark(page)) && (await dark(pill)), { what: 'the window and the pill dark' });
  assert.equal((await page.evaluate(() => window.pauli.getSettings())).theme, 'dark');

  await page.click('#theme button[data-theme="light"]');
  await waitFor(async () => !(await dark(page)) && !(await dark(pill)), { what: 'the window and the pill light' });
  assert.equal(await page.getAttribute('#theme button[data-theme="light"]', 'aria-checked'), 'true');
});
