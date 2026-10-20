'use strict';
// Pauli Speaks - main process.
//
// Architecture:
//   keyboard.js  global low-level hook -> shortcut-engine (exact key-set match)
//   dictation-controller.js  push-to-talk / hands-free / translate / command state machine
//   overlay window  floating status pill + microphone capture (16 kHz mono) + read aloud
//   asr/  Whisper (GPU via DirectML or CPU) in a utility process, NLLB translation,
//         or an OpenAI-compatible cloud API
//   text-cleanup.js  fillers, voice commands, dictionary, snippets, per-app style
//   paster.js  clipboard swap + SendInput Ctrl+V + clipboard restore, selection capture
//   llm.js  command mode (edit the selection by voice)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, session, clipboard, safeStorage, dialog,
} = require('electron');

const log = require('./logger');
const win32 = require('./win32');
const { Settings, DEFAULTS } = require('./settings');
const { History } = require('./history');
const { createAudioHistory } = require('./audio-history');
const { createPrivacy, deleteAllData } = require('./privacy');
const { registerPrivacyIpc } = require('./privacy-ipc');
const { KeyboardService } = require('./keyboard');
const { DictationController } = require('./dictation-controller');
const { isTalkAction } = require('./shortcut-rules');
const { sameSet } = require('./shortcut-engine');
const { ShortcutRecorder } = require('./shortcut-recorder');
const { LastPaste } = require('./last-paste');
const { formatShortcut, sortKeys, VK } = require('./keys');
const { cleanTranscript, toSrt } = require('./text-cleanup');
const { speechLevel, SAMPLE_RATE } = require('./audio-utils');
const { gateSpeech, reportOncePerMessage, SILENCE_LEVEL } = require('./speech-gate');
const { createRecoveryFile } = require('./recovery-file');
const { createListeningSession } = require('./listening-session');
const { createPendingAudio } = require('./pending-audio');
const { createRetryOffers } = require('./retry-offers');
const { createDictationFlow } = require('./dictation-flow');
const { createDictationRun } = require('./dictation-run');
const { createTyping } = require('./typing');
const { pasteText, pressKey, getSelectedText, writeExcluded } = require('./paster');
const { PROTOCOL, parseCommandLine } = require('./remote');
const { createModeSession } = require('./mode-session');
const { createFileTranscriber } = require('./files');
const { modeLabel, withModesFor, DEFAULT_MODE } = require('./modes');
const { buildCommandMessages, chatComplete } = require('./llm');
const { LocalAsr } = require('./asr/local-asr');
const { transcribeCloud } = require('./asr/cloud');
const { createEngines } = require('./asr/engines');
const { createWhisperEngine } = require('./asr/engines/whisper');
const { createCloudEngine } = require('./asr/engines/cloud');
const { MODELS, isModelDownloaded, canWhisperTranslate, buildPrompt } = require('./asr/whisper-local');
const { NLLB_MODEL, NLLB_SIZE, NLLB_CODES } = require('./asr/translator-local');
const { Updater } = require('./updater');
const { setupPortable } = require('./portable');
const { shouldPreloadAtStartup, shouldOfferSmallerModel, isAllowedExternalUrl } = require('./system-check');
const { registerWelcomeIpc, registerBackupIpc, runningProcessNames } = require('./welcome-ipc');
const { registerRecoveryIpc } = require('./recovery-ipc');
const { registerDiagnosticsIpc } = require('./diagnostics-ipc');
const { e2eEnabled, createE2E } = require('./e2e');
const { createLanguageHints } = require('./language-hints');
const { readChangelog } = require('./changelog');
const { registerI18nIpc } = require('./i18n-ipc');
const { trayTemplate, trayHints } = require('./tray-menu');
const { t, languageName } = require('./strings');

// Before anything reads userData: a portable copy keeps its data next to its exe.
const portable = setupPortable(app);
// Development only: run against a scratch data folder instead of the real one.
if (!app.isPackaged && process.env.PAULI_USER_DATA_DIR) app.setPath('userData', process.env.PAULI_USER_DATA_DIR);
// End-to-end tests only (e2e.js): fake paster, keys, clipboard and speech engine, and a fake microphone.
const e2e = e2eEnabled(app) ? createE2E() : null;
if (e2e) for (const sw of ['use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream']) app.commandLine.appendSwitch(sw);
const io = e2e ? e2e.io : { pasteText, pressKey, getSelectedText, writeClipboard: (text) => clipboard.writeText(text) };
/** The app in front (e2e: the one a test names, so per-app modes can be tested). */
const foregroundApp = () => (e2e && e2e.state.foreground ? { exe: e2e.state.foreground, pid: 0 } : win32.foregroundApp());

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const OVERLAY_SIZE = { width: 560, height: 160 };
const PREVIEW_INTERVAL_MS = 1500;
const PREVIEW_MAX_SECONDS = 25;

let settings;
let history;
let keyboard;
let controller;
let asr;
let engines = null; // Whisper on this PC, or a cloud service (asr/engines/), by settings.engine
let tray = null;
let overlay = null;
let mainWindow = null;
let quitting = false;
let modelState = { model: null, acceleration: null, status: 'idle', percent: 0, error: null, device: null };
let translatorState = { status: 'idle', percent: 0, error: null };
let recorder = null; // ShortcutRecorder behind "+ Add" on the Shortcuts page
let keyTest = null; // "Test a key" readout: { max }
let lastTalkBinding = null;
let hookError = null; // why the global keyboard hook did not start (null: it did)
const lastPaste = new LastPaste(); // what typing.undoLast removes
let overlayReady = false;
const remoteQueue = [];
let trayHintShown = false;
let sessionApp = null;
let modes = null; // which mode a dictation runs in, and the Switch mode choice (mode-session.js)
let previewTimer = null;
let previewBusy = false;
let recovery = null; // crash-recovery file of the dictation in progress
let recoveryIpc = null; // Home's "Recover your last dictation?"
let languageHints = null; // Home's "Sounds like <Language>. Add it to your languages?"
let i18nIpc = null; // the UI language (strings.js) and the windows' copy of it
let audioHistory = null; // recordings kept for 24 hours (Settings → Privacy)
let privacy = null; // retention, hourly sweep, saved recordings
let listening = null; // tap + crash file + live VAD of the dictation in progress
let retry = null; // Retry / Undo: audio kept in memory (retry-offers.js)
let flow = null; // what happens to a recording after the microphone stops (dictation-flow.js)
let run = null; // transcribe, clean up, paste; command mode (dictation-run.js)
let typing = null; // paste, Enter, undo last, voice commands (typing.js)
let reading = false;
let files = null; // Files → transcribe a file (files.js)
let updater = null;
let updateNotified = false;
const audioRequests = new Map();
let nextAudioId = 1;

