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
const path = require('node:path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, session, clipboard, safeStorage, dialog,
} = require('electron');

const log = require('./logger');
const win32 = require('./win32');
const { Settings, DEFAULTS } = require('./settings');
const { History } = require('./history');
const { KeyboardService } = require('./keyboard');
const { DictationController } = require('./dictation-controller');
const { isTalkAction } = require('./shortcut-rules');
const { sameSet } = require('./shortcut-engine');
const { ShortcutRecorder } = require('./shortcut-recorder');
const { LastPaste } = require('./last-paste');
const { formatShortcut, sortKeys, VK } = require('./keys');
const { cleanTranscript, cleanUtterance, countWords, toSrt } = require('./text-cleanup');
const { speechLevel, splitAtPauses, SAMPLE_RATE } = require('./audio-utils');
const { pasteText, pressKey, getSelectedText } = require('./paster');
const { PROTOCOL, parseCommandLine } = require('./remote');
const { resolveStyle } = require('./app-styles');
const { buildCommandMessages, chatComplete } = require('./llm');
const { LocalAsr } = require('./asr/local-asr');
const { transcribeCloud, translateCloud } = require('./asr/cloud');
const { MODELS, isModelDownloaded, canWhisperTranslate, buildPrompt } = require('./asr/whisper-local');
const { NLLB_MODEL, NLLB_SIZE, NLLB_CODES } = require('./asr/translator-local');
const { Updater } = require('./updater');
const { setupPortable } = require('./portable');
const { shouldPreloadAtStartup, shouldOfferSmallerModel, isAllowedExternalUrl } = require('./system-check');
const { registerWelcomeIpc, runningProcessNames } = require('./welcome-ipc');
const { readChangelog } = require('./changelog');

// Before anything reads userData: a portable copy keeps its data next to its exe.
const portable = setupPortable(app);
// Development only: run against a scratch data folder instead of the real one.
if (!app.isPackaged && process.env.PAULI_USER_DATA_DIR) app.setPath('userData', process.env.PAULI_USER_DATA_DIR);

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const OVERLAY_SIZE = { width: 560, height: 160 };
const MIN_AUDIO_SECONDS = 0.3;
const SILENCE_LEVEL = 0.004;
const PREVIEW_INTERVAL_MS = 1500;
const PREVIEW_MAX_SECONDS = 25;

let settings;
let history;
let keyboard;
let controller;
let asr;
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
const lastPaste = new LastPaste(); // what undoLast removes
let enterAfterPaste = false;
let overlayReady = false;
const remoteQueue = [];
let trayHintShown = false;
let sessionApp = null;
let previewTimer = null;
let previewBusy = false;
let reading = false;
let fileBusy = false;
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

const holdKeys = () => bindingKeys('dictate', (b) => b.behaviour !== 'toggle');

/** "hold Ctrl + Win to dictate", or whatever the first dictation shortcut is. */
function talkHint() {
  const hold = holdKeys();
  if (hold.length) return `hold ${formatShortcut(hold)} to dictate`;
  const any = bindingKeys('dictate');
  return any.length ? `press ${formatShortcut(any)} to dictate` : 'click the bar to dictate';
}

function sendOverlayState(state) {
  send(overlay, 'overlay:state', {
    ...state,
    shortcut: formatShortcut(holdKeys().length ? holdKeys() : bindingKeys('dictate')),
    handsFreeShortcut: formatShortcut(bindingKeys('dictate', (b) => b.behaviour === 'toggle')),
  });
  if (state.state === 'idle') setTimeout(hideOverlayIfIdle, 250);
}

let flashTimer = null;

