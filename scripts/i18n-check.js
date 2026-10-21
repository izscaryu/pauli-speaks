'use strict';
// npm run i18n:check - are the locale files and the code in step?
//   * keys the code uses (t('…'), data-i18n*="…") that en.json lacks
//   * en.json keys nothing uses (t(`prefix.${x}`) counts as using every key under prefix.)
//   * per translation: keys it lacks (plural forms by that language's rules), keys English no longer has,
//     and {placeholders} that differ from English
// Exits 1 when anything is wrong. Runs in CI.

const fs = require('node:fs');
const path = require('node:path');
const { placeholders } = require('../src/renderer/i18n');

const ROOT = path.join(__dirname, '..');
const ALWAYS_USED = ['language.name']; // read by src/main/strings.js for the language picker
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const CALL = String.raw`(?:\bI18n\.|(?<![\w$.]))t\(\s*`;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'locales' && entry.name !== 'node_modules') out.push(...sourceFiles(full));
    } else if (/\.(js|html)$/.test(entry.name) && entry.name !== 'i18n.js') out.push(full);
  }
  return out;
}

const KEY = /^[\w-]+(\.[\w-]+)+$/;

/** The first argument of the t( call that starts at `from`: up to the first top-level comma or closing bracket. */
function firstArgument(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(from, i);
      depth--;
    } else if (ch === ',' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

/**
 * keys: what t() calls and data-i18n* attributes name (every key a ternary can pick, too);
 * prefixes: t(`prefix.${x}`); literals: every quoted dotted string, so a key kept in a lookup table counts as used.
 * @returns {{keys: Set<string>, prefixes: string[], literals: Set<string>}}
 */
function usedKeys(srcDir) {
  const keys = new Set();
  const prefixes = new Set();
  const literals = new Set();
  for (const file of sourceFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(new RegExp(CALL, 'g'))) {
      const arg = firstArgument(text, m.index + m[0].length);
      for (const s of arg.matchAll(/(['"])([^'"\n]*)\1/g)) if (KEY.test(s[2])) keys.add(s[2]);
      for (const s of arg.matchAll(/`([^`$]*)(\$\{)?[^`]*`/g)) {
        if (s[2]) { if (s[1]) prefixes.add(s[1]); } else if (KEY.test(s[1])) keys.add(s[1]);
      }
    }
    for (const m of text.matchAll(/data-i18n(?:-(?!slot)[a-z-]+)?="([^"]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/'data-i18n(?:-(?!slot)[a-z-]+)?':\s*'([^']+)'/g)) keys.add(m[1]);
    for (const m of text.matchAll(/(['"])([\w-]+(?:\.[\w-]+)+)\1/g)) literals.add(m[2]);
  }
  return { keys, prefixes: [...prefixes].sort(), literals };
}

/** 'a.b.few' → 'a.b' when the last part is a plural category, else null. */
const pluralBase = (key) => {
  const i = key.lastIndexOf('.');
  return i > 0 && CATEGORIES.includes(key.slice(i + 1)) ? key.slice(0, i) : null;
};

const pluralCategories = (lang) => {
  try {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
};

/**
 * @param {{keys: Set<string>, prefixes: string[]}} used
 * @param {Record<string, object>} locales { en: {...}, hr: {...} }
 */
function checkLocales(used, locales) {
  const en = locales.en || {};
  const enKeys = Object.keys(en);
  const plurals = new Set(enKeys.map(pluralBase).filter((b) => b && Object.hasOwn(en, `${b}.other`)));
  const isPluralForm = (key) => plurals.has(pluralBase(key));
  const enPlaceholders = (key) => {
    const base = isPluralForm(key) ? pluralBase(key) : null;
    if (!base) return placeholders(en[key] || '');
    return [...new Set(enKeys.filter((k) => pluralBase(k) === base).flatMap((k) => placeholders(en[k])))].sort();
  };

  const missing = [...used.keys].filter((k) => !Object.hasOwn(en, k) && !plurals.has(k)).sort();
  const literals = used.literals || new Set();
  const unused = enKeys.filter((k) => !ALWAYS_USED.includes(k)
    && !used.keys.has(k)
    && !literals.has(k)
    && !(isPluralForm(k) && used.keys.has(pluralBase(k)))
    && !used.prefixes.some((p) => k.startsWith(p))).sort();

  const languages = {};
  for (const [lang, strings] of Object.entries(locales)) {
    if (lang === 'en') continue;
    const cats = pluralCategories(lang);
    const required = [
      ...enKeys.filter((k) => !isPluralForm(k)),
      ...[...plurals].flatMap((b) => cats.map((c) => `${b}.${c}`)),
    ];
    const untranslated = required.filter((k) => typeof strings[k] !== 'string').sort();
    const extra = Object.keys(strings).filter((k) => !Object.hasOwn(en, k) && !(isPluralForm(k) && cats.includes(k.slice(k.lastIndexOf('.') + 1)))).sort();
    const badPlaceholders = Object.keys(strings).filter((k) => {
      if (extra.includes(k) || typeof strings[k] !== 'string') return false;
      const mine = placeholders(strings[k]);
      const theirs = enPlaceholders(k);
      return isPluralForm(k) ? mine.some((p) => !theirs.includes(p)) : mine.join() !== theirs.join();
    }).sort();
    languages[lang] = { untranslated, extra, placeholders: badPlaceholders };
  }
  const style = Object.fromEntries(Object.entries(locales).map(([lang, strings]) => [lang, styleProblems(strings)]));
  const ok = !missing.length && !unused.length
    && Object.values(languages).every((l) => !l.untranslated.length && !l.extra.length && !l.placeholders.length)
    && Object.values(style).every((keys) => !keys.length);
  return { ok, keys: enKeys.length, missing, unused, languages, style };
}

/**
 * House style in every language: a dash is a colon, a new sentence or an en dash ("F13–F24"), never a spaced
 * hyphen; a heading (a .title key) has no full stop.
 */
function styleProblems(strings) {
  return Object.entries(strings)
    .filter(([key, text]) => typeof text === 'string' && (/ - /.test(text) || (/\.title$/.test(key) && /[^.]\.$/.test(text))))
    .map(([key]) => key)
    .sort();
}

function formatReport(r) {
  const lines = [`i18n: ${r.keys} strings in en.json, translations: ${Object.keys(r.languages).join(', ') || 'none'}`];
  const list = (title, keys) => keys.length && lines.push(`✗ ${title} (${keys.length}):`, ...keys.map((k) => `    ${k}`));
  list('Used in the code but missing from en.json', r.missing);
  list('In en.json but not used anywhere', r.unused);
  for (const [lang, l] of Object.entries(r.languages)) {
    list(`${lang}.json: not translated yet`, l.untranslated);
    list(`${lang}.json: keys English no longer has`, l.extra);
    list(`${lang}.json: {placeholders} differ from English`, l.placeholders);
  }
  for (const [lang, keys] of Object.entries(r.style || {})) {
    list(`${lang}.json: a spaced hyphen as a dash (use a colon or "–"), or a heading ending in a full stop`, keys);
  }
  if (r.ok) lines.push('✓ All good.');
  return lines.join('\n');
}

if (require.main === module) {
  const { loadLocales } = require('../src/main/strings');
  const r = checkLocales(usedKeys(path.join(ROOT, 'src')), loadLocales(path.join(ROOT, 'src', 'renderer', 'locales')));
  console.log(formatReport(r));
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { usedKeys, checkLocales, formatReport };
