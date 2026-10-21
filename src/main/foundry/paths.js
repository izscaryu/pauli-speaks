'use strict';
// Foundry Local (AI polish on this PC, set up from the app): where the SDK's native files are, and how the SDK is
// configured. Pure, unit tested; the worker (worker.js) uses both.
//
// The SDK ships its own ONNX Runtime. Like the speech engine's (asr/ort-preload.js), it is loaded by full path
// before anything asks Windows for it by name, so the older copy in System32 can never be picked up instead.

const path = require('node:path');

const PRELOAD = ['onnxruntime.dll', 'onnxruntime-genai.dll'];

/**
 * @param {{sdkEntry: string, platform: string, arch: string}} o  sdkEntry: the SDK's dist/index.js
 * @returns {{libraryPath: string, preload: string[]}|null} null where the SDK has no build we ship (only Windows x64)
 */
function foundryNativePaths({ sdkEntry, platform, arch }) {
  if (platform !== 'win32' || arch !== 'x64') return null;
  // Inside the installed app the package lives in app.asar; its native files are in app.asar.unpacked.
  const pkg = path.win32.join(path.win32.dirname(sdkEntry), '..').replace(/\\app\.asar\\/i, '\\app.asar.unpacked\\');
  const libraryPath = path.win32.join(pkg, 'prebuilds', 'win32-x64');
  return { libraryPath, preload: PRELOAD.map((name) => path.win32.join(libraryPath, name)) };
}

/**
 * The SDK's settings: its data and models under the app's models folder (so Settings → Privacy → Delete downloaded
 * models takes them too), its logs next to ours, its web service on this PC only, no optional telemetry.
 * @param {{modelsDir: string, logsDir: string, libraryPath: string}} o
 */
function foundryConfig({ modelsDir, logsDir, libraryPath }) {
  return {
    appName: 'pauli-speaks',
    appDataDir: path.win32.join(modelsDir, 'foundry'), // the SDK keeps its models in cache\models below it
    logsDir: path.win32.join(logsDir, 'foundry'),
    logLevel: 'error', // its own log could hold more than ours ever does (never what was dictated)
    webServiceUrls: 'http://127.0.0.1:0',
    disableNonessentialTelemetry: true,
    libraryPath,
  };
}

module.exports = { foundryNativePaths, foundryConfig };
