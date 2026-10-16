'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecoveryFile } = require('../src/main/recovery-file');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'recovery'); // not created yet: begin() makes it
}

const chunk = (n, start) => Float32Array.from({ length: n }, (_, i) => (start + i) / 100000);
const META = { startedAt: 1760000000000, mode: 'dictate' };

test('round trip: three appended chunks read back as their concatenation, with the meta', (t) => {
  const dir = tempDir(t);
  const file = createRecoveryFile(dir);
  file.begin(META);
  const a = chunk(16000, 0);
  const b = chunk(640, 16000);
  const c = chunk(7, 16640);
  file.append(a);
  file.append(b);
  file.append(c);
  const got = file.read();
  assert.deepEqual(got.meta, META);
  assert.ok(got.audio instanceof Float32Array);
  assert.deepEqual(Array.from(got.audio), [...a, ...b, ...c]);
  assert.ok(fs.existsSync(path.join(dir, 'current.pcm')));
  assert.ok(fs.existsSync(path.join(dir, 'current.json')));
});

test('a subarray view is written as its own samples, not its whole buffer', (t) => {
  const file = createRecoveryFile(tempDir(t));
  file.begin(META);
  const big = chunk(100, 0);
  file.append(big.subarray(10, 20));
  assert.deepEqual(Array.from(file.read().audio), Array.from(big.subarray(10, 20)));
});

test('begin() starts a fresh recording', (t) => {
  const file = createRecoveryFile(tempDir(t));
  file.begin(META);
  file.append(chunk(50, 0));
  file.begin({ ...META, mode: 'command' });
  file.append(chunk(3, 7));
  const got = file.read();
  assert.equal(got.meta.mode, 'command');
  assert.deepEqual(Array.from(got.audio), Array.from(chunk(3, 7)));
});

test('truncated file recovers whole samples', (t) => {
  const dir = tempDir(t);
  const file = createRecoveryFile(dir);
  file.begin(META);
  file.append(chunk(1000, 0));
  const pcm = path.join(dir, 'current.pcm');
  const bytes = fs.readFileSync(pcm);
  fs.writeFileSync(pcm, bytes.subarray(0, bytes.length - 2));
  const got = file.read();
  assert.equal(got.audio.length, Math.floor((bytes.length - 2) / 4));
  assert.equal(got.audio.length, 999);
  assert.deepEqual(Array.from(got.audio), Array.from(chunk(999, 0)));
});

test('missing json -> meta null, audio still returned', (t) => {
  const dir = tempDir(t);
  const file = createRecoveryFile(dir);
  file.begin(META);
  file.append(chunk(10, 0));
  fs.rmSync(path.join(dir, 'current.json'));
  const got = file.read();
  assert.equal(got.meta, null);
  assert.equal(got.audio.length, 10);
});

test('corrupt or non-object json -> meta null', (t) => {
  const dir = tempDir(t);
  const file = createRecoveryFile(dir);
  file.begin(META);
  file.append(chunk(10, 0));
  for (const text of ['{"startedAt": 17', 'null', '[1,2]', '"text"']) {
    fs.writeFileSync(path.join(dir, 'current.json'), text);
    assert.equal(file.read().meta, null, text);
  }
});

test('read() with no recording returns null', (t) => {
  const file = createRecoveryFile(tempDir(t));
  assert.equal(file.read(), null);
});

test('finish() removes both files, and later appends do not bring them back', (t) => {
  const dir = tempDir(t);
  const file = createRecoveryFile(dir);
  file.begin(META);
  file.append(chunk(10, 0));
  file.finish();
  assert.equal(fs.existsSync(path.join(dir, 'current.pcm')), false);
  assert.equal(fs.existsSync(path.join(dir, 'current.json')), false);
  file.append(chunk(10, 0));
  assert.equal(fs.existsSync(path.join(dir, 'current.pcm')), false, 'append outside a recording is ignored');
  assert.equal(file.read(), null);
  file.finish(); // finishing twice is fine
});

test('discard() deletes a recording left behind by an earlier run', (t) => {
  const dir = tempDir(t);
  const earlier = createRecoveryFile(dir);
  earlier.begin(META);
  earlier.append(chunk(10, 0));
  const now = createRecoveryFile(dir); // the app started again after a crash
  assert.equal(now.read().audio.length, 10);
  now.discard();
  assert.equal(now.read(), null);
  assert.equal(fs.existsSync(path.join(dir, 'current.json')), false);
});
