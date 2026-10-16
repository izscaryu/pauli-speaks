'use strict';
// "What's new": reads CHANGELOG.md (next to package.json in the repo and inside the app package)
// and cuts out the section for one version. Pure apart from readChangelog's file read.

const fs = require('node:fs');
const path = require('node:path');

const CHANGELOG_FILE = path.join(__dirname, '..', '..', 'CHANGELOG.md');

/** The release a version belongs to: `1.2.0-beta.1` and `1.2.0+build.7` -> `1.2.0`; '' for bad input. */
function baseVersion(version) {
  return typeof version === 'string' ? version.split(/[-+]/)[0].trim() : '';
}

/**
 * The body under `## <version>` up to the next `## ` heading, trimmed; null when the version has no section
 * (or an empty one). A heading may carry a date after a space (`## 1.2.0 (2026-10-20)`). A pre-release
 * (`1.2.0-beta.1`) reads the section of its base version (`## 1.2.0`).
 */
function changelogSection(text, version) {
  if (typeof text !== 'string' || typeof version !== 'string') return null;
  const base = baseVersion(version);
  if (!base) return null;
  const lines = text.split(/\r?\n/);
  const isHeading = (line) => line.startsWith('## ');
  const start = lines.findIndex((line) => {
    if (!isHeading(line)) return false;
    const heading = line.slice(3);
    return heading === base || heading.startsWith(`${base} `);
  });
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && isHeading(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

/** The CHANGELOG.md text, or '' when the file is missing or unreadable (then there is no What's new). */
function readChangelog(file = CHANGELOG_FILE) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

module.exports = { baseVersion, changelogSection, readChangelog, CHANGELOG_FILE };
