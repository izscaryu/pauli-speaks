'use strict';
// The shared components (plan §7.3): the switch, the segmented control, tooltips and keycaps, and that every
// control keeps an edge in a Windows contrast theme, on every page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, openSettings } = require('./helpers');

const PAGES = ['home', 'shortcuts', 'modes', 'dictionary', 'history', 'files', 'settings'];

/**
 * Opens each page, and each section of Settings (one shows at a time), with everything folded away opened, and
 * collects what `check(pageId)` finds on each.
 */
async function eachView(page, check) {
  const out = [];
  const unfold = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  for (const id of PAGES) {
    await page.click(`.nav[data-page="${id}"]`);
    await unfold();
    if (id !== 'settings') {
      out.push(...await check(id));
      continue;
    }
    for (const section of await page.$$eval('.settings-nav a[data-section]', (as) => as.map((a) => a.dataset.section))) {
      await openSettings(page, section);
      await unfold();
      out.push(...await check(id));
    }
  }
  return out;
}

/** Opens the Settings section that holds the element with this id (settings-search.js), unfolding it. */
const openSetting = (page, id) => page.evaluate((x) => window.SettingsSearch.jump(x), id);

test('a Windows contrast theme: every switch, button, field and segment keeps an edge on every page', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const invisible = await eachView(page, (id) => page.evaluate((pageId) => {
    const out = [];
    const sel = '.switch span, .btn, input:not([type=checkbox], [type=radio], [type=range], [type=file]), select, textarea, .segmented, .key';
    for (const node of document.querySelectorAll(`#page-${pageId} :is(${sel})`)) {
      if (!node.getClientRects().length) continue; // not on screen (hidden rows, closed sections)
      const s = getComputedStyle(node);
      const edges = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`]) > 0);
      if (edges.length < 4) out.push(`${pageId}: ${node.tagName.toLowerCase()}.${node.className || ''} has edges ${edges.join(',') || 'none'}`);
    }
    // the chosen segment says so without colour: its line is drawn in the system highlight
    for (const b of document.querySelectorAll(`#page-${pageId} .segmented [aria-checked="true"]`)) {
      if (!b.getClientRects().length) continue;
      const line = getComputedStyle(b, '::after');
      if (line.content === 'none' || line.backgroundColor === 'rgba(0, 0, 0, 0)') out.push(`${pageId}: the chosen segment "${b.textContent}" has no line`);
    }
    return out;
  }, id));
  assert.deepEqual([...new Set(invisible)], []);
});

test('the switch: 40 × 20, an outline when off, a filled track with a white knob when on', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('.nav[data-page="settings"]');
  await openSetting(page, 'text'); // Speech & microphone › Text clean-up
  const sw = '.switch:has(input[data-setting="removeFillers"])';
  const look = () => page.evaluate((s) => {
    const box = document.querySelector(s).getBoundingClientRect();
    const track = getComputedStyle(document.querySelector(`${s} span`));
    const knob = getComputedStyle(document.querySelector(`${s} span`), '::after');
    return { w: box.width, h: box.height, fill: track.backgroundColor, edge: track.borderTopWidth, knob: knob.backgroundColor, knobW: knob.width, on: document.querySelector(`${s} input`).checked };
  }, sw);
  const first = await look();
  assert.deepEqual([first.w, first.h], [40, 20]);
  await page.click(sw);
  await waitFor(async () => (await look()).on !== first.on, { what: 'the switch to flip' });
  await page.mouse.move(0, 0); // no hover: the knob grows on hover
  const [off, on] = first.on ? [await look(), first] : [first, await look()];
  assert.equal(off.fill, 'rgba(0, 0, 0, 0)', 'off: no fill');
  assert.ok(parseFloat(off.edge) > 0, 'off: an outline'); // 1 px, which reads 0.8 px at 125 % display scaling
  assert.equal(off.knobW, '12px');
  assert.notEqual(on.fill, 'rgba(0, 0, 0, 0)', 'on: a filled track');
  assert.equal(on.knob, 'rgb(255, 255, 255)', 'on: a white knob');
  assert.equal(on.knobW, '14px');
});

