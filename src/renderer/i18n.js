'use strict';
// Translations: t(key, vars) with English fallback, Intl for numbers, dates, plurals and language names.
// One file for both sides: a CommonJS module in the main process (src/main/strings.js) and the tests, and a
// plain script in the windows, where it sets up window.I18n and a global t() from what the preload fetched.
//
// Locale files (src/renderer/locales/<code>.json) are flat: { "shortcuts.add": "+ Add", ... }.
//   {name}            filled from vars; numbers are formatted for the language
//   key.one / .few / .other …   plural forms, picked by Intl.PluralRules when vars.count is a number
// In HTML: data-i18n="key" sets the text; a {slot} in the text is filled by the child element with
// data-i18n-slot="slot" (so a sentence can wrap keycaps or a link). data-i18n-placeholder, -title and
// -aria-label set those attributes.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else core.setupWindow(root);
})(typeof self !== 'undefined' ? self : this, () => {
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  const safeLocale = (lang) => {
    try {
      return Intl.getCanonicalLocales(lang || 'en')[0] || 'en';
    } catch {
      return 'en';
    }
  };

  const fill = (text, vars, num) => text.replace(/\{(\w+)\}/g, (m, name) => {
    if (!vars || !Object.hasOwn(vars, name) || vars[name] === undefined || vars[name] === null) return m;
    const v = vars[name];
    return typeof v === 'number' ? num(v) : String(v);
  });

  /**
   * @param {{lang: string, strings: object, fallback: object}} o fallback = the English strings
   */
  function createI18n({ lang = 'en', strings = {}, fallback = {} } = {}) {
    const locale = safeLocale(lang);
    const plural = new Intl.PluralRules(locale);
    const enPlural = new Intl.PluralRules('en');
    const numberFormat = new Intl.NumberFormat(locale);
    let names = null;

    const num = (n, opts) => (opts ? new Intl.NumberFormat(locale, opts) : numberFormat).format(n);
    const has = (dict, key) => Object.hasOwn(dict, key) && typeof dict[key] === 'string';

    function lookup(key, vars) {
      if (vars && typeof vars.count === 'number') {
        for (const [dict, rules] of [[strings, plural], [fallback, enPlural]]) {
          const form = `${key}.${rules.select(vars.count)}`;
          if (has(dict, form)) return dict[form];
          if (has(dict, `${key}.other`)) return dict[`${key}.other`];
        }
      }
      if (has(strings, key)) return strings[key];
      if (has(fallback, key)) return fallback[key];
      return key;
    }

    return {
      lang: locale,
      t: (key, vars) => fill(lookup(key, vars), vars, num),
      num,
      date: (d, opts) => new Date(d).toLocaleString(locale, opts),
      /** "German" / "Njemački": a language's name in the UI language, capitalised for lists and buttons. */
      languageName(code) {
        try {
          names ||= new Intl.DisplayNames([locale], { type: 'language' });
          const name = names.of(code) || code;
          return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
        } catch {
          return code;
        }
      },
    };
  }

  /** 'Hold {keys} and say' → ['Hold ', { slot: 'keys' }, ' and say'] */
  function splitSlots(text) {
    const out = [];
    let last = 0;
    for (const m of String(text).matchAll(/\{(\w+)\}/g)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push({ slot: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  /** The {names} used in a string, sorted and unique. */
  const placeholders = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

  /** Fill every data-i18n* element under `root` (the document, or a part built later). */
  function applyTo(root, t) {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      const text = t(node.dataset.i18n);
      const slots = {};
      for (const child of node.querySelectorAll('[data-i18n-slot]')) slots[child.dataset.i18nSlot] ||= child;
      if (!Object.keys(slots).length) node.textContent = text;
      else node.replaceChildren(...splitSlots(text).map((p) => (typeof p === 'string' ? p : slots[p.slot] || `{${p.slot}}`)));
    }
    for (const attr of ATTRS) {
      const data = `data-i18n-${attr}`;
      for (const node of root.querySelectorAll(`[${data}]`)) node.setAttribute(attr, t(node.getAttribute(data)));
    }
  }

  /** In a window: window.I18n and a global t(), from the strings the preload fetched (window.pauli.i18n()). */
  function setupWindow(win) {
    const api = win.pauli;
    let data = null;
    try {
      data = api && api.i18n ? api.i18n() : null;
    } catch (err) {
      console.error('i18n: fetching the strings failed', err);
    }
    data ||= { lang: 'en', strings: {}, fallback: {}, languages: [], setting: 'system' };
    let current = createI18n(data);
    const listeners = [];
    const I18n = {
      get lang() { return current.lang; },
      get setting() { return data.setting; },
      get languages() { return data.languages || []; },
      t: (key, vars) => current.t(key, vars),
      num: (n, opts) => current.num(n, opts),
      date: (d, opts) => current.date(d, opts),
      languageName: (code) => current.languageName(code),
      apply: (root = win.document) => applyTo(root, current.t),
      onChange: (cb) => listeners.push(cb),
    };
    win.I18n = I18n;
    win.t = I18n.t;
    const apply = () => {
      win.document.documentElement.lang = current.lang;
      I18n.apply();
    };
    apply();
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', apply);
    // The pill can't reload (it records): it swaps its strings in place when the language changes.
    if (api && api.onI18n) {
      api.onI18n((next) => {
        if (!next) return;
        data = next;
        current = createI18n(data);
        apply();
        listeners.forEach((cb) => cb());
      });
    }
  }

  return { createI18n, splitSlots, placeholders, applyTo, setupWindow };
});
