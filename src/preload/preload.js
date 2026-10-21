'use strict';
// Bridge between renderers (main window + overlay pill) and the main process.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pauli', {
  // Synchronous on purpose: i18n.js needs the strings before the page's own scripts run.
  i18n: () => ipcRenderer.sendSync('i18n:get'),
  onI18n: on('i18n:changed'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onSettings: on('settings:changed'),

  welcomeSystem: () => ipcRenderer.invoke('welcome:system'),
  welcomeRecommend: (languages) => ipcRenderer.invoke('welcome:recommend', { languages }),
  welcomeLanguages: (languages) => ipcRenderer.invoke('welcome:languages', { languages }),
  finishWelcome: () => ipcRenderer.invoke('welcome:finish'),
  healthState: () => ipcRenderer.invoke('health:state'),
  getWhatsNew: () => ipcRenderer.invoke('whatsnew:get'),
  whatsNewSeen: () => ipcRenderer.invoke('whatsnew:seen'),
  redownloadModel: () => ipcRenderer.invoke('model:redownload'),
  recoveryState: () => ipcRenderer.invoke('recovery:state'),
  recoverDictation: () => ipcRenderer.invoke('recovery:recover'),
  discardRecovery: () => ipcRenderer.invoke('recovery:discard'),
  languageHint: () => ipcRenderer.invoke('language-hint:state'),
  addHintedLanguage: (code) => ipcRenderer.invoke('language-hint:add', code),
  dismissLanguageHint: (code) => ipcRenderer.invoke('language-hint:dismiss', code),
  onLanguageHint: on('language-hint:changed'),
  exportSettings: () => ipcRenderer.invoke('backup:export'),
  importSettings: () => ipcRenderer.invoke('backup:import'),

  listHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  retryHistory: (id) => ipcRenderer.invoke('history:retry', id),
  historyAudio: (id) => ipcRenderer.invoke('history:audio', id),
  privacyModels: () => ipcRenderer.invoke('privacy:models'),
  deleteModels: () => ipcRenderer.invoke('privacy:delete-models'),
  deleteModel: (id) => ipcRenderer.invoke('privacy:delete-model', id),
  deleteAllData: () => ipcRenderer.invoke('privacy:delete-all'),
  retentionDrops: (retention) => ipcRenderer.invoke('privacy:retention-drops', retention),
  getStats: () => ipcRenderer.invoke('stats:get'),
  onHistory: on('history:changed'),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),

  recordShortcut: (opts) => ipcRenderer.invoke('shortcut:record-start', opts),
  stopRecordingShortcut: () => ipcRenderer.invoke('shortcut:record-stop'),
  confirmShortcut: () => ipcRenderer.invoke('shortcut:record-confirm'),
  retryShortcut: () => ipcRenderer.invoke('shortcut:record-retry'),
  onShortcutRecording: on('shortcut:recording'),
  setKeyTest: (on) => ipcRenderer.invoke('shortcut:test', on),
  onKeyTest: on('shortcut:test'),
  resetShortcuts: () => ipcRenderer.invoke('shortcut:reset'),

  getModelState: () => ipcRenderer.invoke('model:state'),
  loadModel: () => ipcRenderer.invoke('model:load'),
  loadTranslator: () => ipcRenderer.invoke('translator:load'),
  onModelState: on('model:state'),
  testCloud: () => ipcRenderer.invoke('cloud:test'),

  // AI polish (Settings → AI polish): servers on this PC, a test, and Foundry Local's models
  findPolishServers: () => ipcRenderer.invoke('polish:detect'),
  testPolish: () => ipcRenderer.invoke('polish:test'),
  foundryCatalog: () => ipcRenderer.invoke('foundry:catalog'),
  foundryDownload: (id) => ipcRenderer.invoke('foundry:download', id),
  foundryCancel: () => ipcRenderer.invoke('foundry:cancel'),
  foundryRemove: (id) => ipcRenderer.invoke('foundry:remove', id),
  onFoundryProgress: on('foundry:progress'),

  getDictationStatus: () => ipcRenderer.invoke('dictation:status'),
  onDictationStatus: on('dictation:status'),
  onError: on('app:error'),

  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (which) => ipcRenderer.invoke('app:open-path', which),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  copyDiagnostics: () => ipcRenderer.invoke('diagnostics:copy'),
  reportProblem: () => ipcRenderer.invoke('diagnostics:report'),

  // overlay pill + recorder
  onOverlayState: on('overlay:state'),
  setOverlayHover: (inside) => ipcRenderer.send('overlay:hover', inside),
  toggleDictation: () => ipcRenderer.send('dictation:toggle'),
  cancelDictation: () => ipcRenderer.send('dictation:cancel'),
  pillAction: (id) => ipcRenderer.send('overlay:action', id),
  pillLanguage: () => ipcRenderer.send('overlay:language'), // the next language for this dictation (pill.js)
  pillMoved: (screenX) => ipcRenderer.send('overlay:moved', screenX), // dropped: left, centre or right
  onRecorderStart: on('recorder:start'),
  onRecorderStop: on('recorder:stop'),
  onRecorderSnapshot: on('recorder:snapshot'),
  onRecorderTail: on('recorder:tail'),
  onRecorderVadFallback: on('recorder:vad-fallback'),
  sendAudio: (id, audio) => ipcRenderer.send('recorder:audio', { id, audio }),
  sendSilence: () => ipcRenderer.send('recorder:silence'),
  sendRecorderError: (message) => ipcRenderer.send('recorder:error', message),
  onTtsSpeak: on('tts:speak'),
  onTtsStop: on('tts:stop'),
  ttsEnded: () => ipcRenderer.send('tts:ended'),

  // main window extras
  onNavigate: on('app:navigate'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: on('update:state'),
  testCommand: () => ipcRenderer.invoke('command:test'),
  transcribeFile: (audio, translate) => ipcRenderer.invoke('file:transcribe', { audio, translate }),
  onFileProgress: on('file:progress'),
  saveTranscript: (payload) => ipcRenderer.invoke('file:save', payload),
});