const modelsDir = () => path.join(app.getPath('userData'), 'models');
const asset = (name) => path.join(ROOT, 'assets', name);

// ---------------------------------------------------------------- windows

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcast(channel, payload) {
  send(mainWindow, channel, payload);
  send(overlay, channel, payload);
}

function positionOverlay() {
  if (!overlay) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  overlay.setBounds({
    x: Math.round(wa.x + (wa.width - OVERLAY_SIZE.width) / 2),
    y: Math.round(wa.y + wa.height - OVERLAY_SIZE.height - 6),
    ...OVERLAY_SIZE,
  });
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: PRELOAD,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(RENDERER, 'overlay.html'));
  overlay.webContents.once('did-finish-load', () => {
    positionOverlay();
    sendOverlayState({ state: 'idle' });
    if (settings.get().showIdlePill) overlay.showInactive();
    overlayReady = true;
    remoteQueue.splice(0).forEach(runRemote); // links / flags that arrived before the recorder could start
  });
  overlay.on('closed', () => {
    overlay = null;
  });
}

function showOverlay() {
  if (!overlay) return;
  positionOverlay();
  if (!overlay.isVisible()) overlay.showInactive();
}

function hideOverlayIfIdle() {
  if (overlay && controller.status === 'idle' && !reading && !settings.get().showIdlePill) overlay.hide();
}

/** Keys of the first chord bound to an action (optionally filtered), for labels. */
function bindingKeys(action, test = () => true) {
  const b = settings.get().bindings.find((x) => x.action === action && x.trigger !== 'doubleTap' && test(x));
  return b ? b.keys : [];
}

const holdKeys = () => {
  const keys = bindingKeys('dictate', (b) => b.behaviour !== 'toggle' && !b.mode);
  return keys.length ? keys : bindingKeys('dictate', (b) => b.behaviour !== 'toggle');
};

/** The tray's tooltip and balloon: "hold Ctrl + Win to dictate", or whatever the first dictation shortcut is. */
const hints = () => trayHints({ hold: formatShortcut(holdKeys()), any: formatShortcut(bindingKeys('dictate')) });

function sendOverlayState(state) {
  send(overlay, 'overlay:state', {
    ...state,
    shortcut: formatShortcut(holdKeys().length ? holdKeys() : bindingKeys('dictate')),
    handsFreeShortcut: formatShortcut(bindingKeys('dictate', (b) => b.behaviour === 'toggle')),
  });
  if (state.state === 'idle') setTimeout(hideOverlayIfIdle, 250);
}

let flashTimer = null;

/** @param {{id: string, label: string}|null} [action]  a button on the pill (Retry / Undo) */
function flash(text, kind = 'info', ms = 2600, action = null) {
  showOverlay();
  sendOverlayState({ state: 'message', text, kind, ms, action });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(hideOverlayIfIdle, ms + 300);
}

function createMainWindow(page) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (page) send(mainWindow, 'app:navigate', page);
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'Pauli Speaks',
    backgroundColor: '#f6f5f1',
    icon: asset('icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD },
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(RENDERER, 'app.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (page) send(mainWindow, 'app:navigate', page);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && tray) {
      trayHintShown = true;
      tray.displayBalloon({
        title: t('tray.balloon.title'),
        content: hints().balloon,
        iconType: 'info',
      });
    }
  });
  // The recorder and the key test switch shortcuts off; never leave them on behind the user's back.
  mainWindow.on('blur', () => {
    if (keyTest) setKeyTest(false);
  });
  mainWindow.on('hide', () => {
    if (!recorder.active) return;
    stopShortcutRecording();
    send(mainWindow, 'shortcut:recording', { done: true, cancelled: true });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopShortcutRecording();
    if (keyTest) setKeyTest(false);
  });
  return mainWindow;
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset('tray.png')));
  tray.setToolTip('Pauli Speaks');
  tray.on('click', () => createMainWindow());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setToolTip(hints().tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate({
    busy: !!controller && controller.status !== 'idle',
    hasLast: !!history.last(),
    updateVersion: updater && updater.state.status === 'ready' ? updater.state.version : null,
  }, {
    open: () => createMainWindow(),
    files: () => createMainWindow('files'),
    toggle: () => controller.toggle(),
    pasteLast: () => typing.pasteLast(),
    copyLast: () => typing.copyLast(),
    install: () => updater.install(),
    quit: () => app.quit(),
  })));
}

// ---------------------------------------------------------------- dictation session

const modeName = (m) => modeLabel(m, { t, languageName });

/** The pill's mode chip (colour + name): every mode but Default, and not in command mode (it has its AI badge). */
const modeChip = () => {
  const m = controller.mode;
  return m && !controller.command && m.id !== DEFAULT_MODE.id ? { name: modeName(m), color: m.color } : null;
};

function listeningState(extra = {}) {
  return {
    state: 'listening',
    locked: controller.locked,
    mode: controller.command ? 'command' : run.translatingNow() ? 'translate' : 'dictate',
    translateTo: run.translatingNow() ? run.sessionMode().translateTo : null,
    chip: modeChip(),
    ...extra,
  };
}

