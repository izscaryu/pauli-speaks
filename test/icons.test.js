'use strict';
// Fluent System Icons (MIT), inline: src/renderer/icons.js holds the path of each one the main window uses, and
// the page fills <span data-icon="…"> with it. No icon font, no download, no hand-drawn glyphs (G-20).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ICONS, svg } = require('../src/renderer/icons');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'renderer');

test('each icon is one Fluent path on its own grid', () => {
  for (const [name, icon] of Object.entries(ICONS)) {
    assert.match(icon.viewBox, /^0 0 (12|16|20|24) \1$/, name);
    assert.match(icon.d, /^[Mm][\d.\s,a-zA-Z-]+$/, name);
  }
  assert.ok(Object.keys(ICONS).length >= 20);
});

test('svg(): a decorative icon (hidden from screen readers), filled with the text colour', () => {
  const out = svg('home');
  assert.match(out, /^<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M[^"]+"\/><\/svg>$/);
  assert.match(svg('home', 'filled'), /^<svg class="icon filled" /);
  assert.throws(() => svg('nope'), /unknown icon/);
});

test('the navigation has a regular and a filled icon for each page (filled = the current page)', () => {
  const html = fs.readFileSync(path.join(DIR, 'app.html'), 'utf8');
  const pages = [...html.matchAll(/class="nav[^"]*" data-page="(\w+)"[^>]*><span class="nav-icon" data-icon="([\w-]+)"/g)];
  assert.equal(pages.length, 7, 'every page (About is a section of Settings)');
  for (const [, page, name] of pages) {
    assert.ok(ICONS[name], `${page}: ${name}`);
    assert.ok(ICONS[`${name}-filled`], `${page}: ${name}-filled`);
  }
});

test('every data-icon in the page and every Icons.svg() in the scripts names an icon that exists', () => {
  const missing = [];
  for (const file of fs.readdirSync(DIR).filter((f) => /\.(html|js)$/.test(f) && f !== 'icons.js' && f !== 'overlay.js')) {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    for (const m of text.matchAll(/data-icon="([\w-]+)"|data-icon': '([\w-]+)'|Icons\.svg\('([\w-]+)'/g)) {
      const name = m[1] || m[2] || m[3];
      if (!ICONS[name]) missing.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('no hand-drawn icons are left in the main window', () => {
  const drawn = [];
  for (const file of ['app.html', 'app.js', 'history-audio.js', 'modes.js', 'privacy.js', 'home-notices.js']) {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    if (/<svg[\s>]/.test(text)) drawn.push(file);
  }
  assert.deepEqual(drawn, []);
});

test('THIRD_PARTY_NOTICES.md credits Fluent UI System Icons and its MIT licence', () => {
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /Fluent UI System Icons[\s\S]{0,200}MIT License/);
  assert.match(fs.readFileSync(path.join(DIR, 'icons.js'), 'utf8'), /Copyright \(c\) [\d-]+ Microsoft Corporation/);
});