test('the segmented control is a radio group: arrow keys move the choice, and it is saved', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.click('.nav[data-page="settings"]');
  await openSetting(page, 'speech');
  const state = () => page.$$eval('#accel button', (bs) => bs.map((b) => `${b.dataset.accel}:${b.getAttribute('role')}:${b.getAttribute('aria-checked')}:${b.tabIndex}`));
  assert.equal(await page.getAttribute('#accel', 'role'), 'radiogroup');
  assert.deepEqual(await state(), ['auto:radio:true:0', 'cpu:radio:false:-1'], 'only the chosen one is in the Tab order');
  await page.focus('#accel button[data-accel="auto"]');
  await page.keyboard.press('ArrowRight');
  await waitFor(async () => (await state()).join() === 'auto:radio:false:-1,cpu:radio:true:0', { what: 'CPU only chosen' });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.accel), 'cpu', 'focus moves with the choice');
  await waitFor(async () => (await page.evaluate(() => window.pauli.getSettings())).acceleration === 'cpu', { what: 'the choice saved' });
  await page.keyboard.press('ArrowLeft');
  await waitFor(async () => (await state())[0] === 'auto:radio:true:0', { what: 'GPU chosen again' });
});

test('a tooltip names an icon button after a moment on hover, at once on keyboard focus, and Esc hides it', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  await page.click('.nav[data-page="shortcuts"]');
  await page.evaluate(() => { document.getElementById('remote-links').closest('details').open = true; }); // folded away
  const button = page.locator('#remote-links .icon-btn').first();
  const tip = () => page.evaluate(() => {
    const node = document.querySelector('[role="tooltip"]');
    return node && !node.hidden ? node.textContent : null;
  });
  assert.equal(await button.getAttribute('title'), null, 'no native tooltip as well');
  await button.hover();
  assert.equal(await tip(), null, 'not at once on hover');
  await waitFor(tip, { what: 'the tooltip on hover', timeout: 4000 }); // a slow run can take longer than the delay
  assert.equal(await tip(), 'Copy');
  await page.mouse.move(0, 0);
  await waitFor(async () => (await tip()) === null, { what: 'the tooltip gone' });

  await button.focus(); // then away and back with the keyboard, so it is keyboard focus
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await waitFor(tip, { what: 'the tooltip on keyboard focus', timeout: 400 });
  await page.keyboard.press('Escape');
  await waitFor(async () => (await tip()) === null, { what: 'Esc hides it' });
});

test('keycaps press down on Home while you talk', async (t) => {
  const run = await launch();
  t.after(run.close);
  const pressed = () => run.page.$$eval('#ptt-chips .key', (ks) => ks.map((k) => k.classList.contains('pressed')));
  assert.deepEqual(await pressed(), [false]);
  const during = await run.dictate('F13', { during: pressed });
  assert.deepEqual(during, [true]);
  await waitFor(async () => (await pressed()).join() === 'false', { what: 'the keycap back up' });
});

test('hit areas: icon buttons are 32 px or more on every page, a chip\'s ✕ 24 px; checked radios and boxes are accent', async (t) => {
  const run = await launch();
  t.after(run.close);
  const { page } = run;
  const small = await eachView(page, (id) => page.evaluate((pageId) => {
    const out = [];
    for (const [sel, min] of [['.icon-btn', 32], ['.phrase button, .app-chip button', 24]]) {
      for (const b of document.querySelectorAll(`#page-${pageId} :is(${sel})`)) {
        const r = b.getBoundingClientRect();
        if (r.width && (r.width < min || r.height < min)) out.push(`${pageId}: ${b.className || b.tagName} ${r.width}×${r.height}`);
      }
    }
    return out;
  }, id));
  assert.deepEqual(small, []);
  await page.click('.nav[data-page="settings"]');
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { want, radio: getComputedStyle(document.querySelector('.model input[type=radio]')).accentColor };
  });
  assert.equal(accent.radio, accent.want);
});
