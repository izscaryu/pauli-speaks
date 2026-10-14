'use strict';
// Publish a new version to GitHub Releases - the feed the in-app updater reads.
//
//   1. bump "version" in package.json (e.g. 1.0.1) and commit
//   2. npm run release
//
// Runs the tests, checks the version isn't released yet and the work is pushed,
// then builds the NSIS installer and uploads it with latest.yml + blockmap.
// Uses the GitHub CLI's login for the token (gh auth login), or GH_TOKEN.

const { execSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { owner, repo } = pkg.build.publish[0];
const tag = `v${pkg.version}`;

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (sh('git status --porcelain')) fail('Commit your changes first (git status is not clean).');
sh('git fetch --quiet origin');
if (sh('git rev-parse HEAD') !== sh('git rev-parse @{u}')) fail('Push your commits first (git push).');

const existing = spawnSync('gh', ['release', 'view', tag, '--repo', `${owner}/${repo}`], { cwd: root, encoding: 'utf8' });
if (existing.status === 0) fail(`${tag} is already released. Bump "version" in package.json.`);

console.log('Running tests…');
const tests = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit', shell: true });
if (tests.status !== 0) fail('Tests failed.');

const token = process.env.GH_TOKEN || sh('gh auth token');
console.log(`Building and publishing ${tag} to ${owner}/${repo}…`);
const build = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token },
});
if (build.status !== 0) fail('Build or upload failed.');
console.log(`\n✔ Released ${tag}: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
console.log('Installed copies will pick it up within 6 hours (or via About → Check for updates).');