function startRecording() {
  if (reading) stopReading();
  retry.expireUndo(); // before the new crash file begins: the cancelled one's is deleted now
  typing.enterAfterPaste = false; // sessionApp: set when the controller resolved the mode, just before
  showOverlay();
  sendOverlayState(listeningState());
  const s = settings.get();
  listening = createListeningSession({
    settings: s, recovery, mode: listeningState().mode,
    requestTail: (from) => requestAudio('tail', { from }),
    vadStream: (id, samples) => asr.vadStream(id, samples),
    isHandsFree: () => controller.locked,
    onSilence: autoStopAfterSilence,
    onVadError: (err) => { reportDetectorError(err); send(overlay, 'recorder:vad-fallback'); },
    onRecoveryError: (err) => log.warn(`Crash recovery file: ${err.message}`),
    onError: reportTapError,
  });
  send(overlay, 'recorder:start', { deviceId: s.microphoneId, sounds: s.sounds, autoStopSilence: s.autoStopSilence, vadAutoStop: listening.vadAutoStop });
  listening.start();
  startPreview();
}

function endListening() {
  listening?.end();
  listening = null;
}

function autoStopAfterSilence() {
  if (controller.isListening && controller.locked) {
    log.info('Auto-stop after silence');
    controller.stop('silence');
  }
}

/** Ask the overlay recorder for audio: the final take ('stop'), what's been said so far ('snapshot') or from sample `extra.from` on ('tail'). */
function requestAudio(kind, extra = {}) {
  const id = nextAudioId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      audioRequests.delete(id);
      if (kind === 'stop') log.warn('Recorder did not return audio in time');
      resolve(new Float32Array(0));
    }, kind === 'stop' ? 4000 : 1500);
    audioRequests.set(id, (audio) => {
      clearTimeout(timer);
      resolve(audio);
    });
    send(overlay, `recorder:${kind}`, { id, ...extra });
  });
}

/** @param {boolean} discard  @param {object} [session]  @param {boolean} [cancelled]  kept for Undo: the cancel sound plays */
async function stopRecording(discard, session = listening, cancelled = false) {
  stopPreview();
  const sounds = settings.get().sounds;
  if (discard) {
    endListening();
    send(overlay, 'recorder:stop', { id: 0, discard: true, sounds });
    return new Float32Array(0);
  }
  const tapStopped = session?.stop(); // its last pull runs while the recorder flushes
  const audio = await requestAudio('stop', { discard: false, cancelled, sounds });
  await tapStopped;
  session?.complete(audio);
  return audio;
}

// ----- live preview (opt-in, local engine): transcribe what's been said so far every 1.5 s

function startPreview() {
  stopPreview();
  const s = settings.get();
  if (!s.livePreview || s.engine !== 'local') return;
  previewTimer = setInterval(runPreview, PREVIEW_INTERVAL_MS);
}

function stopPreview() {
  clearInterval(previewTimer);
  previewTimer = null;
}

async function runPreview() {
  if (previewBusy || !controller.isListening || modelState.status !== 'ready') return;
  previewBusy = true;
  try {
    const audio = await requestAudio('snapshot');
    if (!controller.isListening || audio.length < SAMPLE_RATE || speechLevel(audio) < SILENCE_LEVEL) return;
    const tail = audio.subarray(Math.max(0, audio.length - SAMPLE_RATE * PREVIEW_MAX_SECONDS));
    const mode = run.sessionMode();
    const r = await engines.get('local').transcribe(tail, { languages: mode.language ? [mode.language] : settings.get().languages, prompt: vocabularyPrompt() });
    if (controller.isListening && previewTimer) sendOverlayState(listeningState({ preview: r.text }));
  } catch (err) {
    log.debug(`preview failed: ${err.message}`);
  } finally {
    previewBusy = false;
  }
}

// ---------------------------------------------------------------- models

function preloadModel() {
  const s = settings.get();
  if (s.engine !== 'local') return Promise.resolve();
  const model = s.localModel;
  const acceleration = s.acceleration;
  if (modelState.model === model && modelState.acceleration === acceleration
    && ['loading', 'downloading', 'ready'].includes(modelState.status)) {
    return modelState.promise || Promise.resolve();
  }
  modelState = {
    model, acceleration, device: null, percent: 0, error: null,
    status: isModelDownloaded(modelsDir(), model) ? 'loading' : 'downloading',
  };
  broadcast('model:state', publicModelState());
  const promise = asr
    .load(model, acceleration)
    .then((info) => {
      if (modelState.model !== model || modelState.acceleration !== acceleration) return;
      modelState = { model, acceleration, status: 'ready', percent: 100, error: null, device: info.device, gpuError: info.gpuError };
      broadcast('model:state', publicModelState());
      log.info(`Speech model ready: ${model} on ${info.device}${info.gpuError ? ` (GPU failed: ${info.gpuError})` : ''}`);
    })
    .catch((err) => {
      if (modelState.model !== model) return;
      modelState = { model, acceleration, status: 'error', percent: 0, error: err.message, device: null };
      broadcast('model:state', publicModelState());
      log.error('Model load failed', err);
    });
  modelState.promise = promise;
  return promise;
}

/** NLLB is needed for non-English targets, "Best" quality, or a speech model that can't translate. */
function needsNllb(s, target = s.translation.target) {
  if (target !== 'en' || s.translation.quality === 'best') return true;
  return s.engine === 'local' && !canWhisperTranslate(s.localModel);
}

/** Default translates with the offline translator: load it early, like "Always translate" did. */
const defaultNeedsTranslator = (s) => !!s.modes[0].translateTo && needsNllb(s, s.modes[0].translateTo);

function preloadTranslator() {
  if (['loading', 'downloading', 'ready'].includes(translatorState.status)) {
    return translatorState.promise || Promise.resolve();
  }
  translatorState = { status: isModelDownloaded(modelsDir(), NLLB_MODEL) ? 'loading' : 'downloading', percent: 0, error: null };
  broadcast('model:state', publicModelState());
  const promise = asr
    .loadTranslator()
    .then(() => {
      translatorState = { status: 'ready', percent: 100, error: null };
      broadcast('model:state', publicModelState());
      log.info('Translator ready');
    })
    .catch((err) => {
      translatorState = { status: 'error', percent: 0, error: err.message };
      broadcast('model:state', publicModelState());
      log.error('Translator load failed', err);
    });
  translatorState.promise = promise;
  return promise;
}

