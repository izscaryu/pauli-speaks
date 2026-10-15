'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/main/logger');

/** A stream that remembers what was written. */
const sink = () => ({ text: '', write(s) { this.text += s; return true; } });
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-log-'));
const failing = (code) => Object.assign(new Error(code), { code });

test('lines go to the log file', () => {
  const log = createLogger({ out: sink(), err: sink() });
  const dir = tempDir();
  log.init(dir);
  log.info('hello', { n: 1 });
  log.debug('quiet');
  const text = fs.readFileSync(log.file, 'utf8');
  assert.match(text, /\[info\] hello {"n":1}\n/);
  assert.match(text, /\[debug\] quiet\n/);
});

test('the last 500 lines are kept in memory, oldest dropped first', () => {
  const log = createLogger({ out: sink(), err: sink() });
  for (let i = 1; i <= 510; i++) log.info(`line ${i}`);
  const lines = log.recent();
  assert.equal(lines.length, 500);
  assert.match(lines[0], /line 11$/);
  assert.match(lines.at(-1), /line 510$/);
  assert.equal(log.recent(3).length, 3);
  assert.match(log.recent(3)[2], /line 510$/);
});

test('a failing append is reported once on stderr, with the error code, and lines stay in memory', () => {
  const err = sink();
  let appends = 0;
  const brokenFs = { ...fs, appendFileSync: () => { appends++; throw failing('EPERM'); } };
  const log = createLogger({ fs: brokenFs, out: sink(), err });
  log.init(tempDir());
  log.info('one');
  log.info('two');
  log.warn('three');
  assert.equal(err.text.split('\n').filter(Boolean).length, 1, 'reported once');
  assert.match(err.text, /EPERM/);
  assert.ok(appends >= 3, 'later lines are still tried');
  assert.deepEqual(log.recent().map((l) => l.replace(/^\S+ /, '')), ['[info] one', '[info] two', '[warn] three']);
});

test('after the first failure the log folder is recreated and the line retried once', () => {
  const dir = tempDir();
  const log = createLogger({ out: sink(), err: sink() });
  log.init(dir);
  fs.rmSync(dir, { recursive: true });
  log.info('after the folder vanished');
  assert.match(fs.readFileSync(log.file, 'utf8'), /after the folder vanished/);
});

test('stdout that throws does not stop the file or the memory buffer', () => {
  const out = { write: () => { throw failing('EBADF'); } };
  const log = createLogger({ out, err: sink() });
  log.init(tempDir());
  log.info('still logged');
  assert.match(fs.readFileSync(log.file, 'utf8'), /still logged/);
  assert.match(log.recent()[0], /still logged/);
});

test('a log folder that cannot be created leaves a memory-only logger', () => {
  const err = sink();
  const brokenFs = { ...fs, mkdirSync: () => { throw failing('EACCES'); } };
  const log = createLogger({ fs: brokenFs, out: sink(), err });
  assert.doesNotThrow(() => log.init(path.join(tempDir(), 'logs')));
  log.info('kept');
  assert.match(err.text, /EACCES/);
  assert.match(log.recent()[0], /kept/);
});

test('an oversized log is rotated to .old on start', () => {
  const dir = tempDir();
  const file = path.join(dir, 'pauli-speaks.log');
  fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
  const log = createLogger({ out: sink(), err: sink() });
  log.init(dir);
  assert.ok(fs.existsSync(`${file}.old`));
  log.info('fresh');
  assert.ok(fs.statSync(file).size < 1000);
});
