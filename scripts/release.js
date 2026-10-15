'use strict';
// Start a release. The build happens on GitHub, not on this PC:
//
//   npm run release -- 1.1.0        (or patch / minor / major)
//
// Checks that the tree is clean and main is in sync with GitHub, runs the
// tests, bumps "version" in package.json (npm version: commit "Release vX"
// plus tag vX), then pushes the commit and the tag together.
// The tag starts .github/workflows/release.yml, which builds the installer,
// checks latest.yml (scripts/release-check.js) and creates the GitHub release.

const { execSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bump = process.argv[2];

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd) => spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true }).status === 0;
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump || '')) fail('Say which version: npm run release -- 1.1.0 (or patch, minor, major).');
if (sh('git status --porcelain')) fail('Commit your changes first (git status is not clean).');
if (sh('git branch --show-current') !== 'main') fail('Releases are made from main. Switch to main first.');
sh('git fetch --quiet --tags origin');
if (sh('git rev-parse HEAD') !== sh('git rev-parse origin/main')) fail('main differs from origin/main. Pull or push first.');

console.log('Running tests…');
if (!run('npm test')) fail('Tests failed.');

if (!run(`npm version ${bump} -m "Release v%s"`)) fail(`npm version ${bump} failed (nothing was pushed).`);
const { version } = JSON.parse(sh('git show HEAD:package.json'));
const tag = `v${version}`;

console.log(`Pushing ${tag}…`);
if (!run(`git push --atomic origin HEAD:main ${tag}`)) {
  fail(`Push failed. To undo the local bump: git tag -d ${tag} && git reset --hard HEAD~1`);
}

const { owner, repo } = require(path.join(root, 'package.json')).build.publish[0];
console.log(`\n✔ ${tag} pushed. GitHub now builds and publishes it:`);
console.log(`  https://github.com/${owner}/${repo}/actions/workflows/release.yml`);
console.log('Installed copies pick it up within 6 hours of the release, or straight away via About → Check for updates.');
