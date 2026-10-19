'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { usedKeys, checkLocales, formatReport } = require('../scripts/i18n-check');

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-i18n-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

const SOURCE = {
  'src/a.js': "t('home.ready'); t(\"home.hello\", { name }); I18n.t('home.words', { count: 2 }); t(`action.${id}.title`); el('b', { 'data-i18n': 'js.attr' });",
  'src/b.html': '<p data-i18n="html.text"></p><input data-i18n-placeholder="html.placeholder" />',
  'src/renderer/locales/en.json': { 'not.code': 'locale files are not code' },
};

test('usedKeys() finds t() calls, data-i18n attributes and template prefixes', (t) => {
  const dir = tree(SOURCE);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const used = usedKeys(path.join(dir, 'src'));
  assert.deepEqual([...used.keys].sort(), ['home.hello', 'home.ready', 'home.words', 'html.placeholder', 'html.text', 'js.attr']);
  assert.deepEqual(used.prefixes, ['action.']);
});

const EN = {
  'language.name': 'English',
  'home.ready': 'Ready',
  'home.hello': 'Hello {name}',
  'home.words.one': '{count} word',
  'home.words.other': '{count} words',
  'action.dictate.title': 'Dictate',
  'html.text': 'Text',
  'html.placeholder': 'Type…',
  'js.attr': 'Attr',
  'old.unused': 'Nobody uses me',
};

test('usedKeys() sees every key a ternary can pick, and skips slot names', (t) => {
  const dir = tree({
    'src/c.js': "t(on ? 'toggle.on' : 'toggle.off', { code: code(x) }); t(n < 5 ? 'n.few' : n < 9 ? 'n.some' : 'n.many');",
    'src/d.html': '<p data-i18n="p.text">Hold <span data-i18n-slot="keys"></span></p>',
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual([...usedKeys(path.join(dir, 'src')).keys].sort(), ['n.few', 'n.many', 'n.some', 'p.text', 'toggle.off', 'toggle.on']);
});

test('usedKeys() lists every quoted dotted string, so a key kept in a lookup table counts as used', (t) => {
  const dir = tree({ 'src/e.js': "const key = { idle: 'update.status.idle', 'up-to-date': 'update.status.upToDate' }[s]; t(key);" });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const used = usedKeys(path.join(dir, 'src'));
  assert.ok(used.literals.has('update.status.idle'));
  const r = checkLocales(used, { en: { 'language.name': 'English', 'update.status.idle': 'Idle', 'update.status.upToDate': 'Up to date', 'never.used': 'x' } });
  assert.deepEqual(r.unused, ['never.used']);
  assert.deepEqual(r.missing, []);
});

test('checkLocales(): keys the code uses that en.json lacks, and en.json keys nobody uses', () => {
  const used = { keys: new Set(['home.ready', 'home.hello', 'home.words', 'html.text', 'html.placeholder', 'js.attr', 'brand.new']), prefixes: ['action.'] };
  const r = checkLocales(used, { en: EN });
  assert.deepEqual(r.missing, ['brand.new']);
  assert.deepEqual(r.unused, ['old.unused']);
});

test('checkLocales(): a translation must have every key, its plural forms, no extras and the same placeholders', () => {
  const used = { keys: new Set(Object.keys(EN)), prefixes: [] };
  const hr = {
    'language.name': 'Hrvatski',
    'home.ready': 'Spremno',
    'home.hello': 'Bok {ime}',
    'home.words.one': '{count} riječ',
    'home.words.other': '{count} riječi',
    'action.dictate.title': 'Diktiraj',
    'html.text': 'Tekst',
    'html.placeholder': 'Upiši…',
    'old.unused': 'x',
    'stale.key': 'gone from English',
  };
  const r = checkLocales(used, { en: EN, hr });
  assert.deepEqual(r.languages.hr.untranslated, ['home.words.few', 'js.attr']);
  assert.deepEqual(r.languages.hr.extra, ['stale.key']);
  assert.deepEqual(r.languages.hr.placeholders, ['home.hello']);
  assert.equal(r.ok, false);
});

test('checkLocales(): all good when everything lines up', () => {
  const en = { 'language.name': 'English', a: 'A {x}' };
  const r = checkLocales({ keys: new Set(['a']), prefixes: [] }, { en, hr: { 'language.name': 'Hrvatski', a: 'A {x}' } });
  assert.equal(r.ok, true);
  assert.match(formatReport(r), /all good/i);
});

test('formatReport() names each problem', () => {
  const r = checkLocales({ keys: new Set(['a', 'b']), prefixes: [] }, { en: { 'language.name': 'English', a: 'A', c: 'C' }, hr: { 'language.name': 'Hrvatski' } });
  const text = formatReport(r);
  assert.match(text, /missing from en\.json.*\n.*\bb\b/i);
  assert.match(text, /not used.*\n.*\bc\b/i);
  assert.match(text, /hr.*not translated/i);
});

test('the real app passes the check', () => {
  const root = path.join(__dirname, '..');
  const { loadLocales } = require('../src/main/strings');
  const r = checkLocales(usedKeys(path.join(root, 'src')), loadLocales(path.join(root, 'src', 'renderer', 'locales')));
  assert.equal(r.ok, true, formatReport(r));
});