/** Nothing is loaded (the models were deleted, or the speech engine restarted). */
function forgetModels() {
  modelState = { model: null, acceleration: null, status: 'idle', percent: 0, error: null, device: null };
  translatorState = { status: 'idle', percent: 0, error: null };
  broadcast('model:state', publicModelState());
}

function publicModelState() {
  const { promise, ...rest } = modelState;
  const { promise: _p, ...translator } = translatorState;
  return {
    ...rest,
    offerSmaller: shouldOfferSmallerModel(rest),
    models: MODELS.map((m) => ({ ...m, downloaded: isModelDownloaded(modelsDir(), m.id) })),
    translator: {
      ...translator,
      model: NLLB_MODEL,
      size: NLLB_SIZE,
      downloaded: isModelDownloaded(modelsDir(), NLLB_MODEL),
      languages: Object.keys(NLLB_CODES),
    },
  };
}

// ---------------------------------------------------------------- speech -> text

function vocabularyPrompt() {
  const s = settings.get();
  return s.vocabularyPrompt ? buildPrompt(s.dictionary) : '';
}

/** The chosen Whisper model is loaded; a dictation waiting for it says so on the pill. Rejects when it can't be. */
async function ensureWhisperLoaded() {
  if (modelState.status !== 'ready' && controller.status === 'processing') {
    sendOverlayState({ state: 'processing', text: t(modelState.status === 'downloading' ? 'overlay.downloadingModel' : 'overlay.loadingModel') });
  }
  await preloadModel();
  if (modelState.status === 'error') throw new Error(t('errors.modelFailed', { error: modelState.error }));
}

function createSpeechEngines() {
  const s = () => settings.get();
  return createEngines([
    createWhisperEngine({ asr, ensureLoaded: ensureWhisperLoaded, options: () => ({ model: s().localModel, acceleration: s().acceleration }) }),
    createCloudEngine({ options: () => ({ baseUrl: s().cloud.baseUrl, apiKey: settings.getApiKey(), model: s().cloud.model }) }),
  ]);
}

/** @param {{languages?: string[]}} [extra] languages: the mode's, instead of your languages */
function recognise(audio, task, extra = {}) {
  const s = settings.get();
  return engines.get(s.engine).transcribe(audio, { languages: s.languages, prompt: vocabularyPrompt(), task, ...extra });
}

async function translateText(text, source, target) {
  if (translatorState.status !== 'ready') {
    sendOverlayState({ state: 'processing', text: t(isModelDownloaded(modelsDir(), NLLB_MODEL) ? 'overlay.loadingTranslator' : 'overlay.downloadingTranslator') });
  }
  await preloadTranslator();
  if (translatorState.status === 'error') throw new Error(t('errors.translatorFailed', { error: translatorState.error }));
  return asr.translate(text, source, target);
}

const reportDetectorError = reportOncePerMessage((message) => log.warn(`Speech detector unavailable: ${message}`));
const reportTapError = reportOncePerMessage((message) => log.warn(`Recording tap: ${message}`));

async function finishDictation(reason) {
  try {
    await transcribeDictation(reason);
  } finally {
    endListening(); // pasted, nothing said, cancelled or failed: the crash file goes
  }
}

async function transcribeDictation(reason) {
  const t0 = Date.now();
  sendOverlayState({ state: 'processing', mode: controller.command ? 'command' : 'dictate' });
  const audio = await stopRecording(false);
  log.info(`Dictation stopped (${reason}), ${(audio.length / SAMPLE_RATE).toFixed(1)}s of audio`);
  await flow.processDictation(audio, t0);
}

const speechGate = (audio) => gateSpeech(audio, { enabled: settings.get().silenceDetection, detect: (a) => asr.detectSpeech(a), level: speechLevel, onError: reportDetectorError });

function engineLabel() {
  const s = settings.get();
  if (s.engine === 'cloud') return s.cloud.model;
  const name = s.localModel.split('/').pop();
  return modelState.device === 'dml' ? `${name} · GPU` : name;
}

// ---------------------------------------------------------------- read aloud

async function readAloud() {
  if (reading) return stopReading();
  if (controller.isListening && !controller.locked) controller.dismiss('other-shortcut');
  const text = (await typing.selectedText()).trim();
  if (!text) return flash(t('flash.readAloudSelect'));
  const s = settings.get();
  reading = true;
  showOverlay();
  sendOverlayState({ state: 'reading' });
  send(overlay, 'tts:speak', { text, voice: s.readAloud.voice, rate: s.readAloud.rate });
}

function stopReading() {
  if (!reading) return;
  reading = false;
  send(overlay, 'tts:stop');
  sendOverlayState({ state: 'idle' });
}

// ---------------------------------------------------------------- file transcription (files.js)

/** One piece of a file: Whisper's own English translation (fast), or a timestamped transcription. */
const recognisePiece = (samples, fast) => recognise(samples, fast ? 'translate' : 'transcribe', { prompt: '', timestamps: true });

// ---------------------------------------------------------------- shortcuts

function onAction({ action, phase, binding = {} }) {
  if (isTalkAction(action)) {
    if (phase !== 'down') return controller.talkUp({ behaviour: binding.behaviour });
    lastTalkBinding = binding;
    return controller.talkDown({ behaviour: binding.behaviour, kind: action, binding });
  }
  if (phase === 'down') runAction(action);
}

/** Actions that fire once (shortcut down, or a command-line flag). */
function runAction(action) {
  if (action === 'cancel') return reading ? stopReading() : controller.cancel();
  if (action === 'pasteLast') return typing.pasteLast();
  if (action === 'copyLast') return typing.copyLast(true);
  if (action === 'undoLast') return typing.undoLast();
  if (action === 'pressEnter') return typing.pressEnter();
  if (action === 'readAloud') return readAloud();
  if (action === 'cycleMode') return cycleMode();
}

/** Switch mode: the next mode (or Automatic again); while talking, the running dictation goes on in it. */
function cycleMode() {
  const talking = controller.isListening && !controller.command;
  const { switched, mode } = modes.cycle(talking ? controller.mode.id : undefined);
  log.info(`Switch mode: ${switched || 'automatic'}`);
  if (talking) return controller.setMode(mode);
  flash(switched ? t('flash.modeSwitched', { name: modeName(mode) }) : t('flash.modeAutomatic'));
}

