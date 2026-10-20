'use strict';
// Things that only break in the installed app. electron-builder strips "build" (and the dev parts) from the
// package.json it packs, so code that reads package.json at run time sees much less than a development run does:
// 1.3.0-1.5.0 read build.publish while starting and stopped before the tray, the pill and the keyboard hook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.js$/.test(e.name) ? [full] : [];
  });
}

test('nothing in the app reads package.json fields that electron-builder leaves out of the installed copy', () => {
  // Kept in the packed package.json: name, productName, version, description, main, author, license, homepage...
  const stripped = ['build', 'scripts', 'devDependencies'];
  const offenders = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/require\(['"][./]*package\.json['"]\)\s*\.\s*(\w+)/g)) {
      if (stripped.includes(m[1])) offenders.push(`${path.relative(ROOT, file)}: package.json.${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the GitHub repository the app links to is the one releases are published to', () => {
  const { REPO } = require('../src/main/repo');
  const { owner, repo } = pkg.build.publish[0];
  assert.deepEqual(REPO, { owner, repo });
});
