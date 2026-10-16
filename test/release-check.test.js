'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installerName, portableName, checkRelease, isReleaseArg, isPrerelease } = require('../scripts/release-check');

const exe = Buffer.from('pretend this is an installer');
const sha512 = crypto.createHash('sha512').update(exe).digest('base64');
const exeName = 'Pauli-Speaks-Setup-1.1.0.exe';

/** latest.yml as electron-builder writes it. */
const latestYml = ({ version = '1.1.0', name = exeName, hash = sha512, size = exe.length } = {}) => `version: ${version}
files:
  - url: ${name}
    sha512: ${hash}
    size: ${size}
path: ${name}
sha512: ${hash}
releaseDate: '2026-10-15T10:00:00.000Z'
`;

const good = { tag: 'v1.1.0', version: '1.1.0', exe, latestYml: latestYml() };

test('the installer name follows the version', () => {
  assert.equal(installerName('1.1.0'), exeName);
});

test('the portable exe has its own name, so latest.yml can never point at it', () => {
  const pkg = require('../package.json');
  assert.equal(portableName('1.1.0'), 'Pauli-Speaks-Portable-1.1.0.exe');
  assert.equal(pkg.build.portable.artifactName.replace('${version}', '1.1.0').replace('${ext}', 'exe'), portableName('1.1.0'));
  assert.equal(pkg.build.nsis.artifactName.replace('${version}', '1.1.0').replace('${ext}', 'exe'), installerName('1.1.0'));
});

test('a release whose latest.yml describes the installer passes', () => {
  assert.deepEqual(checkRelease(good), []);
});

test('the tag must match the version in package.json', () => {
  const problems = checkRelease({ ...good, tag: 'v1.0.9' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /v1\.0\.9.*1\.1\.0/);
  assert.equal(checkRelease({ ...good, tag: '1.1.0' }).length, 1, 'the tag needs its "v"');
});

test('latest.yml must name the same version', () => {
  assert.match(checkRelease({ ...good, latestYml: latestYml({ version: '1.0.1' }) }).join(), /version/);
});

test('latest.yml must point at this installer', () => {
  assert.match(checkRelease({ ...good, latestYml: latestYml({ name: 'Pauli Speaks Setup 1.1.0.exe' }) }).join(), /path|url/);
});

test('latest.yml must carry the installer\'s sha512 and size', () => {
  const other = crypto.createHash('sha512').update('a different file').digest('base64');
  assert.match(checkRelease({ ...good, latestYml: latestYml({ hash: other }) }).join(), /sha512/);
  assert.match(checkRelease({ ...good, latestYml: latestYml({ size: exe.length + 1 }) }).join(), /size/);
});

test('a hash in one place of latest.yml and another elsewhere is caught', () => {
  const other = crypto.createHash('sha512').update('signed later').digest('base64');
  const mixed = latestYml().replace(/^sha512: .*$/m, `sha512: ${other}`);
  assert.match(checkRelease({ ...good, latestYml: mixed }).join(), /sha512/);
});

test('npm run release takes a bump, a version or a beta version', () => {
  for (const ok of ['patch', 'minor', 'major', '1.2.0', '1.2.0-beta.1', '2.0.0-beta.12']) assert.equal(isReleaseArg(ok), true, ok);
  // Only "beta": electron-updater moves a beta user on to the next regular release,
  // but a user on another pre-release name (rc, alpha) would wait on that name.
  for (const bad of ['', undefined, '1.2', 'v1.2.0', '1.2.0-rc.1', '1.2.0-alpha.1', '1.2.0-beta', '1.2.0-beta.x', 'prerelease', '1.2.0 && echo']) {
    assert.equal(isReleaseArg(bad), false, String(bad));
  }
});

test('a version with a pre-release part is published as a GitHub pre-release', () => {
  assert.equal(isPrerelease('1.2.0-beta.1'), true);
  assert.equal(isPrerelease('1.2.0'), false);
});

test('a beta release is checked like any other: its latest.yml must describe its installer', () => {
  const beta = Buffer.from('a beta installer');
  const hash = crypto.createHash('sha512').update(beta).digest('base64');
  const yml = latestYml({ version: '1.2.0-beta.1', name: installerName('1.2.0-beta.1'), hash, size: beta.length });
  assert.deepEqual(checkRelease({ tag: 'v1.2.0-beta.1', version: '1.2.0-beta.1', exe: beta, latestYml: yml }), []);
  assert.equal(installerName('1.2.0-beta.1'), 'Pauli-Speaks-Setup-1.2.0-beta.1.exe');
});

test('an empty or missing latest.yml fails', () => {
  assert.ok(checkRelease({ ...good, latestYml: '' }).length > 0);
});
