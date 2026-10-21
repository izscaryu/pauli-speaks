'use strict';
// Generates assets/icon.png (256px app icon: an ink squircle with a coral voice line) and the 32px tray icons, with a
// tiny PNG encoder - no image dependencies. Run: npm run icon

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- signed distance helpers (unit square coordinates, y down)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/** Inside the squircle (a superellipse, like Windows 11 app tiles): <= 0. Approximate distance, fine for edges. */
function sdSquircle(px, py, half, n = 5) {
  const x = Math.abs(px - 0.5) / half;
  const y = Math.abs(py - 0.5) / half;
  return (Math.pow(Math.pow(x, n) + Math.pow(y, n), 1 / n) - 1) * half;
}

const INK = [29, 28, 26];
// The voice line: five rounded bars, tallest in the middle, in one signal colour.
const BARS = [0.16, 0.3, 0.42, 0.3, 0.16];
const COLOURS = { idle: [241, 239, 233], coral: [255, 106, 82], amber: [224, 163, 71] };

function draw(size, bar) {
  const px = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  const step = 0.11;
  const w = size <= 32 ? 0.075 : 0.06; // thicker bars where pixels are few
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const tile = clamp(0.5 - sdSquircle(u, v, 0.47) / aa, 0, 1);
      let line = Infinity;
      BARS.forEach((h, i) => { line = Math.min(line, sdRoundRect(u, v, 0.5 + (i - 2) * step, 0.5, w / 2, h / 2, w / 2)); });
      const gcov = clamp(0.5 - line / aa, 0, 1) * tile;
      const outA = gcov + tile * (1 - gcov);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = outA > 0 ? Math.round((bar[c] * gcov + INK[c] * tile * (1 - gcov)) / outA) : 0;
      px[i + 3] = Math.round(outA * 255);
    }
  }
  return encodePng(size, px);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), draw(256, COLOURS.coral));
// Tray (tray-menu.js trayIcon): idle, listening (coral, the colour of recording) and processing (amber).
fs.writeFileSync(path.join(out, 'tray.png'), draw(32, COLOURS.idle));
fs.writeFileSync(path.join(out, 'tray-listening.png'), draw(32, COLOURS.coral));
fs.writeFileSync(path.join(out, 'tray-processing.png'), draw(32, COLOURS.amber));
console.log('Wrote assets/icon.png and the tray icons');
