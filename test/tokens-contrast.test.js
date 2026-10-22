'use strict';
// src/renderer/tokens.css holds every colour the windows use; app.css and overlay.css only name its tokens.
// The text and edge pairs below are measured in both themes with the WCAG 2.x formula, so a token change that
// drops a pair under 4.5:1 (text) or 3:1 (the edges that show a control and its state) fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'renderer');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = read('tokens.css');

/** The custom properties of one block of declarations. */
function props(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** The first `:root { … }`, the light theme, and the dark one on top of it. */
function themes() {
  const light = props(/^\s*:root\s*\{([^}]*)\}/m.exec(TOKENS)[1]);
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(TOKENS);
  assert.ok(dark, 'tokens.css has a dark block');
  return { light, dark: { ...light, ...props(dark[1]) } };
}

function resolve(theme, value, depth = 0) {
  assert.ok(depth < 10, `var() loop at ${value}`);
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!m) return value.trim();
  assert.ok(theme[m[1]], `${m[1]} is defined`);
  return resolve(theme, theme[m[1]], depth + 1);
}

/** [r, g, b, a] from #rgb, #rrggbb, rgb() or rgba(). */
function rgba(value) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  assert.ok(m, `a colour: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/** A see-through colour laid over an opaque one. */
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);

function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * fg on bg. Each is a token, a colour, or [colour, what it lies on] for a see-through one (nested as deep as
 * needed: a chip on the pill over the desktop is [chip, [pill, desktop]]).
 */
function measure(theme, fg, bg) {
  const colour = (v) => (Array.isArray(v) ? over(colour(v[0]), colour(v[1])) : rgba(resolve(theme, v.startsWith('--') ? `var(${v})` : v)));
  const back = colour(bg);
  return ratio(over(colour(fg), back), back);
}

const TEXT = 4.5;
const EDGE = 3; // WCAG 1.4.11: the parts of a control that show what it is and its state

// [foreground, background, minimum, what]
const BOTH = [
  ['--ink', '--bg-base', TEXT, 'body text on the window'],
  ['--ink', '--card', TEXT, 'body text on a card'],
  ['--ink-2', '--card', TEXT, 'secondary text on a card'],
  ['--ink-2', '--bg-layer', TEXT, 'secondary text on the page'],
  ['--ink-2', '--bg-base', TEXT, 'navigation labels'],
  ['--ink-2', '--sunken', TEXT, 'a neutral badge'],
  ['--ink-3', '--card', TEXT, 'captions and placeholders on a card'],
  ['--ink-3', '--bg-layer', TEXT, 'captions on the page'],
  ['--ink-3', '--bg-base', TEXT, 'captions on the window'],
  ['--accent', '--bg-base', TEXT, 'a link on the window'],
  ['--accent', '--bg-layer', TEXT, 'a link on the page'],
  ['--accent', '--card', TEXT, 'a link on a card'],
  ['--accent', '--accent-soft', TEXT, 'a selected chip'],
  ['--on-primary', '--ink', TEXT, 'a primary button'],
  ['--on-color', '--danger-fill', TEXT, 'a danger button'],
  ['--danger', '--card', TEXT, 'an error message'],
  ['--danger', '--danger-soft', TEXT, 'an error InfoBar'],
  ['--live-ink', '--live-soft', TEXT, 'the Listening status'],
  ['--ok', '--ok-soft', TEXT, 'the Ready status'],
  ['--ok', '--card', TEXT, 'a "ready" state on a card'],
  ['--warn', '--warn-soft', TEXT, 'a warning InfoBar and status'],
  ['--warn', '--card', TEXT, 'a "busy" state on a card'],
  ['--info', '--info-soft', TEXT, 'an information InfoBar'],
  ['--ink', '--key-top', TEXT, 'a keycap'],
  ['--stroke-strong', '--card', EDGE, 'a switch, field edge or checkbox on a card'],
  ['--stroke-strong', '--bg-layer', EDGE, 'a dashed zone on the page'],
  ['--accent', '--card', EDGE, 'the selected-segment line and a field in focus'],
  ['--focus', '--card', EDGE, 'the focus ring on a card'],
  ['--focus', '--bg-base', EDGE, 'the focus ring on the window'],
  ['--on-color', '--toggle-on', EDGE, 'the knob of a switch that is on'],
  ['--ink-2', '--card', EDGE, 'the knob of a switch that is off'],
  // Mica: the material can show a desktop of the other brightness through it (G-25).
  ['--ink-2', ['--mica-layer', '#ffffff'], TEXT, 'secondary text on Mica over a white desktop'],
  ['--ink-2', ['--mica-layer', '#000000'], TEXT, 'secondary text on Mica over a black desktop'],
  ['--ink-2', ['--mica-side', '#ffffff'], TEXT, 'navigation on Mica over a white desktop'],
  ['--ink-2', ['--mica-side', '#000000'], TEXT, 'navigation on Mica over a black desktop'],
];
const LIGHT_ONLY = [
  ['--key-edge', '--card', EDGE, 'a keycap edge'], // in dark the keycap is lighter than the card, which shows it
];
// The pill follows the theme (light or dark) and floats over any desktop.
const PILL = [
  ['--pill-ink', '--pill-bg', TEXT, 'pill text'],
  ['--pill-muted', '--pill-bg', TEXT, 'pill secondary text'],
  ['--pill-warn', '--pill-bg', TEXT, 'a pill warning'],
  ['--pill-danger', '--pill-bg', TEXT, 'a pill error'],
];

for (const [name, theme] of Object.entries(themes())) {
  test(`tokens.css ${name}: text 4.5:1 and control edges 3:1 or more`, () => {
    const low = [];
    for (const [fg, bg, min, what] of [...BOTH, ...(name === 'light' ? LIGHT_ONLY : [])]) {
      const r = measure(theme, fg, bg);
      if (r < min) low.push(`${what}: ${fg} on ${JSON.stringify(bg)} is ${r.toFixed(2)}:1 (needs ${min})`);
    }
    assert.deepEqual(low, []);
  });
}

test('tokens.css pill: text 4.5:1 or more over a white and a black desktop, on the pill and on a chip, in both themes', () => {
  const low = [];
  for (const [name, theme] of Object.entries(themes())) {
    for (const desktop of ['#ffffff', '#000000']) {
      for (const [fg, bg, min, what] of PILL) {
        for (const [back, where] of [[[bg, desktop], 'the pill'], [['--pill-chip', [bg, desktop]], 'a chip']]) {
          const r = measure(theme, fg, back);
          if (r < min) low.push(`${name}: ${what} on ${where} over ${desktop}: ${r.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(low, []);
});

