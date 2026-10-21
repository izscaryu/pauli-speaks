// Draws the plugin's SVG images from one set of glyphs, in the app's colours (src/renderer/app.css):
// ink keys with a coral signal, and plain light icons for Stream Deck's action list.
// Run: node scripts/make-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'com.pauli.speaks.streamdeck.sdPlugin', 'imgs');

const INK = '#1d1c1a';
const CORAL = '#ff6a52'; // --signal in the dark theme, readable on ink
const PAPER = '#ecebe6';
const ICON = '#efefef'; // Elgato's guideline colour for action-list icons

// Each glyph is drawn in a 144 x 144 key, above the title (Stream Deck writes the title at the bottom).
// `a` is the accent colour, `b` the base colour.
const GLYPHS = {
  toggle: (a, b) => `
    <rect x="58" y="22" width="28" height="48" rx="14" fill="${a}"/>
    <path d="M44 56a28 28 0 0 0 56 0M72 84v12M58 96h28" fill="none" stroke="${b}" stroke-width="6" stroke-linecap="round"/>`,
  start: (a, b) => `
    <circle cx="72" cy="60" r="38" fill="none" stroke="${b}" stroke-width="6"/>
    <circle cx="72" cy="60" r="24" fill="${a}"/>`,
  stop: (a, b) => `
    <circle cx="72" cy="60" r="38" fill="none" stroke="${b}" stroke-width="6"/>
    <rect x="54" y="42" width="36" height="36" rx="6" fill="${a}"/>`,
  cancel: (a, b) => `
    <circle cx="72" cy="60" r="38" fill="none" stroke="${a}" stroke-width="6"/>
    <path d="M58 46l28 28M86 46L58 74" fill="none" stroke="${b}" stroke-width="8" stroke-linecap="round"/>`,
  'paste-last': (a, b) => `
    <rect x="46" y="28" width="52" height="68" rx="8" fill="none" stroke="${b}" stroke-width="6"/>
    <rect x="60" y="20" width="24" height="16" rx="4" fill="${a}"/>
    <path d="M58 56h28M58 72h18" fill="none" stroke="${a}" stroke-width="6" stroke-linecap="round"/>`,
};

const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}\n</svg>\n`;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(path.relative(process.cwd(), file));
}

for (const [name, glyph] of Object.entries(GLYPHS)) {
  // Keys: the whole 144 x 144 face, ink background.
  write(path.join(root, 'keys', `${name}.svg`), svg('0 0 144 144', `<rect width="144" height="144" fill="${INK}"/>${glyph(CORAL, PAPER)}`));
  // Action list: just the glyph, one light colour, cropped to fill the small icon.
  write(path.join(root, 'actions', `${name}.svg`), svg('20 10 104 104', glyph(ICON, ICON)));
}
write(path.join(root, 'category.svg'), svg('20 10 104 104', GLYPHS.toggle(ICON, ICON)));
