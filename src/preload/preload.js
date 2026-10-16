'use strict';
// Bridge between renderers (main window + overlay pill) and the main process.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pauli', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onSettings: on('settings:changed'),

  welcomeSystem: () => ipcRenderer.invoke('welcome:system'),
  welcomeRecommend: (languages) => ipcRenderer.invoke('welcome:recommend', { languages }),
  finishWelcome: () => ipcRenderer.invoke('welcome:finish'),
  healthState: () => ipcRenderer.invoke('health:state'),
  getWhatsNew: () => ipcRenderer.invoke('whatsnew:get'),
  whatsNewSeen: () => ipcRenderer.invoke('whatsnew:seen'),
  redownloadModel: () => ipcRenderer.invoke('model:redownload'),
  exportSettings: () => ipcRenderer.invoke('backup:export'),
  importSettings: () => ipcRenderer.invoke('backup:import'),

  listHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
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

  getDictationStatus: () => ipcRenderer.invoke('dictation:status'),
  onDictationStatus: on('dictation:status'),
  onError: on('app:error'),

  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (which) => ipcRenderer.invoke('app:open-path', which),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // overlay pill + recorder
  onOverlayState: on('overlay:state'),
  setOverlayHover: (inside) => ipcRenderer.send('overlay:hover', inside),
  toggleDictation: () => ipcRenderer.send('dictation:toggle'),
  cancelDictation: () => ipcRenderer.send('dictation:cancel'),
  onRecorderStart: on('recorder:start'),
  onRecorderStop: on('recorder:stop'),
  onRecorderSnapshot: on('recorder:snapshot'),
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
