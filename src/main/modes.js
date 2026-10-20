'use strict';
// Modes: one bundle of "how should this dictation come out" - language, translation, style, voice commands
// (and, from M8, AI polish) - picked per shortcut, link, Switch mode or the app in front. Pure, unit tested.
//
// A mode: { id, name, color, language, translateTo, style, voiceCommands, aiPolish, prompt, apps }
//   id           a slug, fixed once made, so pauli-speaks://dictate/start?mode=<id> keeps working after a rename
//   name         '' on a built-in mode means "its name in the UI language" (modes.builtin.<id>)
//   language     null = your languages; or one code to force it
//   translateTo  null = no translation; or a language code
//   apps         exe names that switch it on (lower case); Default never has any, it is the fallback
//
// The mode for a dictation, in this order (resolveMode):
//   1. the shortcut's mode, 2. a ?mode= link or --mode= flag, 3. the Switch mode choice,
//   4. the first mode whose apps has the exe in front, 5. Default.

const { DEFAULT_APP_RULES } = require('./app-styles');

const STYLES = ['normal', 'casual', 'formal', 'code'];
const AI_POLISH = ['off', 'light', 'medium', 'high'];
const MAX_MODES = 20;
const MAX_APPS = 50;
const DEFAULT_ID = 'default';
const TRANSLATE_ID = 'translate';
const BUILTIN = new Set([DEFAULT_ID, 'chat', 'code', 'formal', TRANSLATE_ID]);
// Colours for new modes, picked in turn; the Modes page offers the same swatches.
const PALETTE = ['#8b867b', '#2f6db3', '#2e7d9a', '#7c5a8a', '#c8553d', '#b7741a', '#3d8b5a', '#a33d6b'];

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const LANGUAGE = /^[a-z]{2,3}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const BAD_APP = /[\\/:*?"<>|]/;

const has = (o, k) => Object.hasOwn(o, k);
const language = (v) => (typeof v === 'string' && LANGUAGE.test(v) ? v.toLowerCase() : null);

function cleanApps(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    let app = raw.trim().toLowerCase();
    if (!app || app.length > 100 || BAD_APP.test(app)) continue;
    if (!app.endsWith('.exe')) app += '.exe';
    if (!out.includes(app)) out.push(app);
    if (out.length >= MAX_APPS) break;
  }
  return out;
}

/** "Bilješke (HR)" → "biljeske-hr" */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/ø/g, 'o')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/, '');
}

/** An id for a mode called `name` that none of `modes` uses: "code", then "code-2", ... */
function newModeId(name, modes = []) {
  const used = new Set(modes.map((m) => m && m.id));
  const base = slugify(name) || 'mode';
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** One mode with every field present and valid (`id` already decided). */
function cleanMode(raw, id, index) {
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '',
    color: typeof raw.color === 'string' && COLOR.test(raw.color) ? raw.color.toLowerCase() : PALETTE[index % PALETTE.length],
    language: language(raw.language),
    translateTo: language(raw.translateTo),
    style: STYLES.includes(raw.style) ? raw.style : 'normal',
    voiceCommands: typeof raw.voiceCommands === 'boolean' ? raw.voiceCommands : true,
    aiPolish: AI_POLISH.includes(raw.aiPolish) ? raw.aiPolish : 'off',
    prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 4000) : '',
    apps: id === DEFAULT_ID ? [] : cleanApps(raw.apps),
  };
}

const mode = (fields) => cleanMode(fields, fields.id, 0);

const STYLE_MODES = [['chat', 'casual', '#7c5a8a'], ['code', 'code', '#2e7d9a'], ['formal', 'formal', '#2f6db3']];
const appsFor = (rules, style) => rules.filter((r) => r && r.style === style && typeof r.app === 'string').map((r) => r.app);

const DEFAULT_MODE = Object.freeze(mode({ id: DEFAULT_ID, color: '#8b867b' }));
const TRANSLATE_COLOR = '#c8553d';

const DEFAULT_MODES = Object.freeze([
  DEFAULT_MODE,
  ...STYLE_MODES.map(([id, style, color]) => mode({ id, style, color, apps: appsFor(DEFAULT_APP_RULES, style) })),
  mode({ id: TRANSLATE_ID, color: TRANSLATE_COLOR, translateTo: 'en' }),
].map(Object.freeze));

/**
 * Repair a mode list from disk or from the window: objects only, unique valid ids (made from the name when
 * missing), every field valid, Default first with no apps, at most MAX_MODES. Not a list: the defaults.
 */
function normalizeModes(list) {
  if (!Array.isArray(list)) return structuredClone(DEFAULT_MODES);
  const out = [];
  list.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const id = typeof raw.id === 'string' && ID.test(raw.id) && !out.some((m) => m.id === raw.id)
      ? raw.id
      : newModeId(typeof raw.name === 'string' ? raw.name : '', out);
    out.push(cleanMode(raw, id, out.length));
  });
  const i = out.findIndex((m) => m.id === DEFAULT_ID);
  const def = i >= 0 ? out.splice(i, 1)[0] : structuredClone(DEFAULT_MODE);
  return [def, ...out].slice(0, MAX_MODES);
}

