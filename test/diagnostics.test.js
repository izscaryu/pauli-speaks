'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnostics, scrubLogLine, issueUrl, LOG_LINES } = require('../src/main/diagnostics');
const { registerDiagnosticsIpc } = require('../src/main/diagnostics-ipc');
const { DEFAULTS } = require('../src/main/settings');

const HOME = 'C:\\Users\\jana';

/** What diagnostics-ipc gathers on a typical PC. */
const info = (more = {}) => ({
  app: { version: '1.3.0-beta.3', portable: false, betaUpdates: true },
  system: { windows: '10.0.26300', arch: 'x64', cpu: 'AMD Ryzen 7 7840U', threads: 16, ramGb: 31.7, freeRamGb: 12.4 },
  gpu: { vendor: 'amd', usable: true },
  engine: { engine: 'local', localModel: 'onnx-community/whisper-small', acceleration: 'auto', cloudModel: 'whisper-large-v3-turbo', cloudHost: 'api.groq.com', hasApiKey: true },
  model: { status: 'ready', device: 'dml', gpuError: null, error: null },
  translator: { status: 'idle', error: null },
  models: [{ id: 'onnx-community/whisper-small', mb: 174 }],
  languages: ['hr', 'en'],
  switches: { silenceDetection: true, crashRecovery: true, historyRetention: 'keep', audioHistory: 'off', voiceCommandsEnabled: true, livePreview: false },
  bindings: [{ action: 'dictate', keys: 'Ctrl + Win', behaviour: 'both' }, { action: 'cancel', keys: 'Esc', behaviour: null }],
  hookError: null,
  conflicts: [],
  log: ['2026-10-19T13:22:02.891Z [info] Pauli Speaks 1.3.0-beta.3 starting'],
  ...more,
});

test('the block names the version, Windows, hardware, engine, model state, languages, settings, shortcuts and hook', () => {
  const text = buildDiagnostics(info());
  for (const expected of [
    '1.3.0-beta.3', 'installed', 'early versions on', '10.0.26300', 'x64', 'AMD Ryzen 7 7840U', '16 threads', '31.7 GB', '12.4 GB free',
    'amd', 'onnx-community/whisper-small', 'acceleration auto', 'ready on dml', 'hr, en', 'silence detection on',
    'crash recovery on', 'history keep', 'recordings off', 'voice commands on', 'live preview off',
    'dictate: Ctrl + Win (both)', 'cancel: Esc', 'Keyboard hook: running', 'whisper-small 174 MB',
  ]) assert.ok(text.includes(expected), `missing "${expected}"`);
  assert.ok(text.includes('Pauli Speaks 1.3.0-beta.3 starting'), 'the log lines are in it');
});

test('the cloud engine shows its model and provider host, never the key itself', () => {
  const text = buildDiagnostics(info({ engine: { engine: 'cloud', localModel: 'onnx-community/whisper-small', acceleration: 'auto', cloudModel: 'whisper-large-v3-turbo', cloudHost: 'api.groq.com', hasApiKey: true } }));
  assert.ok(text.includes('cloud, whisper-large-v3-turbo at api.groq.com (API key set)'));
  const none = buildDiagnostics(info({ engine: { engine: 'cloud', cloudModel: 'm', cloudHost: 'h', hasApiKey: false } }));
  assert.ok(none.includes('(no API key)'));
});

test('problems are spelled out: hook failure, model and GPU errors, conflicting apps, portable copy', () => {
  const text = buildDiagnostics(info({
    app: { version: '1.3.0', portable: true, betaUpdates: false },
    hookError: 'uiohook failed to start',
    model: { status: 'error', device: null, gpuError: 'DirectML device lost', error: 'Speech engine stopped unexpectedly' },
    conflicts: ['Wispr Flow'],
  }));
  assert.ok(text.includes('portable'));
  assert.ok(text.includes('Keyboard hook: failed (uiohook failed to start)'));
  assert.ok(text.includes('error: Speech engine stopped unexpectedly'));
  assert.ok(text.includes('GPU error: DirectML device lost'));
  assert.ok(text.includes('Wispr Flow'));
});

