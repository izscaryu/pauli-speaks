'use strict';
// Persistent settings (JSON in userData). Default shortcuts: hold Ctrl+Win to
// talk, Ctrl+Win+Space hands-free, Shift+Alt+Z paste last, Esc cancel.
//
// Shortcuts are a list of bindings, several per action, each with its own
// behaviour. Version 1 files stored one key combination per action
// (`shortcuts: {ptt: [...], handsFree: [...]}`) and a voice-command on/off
// switch; they are migrated on load, and the old file is kept as settings.v1.json.

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
  dictionary: [{ from: 'polyspeaks', to: 'Pauli Speaks' }],
  onboarded: false,
});

const NESTED = ['cloud', 'translation', 'appStyles', 'command', 'readAloud'];

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
 * Bring a saved settings object up to the current shape (pure).
 * @returns {object} a new object; `shortcuts` and a boolean `voiceCommands` are gone
 */
function migrateSettings(saved) {
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
  if ('bindings' in out) out.bindings = normalizeBindings(out.bindings);
  if ('voiceCommands' in out) out.voiceCommands = normalizeVoiceCommands(out.voiceCommands);
  return out;
}

const needsMigration = (saved) => 'shortcuts' in saved || typeof saved.voiceCommands === 'boolean';

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
    if (!saved || typeof saved !== 'object') return;
    for (const [k, v] of Object.entries(migrateSettings(saved))) {
      if (!isSetting(k)) continue;
      this.data[k] = NESTED.includes(k) ? { ...DEFAULTS[k], ...v } : v;
    }
    if (needsMigration(saved)) {
      try {
        fs.copyFileSync(file, path.join(path.dirname(file), 'settings.v1.json'));
        this.#save();
      } catch {
        // read-only folder: the migration still applies in memory
      }
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

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Settings, DEFAULTS, migrateSettings };
