'use strict';
// Persistent settings (JSON in userData). Default shortcuts: hold Ctrl+Win to
// talk, Ctrl+Win+Space hands-free, Shift+Alt+Z paste last, Esc cancel.
//
// settings.json carries a settingsVersion number. Older files are brought up to
// date on load by the steps in MIGRATIONS, and the file as it was is kept once
// as settings.v<its version>.json. Files without a number are version 1.

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DEFAULT_APP_RULES } = require('./app-styles');
const { normalizeBindings } = require('./shortcut-rules');
const { DEFAULT_VOICE_COMMANDS, normalizeVoiceCommands } = require('./voice-commands');

const DEFAULTS = Object.freeze({
  bindings: [
    { id: 'dictate-1', action: 'dictate', keys: ['Ctrl', 'Meta'], behaviour: 'both' },
    { id: 'dictate-2', action: 'dictate', keys: ['Ctrl', 'Meta', 'Space'], behaviour: 'toggle' },
    { id: 'translate-1', action: 'translate', keys: ['Ctrl', 'Meta', 'Shift'], behaviour: 'both' },
    { id: 'command-1', action: 'command', keys: ['Ctrl', 'Meta', 'Alt'], behaviour: 'both' },
    { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
    { id: 'pasteLast-1', action: 'pasteLast', keys: ['Shift', 'Alt', 'Z'] },
    { id: 'readAloud-1', action: 'readAloud', keys: ['Shift', 'Alt', 'S'] },
  ],
  acceleration: 'auto',
  vocabularyPrompt: true,
  snippets: [],
  autoStopSilence: 0,
  livePreview: false,
  appStyles: {
    enabled: true,
    rules: DEFAULT_APP_RULES,
  },
  command: {
    model: 'llama-3.3-70b-versatile',
  },
  readAloud: {
    voice: '',
    rate: 1,
  },
  translation: {
    always: false,
    target: 'en',
    quality: 'fast',
  },
  microphoneId: 'default',
  engine: 'local',
  localModel: 'onnx-community/whisper-base',
  languages: [],
  cloud: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    apiKeyEnc: '',
  },
  removeFillers: true,
  voiceCommandsEnabled: true,
  voiceCommands: DEFAULT_VOICE_COMMANDS,
  capitalize: true,
  addTrailingSpace: true,
  restoreClipboard: true,
  sounds: true,
  showIdlePill: true,
  launchAtLogin: false,
  betaUpdates: false,
  dictionary: [{ from: 'polyspeaks', to: 'Pauli Speaks' }],
  onboarded: false,
  setupCard: false,
  lastSeenVersion: '',
  silenceDetection: true,
  crashRecovery: true,
  historyRetention: 'keep', // 'keep' | '24h' | 'off'
  audioHistory: 'off', // 'off' | '24h'
  languageHints: { shown: [] },
  uiLanguage: 'system', // 'system' (same as Windows) or a locale file's code: 'en', 'hr', ...
});

// reset() leaves these out of the change it announces: the model they name would start downloading.
const RESET_QUIET = ['engine', 'localModel', 'acceleration', 'translation'];

const NESTED = ['cloud', 'translation', 'appStyles', 'command', 'readAloud', 'languageHints'];

/** Known settings only - never inherited names like "__proto__" or "constructor" from a file or the window. */
const isSetting = (k) => Object.hasOwn(DEFAULTS, k);

// Version 1: one combination per action, PTT and hands-free as separate actions.
const V1_SHORTCUTS = {
  ptt: ['Ctrl', 'Meta'],
  handsFree: ['Ctrl', 'Meta', 'Space'],
  cancel: ['Escape'],
  pasteLast: ['Shift', 'Alt', 'Z'],
  translate: ['Ctrl', 'Meta', 'Shift'],
  command: ['Ctrl', 'Meta', 'Alt'],
  readAloud: ['Shift', 'Alt', 'S'],
};
const V1_ACTIONS = {
  ptt: { action: 'dictate', behaviour: 'both' },
  handsFree: { action: 'dictate', behaviour: 'toggle' },
  translate: { action: 'translate', behaviour: 'both' },
  command: { action: 'command', behaviour: 'both' },
  cancel: { action: 'cancel' },
  pasteLast: { action: 'pasteLast' },
  readAloud: { action: 'readAloud' },
};

