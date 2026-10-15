'use strict';
// Checks that a built release is consistent before it is published:
// the tag matches package.json, and latest.yml (the file the in-app updater
// reads) describes exactly the installer in dist/ - same name, sha512 and size.
// If latest.yml is wrong, every installed copy rejects the update.
//
//   node scripts/release-check.js v1.1.0
//
// Run by .github/workflows/release.yml after building (and, once signing is
// in place, after latest.yml has been regenerated for the signed installer).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const installerName = (version) => `Pauli-Speaks-Setup-${version}.exe`;

const valuesOf = (yml, key) => [...yml.matchAll(new RegExp(`^\\s*(?:- )?${key}: *(.+?)\\s*$`, 'gm'))].map((m) => m[1]);

/**
 * @param {{tag: string, version: string, exe: Buffer, latestYml: string}} release
 * @returns {string[]} problems; empty when the release is good to publish
 */
function checkRelease({ tag, version, exe, latestYml }) {
  if (tag !== `v${version}`) return [`Tag ${tag} does not match version ${version} in package.json (expected v${version}).`];
  const problems = [];
  const name = installerName(version);
  const sha512 = crypto.createHash('sha512').update(exe).digest('base64');
  const yml = latestYml || '';

  const versions = valuesOf(yml, 'version');
  if (versions.length !== 1 || versions[0] !== version) problems.push(`latest.yml has version ${versions.join(', ') || '(none)'}, expected ${version}.`);

  const names = [...valuesOf(yml, 'url'), ...valuesOf(yml, 'path')];
  if (names.length < 2 || names.some((n) => n !== name)) problems.push(`latest.yml path/url is ${names.join(', ') || '(none)'}, expected ${name}.`);

  const hashes = valuesOf(yml, 'sha512');
  if (hashes.length < 2 || hashes.some((h) => h !== sha512)) problems.push(`latest.yml sha512 does not match ${name}.`);

  const sizes = valuesOf(yml, 'size');
  if (sizes.length < 1 || sizes.some((s) => s !== String(exe.length))) problems.push(`latest.yml size is ${sizes.join(', ') || '(none)'}, ${name} is ${exe.length} bytes.`);

  return problems;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const { version } = require(path.join(root, 'package.json'));
  const tag = process.argv[2] || '';
  const dist = path.join(root, 'dist');
  const read = (file, enc) => {
    try {
      return fs.readFileSync(path.join(dist, file), enc);
    } catch {
      console.error(`✖ dist/${file} is missing.`);
      process.exit(1);
    }
  };
  const name = installerName(version);
  read(`${name}.blockmap`);
  const problems = checkRelease({ tag, version, exe: read(name), latestYml: read('latest.yml', 'utf8') });
  for (const p of problems) console.error(`✖ ${p}`);
  if (problems.length) process.exit(1);
  console.log(`✔ ${tag}: ${name}, its blockmap and latest.yml match.`);
}

module.exports = { installerName, checkRelease };
