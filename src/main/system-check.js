'use strict';
// Checks the welcome flow runs on first start: system languages, GPU vendor,
// the model that fits both, and other dictation apps that may fight over the
// microphone or shortcut. Pure (no Electron) so it can be unit tested; the
// caller passes in app.getLocaleList-style data, app.getGPUInfo('complete')
// and the output of `tasklist /fo csv /nh`.

const { MODELS, modelDir } = require('./asr/whisper-local');

// Ids from MODELS in asr/whisper-local.js (a test keeps them in sync).
const MODEL_BASE = 'onnx-community/whisper-base';
const MODEL_SMALL = 'onnx-community/whisper-small';
const MODEL_LARGE_TURBO = 'onnx-community/whisper-large-v3-turbo';

const GPU_VENDORS = { 0x10de: 'nvidia', 0x1002: 'amd', 0x8086: 'intel' };
// Intel GPUs are mostly integrated and too slow for Large v3 Turbo (DirectML is still tried if the user picks it).
const USABLE_VENDORS = new Set(['nvidia', 'amd']);

// Unverified exe names: before shipping, install each app in Windows Sandbox,
// read its image name in Task Manager and fix this list.
const KNOWN_CONFLICTS = [
  { name: 'Wispr Flow', exe: ['wispr flow.exe', 'wisprflow.exe'] },
  { name: 'Superwhisper', exe: ['superwhisper.exe'] },
  { name: 'Handy', exe: ['handy.exe'] },
  { name: 'Willow', exe: ['willow.exe', 'willow voice.exe'] },
];

// Windows reports Norwegian as Bokmal (nb) or Nynorsk (nn); the app's language list has just 'no'.
const LANGUAGE_ALIASES = { nb: 'no', nn: 'no' };

/** ['hr-HR', 'en-US', 'en-GB'] -> ['hr', 'en']: lower-case, order kept, deduped, non-strings dropped, nb/nn -> no. */
function baseLanguageCodes(locales) {
  if (!Array.isArray(locales)) return [];
  const out = [];
  for (const locale of locales) {
    if (typeof locale !== 'string') continue;
    const raw = locale.split(/[-_]/)[0].trim().toLowerCase();
    const code = Object.hasOwn(LANGUAGE_ALIASES, raw) ? LANGUAGE_ALIASES[raw] : raw;
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** app.getGPUInfo('complete') -> the active GPU's vendor and whether it can run Large v3 Turbo well. */
function classifyGpu(info) {
  const devices = info && Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
  const device = devices.find((d) => d && d.active === true) || devices[0];
  if (!device) return { usable: false, vendor: null };
  const vendor = Object.hasOwn(GPU_VENDORS, device.vendorId) ? GPU_VENDORS[device.vendorId] : 'other';
  return { usable: USABLE_VENDORS.has(vendor), vendor };
}

/** Usable GPU -> Large v3 Turbo; English only -> Base; anything else -> Small. */
function recommendModel({ languages, gpu }) {
  if (gpu && gpu.usable) return { model: MODEL_LARGE_TURBO, reason: 'gpu' };
  if (Array.isArray(languages) && languages.length === 1 && languages[0] === 'en') {
    return { model: MODEL_BASE, reason: 'english' };
  }
  return { model: MODEL_SMALL, reason: 'other-languages' };
}

/** True when Large v3 Turbo finished loading but runs on the CPU, where a smaller model is the better pick. */
function shouldOfferSmallerModel({ model, status, device }) {
  return model === MODEL_LARGE_TURBO && status === 'ready' && device !== 'dml';
}

/** `tasklist /fo csv /nh` output -> lower-cased image names (the first CSV column). */
function parseTasklistCsv(text) {
  if (typeof text !== 'string') return [];
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^"([^"]*)"/.exec(line);
    if (match && match[1]) names.push(match[1].toLowerCase());
  }
  return names;
}

/** Display names of the KNOWN_CONFLICTS apps among the running process names, each once. */
function findConflicts(processNames) {
  if (!Array.isArray(processNames)) return [];
  const running = new Set(processNames.filter((n) => typeof n === 'string').map((n) => n.toLowerCase()));
  return KNOWN_CONFLICTS.filter((c) => c.exe.some((exe) => running.has(exe))).map((c) => c.name);
}

// The one Windows Settings page the welcome flow links to (microphone blocked by privacy settings).
const MIC_PRIVACY_URL = 'ms-settings:privacy-microphone';

/** URLs the window may hand to shell.openExternal: https links, plus exactly the microphone privacy page. */
function isAllowedExternalUrl(url) {
  return typeof url === 'string' && (url.startsWith('https://') || url === MIC_PRIVACY_URL);
}

/**
 * The model loads when the app starts only once the welcome flow is done, the local engine is chosen and the
 * model is already on disk: someone who clicked "Finish later" before the engine step never confirmed a download.
 */
function shouldPreloadAtStartup(settings, isDownloaded) {
  return !!settings && settings.onboarded === true && settings.engine === 'local'
    && typeof isDownloaded === 'function' && isDownloaded(settings.localModel) === true;
}

/**
 * The folder "Download again" deletes: the model's folder under `modelsDir`, only for an id in MODELS.
 * Anything else (a path, `__proto__`, a made-up id) gives null, so nothing outside the models folder can be named.
 */
function redownloadPath(modelsDir, modelId) {
  if (typeof modelsDir !== 'string' || !modelsDir || typeof modelId !== 'string') return null;
  if (!MODELS.some((m) => m.id === modelId)) return null;
  return modelDir(modelsDir, modelId);
}

module.exports = {
  MODEL_BASE, MODEL_SMALL, MODEL_LARGE_TURBO, KNOWN_CONFLICTS,
  baseLanguageCodes, classifyGpu, recommendModel, shouldOfferSmallerModel, parseTasklistCsv, findConflicts,
  shouldPreloadAtStartup, isAllowedExternalUrl, redownloadPath,
};