test('it pastes cleanly into a GitHub issue: a heading, and the log in a code block that a line cannot break out of', () => {
  const text = buildDiagnostics(info({ log: ['a line with ``` in it'] }));
  assert.match(text, /^### Pauli Speaks diagnostics/);
  const fences = text.split('\n').filter((l) => l.trim() === '```');
  assert.equal(fences.length, 2, 'one log code block');
  assert.ok(!text.includes('with ``` in'));
});

test('scrubLogLine: the Windows account name and anything key-like are taken out', () => {
  assert.equal(scrubLogLine(`at ${HOME}\\AppData\\Local\\Programs\\x.js:1`, HOME), 'at %USERPROFILE%\\AppData\\Local\\Programs\\x.js:1');
  assert.equal(scrubLogLine('at c:/users/jana/Downloads/a.exe', HOME), 'at %USERPROFILE%/Downloads/a.exe', 'any case, forward slashes');
  assert.equal(scrubLogLine('HTTP 401: Bearer gsk_abcdefghijklmnop1234 rejected', HOME), 'HTTP 401: Bearer [hidden] rejected');
  assert.equal(scrubLogLine('key sk-proj-ABCDEFGHIJ0123456789 bad', HOME), 'key [hidden] bad');
  assert.equal(scrubLogLine('nothing to hide', HOME), 'nothing to hide');
});

test('issueUrl: the bug form of the project, with the version filled in', () => {
  assert.equal(
    issueUrl({ owner: 'izscaryu', repo: 'pauli-speaks' }, '1.3.0-beta.3'),
    'https://github.com/izscaryu/pauli-speaks/issues/new?template=bug.yml&version=1.3.0-beta.3',
  );
});

// ---------------------------------------------------------------- IPC with fakes

function fakeIpc() {
  const handlers = new Map();
  return { handle: (channel, fn) => handlers.set(channel, fn), invoke: (channel, ...args) => handlers.get(channel)({}, ...args), handlers };
}

function deps(more = {}) {
  const calls = { copied: [], opened: [] };
  const settings = {
    ...structuredClone(DEFAULTS), languages: ['hr', 'en'], localModel: 'onnx-community/whisper-small', betaUpdates: true,
    cloud: { ...DEFAULTS.cloud, apiKeyEnc: 'secret-encrypted-blob' },
  };
  const d = {
    appVersion: () => '1.3.0-beta.3',
    isPortable: () => false,
    getSettings: () => settings,
    hasApiKey: () => true,
    os: {
      release: () => '10.0.26300', arch: () => 'x64', homedir: () => HOME,
      cpus: () => Array.from({ length: 8 }, () => ({ model: 'Test CPU ' })), totalmem: () => 16 * 1024 ** 3, freemem: () => 4 * 1024 ** 3,
    },
    gpuInfo: async () => ({ gpuDevice: [{ active: true, vendorId: 0x10de }] }),
    getModelState: () => ({ status: 'ready', device: 'dml', gpuError: null, error: null, model: 'onnx-community/whisper-small', promise: Promise.resolve() }),
    getTranslatorState: () => ({ status: 'idle', error: null }),
    modelsDir: () => 'C:\\models',
    modelIds: ['onnx-community/whisper-base', 'onnx-community/whisper-small'],
    dirSize: (dir) => (dir.endsWith('whisper-small') ? 174 * 1024 * 1024 : 0),
    formatKeys: (keys) => keys.join(' + '),
    hookError: () => null,
    processNames: async () => ['explorer.exe', 'wisprflow.exe'],
    recentLog: (n) => [`${HOME}\\AppData x`, 'the second line'].slice(-n),
    writeClipboard: async (text) => { calls.copied.push(text); },
    openExternal: async (url) => { calls.opened.push(url); },
    repo: { owner: 'izscaryu', repo: 'pauli-speaks' },
    log: { warn() {} },
    ...more,
  };
  return { d, calls, settings };
}

test('diagnostics:copy puts the block on the clipboard from the real settings, without the key, and says how many log lines', async () => {
  const ipc = fakeIpc();
  const { d, calls } = deps();
  registerDiagnosticsIpc(ipc, d);
  const out = await ipc.invoke('diagnostics:copy');
  assert.equal(calls.copied.length, 1);
  const text = calls.copied[0];
  assert.ok(text.includes('1.3.0-beta.3'));
  assert.ok(text.includes('Test CPU (8 threads)'));
  assert.ok(text.includes('16.0 GB (4.0 GB free)'));
  assert.ok(text.includes('nvidia'));
  assert.ok(text.includes('whisper-small 174 MB'));
  assert.ok(!text.includes('whisper-base 0 MB'), 'models that are not downloaded are left out');
  assert.ok(text.includes('dictate: Ctrl + Meta'));
  assert.ok(text.includes('%USERPROFILE%\\AppData'));
  assert.ok(!text.includes(HOME));
  assert.ok(!text.includes('secret-encrypted-blob'));
  assert.ok(text.includes('Wispr Flow'));
  assert.deepEqual(out, { ok: true, lines: 2 });
  assert.equal(calls.opened.length, 0);
});

test('AI polish: off, or where it goes and which modes polish at which level', () => {
  assert.ok(buildDiagnostics(info()).includes('- AI polish: off'));
  const on = buildDiagnostics(info({ polish: { provider: 'ollama', model: 'qwen2.5:1.5b', host: '127.0.0.1:11434', hasApiKey: false, modes: ['chat medium', 'code prompt'] } }));
  assert.ok(on.includes('- AI polish: ollama, qwen2.5:1.5b at 127.0.0.1:11434 (chat medium, code prompt)'), on);
  const custom = buildDiagnostics(info({ polish: { provider: 'custom', model: 'm', host: 'llm.example.org', hasApiKey: true, modes: [] } }));
  assert.ok(custom.includes('- AI polish: custom, m at llm.example.org, own API key set (no mode polishes)'), custom);
});

test('diagnostics:copy names the polish provider from the real settings, never its key', async () => {
  const ipc = fakeIpc();
  const { d, calls, settings } = deps();
  settings.polish = { provider: 'custom', baseUrl: 'https://llm.example.org/v1', model: 'm', apiKeyEnc: 'polish-encrypted-blob' };
  settings.modes = [{ ...settings.modes[0], aiPolish: 'light' }, ...settings.modes.slice(1)];
  registerDiagnosticsIpc(ipc, d);
  await ipc.invoke('diagnostics:copy');
  assert.ok(calls.copied[0].includes('AI polish: custom, m at llm.example.org, own API key set (default light)'), calls.copied[0]);
  assert.ok(!calls.copied[0].includes('polish-encrypted-blob'));
});

test('diagnostics:report copies, then opens the bug form on GitHub', async () => {
  const ipc = fakeIpc();
  const { d, calls } = deps();
  registerDiagnosticsIpc(ipc, d);
  const out = await ipc.invoke('diagnostics:report');
  assert.equal(calls.copied.length, 1);
  assert.deepEqual(calls.opened, ['https://github.com/izscaryu/pauli-speaks/issues/new?template=bug.yml&version=1.3.0-beta.3']);
  assert.equal(out.ok, true);
});

test('a part that fails to gather is noted, and the rest is still copied', async () => {
  const ipc = fakeIpc();
  const { d, calls } = deps({ gpuInfo: async () => { throw new Error('no GPU info'); }, processNames: async () => { throw new Error('tasklist'); } });
  registerDiagnosticsIpc(ipc, d);
  const out = await ipc.invoke('diagnostics:copy');
  assert.equal(out.ok, true);
  assert.ok(calls.copied[0].includes('GPU: unknown'));
  assert.ok(calls.copied[0].includes('1.3.0-beta.3'));
});

test('the clipboard failing is reported back, not thrown', async () => {
  const ipc = fakeIpc();
  const { d } = deps({ writeClipboard: async () => { throw new Error('clipboard busy'); } });
  registerDiagnosticsIpc(ipc, d);
  assert.deepEqual(await ipc.invoke('diagnostics:copy'), { ok: false, error: 'clipboard busy' });
});

test(`at most the last ${LOG_LINES} log lines`, async () => {
  const ipc = fakeIpc();
  let asked = 0;
  const { d } = deps({ recentLog: (n) => { asked = n; return []; } });
  registerDiagnosticsIpc(ipc, d);
  await ipc.invoke('diagnostics:copy');
  assert.equal(asked, LOG_LINES);
  assert.equal(LOG_LINES, 100);
});