function flash(text, kind = 'info', ms = 2600) {
  showOverlay();
  sendOverlayState({ state: 'message', text, kind, ms });
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
        title: 'Pauli Speaks is still running',
        content: `${talkHint().replace(/^./, (c) => c.toUpperCase())} anywhere. Change the shortcut on the Shortcuts page. Right-click the tray icon to quit.`,
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
  tray.setToolTip(`Pauli Speaks - ${talkHint()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Pauli Speaks', click: () => createMainWindow() },
      { label: 'Transcribe a file…', click: () => createMainWindow('files') },
      { type: 'separator' },
      {
        label: controller && controller.status !== 'idle' ? 'Stop dictation' : 'Start hands-free dictation',
        click: () => controller.toggle(),
      },
      { label: 'Paste last transcript', click: () => pasteLast(), enabled: !!history.last() },
      { label: 'Copy last transcript', click: () => copyLast(), enabled: !!history.last() },
      { type: 'separator' },
      ...(updater && updater.state.status === 'ready'
        ? [{ label: `Restart to update to ${updater.state.version}`, click: () => updater.install() }]
        : []),
      { label: 'Quit Pauli Speaks', click: () => app.quit() },
    ]),
  );
}

// ---------------------------------------------------------------- dictation session

function translatingNow() {
  return !controller.command && (controller.translate || settings.get().translation.always);
}

function listeningState(extra = {}) {
  return {
    state: 'listening',
    locked: controller.locked,
    mode: controller.command ? 'command' : translatingNow() ? 'translate' : 'dictate',
    translateTo: translatingNow() ? settings.get().translation.target : null,
    ...extra,
  };
}

function startRecording() {
  if (reading) stopReading();
  enterAfterPaste = false;
  sessionApp = win32.foregroundApp();
  showOverlay();
  sendOverlayState(listeningState());
  const s = settings.get();
  send(overlay, 'recorder:start', { deviceId: s.microphoneId, sounds: s.sounds, autoStopSilence: s.autoStopSilence });
  startPreview();
}

/** Ask the overlay recorder for audio: the final take ('stop') or what's been said so far ('snapshot'). */
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
    send(overlay, kind === 'stop' ? 'recorder:stop' : 'recorder:snapshot', { id, ...extra });
  });
}

function stopRecording(discard) {
  stopPreview();
  const sounds = settings.get().sounds;
  if (discard) {
    send(overlay, 'recorder:stop', { id: 0, discard: true, sounds });
    return Promise.resolve(new Float32Array(0));
  }
  return requestAudio('stop', { discard: false, sounds });
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
    const r = await asr.transcribe(tail, { ...localOpts(), task: 'transcribe' });
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
function needsNllb(s) {
  const t = s.translation;
  if (t.target !== 'en' || t.quality === 'best') return true;
  return s.engine === 'local' && !canWhisperTranslate(s.localModel);
}

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

function localOpts() {
  const s = settings.get();
  return { model: s.localModel, acceleration: s.acceleration, languages: s.languages, prompt: vocabularyPrompt() };
}

function cloudOpts() {
  const s = settings.get();
  return { baseUrl: s.cloud.baseUrl, apiKey: settings.getApiKey(), model: s.cloud.model, languages: s.languages, prompt: vocabularyPrompt() };
}

async function recognise(audio, task, extra = {}) {
  if (settings.get().engine === 'cloud') {
    return task === 'translate' ? translateCloud(audio, cloudOpts()) : transcribeCloud(audio, cloudOpts());
  }
  if (modelState.status !== 'ready') {
    sendOverlayState({ state: 'processing', text: modelState.status === 'downloading' ? 'Downloading speech model…' : 'Loading speech model…' });
  }
  await preloadModel();
  if (modelState.status === 'error') throw new Error(`Speech model failed to load: ${modelState.error}`);
  return asr.transcribe(audio, { ...localOpts(), task, ...extra });
}

async function translateText(text, source, target) {
  if (translatorState.status !== 'ready') {
    sendOverlayState({ state: 'processing', text: isModelDownloaded(modelsDir(), NLLB_MODEL) ? 'Loading translator…' : 'Downloading translator…' });
  }
  await preloadTranslator();
  if (translatorState.status === 'error') throw new Error(`Translator failed to load: ${translatorState.error}`);
  return asr.translate(text, source, target);
}

/**
 * Speech -> text, optionally translated:
 *   Fast  (target English): Whisper's own translate task, one pass, no extra download
 *   Best  (or other target): transcribe, clean up, then NLLB-200 text translation
 * @returns {Promise<{text: string, language: string|null, translatedTo: string|null, original?: string}>}
 */
async function transcribe(audio, { translate = false } = {}) {
  const s = settings.get();
  const target = s.translation.target;
  const fast = translate && target === 'en' && !needsNllb(s);
  const result = await recognise(audio, fast ? 'translate' : 'transcribe');
  if (!translate || result.translatedTo) return result;

  const source = result.language || (s.languages.length === 1 ? s.languages[0] : null);
  if (source === target) return result;
  // Voice commands are found in the language they were spoken in ("pošalji"), before translating.
  const { text: original, before, after } = cleanUtterance(result.text, { ...s, addTrailingSpace: false, snippets: [] });
  if (!original.trim()) return result;
  const text = await translateText(original, source || 'en', target);
  return { ...result, text, language: source, translatedTo: target, original, before, after };
}

async function finishDictation(reason) {
  const t0 = Date.now();
  sendOverlayState({ state: 'processing', mode: controller.command ? 'command' : 'dictate' });
  const audio = await stopRecording(false);
  const seconds = audio.length / SAMPLE_RATE;
  log.info(`Dictation stopped (${reason}), ${seconds.toFixed(1)}s of audio`);

  if (seconds < MIN_AUDIO_SECONDS || speechLevel(audio) < SILENCE_LEVEL) {
    flash('No speech detected');
    return;
  }

  try {
    if (controller.command) await runCommand(audio, seconds);
    else await runDictation(audio, seconds, t0);
  } catch (err) {
    log.error('Dictation failed', err);
    flash(err.message.length > 80 ? 'Something went wrong - see Pauli Speaks for details' : err.message, 'error', 4500);
    broadcast('app:error', { message: err.message });
  } finally {
    enterAfterPaste = false;
  }
}

/** Text plus the voice commands said at its start / end. */
function dictationText(result, style) {
  const s = settings.get();
  if (!result.original) return cleanUtterance(result.text, { ...s, style });
  // NLLB output was already cleaned (and its commands found) before translation: only polish it now.
  const after = result.after || [];
  const keyAfter = after.some((c) => c.action === 'key');
  const text = cleanTranscript(result.text, { ...s, removeFillers: false, voiceCommands: false, style, addTrailingSpace: s.addTrailingSpace && !keyAfter });
  return { text, before: result.before || [], after };
}

async function runDictation(audio, seconds, t0) {
  const result = await transcribe(audio, { translate: translatingNow() });
  if (controller.cancelled) return sendOverlayState({ state: 'idle' });

  const s = settings.get();
  const style = resolveStyle(sessionApp && sessionApp.exe, s.appStyles);
  const { text: cleaned, before, after } = dictationText(result, style);
  // "scratch that" at the end throws away what was just said
  const scratched = after.some((c) => c.action === 'undo');
  const text = scratched ? '' : cleaned;
  log.info(`Transcribed in ${Date.now() - t0}ms (${result.language || '?'}${result.translatedTo ? ` -> ${result.translatedTo}` : ''}, ${sessionApp ? sessionApp.exe : '?'}: ${style})${before.length + after.length ? `, commands: ${[...before, ...after].map((c) => c.action).join(' ')}` : ''}`);
  if (!text.trim() && !before.length && !after.length) return flash('No speech detected');
  sendOverlayState({ state: 'idle' });

  for (const c of before) await runVoiceAction(c, !text.trim());
  if (scratched) return flash('Dropped that dictation');
  if (!text.trim()) {
    if (enterAfterPaste) await pressEnterNow();
    return;
  }

  history.add({
    text: text.trim(),
    rawText: result.text,
    original: result.original || null,
    durationMs: Math.round(seconds * 1000),
    words: countWords(text),
    engine: engineLabel(),
    language: result.language || null,
    translatedTo: result.translatedTo || null,
    app: sessionApp ? sessionApp.exe : null,
    style,
  });
  await paste(text);
  for (const c of after) await runVoiceAction(c, false);
  if (enterAfterPaste && !after.some((c) => c.arg === 'Enter')) await pressEnterNow();
}

/** Command mode: the speech is an instruction for the selected text (or a request to write something). */
async function runCommand(audio, seconds) {
  const s = settings.get();
  sendOverlayState({ state: 'processing', mode: 'command', text: 'Listening to your instruction…' });
  const r = await recognise(audio, 'transcribe');
  const instruction = cleanTranscript(r.text, { ...s, addTrailingSpace: false, snippets: [] });
  if (!instruction.trim()) return flash('No speech detected');
  const selection = await selectedText();
  sendOverlayState({ state: 'processing', mode: 'command', text: selection.trim() ? 'Editing your selection…' : 'Writing…' });
  const output = await chatComplete(
    { baseUrl: s.cloud.baseUrl, apiKey: settings.getApiKey(), model: s.command.model },
    buildCommandMessages(instruction, selection),
  );
  if (controller.cancelled) return sendOverlayState({ state: 'idle' });
  if (!output) return flash('The AI returned nothing - try rephrasing', 'error');
  log.info(`Command (${instruction.length} chars) on ${selection.length} chars -> ${output.length} chars`);
  history.add({
    kind: 'command',
    text: output,
    instruction,
    rawText: r.text,
    original: selection.trim() ? selection : null,
    durationMs: Math.round(seconds * 1000),
    words: countWords(output),
    engine: s.command.model,
    language: r.language || null,
    app: sessionApp ? sessionApp.exe : null,
  });
  sendOverlayState({ state: 'idle' });
  await paste(output);
  if (enterAfterPaste) await pressEnterNow();
}

function engineLabel() {
  const s = settings.get();
  if (s.engine === 'cloud') return s.cloud.model;
  const name = s.localModel.split('/').pop();
  return modelState.device === 'dml' ? `${name} · GPU` : name;
}

/** Paste into the focused app and remember it, so "undo last" can take it back. */
async function paste(text) {
  const ok = await pasteText(text, { restoreClipboard: settings.get().restoreClipboard });
  const target = win32.foregroundApp();
  lastPaste.remember(text, target && target.exe);
  return ok;
}

async function pasteLast() {
  const last = history.last();
  if (!last) return flash('Nothing to paste yet');
  await waitForKeysReleased();
  await paste(last.text + (settings.get().addTrailingSpace ? ' ' : ''));
}

function copyLast(notify = false) {
  const last = history.last();
  if (!last) return notify ? flash('Nothing to copy yet') : undefined;
  Promise.resolve(clipboard.writeText(last.text))
    .then(() => notify && flash('Copied your last dictation'))
    .catch((err) => log.warn(`Copy failed: ${err.message}`));
}

/** Take back the text Pauli Speaks typed last (rules in last-paste.js). @returns {Promise<boolean>} removed */
async function undoLast() {
  const target = win32.foregroundApp();
  const plan = lastPaste.undoPlan(target && target.exe);
  if (plan.error) {
    flash(plan.error);
    return false;
  }
  await waitForKeysReleased();
  await pressKey(VK.Backspace, plan.backspaces);
  return true;
}

async function pressEnterNow() {
  enterAfterPaste = false;
  await waitForKeysReleased();
  await pressKey(VK.Enter);
  lastPaste.markSent();
}

/** "Press Enter" shortcut: while dictating it finishes and sends; otherwise it presses Enter now. */
function pressEnter() {
  if (controller.isListening) {
    enterAfterPaste = true;
    return controller.stop('enter');
  }
  if (controller.status === 'processing') {
    enterAfterPaste = true;
    return;
  }
  return pressEnterNow();
}

/** A voice command said at the start or end of a dictation. */
async function runVoiceAction(c, alone) {
  if (c.action === 'undo') {
    if ((await undoLast()) && alone) flash('Removed the last dictation');
    return;
  }
  if (c.action === 'key' && VK[c.arg]) {
    if (c.arg === 'Enter') return pressEnterNow();
    await waitForKeysReleased();
    await pressKey(VK[c.arg]);
  }
}

/**
 * Before we synthesise Ctrl+C, every key of the user's shortcut must be up -
 * otherwise a still-held letter (the S of Shift+Alt+S) turns it into Ctrl+S.
 */
async function waitForKeysReleased(timeoutMs = 1500) {
  const end = Date.now() + timeoutMs;
  while (keyboard.engine.pressed.size > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 15));
}

async function selectedText() {
  await waitForKeysReleased();
  return getSelectedText();
}

// ---------------------------------------------------------------- read aloud

async function readAloud() {
  if (reading) return stopReading();
  if (controller.isListening && !controller.locked) controller.dismiss('other-shortcut');
  const text = (await selectedText()).trim();
  if (!text) return flash('Select some text, then press the read-aloud shortcut');
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

// ---------------------------------------------------------------- file transcription

/**
 * Transcribe a whole audio/video file (decoded to 16 kHz mono by the renderer).
 * Long files are split at pauses into ~2 minute pieces for progress reporting.
 * @returns {Promise<{text: string, segments: {start,end,text}[], language: string|null, translatedTo: string|null}>}
 */
async function transcribeFile(audio, { translate = false } = {}) {
  if (fileBusy) throw new Error('Another file is already being transcribed');
  if (controller.status !== 'idle') throw new Error('Finish the current dictation first');
  fileBusy = true;
  try {
    const s = settings.get();
    const target = s.translation.target;
    const fast = translate && target === 'en' && !needsNllb(s);
    const pieces = splitAtPauses(audio);
    const segments = [];
    let language = null;
    for (let i = 0; i < pieces.length; i++) {
      send(mainWindow, 'file:progress', { done: i, total: pieces.length });
      const { start, samples } = pieces[i];
      if (speechLevel(samples) < SILENCE_LEVEL) continue;
      let r;
      if (s.engine === 'cloud') {
        r = fast ? await translateCloud(samples, cloudOpts()) : await transcribeCloud(samples, { ...cloudOpts(), prompt: '' });
      } else {
        await preloadModel();
        if (modelState.status === 'error') throw new Error(`Speech model failed to load: ${modelState.error}`);
        r = await asr.transcribe(samples, { ...localOpts(), prompt: '', task: fast ? 'translate' : 'transcribe', timestamps: true });
      }
      const dur = samples.length / SAMPLE_RATE;
      const chunks = r.chunks && r.chunks.length ? r.chunks : [{ start: 0, end: dur, text: r.text }];
      language ??= r.language;
      if (translate && !r.translatedTo && r.language && r.language !== target) {
        for (const c of chunks) if (c.text.trim()) c.text = await translateText(c.text, r.language, target);
      }
      for (const c of chunks) {
        const text = cleanTranscript(c.text, { ...s, addTrailingSpace: false, snippets: [], voiceCommands: false });
        if (text.trim()) segments.push({ start: start + c.start, end: start + Math.min(c.end, dur), text });
      }
    }
    send(mainWindow, 'file:progress', { done: pieces.length, total: pieces.length });
    return {
      text: segments.map((x) => x.text).join(' ').replace(/[ \t]+/g, ' ').trim(),
      segments,
      language,
      translatedTo: translate ? target : null,
    };
  } finally {
    fileBusy = false;
  }
}

// ---------------------------------------------------------------- shortcuts

function onAction({ action, phase, binding = {} }) {
  if (isTalkAction(action)) {
    if (phase !== 'down') return controller.talkUp({ behaviour: binding.behaviour });
    lastTalkBinding = binding;
    return controller.talkDown({ behaviour: binding.behaviour, kind: action });
  }
  if (phase === 'down') runAction(action);
}

/** Actions that fire once (shortcut down, or a command-line flag). */
function runAction(action) {
  if (action === 'cancel') return reading ? stopReading() : controller.cancel();
  if (action === 'pasteLast') return pasteLast();
  if (action === 'copyLast') return copyLast(true);
  if (action === 'undoLast') return undoLast();
  if (action === 'pressEnter') return pressEnter();
  if (action === 'readAloud') return readAloud();
  if (action === 'cycleMode') return flash('Switching modes comes with Modes, in a later version');
}

// ----- deep links and command-line flags (remote.js)

function runRemote(cmd) {
  log.info(`Remote command: ${cmd.command}${cmd.mode ? ` (mode ${cmd.mode} - modes are not available yet)` : ''}`);
  if (cmd.command === 'toggle') return controller.toggle();
  if (cmd.command === 'start') return controller.start();
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
  ipcMain.handle('history:list', () => history.list());
  ipcMain.handle('history:delete', (_e, id) => history.remove(id));
  ipcMain.handle('history:clear', () => history.clear());
  ipcMain.handle('stats:get', () => history.stats());
  ipcMain.handle('clipboard:copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('shortcut:record-start', (_e, opts) => startShortcutRecording(opts));
  ipcMain.handle('shortcut:record-stop', () => stopShortcutRecording());
  ipcMain.handle('shortcut:record-confirm', () => recorder.confirm());
  ipcMain.handle('shortcut:record-retry', () => recorder.retry());
  ipcMain.handle('shortcut:test', (_e, on) => setKeyTest(!!on));
  ipcMain.handle('shortcut:reset', () => {
    stopShortcutRecording();
    settings.update({ bindings: structuredClone(DEFAULTS.bindings) });
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
  ipcMain.handle('dictation:status', () => ({ status: controller.status, locked: controller.locked }));
  ipcMain.handle('update:state', () => updater.state);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('file:transcribe', (_e, { audio, translate }) =>
    transcribeFile(audio instanceof Float32Array ? audio : new Float32Array(audio), { translate }));
  ipcMain.handle('file:save', async (_e, { name, format, text, segments }) => {
    const base = String(name || 'transcript').replace(/\.[^.]+$/, '');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${base}.${format}`,
      filters: [format === 'srt' ? { name: 'Subtitles', extensions: ['srt'] } : { name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, format === 'srt' ? toSrt(segments || []) : String(text || ''), 'utf8');
    return { saved: true, filePath };
  });

  ipcMain.on('dictation:toggle', () => controller.toggle());
  ipcMain.on('dictation:cancel', () => (reading ? stopReading() : controller.cancel()));
  ipcMain.on('overlay:hover', (_e, inside) => {
    if (overlay) overlay.setIgnoreMouseEvents(!inside, { forward: true });
  });
  ipcMain.on('recorder:audio', (_e, { id, audio }) => {
    const resolve = audioRequests.get(id);
    if (!resolve) return;
    audioRequests.delete(id);
    resolve(audio instanceof Float32Array ? audio : new Float32Array(audio || []));
  });
  ipcMain.on('recorder:silence', () => {
    if (controller.isListening && controller.locked) {
      log.info('Auto-stop after silence');
      controller.stop('silence');
    }
  });
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
  if ('showIdlePill' in patch && overlay && controller.status === 'idle') {
    if (data.showIdlePill) showOverlay();
    else overlay.hide();
  }
  if ('engine' in patch || 'localModel' in patch || 'acceleration' in patch) preloadModel();
  if (('translation' in patch || 'engine' in patch || 'localModel' in patch) && data.translation.always && needsNllb(data)) {
    preloadTranslator();
  }
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
  asr = new LocalAsr(modelsDir());
  asr.on('progress', (p) => {
    if (p.model === NLLB_MODEL) {
      if (p.status !== 'downloading') return;
      translatorState = { ...translatorState, status: 'downloading', percent: p.percent };
      broadcast('model:state', publicModelState());
      if (controller.status === 'processing') sendOverlayState({ state: 'processing', text: `Downloading translator… ${p.percent}%` });
      return;
    }
    if (p.model !== modelState.model) return;
    if (p.status === 'downloading') {
      modelState = { ...modelState, status: 'downloading', percent: p.percent };
      broadcast('model:state', publicModelState());
      if (controller.status === 'processing') sendOverlayState({ state: 'processing', text: `Downloading speech model… ${p.percent}%` });
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  controller = new DictationController({
    start: startRecording,
    finish: finishDictation,
    dismiss: (reason) => {
      log.info(`Dictation dismissed (${reason})`);
      stopRecording(true);
      if (reason === 'tap') {
        const keys = lastTalkBinding && lastTalkBinding.keys ? lastTalkBinding.keys : holdKeys();
        flash(`Hold ${formatShortcut(keys)} while you speak`, 'info', 2200);
      }
      else sendOverlayState({ state: 'idle' });
    },
  });
  controller.on('status', ({ status, locked }) => {
    if (status === 'listening') sendOverlayState(listeningState());
    broadcast('dictation:status', { status, locked, translateTo: listeningState().translateTo, mode: listeningState().mode });
    updateTrayMenu();
  });
  controller.on('busy', () => flash('Still working on the last dictation…'));
  controller.on('cancel-processing', () => sendOverlayState({ state: 'idle' }));

  keyboard = new KeyboardService();
  keyboard.on('action', onAction);
  keyboard.on('chord', () => controller.otherChord());
  keyboard.on('recording', onRecording);
  keyboard.setBindings(settings.get().bindings);
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
        title: `Pauli Speaks ${state.version} is ready`,
        content: 'Restart from the tray menu or the app to update. Otherwise it installs when you quit.',
        iconType: 'info',
      });
    }
  });

  registerIpc();
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
  if (settings.get().translation.always && needsNllb(settings.get())) preloadTranslator();

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
    const result = await transcribe(samples);
    report.dictation = { ms: Date.now() - t0, raw: result.text, text: cleanTranscript(result.text, settings.get()), language: result.language };
    report.codeStyle = cleanTranscript(result.text, { ...settings.get(), style: 'code' });
    log.info(`SELFTEST transcript (${report.dictation.ms}ms on ${report.device}): ${JSON.stringify(report.dictation.text)}`);

    if (process.env.PAULI_SELFTEST_TARGET) {
      const saved = { ...settings.get().translation };
      settings.update({ translation: { target: process.env.PAULI_SELFTEST_TARGET } });
      t0 = Date.now();
      const tr = await transcribe(samples, { translate: true });
      report.translation = { ms: Date.now() - t0, text: tr.text, translatedTo: tr.translatedTo };
      settings.update({ translation: saved });
    }

    t0 = Date.now();
    const looped = new Float32Array(samples.length * 3 + SAMPLE_RATE * 3);
    for (let i = 0; i < 3; i++) looped.set(samples, i * (samples.length + SAMPLE_RATE));
    const file = await transcribeFile(looped);
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
