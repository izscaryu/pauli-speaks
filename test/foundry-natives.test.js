'use strict';
// foundry-local-sdk's install script downloads ONNX Runtime and ONNX Runtime GenAI from NuGet into its prebuilds
// folder, with no checksum of its own (the npm package itself is checked through package-lock.json). These are
// the files that were reviewed - signed by Microsoft, from nuget.org - so a different download fails here, before
// CI or a release build packs it. Update the hashes together with the SDK version.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'node_modules', 'foundry-local-sdk', 'prebuilds', 'win32-x64');
const REVIEWED = {
  'onnxruntime.dll': '7e39e2bdbba836d98071ef28620735ba36a47c554cf794585269aecc50fab0da', // Microsoft.ML.OnnxRuntime 1.30.0
  'onnxruntime-genai.dll': '47184b803e70a44c92d5a4361b8d62342d0fc6a983963cf898e52b8c81402e60', // Microsoft.ML.OnnxRuntimeGenAI.Foundry 0.17.1
  'onnxruntime_providers_shared.dll': 'b9b7ab9e2a8b08ee7ae4a7ac1c8bfd44a741f17ad8d0f764953140a57de0b796',
};

test('the SDK is the reviewed version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['foundry-local-sdk'], '2.1.0', 'a new SDK version needs its downloads reviewed and the hashes below updated');
});

test('the ONNX Runtime files Foundry Local downloaded at install are the reviewed ones', () => {
  for (const [name, sha256] of Object.entries(REVIEWED)) {
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `${name} is missing: npm install did not run the SDK's install script`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha256, name);
  }
});
