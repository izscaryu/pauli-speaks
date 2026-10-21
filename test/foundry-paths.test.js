'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { foundryNativePaths, foundryConfig } = require('../src/main/foundry/paths');

test('in a development run the native files are next to the SDK, in its prebuilds folder', () => {
  const p = foundryNativePaths({ sdkEntry: 'C:\\dev\\app\\node_modules\\foundry-local-sdk\\dist\\index.js', platform: 'win32', arch: 'x64' });
  assert.equal(p.libraryPath, 'C:\\dev\\app\\node_modules\\foundry-local-sdk\\prebuilds\\win32-x64');
  assert.deepEqual(p.preload, [
    'C:\\dev\\app\\node_modules\\foundry-local-sdk\\prebuilds\\win32-x64\\onnxruntime.dll',
    'C:\\dev\\app\\node_modules\\foundry-local-sdk\\prebuilds\\win32-x64\\onnxruntime-genai.dll',
  ]);
});

test('in the installed app they are in app.asar.unpacked, where Windows can load them', () => {
  const p = foundryNativePaths({ sdkEntry: 'C:\\Program Files\\Pauli Speaks\\resources\\app.asar\\node_modules\\foundry-local-sdk\\dist\\index.js', platform: 'win32', arch: 'x64' });
  assert.equal(p.libraryPath, 'C:\\Program Files\\Pauli Speaks\\resources\\app.asar.unpacked\\node_modules\\foundry-local-sdk\\prebuilds\\win32-x64');
  assert.ok(p.preload.every((f) => f.includes('\\app.asar.unpacked\\')));
});

test('only Windows x64 is supported for now: elsewhere there is nothing to load', () => {
  assert.equal(foundryNativePaths({ sdkEntry: 'C:\\x\\dist\\index.js', platform: 'win32', arch: 'arm64' }), null);
  assert.equal(foundryNativePaths({ sdkEntry: '/x/dist/index.js', platform: 'linux', arch: 'x64' }), null);
});

test('the SDK keeps its models under the app\'s models folder and its logs with ours, and sends no optional telemetry', () => {
  const c = foundryConfig({ modelsDir: 'C:\\data\\models', logsDir: 'C:\\data\\logs', libraryPath: 'C:\\lib' });
  assert.deepEqual(c, {
    appName: 'pauli-speaks',
    appDataDir: 'C:\\data\\models\\foundry', // models in its own cache\models below
    logsDir: 'C:\\data\\logs\\foundry',
    logLevel: 'error', // its own log could hold more than we would write
    webServiceUrls: 'http://127.0.0.1:0',
    disableNonessentialTelemetry: true,
    libraryPath: 'C:\\lib',
  });
});