/**
 * Version 1 → 2 (Triggers 1.0): one shortcut per action becomes a list of
 * bindings, and the voice-command on/off switch becomes voiceCommandsEnabled
 * plus an editable list. Leaves files that already have bindings alone.
 */
function v1to2(saved) {
  const out = { ...saved };
  if (!Array.isArray(out.bindings) && out.shortcuts && typeof out.shortcuts === 'object') {
    const shortcuts = { ...V1_SHORTCUTS, ...out.shortcuts };
    out.bindings = Object.entries(V1_ACTIONS)
      .filter(([old]) => Array.isArray(shortcuts[old]) && shortcuts[old].length)
      .map(([old, target]) => ({ ...target, keys: shortcuts[old] }));
  }
  delete out.shortcuts;
  if (typeof out.voiceCommands === 'boolean') {
    if (!('voiceCommandsEnabled' in out)) out.voiceCommandsEnabled = out.voiceCommands;
    out.voiceCommands = structuredClone(DEFAULT_VOICE_COMMANDS);
  }
  return out;
}

/** Version 2 → 3: "Get early versions" (About → Updates) arrives, switched off. */
function v2to3(saved) {
  return { ...saved, betaUpdates: saved.betaUpdates === true };
}

/**
 * Version 3 → 4 (welcome flow): "onboarded" now means the welcome flow is
 * finished or skipped. Existing users keep their Home setup card; lastSeenVersion
 * stays unset so they see What's new once.
 */
function v3to4(saved) {
  return { ...saved, setupCard: saved.onboarded === true };
}

/** Version 4 → 5 (dictation that just works): adds the new settings the file lacks, with their defaults. */
function v4to5(saved) {
  const out = { ...saved };
  for (const key of ['silenceDetection', 'crashRecovery', 'historyRetention', 'audioHistory', 'languageHints']) {
    if (!Object.hasOwn(out, key)) out[key] = structuredClone(DEFAULTS[key]);
  }
  return out;
}

/** Version 5 → 6 (speaks your language): the window's language, following Windows unless one was chosen. */
function v5to6(saved) {
  return { ...saved, uiLanguage: typeof saved.uiLanguage === 'string' ? saved.uiLanguage : 'system' };
}

/** Every change to the shape of settings.json is a step here, in order. */
const MIGRATIONS = Object.freeze([
  { from: 1, to: 2, run: v1to2 },
  { from: 2, to: 3, run: v2to3 },
  { from: 3, to: 4, run: v3to4 },
  { from: 4, to: 5, run: v4to5 },
  { from: 5, to: 6, run: v5to6 },
]);

/** 'system' or something shaped like a locale code; strings.js falls back to English for a code without a file. */
const isUiLanguage = (v) => typeof v === 'string' && (v === 'system' || /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(v));
const SETTINGS_VERSION = MIGRATIONS.at(-1).to;

/** Files written before settings were numbered are version 1. */
const versionOf = (saved) => (Number.isInteger(saved.settingsVersion) && saved.settingsVersion > 0 ? saved.settingsVersion : 1);

/**
 * Run the migrations from the file's version up to `target` (pure).
 * A file from a newer version is returned unchanged.
 */
function runMigrations(saved, migrations, target) {
  let out = { ...saved };
  for (let v = versionOf(saved); v < target; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new Error(`No settings migration from version ${v}`);
    out = { ...step.run(out), settingsVersion: step.to };
  }
  return out;
}

