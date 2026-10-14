'use strict';
// Persistent settings (JSON in userData). Defaults mirror Wispr Flow's Windows
// defaults found in its bundle (module 28889): PTT = Ctrl+Win,
// hands-free = Ctrl+Win+Space, paste last = Shift+Alt+Z, dismiss = Esc.

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { DEFAULT_APP_RULES } = require('./app-styles');

const DEFAULTS = Object.freeze({
  shortcuts: {
    ptt: ['Ctrl', 'Meta'],
    handsFree: ['Ctrl', 'Meta', 'Space'],
    cancel: ['Escape'],
    pasteLast: ['Shift', 'Alt', 'Z'],
    translate: ['Ctrl', 'Meta', 'Shift'],
    command: ['Ctrl', 'Meta', 'Alt'],
    readAloud: ['Shift', 'Alt', 'S'],
  },
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
  voiceCommands: true,
  capitalize: true,
  addTrailingSpace: true,
  restoreClipboard: true,
  sounds: true,
  showIdlePill: true,
  launchAtLogin: false,
  dictionary: [{ from: 'polyspeaks', to: 'Pauli Speaks' }],
  onboarded: false,
});

const NESTED = ['shortcuts', 'cloud', 'translation', 'appStyles', 'command', 'readAloud'];

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
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(saved)) {
        if (!(k in DEFAULTS)) continue;
        this.data[k] = NESTED.includes(k) ? { ...DEFAULTS[k], ...v } : v;
      }
    } catch {
      // first run or unreadable file: keep defaults
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
      if (!(k in DEFAULTS)) continue;
      if (k === 'cloud') {
        const { apiKey, hasApiKey, ...rest } = v;
        next.cloud = { ...next.cloud, ...rest };
        if (typeof apiKey === 'string') next.cloud.apiKeyEnc = apiKey ? this.crypto.encrypt(apiKey.trim()) : '';
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

module.exports = { Settings, DEFAULTS };
