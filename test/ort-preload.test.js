'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ortLibraryPaths, preloadOrtLibraries } = require('../src/main/asr/ort-preload');

const DEV = 'C:\\dev\\pauli-speaks\\node_modules\\onnxruntime-node\\dist\\index.js';
const PACKED = 'C:\\Program Files\\Pauli Speaks\\resources\\app.asar\\node_modules\\onnxruntime-node\\dist\\index.js';

test('the libraries next to the onnxruntime-node binding, DirectML first', () => {
  assert.deepEqual(ortLibraryPaths({ indexPath: DEV, platform: 'win32', arch: 'x64' }), [
    'C:\\dev\\pauli-speaks\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\DirectML.dll',
    'C:\\dev\\pauli-speaks\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime.dll',
  ]);
});

test('in the installed app they come from app.asar.unpacked, where Windows can read them', () => {
  const [, ort] = ortLibraryPaths({ indexPath: PACKED, platform: 'win32', arch: 'x64' });
  assert.equal(ort, 'C:\\Program Files\\Pauli Speaks\\resources\\app.asar.unpacked\\node_modules\\onnxruntime-node\\bin\\napi-v6\\win32\\x64\\onnxruntime.dll');
  const unpacked = PACKED.replace('app.asar', 'app.asar.unpacked');
  assert.equal(ortLibraryPaths({ indexPath: unpacked, platform: 'win32', arch: 'x64' })[1], ort, 'an already unpacked path stays as it is');
});

test('nothing to preload outside Windows', () => {
  assert.deepEqual(ortLibraryPaths({ indexPath: '/opt/app/node_modules/onnxruntime-node/dist/index.js', platform: 'linux', arch: 'x64' }), []);
});

test('every library is loaded in order; one that fails is reported and the rest still load', () => {
  const loaded = [];
  const errors = [];
  const out = preloadOrtLibraries({
    paths: ['a\\DirectML.dll', 'a\\onnxruntime.dll'],
    load: (p) => { if (p.endsWith('DirectML.dll')) throw new Error('missing'); loaded.push(p); },
    onError: (err, p) => errors.push([p, err.message]),
  });
  assert.deepEqual(loaded, ['a\\onnxruntime.dll']);
  assert.deepEqual(out, ['a\\onnxruntime.dll']);
  assert.deepEqual(errors, [['a\\DirectML.dll', 'missing']]);
});

test('on this PC the bundled libraries load by full path', { skip: process.platform !== 'win32' }, () => {
  const koffi = require('koffi');
  const paths = ortLibraryPaths({ indexPath: require.resolve('onnxruntime-node'), platform: process.platform, arch: process.arch });
  const errors = [];
  assert.deepEqual(preloadOrtLibraries({ paths, load: (p) => koffi.load(p), onError: (err) => errors.push(err.message) }), paths);
  assert.deepEqual(errors, []);
});