// ----- deep links and command-line flags (remote.js)

function runRemote(cmd) {
  log.info(`Remote command: ${cmd.command}${cmd.mode ? ` (mode ${cmd.mode})` : ''}`);
  if (cmd.command === 'toggle') return controller.toggle({ link: cmd.mode });
  if (cmd.command === 'start') return controller.start({ link: cmd.mode });
  if (cmd.command === 'stop') return controller.stop('remote');
  if (cmd.command === 'open') return createMainWindow();
  return runAction(cmd.command);
}

function queueRemote(cmd) {
  if (overlayReady) runRemote(cmd);
  else remoteQueue.push(cmd);
}

function registerProtocol() {
  // A portable copy runs from a temp folder and leaves nothing in the registry.
  if (portable.active) return;
  // From source (`electron .`) Windows must launch electron.exe with the app folder.
  const ok = process.defaultApp
    ? app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')])
    : app.setAsDefaultProtocolClient(PROTOCOL);
  if (!ok) log.warn(`Could not register ${PROTOCOL}:// links`);
}

// ----- shortcut recorder (shortcut-recorder.js): the global hook records, so Win, mouse buttons and pedals work

function startShortcutRecording(opts) {
  keyTest = null;
  if (recorder.start(opts || {})) keyboard.setRecording(true);
}

function stopShortcutRecording() {
  if (recorder.active) recorder.stop();
}

/** Recording finished (saved, cancelled or stopped): shortcuts work again. */
function onRecorderEnd() {
  keyboard.setRecording(!!keyTest);
  keyboard.setBindings(settings.get().bindings);
}

function onRecording(e) {
  if (recorder.active) return recorder.handle(e);
  if (keyTest) onKeyTest(e);
}

// ----- "Test a key, pedal or mouse button": what the hook sees, and what it would do

function describeKeys(keys, doubleTap) {
  const b = settings.get().bindings.find((x) => (doubleTap
    ? x.trigger === 'doubleTap' && x.keys[0] === keys[0]
    : x.trigger !== 'doubleTap' && sameSet(x.keys, keys)));
  return { keys: sortKeys(keys), doubleTap: !!doubleTap, action: b ? b.action : null, behaviour: b ? b.behaviour || null : null };
}

function onKeyTest(e) {
  if (!e.isRelease) {
    if (e.keys.length >= keyTest.max.length) keyTest.max = e.keys;
    return send(mainWindow, 'shortcut:test', describeKeys(e.keys, false));
  }
  if (e.doubleTap) return send(mainWindow, 'shortcut:test', describeKeys(e.keys, true));
  if (e.remaining.length === 0) keyTest.max = [];
}

