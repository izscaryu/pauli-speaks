'use strict';
// One type ramp (Segoe UI Variable): six sizes in tokens.css, and app.css and overlay.css use only those, in
// sentence case. It replaced fourteen sizes from 11 to 28 px and uppercase tracked headings (G-01, G-02).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'renderer');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = (css, prop) => [...css.matchAll(new RegExp(`(?<![\w-])${prop}\s*:\s*([^;{}]+)`, 'g'))].map((m) => m[1].trim());

test('tokens.css: six sizes, caption 12 to display 40', () => {
  const sizes = [...read('tokens.css').matchAll(/--fs-[\w-]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.deepEqual(sizes, [12, 14, 18, 20, 28, 40]);
});

for (const file of ['app.css', 'overlay.css']) {
  test(`${file}: every size comes from the ramp, every font from a token`, () => {
    const css = read(file);
    const off = [
      ...declarations(css, 'font-size').filter((v) => !/^var\(--fs-[\w-]+\)$|^inherit$/.test(v)).map((v) => `font-size: ${v}`),
      ...declarations(css, 'font').filter((v) => v !== 'inherit' && !/^var\(--t-[\w-]+\)$/.test(v)
        && !/^(\d{3} )?var\(--fs-[\w-]+\)(\/[\d.]+(px)?)? var\(--(font|font-display|mono)\)$/.test(v)).map((v) => `font: ${v}`),
      ...declarations(css, 'font-family').filter((v) => !/^var\(--(font|font-display|mono)\)$|^inherit$/.test(v)).map((v) => `font-family: ${v}`),
    ];
    assert.deepEqual(off, []);
  });
}

test('app.css: headings in sentence case, two weights', () => {
  const css = read('app.css');
  assert.deepEqual(declarations(css, 'text-transform').filter((v) => v !== 'none'), [], 'no uppercase labels');
  assert.deepEqual(declarations(css, 'letter-spacing').filter((v) => v !== '0'), [], 'no tracking');
  assert.deepEqual([...new Set(declarations(css, 'font-weight'))].filter((w) => !['400', '600', 'inherit'].includes(w)), []);
});
