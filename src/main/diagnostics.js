'use strict';
// The block behind About → "Copy diagnostic info": what a bug report needs, as Markdown that pastes
// cleanly into a GitHub issue. Never dictated text (no log line carries any) and never an API key: log
// lines are scrubbed of the Windows account name and of anything key-like on the way in.
// Pure, so it is unit tested; diagnostics-ipc.js gathers the information.

const LOG_LINES = 100;

const onOff = (v) => (v ? 'on' : 'off');
const shortModel = (id) => String(id || '').split('/').pop();

function engineLine(e) {
  if (e.engine === 'cloud') return `cloud, ${e.cloudModel} at ${e.cloudHost} (${e.hasApiKey ? 'API key set' : 'no API key'})`;
  return `local, ${e.localModel}, acceleration ${e.acceleration}`;
}

/** "ollama, qwen2.5:1.5b at 127.0.0.1:11434 (chat medium)": where AI polish goes and which modes use it. */
function polishLine(p) {
  if (!p || !p.provider || p.provider === 'off') return 'off';
  const modes = p.modes && p.modes.length ? p.modes.join(', ') : 'no mode polishes';
  return `${p.provider}, ${p.model || 'no model'} at ${p.host || '?'}${p.hasApiKey ? ', own API key set' : ''} (${modes})`;
}

function stateLine(s) {
  if (!s) return 'unknown';
  const main = s.status === 'error' ? `error: ${s.error}` : `${s.status}${s.device ? ` on ${s.device}` : ''}`;
  return s.gpuError ? `${main}, GPU error: ${s.gpuError}` : main;
}

function gpuLine(g) {
  if (!g || !g.vendor) return 'unknown';
  return `${g.vendor} (DirectML usable: ${g.usable ? 'yes' : 'no'})`;
}

function systemLines(s) {
  if (!s) return ['- Windows: unknown'];
  return [
    `- Windows: ${s.windows} ${s.arch}`,
    `- CPU: ${s.cpu} (${s.threads} threads), RAM ${s.ramGb.toFixed(1)} GB (${s.freeRamGb.toFixed(1)} GB free)`,
  ];
}

function settingsLine(w) {
  return [
    `silence detection ${onOff(w.silenceDetection)}`, `crash recovery ${onOff(w.crashRecovery)}`,
    `history ${w.historyRetention}`, `recordings ${w.audioHistory}`,
    `voice commands ${onOff(w.voiceCommandsEnabled)}`, `live preview ${onOff(w.livePreview)}`,
  ].join(', ');
}

/** A log line with the Windows account name and anything that looks like an API key taken out. */
function scrubLogLine(line, home) {
  let out = String(line);
  if (home) {
    const pattern = String(home).split(/[\\/]+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
    out = out.replace(new RegExp(pattern, 'gi'), '%USERPROFILE%');
  }
  return out
    .replace(/\bBearer\s+\S+/g, 'Bearer [hidden]')
    .replace(/\b(?:gsk|sk)[-_][A-Za-z0-9_-]{12,}/g, '[hidden]');
}

/**
 * @param {object} info  gathered by diagnostics-ipc.js (see its gather())
 * @returns {string} Markdown
 */
function buildDiagnostics(info) {
  const { app, engine, switches } = info;
  const models = info.models && info.models.length ? info.models.map((m) => `${shortModel(m.id)} ${m.mb} MB`).join(', ') : 'none';
  const bindings = (info.bindings || []).map((b) => `${b.action}: ${b.keys}${b.behaviour ? ` (${b.behaviour})` : ''}`).join('; ') || 'none';
  const log = (info.log || []).map((l) => String(l).replace(/```/g, "'''"));
  return [
    '### Pauli Speaks diagnostics',
    '',
    `- Version: ${app.version} (${app.portable ? 'portable' : 'installed'}, early versions ${onOff(app.betaUpdates)})`,
    ...systemLines(info.system),
    `- GPU: ${gpuLine(info.gpu)}`,
    `- Engine: ${engineLine(engine)}`,
    `- AI polish: ${polishLine(info.polish)}`,
    `- Speech model: ${stateLine(info.model)}`,
    `- Translator: ${stateLine(info.translator)}`,
    `- Downloaded models: ${models}`,
    `- Languages: ${info.languages && info.languages.length ? info.languages.join(', ') : 'automatic'}`,
    `- Settings: ${settingsLine(switches)}`,
    `- Shortcuts: ${bindings}`,
    `- Keyboard hook: ${info.hookError ? `failed (${info.hookError})` : 'running'}`,
    `- Apps that may use the same shortcut: ${info.conflicts && info.conflicts.length ? info.conflicts.join(', ') : 'none'}`,
    '',
    `Last ${log.length} log lines (they never contain dictated text):`,
    '',
    '```',
    ...log,
    '```',
    '',
  ].join('\n');
}

/** The project's bug form on GitHub, with the version filled in (the block itself is too long for a URL). */
function issueUrl({ owner, repo }, version) {
  return `https://github.com/${owner}/${repo}/issues/new?template=bug.yml&version=${encodeURIComponent(version)}`;
}

module.exports = { buildDiagnostics, scrubLogLine, issueUrl, LOG_LINES };
