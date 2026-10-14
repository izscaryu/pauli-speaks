'use strict';
// Publish a new version to GitHub Releases - the feed the in-app updater reads.
//
//   1. bump "version" in package.json (e.g. 1.0.1), commit and push
//   2. npm run release
//
// Runs the tests, builds the NSIS installer locally, checks that latest.yml
// describes exactly that installer (sha512 + size), then creates the release
// with all three files the updater needs and verifies they arrived.
// Uses the GitHub CLI's login (gh auth login).

const { execSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { owner, repo } = pkg.build.publish[0];
const slug = `${owner}/${repo}`;
const { version } = pkg;
const tag = `v${version}`;
const dist = path.join(root, 'dist');
const exeName = `Pauli-Speaks-Setup-${version}.exe`;
const assets = [exeName, `${exeName}.blockmap`, 'latest.yml'];

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true }).status === 0;
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

if (sh('git status --porcelain')) fail('Commit your changes first (git status is not clean).');
sh('git fetch --quiet origin');
if (sh('git rev-parse HEAD') !== sh('git rev-parse @{u}')) fail('Push your commits first (git push).');
if (spawnSync('gh', ['release', 'view', tag, '--repo', slug], { cwd: root }).status === 0) {
  fail(`${tag} is already released. Bump "version" in package.json.`);
}

console.log('Running tests…');
if (!run('npm', ['test'])) fail('Tests failed.');

console.log(`Building ${tag}…`);
for (const a of assets) fs.rmSync(path.join(dist, a), { force: true });
if (!run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'])) fail('Build failed.');

const exe = fs.readFileSync(path.join(dist, exeName));
const latest = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
const sha512 = crypto.createHash('sha512').update(exe).digest('base64');
if (!latest.includes(`version: ${version}`) || !latest.includes(sha512) || !latest.includes(`size: ${exe.length}`)) {
  fail('latest.yml does not match the installer that was just built.');
}

console.log(`Publishing ${tag} to ${slug}…`);
const created = run('gh', [
  'release', 'create', tag, ...assets.map((a) => `"${path.join('dist', a)}"`),
  '--repo', slug, '--target', 'main', '--title', `"Pauli Speaks ${version}"`, '--generate-notes',
]);
if (!created) fail('Creating the GitHub release failed.');

const uploaded = JSON.parse(sh(`gh release view ${tag} --repo ${slug} --json assets`)).assets.map((a) => a.name);
const missing = assets.filter((a) => !uploaded.includes(a));
if (missing.length) fail(`Release is missing ${missing.join(', ')} - upload them with: gh release upload ${tag} <files> --repo ${slug}`);

console.log(`\n✔ Released ${tag}: https://github.com/${slug}/releases/tag/${tag}`);
console.log('Installed copies pick it up within 6 hours, or straight away via About → Check for updates.');
