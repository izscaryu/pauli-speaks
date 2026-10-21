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
// Every file in the folder: the SDK's own (from the npm package) and the two NuGet downloads. A file that isn't
// listed here would be packed and loaded next to them, so an extra one fails too.
const REVIEWED = {
  'foundry_local.dll': 'e7e88b603fd6711b18959ca5b81a4e4215085c3f94b0014e13d562ef9177c5fd',
  'foundry_local_node.node': 'b53d7d6a044d1b4e44da6c85f2dd2360ea52b04973127e09784929ac485f7f99',
  'foundry_local_preload.node': 'edf4f195667dc6a96318b89b4a73a246391f7b37868b56f9ba90a7ecf8587c0f',
  'Microsoft.Windows.AI.MachineLearning.dll': 'b401a47552a745755d65100828faefcf3df3895c759f96ac625ddf990711c8dd', // not shipped (package.json)
  'onnxruntime.dll': '7e39e2bdbba836d98071ef28620735ba36a47c554cf794585269aecc50fab0da', // Microsoft.ML.OnnxRuntime 1.30.0
  'onnxruntime-genai.dll': '47184b803e70a44c92d5a4361b8d62342d0fc6a983963cf898e52b8c81402e60', // Microsoft.ML.OnnxRuntimeGenAI.Foundry 0.17.1
  'onnxruntime_providers_shared.dll': 'b9b7ab9e2a8b08ee7ae4a7ac1c8bfd44a741f17ad8d0f764953140a57de0b796',
};

test('the SDK is the reviewed version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['foundry-local-sdk'], '2.1.0', 'a new SDK version needs its downloads reviewed and the hashes below updated');
});

test('the native files Foundry Local brings are exactly the reviewed ones', () => {
  assert.deepEqual(fs.readdirSync(DIR).sort(), Object.keys(REVIEWED).sort(), 'nothing missing, nothing extra');
  for (const [name, sha256] of Object.entries(REVIEWED)) {
    const file = path.join(DIR, name);
    assert.ok(fs.existsSync(file), `${name} is missing: npm install did not run the SDK's install script`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), sha256, name);
  }
});