test('tokens.css pill: it follows the theme, light in the light theme and dark in the dark one', () => {
  const { light, dark } = themes();
  const bg = (theme) => luminance(over(rgba(resolve(theme, theme['--pill-bg'])), [128, 128, 128, 1]));
  assert.ok(bg(light) > 0.6, 'a light pill');
  assert.ok(bg(dark) < 0.1, 'a dark pill');
});

test('the measuring itself: black on white is 21:1, a colour on itself 1:1', () => {
  const { light } = themes();
  assert.equal(Math.round(measure(light, '#000000', '#ffffff')), 21);
  assert.equal(measure(light, '--ink', '--ink'), 1);
  assert.equal(Number(measure(light, '#777777', '#ffffff').toFixed(2)), 4.48);
  assert.equal(Number(measure(light, 'rgba(0, 0, 0, 0.5)', '#ffffff').toFixed(2)), 3.98, 'half-black over white is #808080');
});

for (const file of ['app.css', 'overlay.css']) {
  test(`${file} names tokens only: no colour of its own`, () => {
    const raw = [];
    for (const m of read(file).matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(m[2])) raw.push(`${m[1]}: ${m[2].trim()}`);
    }
    assert.deepEqual(raw, []);
  });

  test(`${file}: every var() it uses is defined`, () => {
    const css = read(file);
    const defined = new Set([...TOKENS.matchAll(/(--[\w-]+)\s*:/g), ...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !defined.has(v));
    assert.deepEqual(missing, []);
  });
}

test('the scripts colour things with tokens too, and only ones that exist', () => {
  const defined = new Set([...TOKENS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = [];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(DIR, file), 'utf8').matchAll(/var\((--[\w-]+)\)/g)) {
      if (!defined.has(m[1])) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('app.html and overlay.html load tokens.css before their own stylesheet', () => {
  for (const [html, own] of [['app.html', 'app.css'], ['overlay.html', 'overlay.css']]) {
    const text = fs.readFileSync(path.join(DIR, html), 'utf8');
    const tokens = text.indexOf('href="tokens.css"');
    assert.ok(tokens > 0, `${html} loads tokens.css`);
    assert.ok(tokens < text.indexOf(`href="${own}"`), `${html}: tokens.css first`);
  }
});
