'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecoveryFile: create } = require('../src/main/recovery-file');

const opened = [];
const createRecoveryFile = (dir) => {
  const file = create(dir);
  opened.push(file);
  return file;
};

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-recovery-'));
  t.after(() => {
    for (const f of opened.splice(0)) f.finish(); // close any open recording before removing the folder
    fs.rmSync(dir, { recursive: true, force: true });
  });
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
  // what a crashed run leaves behind
  fs.mkdirSync(dir, { recursive: true });
  const left = chunk(10, 0);
  fs.writeFileSync(path.join(dir, 'current.pcm'), Buffer.from(left.buffer));
  fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(META));
  const now = createRecoveryFile(dir); // the app started again
  assert.equal(now.read().audio.length, 10);
  now.discard();
  assert.equal(now.read(), null);
  assert.equal(fs.existsSync(path.join(dir, 'current.json')), false);
});

test('one file handle from begin() to finish(), not an open and close per append', (t) => {
  const dir = tempDir(t);
  const opens = t.mock.method(fs, 'openSync');
  const appends = t.mock.method(fs, 'appendFileSync');
  const closes = t.mock.method(fs, 'closeSync');
  const file = createRecoveryFile(dir);
  file.begin(META);
  for (let i = 0; i < 5; i++) file.append(chunk(640, i * 640));
  // writeFileSync / readFileSync open and close files of their own: count only the .pcm handle
  const pcmOpens = opens.mock.calls.filter((c) => String(c.arguments[0]).endsWith('current.pcm'));
  assert.equal(pcmOpens.length, 1);
  const pcmCloses = () => closes.mock.calls.filter((c) => c.arguments[0] === pcmOpens[0].result).length;
  assert.equal(appends.mock.callCount(), 0);
  assert.equal(pcmCloses(), 0);
  assert.equal(file.read().audio.length, 3200, 'readable while it is still open');
  file.finish();
  assert.equal(pcmCloses(), 1);
  assert.equal(fs.existsSync(path.join(dir, 'current.pcm')), false);
});

test('begin() again closes the previous handle; finish() closes the last one', (t) => {
  const dir = tempDir(t);
  const open = new Set(); // .pcm handles that are open right now
  const realOpen = fs.openSync;
  const realClose = fs.closeSync;
  t.mock.method(fs, 'openSync', (...args) => {
    const fd = realOpen.apply(fs, args);
    if (String(args[0]).endsWith('current.pcm')) open.add(fd);
    return fd;
  });
  t.mock.method(fs, 'closeSync', (fd) => {
    open.delete(fd);
    return realClose.call(fs, fd);
  });
  const file = createRecoveryFile(dir);
  file.begin(META);
  file.begin(META);
  assert.equal(open.size, 1);
  file.finish();
  assert.equal(open.size, 0);
});