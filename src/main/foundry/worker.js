'use strict';
// Runs inside an Electron utilityProcess: Foundry Local (foundry-local-sdk) with its own ONNX Runtime, away from the
// app and from the speech engine's. foundry-local.js starts it the first time AI polish needs Foundry Local and
// talks to it with {id, type, ...} messages; the work itself is in host.js. Download progress comes back as
// {type: 'progress', progress: {id, percent}}.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { foundryNativePaths, foundryConfig } = require('./paths');
const { createFoundryHost } = require('./host');

// The SDK is ESM-only and has no "require" export to resolve: it sits in the app's node_modules (app.asar when installed).
const SDK_ENTRY = path.join(__dirname, '..', '..', '..', 'node_modules', 'foundry-local-sdk', 'dist', 'index.js');

const port = process.parentPort;
const { modelsDir, logsDir } = JSON.parse(process.env.PAULI_FOUNDRY || '{}');
const natives = foundryNativePaths({ sdkEntry: SDK_ENTRY, platform: process.platform, arch: process.arch });

async function loadSdk() {
  if (!natives) throw new Error('Foundry Local runs on Windows x64 only');
  for (const dll of natives.preload) require('koffi').load(dll); // ours, before Windows looks in System32 (paths.js)
  return import(pathToFileURL(SDK_ENTRY).href);
}

const host = createFoundryHost({
  load: loadSdk,
  config: foundryConfig({ modelsDir, logsDir, libraryPath: natives ? natives.libraryPath : '' }),
  onProgress: (progress) => port.postMessage({ type: 'progress', progress }),
});

port.on('message', async ({ data }) => {
  const { id, type, modelId } = data || {}; // id: the request's; modelId: the model it is about
  try {
    port.postMessage({ id, ok: true, result: await host.handle({ type, id: modelId }) });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err && err.message) || err), code: (err && (err.code || err.name)) || null });
  }
});
