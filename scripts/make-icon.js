'use strict';
// Generates assets/icon.png (256px app icon) and assets/tray.png (32px) with a
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
function sdArc(px, py, cx, cy, radius, thick) {
  // lower half-ring (the microphone holder "U")
  if (py >= cy) return Math.abs(Math.hypot(px - cx, py - cy) - radius) - thick / 2;
  const d1 = Math.hypot(px - (cx - radius), py - cy);
  const d2 = Math.hypot(px - (cx + radius), py - cy);
  return Math.min(d1, d2) - thick / 2;
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // rounded badge with a violet -> cyan diagonal gradient
      const d = sdRoundRect(u, v, 0.5, 0.5, 0.46, 0.46, 0.22);
      const a = clamp(0.5 - d / aa, 0, 1);
      const t = clamp(u * 0.6 + v * 0.4, 0, 1) * 0.55;
      let r = 108 + (63 - 108) * t;
      let g = 92 + (196 - 92) * t;
      let b = 246 + (240 - 246) * t;
      // white microphone glyph
      const cap = sdRoundRect(u, v, 0.5, 0.39, 0.095, 0.17, 0.095);
      const arc = sdArc(u, v, 0.5, 0.45, 0.19, 0.045);
      const stem = sdRoundRect(u, v, 0.5, 0.72, 0.0225, 0.07, 0.01);
      const base = sdRoundRect(u, v, 0.5, 0.79, 0.12, 0.0225, 0.0225);
      const gcov = clamp(0.5 - Math.min(cap, arc, stem, base) / aa, 0, 1);
      const outA = gcov + a * (1 - gcov);
      if (outA > 0) {
        r = (255 * gcov + r * a * (1 - gcov)) / outA;
        g = (255 * gcov + g * a * (1 - gcov)) / outA;
        b = (255 * gcov + b * a * (1 - gcov)) / outA;
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(outA * 255);
    }
  }
  return encodePng(size, px);
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), draw(256));
fs.writeFileSync(path.join(out, 'tray.png'), draw(32));
console.log('Wrote assets/icon.png and assets/tray.png');
