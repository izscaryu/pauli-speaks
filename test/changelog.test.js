'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { changelogSection, readChangelog } = require('../src/main/changelog');

const FIXTURE = [
  '# Changelog',
  '',
  'Intro line.',
  '',
  '## 1.2.0',
  '',
  '- Guided setup on first start.',
  '- Health banners.',
  '',
  '## 1.1.3',
  '',
  '- Older change.',
  '',
].join('\n');

test('changelogSection returns the body of one version, trimmed', () => {
  assert.equal(changelogSection(FIXTURE, '1.2.0'), '- Guided setup on first start.\n- Health banners.');
  assert.equal(changelogSection(FIXTURE, '1.1.3'), '- Older change.');
});

test('changelogSection returns null for a missing version or bad input', () => {
  assert.equal(changelogSection(FIXTURE, '9.9.9'), null);
  assert.equal(changelogSection(FIXTURE, '1.2'), null);
  assert.equal(changelogSection(undefined, '1.2.0'), null);
  assert.equal(changelogSection(FIXTURE, undefined), null);
  assert.equal(changelogSection('', '1.2.0'), null);
});

test('changelogSection does not match a longer version that starts the same', () => {
  const text = '## 1.2.10\n\n- ten\n\n## 1.2.1\n\n- one\n';
  assert.equal(changelogSection(text, '1.2.1'), '- one');
  assert.equal(changelogSection(text, '1.2'), null);
});

test('changelogSection tolerates a trailing date on the heading', () => {
  const text = '## 1.2.0 (2026-10-20)\n\n- Dated.\n\n## 1.1.3 (2026-09-01)\n\n- Old.\n';
  assert.equal(changelogSection(text, '1.2.0'), '- Dated.');
});

test('changelogSection reads a pre-release from its base version', () => {
  assert.equal(changelogSection(FIXTURE, '1.2.0-beta.1'), '- Guided setup on first start.\n- Health banners.');
  assert.equal(changelogSection(FIXTURE, '1.1.3-rc.2+build5'), '- Older change.');
  assert.equal(changelogSection(FIXTURE, '9.9.9-beta.1'), null);
});

test('changelogSection copes with Windows line endings and an empty section', () => {
  assert.equal(changelogSection('## 1.2.0\r\n\r\n- One.\r\n- Two.\r\n\r\n## 1.1.3\r\n', '1.2.0'), '- One.\n- Two.');
  assert.equal(changelogSection('## 1.2.0\n\n## 1.1.3\n\n- x\n', '1.2.0'), null);
});

test('changelogSection ignores deeper headings and stops only at the next "## "', () => {
  const text = '## 1.2.0\n\n### Fixed\n\n- A fix.\n\n## 1.1.3\n\n- Old.\n';
  assert.equal(changelogSection(text, '1.2.0'), '### Fixed\n\n- A fix.');
});

test('readChangelog returns the file text, or "" when it is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-changelog-'));
  try {
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, FIXTURE);
    assert.equal(readChangelog(file), FIXTURE);
    assert.equal(readChangelog(path.join(dir, 'nope.md')), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real CHANGELOG.md has a 1.2.0 section with bullets', () => {
  const section = changelogSection(readChangelog(), '1.2.0');
  assert.ok(section, 'CHANGELOG.md has no "## 1.2.0" section');
  assert.match(section, /^- /m);
});