const findMode = (modes, id) => (typeof id === 'string' && id
  ? modes.find((m) => m.id === id) || modes.find((m) => m.id === id.toLowerCase()) || null
  : null);

/** A shortcut that names its mode (or the old Talk & translate action) fixes the mode; others are Automatic. */
const pinsMode = (binding) => !!binding && ((typeof binding.mode === 'string' && binding.mode !== '') || binding.action === 'translate');

/**
 * The mode a dictation uses (see the order at the top). A mode that no longer exists is skipped.
 * @param {{binding?: {action?: string, mode?: string}|null, link?: string|null, switched?: string|null,
 *          exe?: string|null, modes?: object[], translateTarget?: string}} o
 *   translateTarget: for the old Talk & translate action when there is no Translate mode
 */
function resolveMode({ binding = null, link = null, switched = null, exe = null, modes, translateTarget = 'en' } = {}) {
  const list = Array.isArray(modes) && modes.length ? modes : DEFAULT_MODES;
  const def = findMode(list, DEFAULT_ID) || list[0];
  if (binding && binding.action === 'translate' && !binding.mode) {
    return findMode(list, TRANSLATE_ID) || { ...def, id: TRANSLATE_ID, name: '', translateTo: language(translateTarget) || 'en' };
  }
  const pinned = (binding && findMode(list, binding.mode)) || findMode(list, link) || findMode(list, switched);
  if (pinned) return pinned;
  const name = typeof exe === 'string' ? exe.toLowerCase() : '';
  return (name && list.find((m) => m.apps.includes(name))) || def;
}

/** Switch mode: Automatic (null) → each mode in turn → Automatic. */
function nextMode(modes, currentId) {
  const order = [null, ...modes.map((m) => m.id)];
  const i = Math.max(0, order.indexOf(currentId ?? null)); // a mode that is gone counts as Automatic
  return order[(i + 1) % order.length];
}

/**
 * The name to show: the one the user gave, or a built-in mode's name in the UI language.
 * @param {{t: (key: string, vars?: object) => string, languageName: (code: string) => string}} i18n
 */
function modeLabel(m, { t, languageName }) {
  if (m.name) return m.name;
  if (!BUILTIN.has(m.id)) return m.id;
  return m.id === TRANSLATE_ID ? t('modes.builtin.translate', { language: languageName(m.translateTo || 'en') }) : t(`modes.builtin.${m.id}`);
}

/**
 * Settings v6 → v7: app styles, "Always translate" and Talk & translate shortcuts become modes.
 *   - appStyles rules → one mode per style that has apps (Chat, Code, Formal) with those apps; switched off →
 *     the same modes without apps; a file without appStyles had the defaults.
 *   - translation.always → every migrated mode translates (Default alone would stop translating in Slack).
 *   - Talk & translate shortcuts → Dictate shortcuts for a "Translate to <target>" mode. A file without
 *     shortcuts had the default Talk & translate one.
 * appStyles and translation.always leave the file (settings.v6.json keeps them).
 */
function v6to7(saved) {
  const out = { ...saved };
  const translation = saved.translation && typeof saved.translation === 'object' ? saved.translation : {};
  const target = language(translation.target) || 'en';
  const always = translation.always === true;
  const bindings = Array.isArray(saved.bindings) ? saved.bindings : null;
  const translateKeys = bindings ? bindings.some((b) => b && b.action === 'translate') : true;

  if (!Array.isArray(saved.modes)) {
    const styles = saved.appStyles && typeof saved.appStyles === 'object' ? saved.appStyles : { enabled: true, rules: DEFAULT_APP_RULES };
    const rules = Array.isArray(styles.rules) ? styles.rules : [];
    const modes = [{ id: DEFAULT_ID, color: DEFAULT_MODE.color }];
    for (const [id, style, color] of STYLE_MODES) {
      const apps = appsFor(rules, style);
      if (apps.length) modes.push({ id, style, color, apps: styles.enabled === false ? [] : apps });
    }
    if (translateKeys) modes.push({ id: TRANSLATE_ID, color: TRANSLATE_COLOR, translateTo: target });
    out.modes = normalizeModes(modes.map((m) => (always ? { ...m, translateTo: target } : m)));
  }
  if (bindings) out.bindings = bindings.map((b) => (b && b.action === 'translate' ? { ...b, action: 'dictate', mode: TRANSLATE_ID } : b));
  delete out.appStyles;
  if (has(saved, 'translation') && saved.translation && typeof saved.translation === 'object') {
    const { always: _always, ...rest } = saved.translation;
    out.translation = rest;
  }
  return out;
}

module.exports = {
  STYLES, AI_POLISH, MAX_MODES, PALETTE, DEFAULT_ID, TRANSLATE_ID, DEFAULT_MODE, DEFAULT_MODES,
  normalizeModes, newModeId, slugify, findMode, pinsMode, resolveMode, nextMode, modeLabel, v6to7,
};
