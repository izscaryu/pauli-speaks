'use strict';
// The main process's text (pill messages, tray menu, notifications, dialogs, errors shown in the window),
// from the same locale files as the windows: src/renderer/locales/<code>.json. The list of UI languages is
// the folder's listing, so a new language is one file.
//
// One shared instance: modules call t() at the moment they show something, so a language change applies at
// once. It speaks English until main calls setLanguage() with the uiLanguage setting.

const fs = require('node:fs');
const path = require('node:path');
const { createI18n } = require('../renderer/i18n');

const LOCALES_DIR = path.join(__dirname, '..', 'renderer', 'locales');
const CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/** { en: {...}, hr: {...} }: every <code>.json that parses to an object. */
function loadLocales(dir) {
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const code = name.replace(/\.json$/i, '');
    if (code === name || !CODE.test(code)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) out[code.toLowerCase()] = data;
    } catch {
      // a broken file is skipped: English fills in
    }
  }
  return out;
}

/** [{ code, name }] for the picker: each language named in itself, English first, then by name. */
function languageList(locales) {
  return Object.entries(locales)
    .map(([code, s]) => ({ code, name: typeof s['language.name'] === 'string' ? s['language.name'] : code }))
    .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.name.localeCompare(b.name)));
}

/**
 * The UI language: the chosen one when there is a file for it, else the first Windows language there is a
 * file for ("hr-HR" → "hr"), else English.
 */
function resolveLanguage(setting, systemLanguages, codes) {
  const have = (c) => codes.includes(c);
  if (typeof setting === 'string' && setting !== 'system' && have(setting)) return setting;
  for (const tag of Array.isArray(systemLanguages) ? systemLanguages : []) {
    if (typeof tag !== 'string') continue;
    const lower = tag.toLowerCase();
    if (have(lower)) return lower;
    const base = lower.split(/[-_]/)[0];
    if (have(base)) return base;
  }
  return 'en';
}

function createStrings({ dir = LOCALES_DIR } = {}) {
  const locales = loadLocales(dir);
  const fallback = locales.en || {};
  const languages = languageList(locales);
  let setting = 'system';
  let lang = 'en';
  let current = createI18n({ lang, strings: fallback, fallback });

  return {
    get lang() { return lang; },
    t: (key, vars) => current.t(key, vars),
    /** @param {string} next the uiLanguage setting ('system' or a code) @param {string[]} systemLanguages Windows' */
    setLanguage(next, systemLanguages) {
      setting = typeof next === 'string' ? next : 'system';
      lang = resolveLanguage(setting, systemLanguages, Object.keys(locales));
      current = createI18n({ lang, strings: locales[lang] || fallback, fallback });
      return lang;
    },
    /** What a window needs to translate itself (the preload fetches it once per page load). */
    payload: () => ({ lang, setting, strings: locales[lang] || fallback, fallback, languages }),
  };
}

const shared = createStrings();

module.exports = {
  t: shared.t,
  setLanguage: shared.setLanguage,
  payload: shared.payload,
  currentLanguage: () => shared.lang,
  loadLocales, languageList, resolveLanguage, createStrings, LOCALES_DIR,
};
