'use strict';
// Every page fits the window: at 900 and 1280 px wide, light and dark, nothing runs past the right edge of the
// content (a control cut off there can't be reached; main used to hide that overflow).
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, setUpSettings, waitFor } = require('./helpers');

const MODES = [
  { id: 'default' },
  { id: 'email', name: 'Email in English', style: 'formal', translateTo: 'en', apps: ['outlook.exe', 'winword.exe'], aiPolish: 'medium' },
  { id: 'code', style: 'code', apps: ['code.exe'] },
];

async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows().find((x) => /\/app\.html(\?|$)/.test(x.webContents.getURL()));
    win.setContentSize(w, h);
  }, [width, height]);
}

/** What sticks out of main on the page that shows: main's own scroll width, and each control past its right edge. */
const overflow = (page) => page.evaluate(() => {
  const main = document.querySelector('main');
  const box = main.getBoundingClientRect();
  const right = box.left + main.clientLeft + main.clientWidth; // the content's edge, not counting the scrollbar
  // A control inside a strip that scrolls sideways on purpose (the mode list on a narrow window) may be out of view.
  const scrolls = (node) => {
    for (let p = node.parentElement; p && p !== main; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
    return false;
  };
  const out = [...main.querySelectorAll('select, input, button, textarea, a, .key')]
    .filter((n) => n.offsetParent !== null && n.getClientRects().length && !scrolls(n))
    .filter((n) => n.getBoundingClientRect().right > right + 0.5)
    .map((n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''} "${(n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 30)}" ends at ${Math.round(n.getBoundingClientRect().right)} > ${Math.round(right)}`);
  return { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth, out };
});

test('every page fits at 900 and 1280 px wide, in light and dark', async (t) => {
  const run = await launch({ settings: setUpSettings({ modes: MODES }) });
  t.after(run.close);
  const { app, page } = run;
  const pages = await page.$$eval('.nav[data-page]', (navs) => navs.map((n) => n.dataset.page));
  assert.ok(pages.length >= 8, `${pages.length} pages`);
  const problems = [];
  for (const width of [900, 1280]) {
    await resize(app, width, 800);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const id of pages) {
        await page.click(`.nav[data-page="${id}"]`);
        await waitFor(() => page.evaluate((pid) => !document.getElementById(`page-${pid}`).hidden, id), { what: `the ${id} page` });
        if (id === 'modes') await page.click('.mode-item:has-text("Email in English")'); // the fullest editor
        await page.waitForTimeout(250); // the page's entrance and the window's new size settle
        const o = await overflow(page);
        if (o.scrollWidth > o.clientWidth) problems.push(`${width} ${scheme} ${id}: main scrolls sideways (${o.scrollWidth} > ${o.clientWidth})`);
        for (const line of o.out) problems.push(`${width} ${scheme} ${id}: ${line}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
