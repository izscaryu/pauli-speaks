'use strict';
// The UI language: switching to Hrvatski in Settings reloads the window in Croatian (on the same page), and the
// pill, which never reloads, speaks Croatian from then on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, setUpSettings, waitFor } = require('./helpers');

test('Settings → App language → Hrvatski: the window and the pill switch to Croatian', async (t) => {
  const settings = setUpSettings();
  settings.bindings.push({ id: 'pasteLast-1', action: 'pasteLast', keys: ['F14'] });
  const run = await launch({ settings });
  t.after(run.close);
  const { page } = run;

  await page.locator('button.nav[data-page="settings"]').click();
  assert.equal(await page.locator('button.nav[data-page="settings"]').textContent(), 'Settings');
  await page.locator('#ui-language').selectOption('hr');

  await waitFor(() => page.evaluate(() => document.documentElement.lang === 'hr' && !document.querySelector('#page-settings').hidden).catch(() => false), { what: 'the window in Croatian' });
  assert.equal((await page.locator('button.nav[data-page="settings"]').textContent()).trim(), 'Postavke');
  assert.equal(await page.locator('#ui-language').inputValue(), 'hr');
  assert.equal(JSON.parse(fs.readFileSync(path.join(run.dir, 'settings.json'), 'utf8')).uiLanguage, 'hr');

  // Nothing dictated yet: Paste last says so on the pill, in Croatian.
  const pill = await waitFor(() => run.app.windows().find((w) => w.url().endsWith('overlay.html')), { what: 'the pill' });
  await run.key('F14', true);
  await run.key('F14', false);
  const said = await waitFor(async () => {
    const text = await pill.locator('#label').textContent();
    return text ? text : null;
  }, { what: 'the pill message' });
  assert.equal(said, 'Još nema ničega za zalijepiti');
  assert.equal(await pill.evaluate(() => document.documentElement.lang), 'hr');
});

/** Text or attributes on the page that are a translation key: a string the locale file is missing. */
const KEYS = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'locales', 'en.json'), 'utf8')));
const rawKeys = (page) => page.evaluate((keys) => {
  const known = new Set(keys);
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (known.has(n.textContent.trim())) out.push(n.textContent.trim());
  for (const el of document.querySelectorAll('[placeholder], [title], [aria-label]')) {
    for (const a of ['placeholder', 'title', 'aria-label']) if (known.has(el.getAttribute(a))) out.push(el.getAttribute(a));
  }
  return out;
}, KEYS);

test('no page shows a raw translation key, in English or in Croatian', async (t) => {
  for (const uiLanguage of ['en', 'hr']) {
    const run = await launch({ settings: setUpSettings({ uiLanguage }) });
    try {
      for (const nav of ['home', 'shortcuts', 'files', 'dictionary', 'settings', 'about']) {
        await run.page.locator(`button.nav[data-page="${nav}"]`).click();
        assert.deepEqual(await rawKeys(run.page), [], `${uiLanguage}: ${nav}`);
      }
    } finally {
      await run.close();
    }
  }
});
