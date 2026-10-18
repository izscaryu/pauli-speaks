'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAudioHistory } = require('../src/main/audio-history');
const { decodeWav } = require('../src/main/audio-utils');

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const HOUR = 3600e3;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-audio-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'audio');
  return { dir, audio: createAudioHistory(dir) };
}

const tone = (n = 1600) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i / 10));
const age = (file, hoursAgo) => {
  const t = new Date(Date.now() - hoursAgo * HOUR);
  fs.utimesSync(file, t, t);
};

test('save writes a 16-bit mono 16 kHz WAV named after the History item', () => {
  const { dir, audio } = setup();
  const samples = tone(1600);
  const file = audio.save(ID1, samples);
  assert.equal(file, path.join(dir, `${ID1}.wav`));
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(20), 1, 'PCM');
  assert.equal(bytes.readUInt16LE(22), 1, 'mono');
  assert.equal(bytes.readUInt32LE(24), 16000, 'sample rate');
  assert.equal(bytes.readUInt16LE(34), 16, 'bits per sample');
  assert.equal(bytes.readUInt32LE(40), 1600 * 2, 'data size');
  const back = decodeWav(bytes);
  assert.equal(back.samples.length, 1600);
  assert.ok(Math.abs(back.samples[100] - samples[100]) < 1e-3);
});

test('path gives the file for a saved recording and null otherwise', () => {
  const { dir, audio } = setup();
  assert.equal(audio.path(ID1), null, 'no folder yet');
  audio.save(ID1, tone());
  assert.equal(audio.path(ID1), path.join(dir, `${ID1}.wav`));
  assert.equal(audio.path(ID2), null);
});

test('ids that are not History ids are refused, never turned into a path', () => {
  const { dir, audio } = setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '..', 'outside.wav'), 'x');
  for (const bad of ['../outside', '..\\outside', 'a/b', '', 'constructor', '__proto__', null, undefined, 42, `${ID1}.wav`]) {
    assert.equal(audio.path(bad), null, String(bad));
    assert.equal(audio.read(bad), null, String(bad));
    assert.throws(() => audio.save(bad, tone()), /id/i, String(bad));
    audio.remove(bad); // quietly nothing
  }
  assert.ok(fs.existsSync(path.join(dir, '..', 'outside.wav')));
});

test('read returns the WAV bytes', () => {
  const { audio } = setup();
  audio.save(ID1, tone(800));
  const bytes = audio.read(ID1);
  assert.equal(bytes.length, 44 + 1600);
  assert.equal(audio.read(ID2), null);
});

test('saving again replaces the recording and leaves no temporary file', () => {
  const { dir, audio } = setup();
  audio.save(ID1, tone(100));
  audio.save(ID1, tone(200));
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(audio.read(ID1).length, 44 + 400);
});

test('remove deletes one recording', () => {
  const { audio } = setup();
  audio.save(ID1, tone());
  audio.save(ID2, tone());
  audio.remove(ID1);
  assert.equal(audio.path(ID1), null);
  assert.ok(audio.path(ID2));
});

test('ids lists the recordings on disk', () => {
  const { dir, audio } = setup();
  assert.deepEqual([...audio.ids()], []);
  audio.save(ID1, tone());
  audio.save(ID2, tone());
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not ours');
  assert.deepEqual([...audio.ids()].sort(), [ID1, ID2]);
});

test('sweep removes recordings older than 24 hours and only those', () => {
  const { dir, audio } = setup();
  audio.save(ID1, tone());
  audio.save(ID2, tone());
  audio.save(ID3, tone());
  age(path.join(dir, `${ID1}.wav`), 25);
  age(path.join(dir, `${ID2}.wav`), 23);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not ours');
  age(path.join(dir, 'notes.txt'), 100);
  const removed = audio.sweep(Date.now());
  assert.equal(removed, 1);
  assert.equal(audio.path(ID1), null);
  assert.ok(audio.path(ID2));
  assert.ok(audio.path(ID3));
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')), 'files that are not recordings are left alone');
});

test('sweep uses the time it is given', () => {
  const { audio } = setup();
  audio.save(ID1, tone());
  assert.equal(audio.sweep(Date.now()), 0);
  assert.equal(audio.sweep(Date.now() + 25 * HOUR), 1);
});

test('sweep with keep also removes recordings no History item points to', () => {
  const { audio } = setup();
  audio.save(ID1, tone());
  audio.save(ID2, tone());
  assert.equal(audio.sweep(Date.now(), { keep: new Set([ID2]) }), 1);
  assert.equal(audio.path(ID1), null);
  assert.ok(audio.path(ID2));
});

test('sweep of a folder that is not there does nothing', () => {
  const { audio } = setup();
  assert.equal(audio.sweep(Date.now()), 0);
});

test('clear deletes the whole folder', () => {
  const { dir, audio } = setup();
  audio.save(ID1, tone());
  audio.clear();
  assert.equal(fs.existsSync(dir), false);
  audio.clear(); // twice is fine
  audio.save(ID2, tone()); // and saving works again
  assert.ok(audio.path(ID2));
});