function setKeyTest(on) {
  if (recorder.active) return;
  keyTest = on ? { max: [] } : null;
  keyboard.setRecording(on);
  if (!on) keyboard.setBindings(settings.get().bindings);
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  i18nIpc = registerI18nIpc(ipcMain, { getSettings: () => settings.get(), systemLanguages: () => app.getPreferredSystemLanguages(), broadcast });
  ipcMain.handle('settings:get', () => settings.getPublic());
  ipcMain.handle('settings:update', (_e, patch) => {
    settings.update(patch);
    return settings.getPublic();
  });
  registerWelcomeIpc(ipcMain, {
    getSettings: () => settings.getPublic(),
    updateSettings: (patch) => settings.update(patch),
    systemLanguages: () => app.getPreferredSystemLanguages(),
    gpuInfo: () => app.getGPUInfo('complete'),
    processNames: runningProcessNames,
    appVersion: () => app.getVersion(),
    hookError: () => hookError,
    changelog: readChangelog,
    modelsDir,
    getModelState: () => modelState,
    preloadModel,
    log,
  });
  registerDiagnosticsIpc(ipcMain, {
    appVersion: () => app.getVersion(), isPortable: () => portable.active, getSettings: () => settings.get(), os,
    hasApiKey: () => { try { return !!settings.getApiKey(); } catch { return false; } },
    gpuInfo: () => app.getGPUInfo('complete'), getModelState: () => modelState, getTranslatorState: () => translatorState,
    modelsDir, modelIds: [...MODELS.map((m) => m.id), NLLB_MODEL], formatKeys: formatShortcut, hookError: () => hookError,
    processNames: runningProcessNames, recentLog: (n) => log.recent(n), writeClipboard: io.writeClipboard,
    openExternal: (url) => shell.openExternal(url), repo: require('../../package.json').build.publish[0], log,
  });
  recoveryIpc = registerRecoveryIpc(ipcMain, {
    recovery, crashRecoveryOn: () => settings.get().crashRecovery, dictationActive: () => controller.status !== 'idle',
    process: (run, mode) => controller.process(run, mode), transcribe: flow.transcribeKept, isCancelled: () => controller.cancelled,
    addEntry: (entry, audio) => privacy.saveRecording(history.add(entry).id, audio), copy: writeExcluded, keep: (audio, meta, error) => retry.failed(audio, meta, error),
    flash, engineLabel, settle: () => { if (controller.status === 'idle') sendOverlayState({ state: 'idle' }); }, log,
  });
  recoveryIpc.check(); // before the first dictation can replace the leftover file
  languageHints = createLanguageHints({ getSettings: () => settings.get(), updateSettings: (patch) => settings.update(patch), broadcast, log });
  languageHints.registerIpc(ipcMain);
  registerPrivacyIpc(ipcMain, {
    catalog: () => [...MODELS.map((m) => ({ id: m.id, label: `Whisper ${m.label}`, kind: 'speech' })), { id: NLLB_MODEL, label: 'Offline translator', kind: 'translator' }],
    modelsDir,
    dictationActive: () => controller.status !== 'idle',
    fileActive: () => files.busy,
    modelsBusy: () => [modelState.status, translatorState.status].some((st) => st === 'downloading' || st === 'loading'),
    unloadModels: () => asr.stop(),
    afterModelsDeleted: forgetModels,
    deleteAll: () => deleteAllData({
      history, audioHistory, settings, recoveryFile: recovery,
      forgetInMemory: () => { retry.clear(); lastPaste.forget(); recoveryIpc.forget(); languageHints.forget(); },
    }),
    retentionDrops: (r) => history.wouldDrop(r),
    audioBytes: (id) => audioHistory.read(id),
    log,
  });
  registerBackupIpc(ipcMain, {
    dialog,
    getWindow: () => mainWindow,
    getData: () => settings.get(),
    updateSettings: (patch) => settings.update(patch),
    appVersion: () => app.getVersion(),
    log,
  });
  ipcMain.handle('history:list', () => flow.historyList());
  ipcMain.handle('history:delete', (_e, id) => {
    retry.forget(id);
    audioHistory.remove(id);
    history.remove(id);
  });
  ipcMain.handle('history:clear', () => {
    retry.forgetAll();
    audioHistory.clear();
    history.clear();
  });
  ipcMain.handle('history:retry', (_e, id) => flow.retryFromHistory(String(id)));
  ipcMain.handle('stats:get', () => history.stats());
  ipcMain.handle('clipboard:copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('shortcut:record-start', (_e, opts) => startShortcutRecording(opts));
  ipcMain.handle('shortcut:record-stop', () => stopShortcutRecording());
  ipcMain.handle('shortcut:record-confirm', () => recorder.confirm());
  ipcMain.handle('shortcut:record-retry', () => recorder.retry());
  ipcMain.handle('shortcut:test', (_e, on) => setKeyTest(!!on));
  ipcMain.handle('shortcut:reset', () => {
    stopShortcutRecording();
    const bindings = structuredClone(DEFAULTS.bindings); // Ctrl + Win + Shift opens the Translate mode: back if deleted
    settings.update({ bindings, modes: withModesFor(settings.get().modes, bindings) });
    return settings.getPublic();
  });
  ipcMain.handle('model:state', () => publicModelState());
  ipcMain.handle('model:load', () => preloadModel());
  ipcMain.handle('translator:load', () => preloadTranslator());
  ipcMain.handle('cloud:test', async () => {
    const s = settings.get();
    const tone = new Float32Array(SAMPLE_RATE).map((_, i) => 0.1 * Math.sin(i / 8));
    try {
      await transcribeCloud(tone, { baseUrl: s.cloud.baseUrl, apiKey: settings.getApiKey(), model: s.cloud.model, languages: ['en'] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('command:test', async () => {
    const s = settings.get();
    try {
      const out = await chatComplete(
        { baseUrl: s.cloud.baseUrl, apiKey: settings.getApiKey(), model: s.command.model },
        buildCommandMessages('Make this all caps', 'hello'),
      );
      return { ok: true, output: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    modelsDir: modelsDir(),
    logFile: log.file,
    packaged: app.isPackaged,
    exePath: portable.exeFile || process.execPath,
    portable: portable.active,
    protocol: PROTOCOL,
  }));
  ipcMain.handle('app:open-path', (_e, which) => {
    const target = which === 'models' ? modelsDir() : which === 'logs' ? path.dirname(log.file) : app.getPath('userData');
    return shell.openPath(target);
  });
  ipcMain.handle('app:open-external', (_e, url) => {
    if (isAllowedExternalUrl(url)) return shell.openExternal(url);
  });
  ipcMain.handle('dictation:status', () => ({ status: controller.status, locked: controller.locked, chip: controller.status === 'idle' ? null : modeChip() }));
  ipcMain.handle('update:state', () => updater.state);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('file:transcribe', (_e, { audio, translate }) =>
    files.transcribe(audio instanceof Float32Array ? audio : new Float32Array(audio), { translate }));
  ipcMain.handle('file:save', async (_e, { name, format, text, segments }) => {
    const base = String(name || 'transcript').replace(/\.[^.]+$/, '');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${base}.${format}`,
      filters: [format === 'srt' ? { name: t('files.filter.subtitles'), extensions: ['srt'] } : { name: t('files.filter.text'), extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, format === 'srt' ? toSrt(segments || []) : String(text || ''), 'utf8');
    return { saved: true, filePath };
  });

  ipcMain.on('dictation:toggle', () => controller.toggle());
  ipcMain.on('dictation:cancel', () => (reading ? stopReading() : controller.cancel()));
  ipcMain.on('overlay:action', (_e, id) => flow.runPillAction(String(id)).catch((err) => log.error('Pill action failed', err)));
  ipcMain.on('overlay:hover', (_e, inside) => {
    if (overlay) overlay.setIgnoreMouseEvents(!inside, { forward: true });
  });
  ipcMain.on('recorder:audio', (_e, { id, audio }) => {
    const resolve = audioRequests.get(id);
    if (!resolve) return;
    audioRequests.delete(id);
    resolve(audio instanceof Float32Array ? audio : new Float32Array(audio || []));
  });
  ipcMain.on('recorder:silence', autoStopAfterSilence);
  ipcMain.on('recorder:error', (_e, message) => {
    log.error(`Microphone error: ${message}`);
    if (controller.isListening) controller.dismiss('mic-error');
    flash(message, 'error', 4500);
  });
  ipcMain.on('tts:ended', () => {
    if (!reading) return;
    reading = false;
    sendOverlayState({ state: 'idle' });
  });
}

// ---------------------------------------------------------------- settings side effects

function applySettings(data, patch) {
  if (patch.bindings && !recorder.active && !keyTest) keyboard.setBindings(data.bindings);
  if ('launchAtLogin' in patch && app.isPackaged && !portable.active) {
    app.setLoginItemSettings({ openAtLogin: !!data.launchAtLogin, args: ['--hidden'] });
  }
  if ('betaUpdates' in patch) updater?.setPrerelease(data.betaUpdates);
  privacy.apply(patch);
  if ('crashRecovery' in patch) recoveryIpc.crashRecoveryChanged(); // before the window hears about it
  if ('showIdlePill' in patch && overlay && controller.status === 'idle') {
    if (data.showIdlePill) showOverlay();
    else overlay.hide();
  }
  if ('engine' in patch || 'localModel' in patch || 'acceleration' in patch) preloadModel();
  if (['translation', 'engine', 'localModel', 'modes'].some((k) => k in patch) && defaultNeedsTranslator(data)) preloadTranslator();
  i18nIpc.settingsChanged(patch);
  updateTrayMenu();
  if (controller.status === 'listening') sendOverlayState(listeningState());
  else if (controller.status === 'idle' && !reading) sendOverlayState({ state: 'idle' });
  broadcast('settings:changed', settings.getPublic());
}

// ---------------------------------------------------------------- startup

function init() {
  app.setAppUserModelId('com.pauli.speaks');
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.info(`Pauli Speaks ${app.getVersion()} starting${portable.active ? ' (portable copy)' : ''}`);
  if (portable.error) log.warn(portable.error);

  const canEncrypt = safeStorage.isEncryptionAvailable();
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'), {
    encrypt: (s) => (canEncrypt ? safeStorage.encryptString(s).toString('base64') : `plain:${s}`),
    decrypt: (s) => (s.startsWith('plain:') ? s.slice(6) : safeStorage.decryptString(Buffer.from(s, 'base64'))),
  });
  history = new History(path.join(app.getPath('userData'), 'history.json'));
  audioHistory = createAudioHistory(path.join(app.getPath('userData'), 'audio'));
  privacy = createPrivacy({ history, audioHistory, getSettings: () => settings.get(), log });
  retry = createRetryOffers({
    history, pending: createPendingAudio({ onEvict: () => broadcast('history:changed') }),
    onFailed: (item, audio) => privacy.saveRecording(item.id, audio),
  });
  recovery = createRecoveryFile(path.join(app.getPath('userData'), 'recovery'));
  asr = new LocalAsr(modelsDir());
  engines = createSpeechEngines();
  asr.on('restarted', forgetModels); // a fresh worker has nothing loaded: the next dictation loads the model again
  asr.on('progress', (p) => {
    if (p.model === NLLB_MODEL) {
      if (p.status !== 'downloading') return;
      translatorState = { ...translatorState, status: 'downloading', percent: p.percent };
      broadcast('model:state', publicModelState());
      if (controller.status === 'processing') sendOverlayState({ state: 'processing', text: t('overlay.downloadingTranslatorPercent', { percent: p.percent }) });
      return;
    }
    if (p.model !== modelState.model) return;
    if (p.status === 'downloading') {
      modelState = { ...modelState, status: 'downloading', percent: p.percent };
      broadcast('model:state', publicModelState());
      if (controller.status === 'processing') sendOverlayState({ state: 'processing', text: t('overlay.downloadingModelPercent', { percent: p.percent }) });
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  modes = createModeSession({ settings, foregroundApp });
  controller = new DictationController({
    // once per dictation: the mode, and the app it was started in (pasting checks it); a kept recording keeps its mode
    resolveMode: (request) => {
      const r = modes.resolve(request);
      if (!request.kept) sessionApp = r.app;
      return r.mode;
    },
    start: startRecording,
    finish: finishDictation,
    dismiss: (reason) => {
      log.info(`Dictation dismissed (${reason})`);
      if (reason === 'cancel') return flow.offerUndo().catch((err) => log.warn(`Undo: ${err.message}`));
      stopRecording(true);
      if (reason === 'tap') {
        const keys = lastTalkBinding && lastTalkBinding.keys ? lastTalkBinding.keys : holdKeys();
        flash(t('flash.holdToTalk', { keys: formatShortcut(keys) }), 'info', 2200);
      }
      else sendOverlayState({ state: 'idle' });
    },
  });
  controller.on('status', ({ status, locked }) => {
    if (status === 'listening') sendOverlayState(listeningState());
    const live = listeningState();
    broadcast('dictation:status', { status, locked, translateTo: live.translateTo, mode: live.mode, chip: status === 'idle' ? null : live.chip });
    updateTrayMenu();
  });
  controller.on('busy', () => flash(t('flash.busy')));
  typing = createTyping({
    settings, lastPaste, history, controller, VK, flash, log, pasteText: io.pasteText, pressKey: io.pressKey, getSelectedText: io.getSelectedText,
    foregroundApp, keysDown: () => keyboard.engine.pressed.size, writeClipboard: io.writeClipboard,
  });
  run = createDictationRun({
    settings, controller, history, typing, recognise: e2e ? e2e.io.recognise : recognise, translateText, needsNllb, engineLabel, chatComplete, sendOverlayState, flash, log,
    sessionApp: () => sessionApp, saveRecording: (id, audio) => privacy.saveRecording(id, audio), onRecorded: () => flow.noteRecorded(),
    feedLanguage: (hint) => languageHints.feed(hint),
  });
  flow = createDictationFlow({
    ...run, retry, history, controller, speechGate, // run: runDictation, runCommand, transcribe, dictationText, …
    takeListening: () => { const s = listening; listening = null; return s; },
    stopForUndo: (s) => stopRecording(false, s, true),
    beginRun: () => {
      sessionApp = foregroundApp();
      sendOverlayState({ state: 'processing', mode: controller.command ? 'command' : 'dictate' });
    },
    afterRun: () => { typing.enterAfterPaste = false; },
    showIdle: () => sendOverlayState({ state: 'idle' }),
    showError: (message) => broadcast('app:error', { message }),
    flash, copy: writeExcluded, savedRecording: (hid) => privacy.savedRecording(hid), audioIds: () => audioHistory.ids(), log,
  });
  controller.on('cancel-processing', () => sendOverlayState({ state: 'idle' }));
  files = createFileTranscriber({
    settings, dictationBusy: () => controller.status !== 'idle', needsNllb, recognisePiece, translateText,
    progress: (done, total) => send(mainWindow, 'file:progress', { done, total }),
  });

  keyboard = new KeyboardService();
  keyboard.on('action', onAction);
  keyboard.on('chord', () => controller.otherChord());
  keyboard.on('recording', onRecording);
  keyboard.setBindings(settings.get().bindings);
  if (e2e) e2e.attach({ keyboard });
  recorder = new ShortcutRecorder({
    getBindings: () => settings.get().bindings,
    onUpdate: (update) => send(mainWindow, 'shortcut:recording', update),
    onSave: (bindings) => settings.update({ bindings }),
    onEnd: onRecorderEnd,
  });

  settings.on('change', applySettings);
  history.on('change', () => {
    broadcast('history:changed');
    updateTrayMenu();
  });

  updater = new Updater({ portable: portable.active, prerelease: settings.get().betaUpdates });
  updater.on('state', (state) => {
    broadcast('update:state', state);
    updateTrayMenu();
    if (state.status === 'ready' && !updateNotified && tray) {
      updateNotified = true;
      tray.displayBalloon({
        title: t('tray.updateBalloon.title', { version: state.version }),
        content: t('tray.updateBalloon.text'),
        iconType: 'info',
      });
    }
  });

  registerIpc();
  privacy.start(); // the History and recordings settings apply now, then every hour
  registerProtocol();
  createOverlay();
  createTray();
  updater.start();
  try {
    keyboard.start();
  } catch (err) {
    log.error('Could not start the global keyboard hook', err);
    hookError = String((err && err.message) || err);
  }

  const startupCommand = parseCommandLine(process.argv);
  if (startupCommand) queueRemote(startupCommand);
  const hidden = process.argv.includes('--hidden') || (startupCommand && startupCommand.command !== 'open');
  if (!hidden || !settings.get().onboarded) createMainWindow();
  if (shouldPreloadAtStartup(settings.get(), (id) => isModelDownloaded(modelsDir(), id))) preloadModel();
  if (defaultNeedsTranslator(settings.get())) preloadTranslator();

  screen.on('display-metrics-changed', positionOverlay);
  if (process.env.PAULI_SELFTEST) runSelfTest(process.env.PAULI_SELFTEST);
}

/**
 * Developer self-test: PAULI_SELFTEST=<dir containing speech.wav>.
 * Exercises the real engines (dictation, translation, file transcription),
 * saves screenshots of every page and the overlay states, writes
 * selftest.json and quits. Never pastes or presses keys.
 */
async function runSelfTest(dir) {
  const { decodeWav } = require('./audio-utils');
  const out = (name, data) => fs.writeFileSync(path.join(dir, name), data);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => out(name, (await win.webContents.capturePage()).toPNG());
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const report = { ok: true };
  try {
    await wait(2500);
    const { samples } = decodeWav(fs.readFileSync(path.join(dir, 'speech.wav')));
    // Clipboard round-trip exactly as a paste does it (snapshot -> write -> restore).
    const { snapshot, restore } = require('./paster');
    const beforeText = await clipboard.readText();
    const snap = await snapshot();
    await clipboard.writeText('pauli-selftest');
    const written = await clipboard.readText();
    await restore(snap);
    report.clipboard = { written: written === 'pauli-selftest', restored: (await clipboard.readText()) === beforeText, snapshotOk: snap !== undefined };
    if (!report.clipboard.written || !report.clipboard.restored || !report.clipboard.snapshotOk) report.ok = false;

    await preloadModel();
    report.device = modelState.device;
    report.gpuError = modelState.gpuError || null;

    let t0 = Date.now();
    const result = await run.transcribe(samples);
    report.dictation = { ms: Date.now() - t0, raw: result.text, text: cleanTranscript(result.text, settings.get()), language: result.language };
    report.codeStyle = cleanTranscript(result.text, { ...settings.get(), style: 'code' });
    log.info(`SELFTEST transcript (${report.dictation.ms}ms on ${report.device}): ${report.dictation.text.length} chars`); // the text itself goes only into the report file

    if (process.env.PAULI_SELFTEST_TARGET) {
      t0 = Date.now();
      const tr = await run.transcribe(samples, { ...DEFAULT_MODE, translateTo: process.env.PAULI_SELFTEST_TARGET });
      report.translation = { ms: Date.now() - t0, text: tr.text, translatedTo: tr.translatedTo };
    }

    t0 = Date.now();
    const looped = new Float32Array(samples.length * 3 + SAMPLE_RATE * 3);
    for (let i = 0; i < 3; i++) looped.set(samples, i * (samples.length + SAMPLE_RATE));
    const file = await files.transcribe(looped);
    report.file = { ms: Date.now() - t0, segments: file.segments.length, srt: toSrt(file.segments).split('\n').slice(0, 4).join(' | '), text: file.text };

    if (mainWindow) {
      for (const page of ['home', 'shortcuts', 'files', 'dictionary', 'settings']) {
        await js(`document.querySelector('[data-page=${page}]').click()`);
        await wait(500);
        await shot(mainWindow, `page-${page}.png`);
      }
      for (const anchor of ['#tr-always', '#accel', '#app-rules', '#cmd-model']) {
        await js(`document.querySelector('${anchor}')?.closest('.panel')?.scrollIntoView()`);
        await wait(300);
        await shot(mainWindow, `settings-${anchor.slice(1)}.png`);
      }
    }
    showOverlay();
    sendOverlayState({ state: 'listening', locked: true, mode: 'dictate', preview: 'This is what a live preview of your words looks like while you speak' });
    await wait(900);
    await shot(overlay, 'overlay-preview.png');
    sendOverlayState({ state: 'listening', locked: false, mode: 'command' });
    await wait(600);
    await shot(overlay, 'overlay-command.png');
    sendOverlayState({ state: 'reading' });
    await wait(600);
    await shot(overlay, 'overlay-reading.png');
  } catch (err) {
    log.error('SELFTEST failed', err);
    report.ok = false;
    report.error = String(err && err.stack);
  }
  out('selftest.json', JSON.stringify(report, null, 2));
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch carries a pauli-speaks:// link or a flag (--toggle...), or just means "show the window".
  app.on('second-instance', (_e, argv) => {
    if (!controller) return;
    const cmd = parseCommandLine(argv);
    if (cmd) queueRemote(cmd);
    else createMainWindow();
  });
  app.whenReady().then(init);
  app.on('before-quit', () => {
    quitting = true;
    updater?.stop();
    keyboard?.stop();
    asr?.dispose();
  });
  app.on('window-all-closed', () => {
    // keep running in the tray
  });
}
