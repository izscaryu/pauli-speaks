'use strict';
// Minimal file logger, dependency-free.
//
// Every line also goes into a 500-line memory buffer (recent()), so the last
// lines are available even when the log file can't be written. The first
// write failure is reported once on stderr with its error code; the log
// folder is then recreated and the line retried once. Later failures are
// silent, and every new line is still tried.

const nodeFs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 500;

function createLogger({ fs = nodeFs, out = process.stdout, err = process.stderr } = {}) {
  let file = null;
  let reported = false;
  const lines = [];

  const reportOnce = (what, e) => {
    if (reported) return;
    reported = true;
    try {
      err.write(`Pauli Speaks: ${what} (${e.code || e.message}). Keeping the last ${MAX_LINES} log lines in memory.\n`);
    } catch {
      // nowhere left to report to
    }
  };

  function init(dir) {
    file = path.join(dir, 'pauli-speaks.log');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      reportOnce(`cannot create the log folder ${dir}`, e);
      return;
    }
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
    } catch {
      // no log yet
    }
  }

  function append(line) {
    try {
      fs.appendFileSync(file, line);
    } catch (e) {
      if (reported) return;
      reportOnce(`cannot write to the log file ${file}`, e);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, line);
      } catch {
        // stays memory-only for this line
      }
    }
  }

  function write(level, args) {
    const line = `${new Date().toISOString()} [${level}] ${args
      .map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}`;
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    if (file) append(`${line}\n`);
    if (level !== 'debug') {
      try {
        out.write(`${line}\n`);
      } catch {
        // no console (e.g. started from a closed terminal)
      }
    }
  }

  return {
    init,
    get file() {
      return file;
    },
    /** The last `n` lines (at most 500), oldest first. */
    recent: (n = MAX_LINES) => lines.slice(-n),
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}

module.exports = createLogger();
module.exports.createLogger = createLogger;
