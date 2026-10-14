'use strict';
// Minimal file logger (Wispr uses electron-log; we keep it dependency-free).

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;
let file = null;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'pauli-speaks.log');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
  } catch {
    // no log yet
  }
}

function write(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  if (level !== 'debug') process.stdout.write(line);
  if (file) fs.appendFile(file, line, () => {});
}

module.exports = {
  init,
  get file() {
    return file;
  },
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
