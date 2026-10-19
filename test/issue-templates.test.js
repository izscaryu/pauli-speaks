'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { issueUrl } = require('../src/main/diagnostics');

const DIR = path.join(__dirname, '..', '.github', 'ISSUE_TEMPLATE');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/
/g, '
'); // Windows checkouts have CRLF

test('Report a problem opens a form that exists, and fills in a field it has', () => {
  const url = new URL(issueUrl({ owner: 'o', repo: 'r' }, '1.0.0'));
  const form = read(url.searchParams.get('template'));
  for (const key of url.searchParams.keys()) {
    if (key !== 'template') assert.match(form, new RegExp(`\\n\\s+id: ${key}\\n`), `the form has a "${key}" field`);
  }
  assert.match(form, /\n\s+id: diagnostics\n/, 'a field to paste the diagnostic info into');
});

test('every form has a name, a description and a body, and no tabs (YAML)', () => {
  for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') && f !== 'config.yml')) {
    const form = read(name);
    assert.doesNotMatch(form, /\t/, name);
    assert.match(form, /^name: .+\ndescription: .+\n/, name);
    assert.match(form, /\nbody:\n/, name);
  }
});

test('blank issues are off, so reports come through the forms', () => {
  assert.match(read('config.yml'), /^blank_issues_enabled: false/);
});