/**
 * Bring a saved settings object up to the current version and clean the
 * lists that can be hand-edited (pure).
 */
function migrateSettings(saved) {
  const out = runMigrations(saved, MIGRATIONS, SETTINGS_VERSION);
  if ('bindings' in out) out.bindings = normalizeBindings(out.bindings);
  if ('voiceCommands' in out) out.voiceCommands = normalizeVoiceCommands(out.voiceCommands);
  return out;
}

class Settings extends EventEmitter {
  /**
   * @param {string} file
   * @param {{encrypt: (s: string) => string, decrypt: (s: string) => string}} crypto
   */
  constructor(file, crypto) {
    super();
    this.file = file;
    this.crypto = crypto;
    this.data = structuredClone(DEFAULTS);
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // first run or unreadable file: keep defaults
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    for (const [k, v] of Object.entries(migrateSettings(saved))) {
      if (!isSetting(k)) continue;
      this.data[k] = NESTED.includes(k) ? { ...DEFAULTS[k], ...v } : v;
    }
    const version = versionOf(saved);
    if (saved.settingsVersion === SETTINGS_VERSION) return;
    try {
      // Keep the file as it was, once per version: an existing backup is never replaced.
      fs.copyFileSync(file, path.join(path.dirname(file), `settings.v${version}.json`), fs.constants.COPYFILE_EXCL);
    } catch {
      // backup already there, or a read-only folder
    }
    if (version > SETTINGS_VERSION) return; // from a newer Pauli Speaks: read what we understand, save only on change
    try {
      this.#save();
    } catch {
      // read-only folder: the migration still applies in memory
    }
  }

  get() {
    return this.data;
  }

  /** Settings safe to hand to a renderer (no secrets). */
  getPublic() {
    const { apiKeyEnc, ...cloud } = this.data.cloud;
    return { ...this.data, cloud: { ...cloud, hasApiKey: !!apiKeyEnc } };
  }

  getApiKey() {
    const enc = this.data.cloud.apiKeyEnc;
    if (!enc) return '';
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return '';
    }
  }

  update(patch) {
    const next = { ...this.data };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!isSetting(k)) continue;
      if (k === 'cloud') {
        const { apiKey, hasApiKey, ...rest } = v;
        next.cloud = { ...next.cloud, ...rest };
        if (typeof apiKey === 'string') next.cloud.apiKeyEnc = apiKey ? this.crypto.encrypt(apiKey.trim()) : '';
      } else if (k === 'bindings') {
        next.bindings = normalizeBindings(v);
      } else if (k === 'voiceCommands') {
        next.voiceCommands = normalizeVoiceCommands(v);
      } else if (k === 'uiLanguage') {
        if (isUiLanguage(v)) next.uiLanguage = v;
      } else if (NESTED.includes(k)) {
        next[k] = { ...next[k], ...v };
      } else {
        next[k] = v;
      }
    }
    this.data = next;
    this.#save();
    this.emit('change', this.data, patch);
    return this.data;
  }

  /**
   * "Delete all my data": every setting back to its default (onboarded false, so the welcome flow runs
   * again), the API key gone, and the older copies kept at upgrades (settings.v<N>.json) deleted.
   * The change is announced without the speech and translation model keys, so nothing starts downloading.
   */
  reset() {
    this.data = structuredClone(DEFAULTS);
    this.#save();
    const dir = path.dirname(this.file);
    for (const name of fs.readdirSync(dir)) {
      if (/^settings\.v\d+\.json$/.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
    const patch = Object.fromEntries(Object.keys(DEFAULTS).filter((k) => !RESET_QUIET.includes(k)).map((k) => [k, structuredClone(DEFAULTS[k])]));
    this.emit('change', this.data, patch);
    return this.data;
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ settingsVersion: SETTINGS_VERSION, ...this.data }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Settings, DEFAULTS, SETTINGS_VERSION, MIGRATIONS, runMigrations, migrateSettings };
