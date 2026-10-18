'use strict';

const api = window.pauli;
const $ = (sel) => document.querySelector(sel);

const KEY_LABELS = {
  Ctrl: 'Ctrl', CtrlRight: 'RCtrl', Alt: 'Alt', AltRight: 'RAlt', Shift: 'Shift',
  ShiftRight: 'RShift', Meta: 'Win', MetaRight: 'RWin', Escape: 'Esc', CapsLock: 'Caps',
  Mouse3: 'Mouse 3', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5', Space: 'Space', Backquote: '`',
};
const ORDER = ['Ctrl', 'CtrlRight', 'Meta', 'MetaRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight'];
// The Shortcuts page, grouped as in docs/design/redesign-concept.html. talk = per-shortcut Hold / Toggle / Both.
const ACTION_INFO = [
  { action: 'dictate', group: 'start', title: 'Dictate', desc: 'Talk, and your words land where the cursor is.', talk: true, min: 1 },
  { action: 'translate', group: 'start', title: 'Talk & translate', desc: 'Dictate into your translation language. Add it to a held talk shortcut to switch mid-sentence.', talk: true },
  { action: 'command', group: 'start', title: 'Command mode', desc: 'Say what to do with the selected text, or what to write.', talk: true },
  { action: 'cancel', group: 'during', title: 'Cancel', desc: 'Throw away what you just said, or stop reading. Works mid-chord.', min: 1, max: 1 },
  { action: 'cycleMode', group: 'during', title: 'Switch mode', desc: 'Reserved for Modes, which arrive in a later version.', badge: 'Soon' },
  { action: 'pasteLast', group: 'after', title: 'Paste last transcript', desc: 'Type your last dictation again.' },
  { action: 'copyLast', group: 'after', title: 'Copy last transcript', desc: 'Put your last dictation on the clipboard.', badge: 'New' },
  { action: 'undoLast', group: 'after', title: 'Undo last dictation', desc: 'Removes the text Pauli Speaks just typed, in the app it typed it into.', badge: 'New' },
  { action: 'pressEnter', group: 'after', title: 'Press Enter', desc: 'Send the chat message. While you dictate, it finishes and sends.', badge: 'New' },
  { action: 'readAloud', group: 'after', title: 'Read aloud', desc: 'Hear the selected text. Press again, or Esc, to stop.' },
];
const ACTION_TITLE = Object.fromEntries(ACTION_INFO.map((a) => [a.action, a.title]));
const MAX_BINDINGS = 4;
const BEHAVIOURS = [['hold', 'Hold', 'Talk while you hold it'], ['toggle', 'Toggle', 'Press to start, press again to finish'], ['both', 'Both', 'Hold to talk, or double-tap to keep listening']];
const MOUSE_NOTE = { Mouse3: 'Also middle-clicks in other apps', Mouse4: 'Also goes Back in browsers', Mouse5: 'Also goes Forward in browsers' };
const VC_PRESETS = {
  enter: { action: 'key', arg: 'Enter' },
  tab: { action: 'key', arg: 'Tab' },
  newline: { action: 'insert', arg: '\n' },
  paragraph: { action: 'insert', arg: '\n\n' },
  undo: { action: 'undo', arg: '' },
  text: { action: 'insert' },
  snippet: { action: 'snippet' },
};
const STYLE_LABELS = { normal: 'Normal', casual: 'Casual · no final full stop', formal: 'Formal · always punctuated', code: 'Code · no capitals or full stop' };
const LANGUAGES = [
  ['en', 'English'], ['hr', 'Croatian'], ['de', 'German'], ['es', 'Spanish'], ['fr', 'French'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sr', 'Serbian'],
  ['bs', 'Bosnian'], ['sl', 'Slovenian'], ['cs', 'Czech'], ['sk', 'Slovak'], ['hu', 'Hungarian'],
  ['ro', 'Romanian'], ['uk', 'Ukrainian'], ['ru', 'Russian'], ['tr', 'Turkish'], ['sv', 'Swedish'],
  ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['el', 'Greek'], ['ar', 'Arabic'],
  ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
];
const LANG_NAME = Object.fromEntries(LANGUAGES);
const ICONS = {
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

let settings = null;
let modelState = null;
let rec = null; // shortcut being recorded: { action, replaceId, keys, error, warning }
let historyItems = [];
let dictation = { status: 'idle' };

// ------------------------------------------------------------------ helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only used with the static ICONS above
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}

function keyChips(keys) {
  const sorted = [...(keys || [])].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  if (!sorted.length) return [el('span', { class: 'key empty' }, 'Not set')];
  return sorted.map((k) => el('kbd', { class: 'key' }, KEY_LABELS[k] || k.replace(/^Digit/, '')));
}

const keyText = (keys) => [...keys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((k) => KEY_LABELS[k] || k.replace(/^Digit/, '')).join(' + ');

/** First binding of an action that passes `test`, or null. */
const firstBinding = (action, test = () => true) => (settings.bindings || []).find((b) => b.action === action && test(b)) || null;

/** Keycaps for a binding: a double-tap shows its key twice-marked. */
function bindingChips(b) {
  if (!b) return keyChips([]);
  return b.trigger === 'doubleTap' ? [...keyChips(b.keys), el('span', { class: 'tap', title: 'Double-tap' }, '×2')] : keyChips(b.keys);
}
const code = (c) => (c || '??').toUpperCase();

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

async function save(patch, message = 'Saved') {
  settings = await api.updateSettings(patch);
  if (message) toast(message);
}

const fmtNum = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());

function modelLabel() {
  if (settings.engine === 'cloud') return `Cloud · ${settings.cloud.model}`;
  const m = modelState?.models.find((x) => x.id === settings.localModel);
  const gpu = modelState?.status === 'ready' && modelState.device === 'dml' ? ' · GPU' : '';
  return `Whisper ${m ? m.label : settings.localModel}${gpu}`;
}

function translationLabel() {
  const t = settings.translation;
  return t.always ? `Always → ${code(t.target)}` : `On shortcut → ${code(t.target)}`;
}

// ------------------------------------------------------------------ navigation

document.querySelectorAll('.nav').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((n) => n.classList.toggle('active', n === b));
    document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== `page-${b.dataset.page}`));
    if (rec) api.stopRecordingShortcut();
    rec = null;
    renderShortcuts();
    if (b.dataset.page === 'settings') renderMics();
  }),
);
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.go)));

// ------------------------------------------------------------------ transcripts page

function renderStrip() {
  $('#ptt-chips').replaceChildren(...bindingChips(firstBinding('dictate', (b) => b.behaviour !== 'toggle')));
  $('#hf-chips').replaceChildren(...bindingChips(firstBinding('dictate', (b) => b.behaviour === 'toggle')));
  $('#tr-chips').replaceChildren(...bindingChips(firstBinding('translate')));
  $('#cancel-chips').replaceChildren(...bindingChips(firstBinding('cancel')));
  $('#tr-label').textContent = `Talk → ${LANG_NAME[settings.translation.target] || code(settings.translation.target)}`;
  $('#side-engine').textContent = modelLabel();
  $('#side-translate').textContent = translationLabel();
}

function renderLive() {
  const live = $('#live');
  const { status, locked, translateTo, mode } = dictation;
  live.className = `live ${status === 'listening' ? 'listening' : status === 'processing' ? 'processing' : ''}`;
  let text = 'Ready';
  if (status === 'listening' && mode === 'command') text = 'Command';
  else if (status === 'listening') text = `${locked ? 'Hands-free' : 'Listening'}${translateTo ? ` → ${code(translateTo)}` : ''}`;
  else if (status === 'processing') text = 'Transcribing';
  else if (settings?.translation.always) text = `Ready → ${code(settings.translation.target)}`;
  $('#live-text').textContent = text;
}

async function renderStats() {
  const st = await api.getStats();
  $('#st-words').textContent = fmtNum(st.words);
  $('#st-wpm').textContent = st.wpm;
  $('#st-saved').textContent = fmtNum(st.minutesSaved);
  $('#st-count').textContent = fmtNum(st.dictations);
  $('#st-streak').textContent = st.streak || 0;
  const max = Math.max(1, ...(st.daily || []).map((d) => d.words));
  const todayKey = (st.daily || []).at(-1)?.date;
  $('#week-bars').replaceChildren(...(st.daily || []).map((d) => {
    const date = new Date(`${d.date}T12:00:00`);
    const label = `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}: ${d.words.toLocaleString()} words`;
    return el('div', { class: `wbar${d.date === todayKey ? ' today' : ''}`, 'data-tip': label, 'aria-label': label, role: 'img' },
      el('i', { style: `height:${Math.max(2, Math.round((d.words / max) * 100))}%` }));
  }));
}

async function loadHistory() {
  historyItems = await api.listHistory();
  recentApps = [...new Set(historyItems.map((i) => i.app).filter(Boolean))].slice(0, 20);
  renderHistory();
  if (settings) renderAppStyles();
}

function historyItem(item) {
  if (item.status === 'failed') return FailedHistory.item(item); // history-failed.js
  const d = new Date(item.createdAt);
  const secs = Math.max(1, Math.round((item.durationMs || 0) / 1000));
  const meta = el('div', { class: 'meta' },
    item.kind === 'command' ? el('span', { class: 'tag ai' }, '✦ AI') : null,
    item.translatedTo
      ? el('span', { class: 'tag tr' }, `${code(item.language)} → ${code(item.translatedTo)}`)
      : item.language ? el('span', { class: 'tag' }, code(item.language)) : null,
    item.app ? el('span', { class: 'tag app' }, item.app.replace(/\.exe$/i, '')) : null,
    `${item.words} words · ${secs}s · ${item.engine}`);
  const body = el('div', {},
    item.instruction ? el('div', { class: 'instr' }, `“${item.instruction}”`) : null,
    el('p', {}, item.text), meta);
  if (item.original) {
    const orig = el('p', { class: 'orig', hidden: true }, item.original);
    meta.append(el('button', {
      class: 'linkish',
      onclick: (e) => {
        orig.hidden = !orig.hidden;
        e.target.textContent = orig.hidden ? 'Show original' : 'Hide original';
      },
    }, 'Show original'));
    body.insertBefore(orig, meta);
  }
  return el('div', { class: 'item' },
    el('time', { datetime: item.createdAt }, d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
    body,
    el('div', { class: 'actions' },
      el('button', { class: 'icon-btn', title: 'Copy', 'aria-label': 'Copy transcript', html: ICONS.copy, onclick: async () => { await api.copy(item.text); toast('Copied'); } }),
      el('button', { class: 'icon-btn danger', title: 'Delete', 'aria-label': 'Delete transcript', html: ICONS.trash, onclick: () => api.deleteHistory(item.id) })));
}

function renderHistory() {
  const box = $('#history');
  const q = $('#history-search').value.trim().toLowerCase();
  const items = q
    ? historyItems.filter((i) => (i.text || '').toLowerCase().includes(q) || (i.original || '').toLowerCase().includes(q))
    : historyItems;
  if (!items.length) {
    box.replaceChildren(el('div', { class: 'empty' }, q ? 'No transcripts match.' : 'Nothing yet. Hold your talk shortcut and say something.'));
    return;
  }
  const out = [];
  let lastDay = null;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  for (const item of items.slice(0, 200)) {
    const d = new Date(item.createdAt);
    const day = d.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      out.push(el('div', { class: 'day' }, day === today ? 'Today' : day === yesterday ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
    }
    out.push(historyItem(item));
  }
  box.replaceChildren(...out);
}

$('#history-search').addEventListener('input', renderHistory);
$('#clear-history').addEventListener('click', async () => {
  if (confirm('Delete all transcripts? This cannot be undone.')) await api.clearHistory();
});

let slowNoteDismissed = false; // the "Large v3 Turbo is slow" note, hidden for this session
/** Home notes when no model job runs: the chosen model isn't on disk yet, or Large v3 Turbo fell back to the CPU. */
function modelNote() {
  if (settings.engine !== 'local') return null;
  const m = modelState.models.find((x) => x.id === settings.localModel);
  if (m && !m.downloaded && modelState.status === 'idle') {
    return [el('div', { class: 'grow' }, el('strong', {}, 'The speech model is not downloaded yet.'), el('span', { class: 'desc' }, 'One-time download. After this it runs offline.')),
      el('button', { class: 'btn primary', onclick: () => api.loadModel() }, `Download Whisper ${m.label} (${m.size})`)];
  }
  if (modelState.offerSmaller && modelState.model === settings.localModel && !slowNoteDismissed) {
    return [el('div', { class: 'grow' }, el('strong', {}, 'Your graphics card couldn\'t be used, so Whisper Large v3 Turbo is slow on this PC.')),
      el('button', { class: 'btn', onclick: () => save({ localModel: 'onnx-community/whisper-small' }, 'Switched to Whisper Small') }, 'Use Whisper Small'),
      el('button', { class: 'btn', onclick: () => { slowNoteDismissed = true; renderBanner(); } }, 'Dismiss')];
  }
  return null;
}

function renderBanner() {
  const banner = $('#model-banner');
  const side = $('#side-progress');
  if (!modelState) return;
  const jobs = [];
  if (settings.engine === 'local') jobs.push({ name: modelLabel(), ...modelState, retry: api.loadModel, again: () => HomeNotices.canRedownload() });
  const tr = modelState.translator;
  if (tr && tr.status !== 'idle' && tr.status !== 'ready') jobs.push({ name: 'Translator (NLLB-200)', ...tr, retry: api.loadTranslator });
  const job = jobs.find((j) => j.status === 'error') || jobs.find((j) => j.status === 'downloading' || j.status === 'loading');
  if (!job) {
    const note = modelNote();
    banner.hidden = !note;
    banner.classList.remove('error');
    if (note) banner.replaceChildren(...note);
    side.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.classList.toggle('error', job.status === 'error');
  if (job.status === 'error') {
    banner.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, `Couldn't load ${job.name}`), el('span', { class: 'desc' }, job.error || '')),
      el('button', { class: 'btn', onclick: () => job.retry() }, 'Retry'),
      ...(job.again?.() ? [el('button', { class: 'btn', onclick: HomeNotices.redownload }, 'Download again')] : []));
    side.hidden = true;
    return;
  }
  const downloading = job.status === 'downloading';
  const meter = el('div', { class: 'meter' }, el('i', { style: `width:${downloading ? job.percent : 100}%` }));
  banner.replaceChildren(
    el('div', { class: 'grow' },
      el('strong', {}, downloading ? `Downloading ${job.name}` : `Loading ${job.name}…`),
      downloading ? el('span', { class: 'desc' }, 'One-time download. After this it runs offline.') : null,
      downloading ? meter : null),
    ...(downloading ? [el('b', {}, `${job.percent}%`)] : []));
  side.hidden = !downloading;
  side.firstElementChild.style.width = `${job.percent || 0}%`;
}

// ------------------------------------------------------------------ dictionary

function renderDictionary() {
  const list = $('#dict-list');
  const entries = settings.dictionary || [];
  if (!entries.length) {
    list.replaceChildren(el('div', { class: 'empty' }, 'No words yet.'));
    return;
  }
  list.replaceChildren(...entries.map((e, i) =>
    el('div', { class: 'dict-item' },
      el('span', { class: 'from' }, e.from), el('span', { class: 'arrow' }, '→'), el('strong', {}, e.to),
      el('button', { class: 'icon-btn danger', title: 'Remove', 'aria-label': `Remove ${e.from}`, html: ICONS.trash,
        onclick: () => save({ dictionary: entries.filter((_, j) => j !== i) }, 'Removed') }))));
}

$('#dict-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('#dict-from').value.trim();
  const to = $('#dict-to').value.trim();
  if (!from || !to) return;
  const rest = (settings.dictionary || []).filter((d) => d.from.toLowerCase() !== from.toLowerCase());
  await save({ dictionary: [...rest, { from, to }] }, 'Added');
  $('#dict-from').value = '';
  $('#dict-to').value = '';
  $('#dict-from').focus();
});

// ------------------------------------------------------------------ snippets

function renderSnippets() {
  const list = $('#snip-list');
  const entries = settings.snippets || [];
  if (!entries.length) {
    list.replaceChildren(el('div', { class: 'empty' }, 'No snippets yet. Try "my email" → your address.'));
    return;
  }
  list.replaceChildren(...entries.map((s, i) =>
    el('div', { class: 'snip-item' },
      el('strong', {}, `“${s.trigger}”`), el('span', { class: 'body' }, s.text),
      el('button', { class: 'icon-btn danger', title: 'Remove', 'aria-label': `Remove snippet ${s.trigger}`, html: ICONS.trash,
        onclick: () => save({ snippets: entries.filter((_, j) => j !== i) }, 'Removed') }))));
}

$('#snip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const trigger = $('#snip-trigger').value.trim();
  const text = $('#snip-text').value;
  if (!trigger || !text.trim()) return;
  const rest = (settings.snippets || []).filter((s) => s.trigger.toLowerCase() !== trigger.toLowerCase());
  await save({ snippets: [...rest, { trigger, text }] }, 'Snippet added');
  $('#snip-trigger').value = '';
  $('#snip-text').value = '';
  $('#snip-trigger').focus();
});

// ------------------------------------------------------------------ files

let fileJob = null;

async function decodeToMono16k(file) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

async function transcribeFile(file) {
  if (fileJob) return;
  const job = $('#file-job');
  const status = $('#file-status');
  const meter = $('#file-meter');
  job.hidden = false;
  $('#file-name').textContent = file.name;
  $('#file-text').value = '';
  ['#file-copy', '#file-txt', '#file-srt'].forEach((s) => ($(s).disabled = true));
  $('#drop').classList.add('busy');
  meter.hidden = false;
  meter.firstElementChild.style.width = '0%';
  fileJob = { name: file.name };
  try {
    status.textContent = 'Decoding audio…';
    const audio = await decodeToMono16k(file);
    const minutes = audio.length / 16000 / 60;
    status.textContent = `Transcribing ${minutes < 1 ? `${Math.round(minutes * 60)} s` : `${minutes.toFixed(1)} min`} of audio…`;
    const t0 = performance.now();
    const result = await api.transcribeFile(audio, $('#file-translate').checked);
    fileJob = { name: file.name, ...result };
    $('#file-text').value = result.text || '(no speech found)';
    status.textContent = `Done in ${Math.round((performance.now() - t0) / 1000)} s · ${result.segments.length} segments${result.language ? ` · ${code(result.language)}` : ''}${result.translatedTo ? ` → ${code(result.translatedTo)}` : ''}`;
    ['#file-copy', '#file-txt', '#file-srt'].forEach((s) => ($(s).disabled = !result.text));
  } catch (err) {
    status.textContent = `Couldn't transcribe: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`;
    fileJob = null;
  } finally {
    $('#drop').classList.remove('busy');
    meter.hidden = true;
    if (fileJob && !fileJob.text) fileJob = null;
    const done = fileJob;
    fileJob = null;
    if (done) lastFile = done;
  }
}

let lastFile = null;
api.onFileProgress(({ done, total }) => {
  $('#file-meter').firstElementChild.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
});
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) transcribeFile(f);
});
const drop = $('#drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) transcribeFile(f);
});
$('#file-copy').addEventListener('click', async () => {
  await api.copy($('#file-text').value);
  toast('Copied');
});
for (const format of ['txt', 'srt']) {
  $(`#file-${format}`).addEventListener('click', async () => {
    if (!lastFile) return;
    const r = await api.saveTranscript({ name: lastFile.name, format, text: $('#file-text').value, segments: lastFile.segments });
    if (r.saved) toast(`Saved ${r.filePath.split(/[\\/]/).pop()}`);
  });
}

// ------------------------------------------------------------------ shortcuts page

function startRec(action, replaceId = null) {
  if (rec) api.stopRecordingShortcut();
  rec = { action, replaceId, keys: [], error: null, warning: null };
  api.recordShortcut({ action, replaceId });
  renderShortcuts();
}

function cancelRec() {
  api.stopRecordingShortcut();
  rec = null;
  renderShortcuts();
}

function saveBindings(bindings, message) {
  return save({ bindings }, message);
}

function behaviourControl(b) {
  if (b.trigger === 'doubleTap') return el('span', { class: 'desc', title: 'A double-tap always toggles' }, 'Toggle');
  const label = keyText(b.keys);
  return el('div', { class: 'segmented small three', role: 'group', 'aria-label': `Behaviour for ${label}` },
    ...BEHAVIOURS.map(([value, name, hint]) => el('button', {
      class: b.behaviour === value ? 'active' : '',
      title: hint,
      'aria-pressed': String(b.behaviour === value),
      onclick: () => b.behaviour !== value && saveBindings(settings.bindings.map((x) => (x.id === b.id ? { ...x, behaviour: value } : x)), `${label}: ${name.toLowerCase()}`),
    }, name)));
}

function bindRow(info, b, count) {
  const label = keyText(b.keys) + (b.trigger === 'doubleTap' ? ' double-tap' : '');
  const remove = () => {
    if (count <= (info.min || 0)) return toast(`${info.title} needs at least one shortcut.`);
    saveBindings(settings.bindings.filter((x) => x.id !== b.id), `Removed ${label}`);
  };
  const mouse = b.keys.find((k) => MOUSE_NOTE[k]);
  const note = b.trigger === 'doubleTap' ? 'Double-tap' : mouse ? MOUSE_NOTE[mouse] : /^F(1[3-9]|2[0-4])$/.test(b.keys[0]) && b.keys.length === 1 ? 'Pedal or macro key' : null;
  return el('li', { class: 'bind' },
    el('span', { class: 'chips' }, bindingChips(b)),
    note ? el('span', { class: 'note' }, note) : null,
    el('span', { class: 'spacer' }),
    info.talk ? behaviourControl(b) : null,
    info.max === 1 ? el('button', { class: 'btn quiet', onclick: () => startRec(info.action, b.id) }, 'Change') : null,
    el('button', { class: 'icon-btn danger', title: 'Remove', 'aria-label': `Remove ${label}`, html: ICONS.x, onclick: remove }));
}

function recRow(info) {
  const kids = [rec.keys.length
    ? el('span', { class: 'chips' }, keyChips(rec.keys))
    : el('span', { class: 'prompt' }, 'Press keys, a pedal or a mouse button…')];
  kids.push(el('span', { class: 'spacer' }));
  if (rec.warning) {
    kids.push(el('button', { class: 'btn', onclick: () => api.retryShortcut() }, 'Try another'));
    kids.push(el('button', { class: 'btn primary', onclick: () => api.confirmShortcut() }, 'Use anyway'));
    kids.push(el('div', { class: 'msg warn', role: 'alert' }, rec.warning));
  } else {
    kids.push(el('span', { class: 'hint' }, info.action === 'cancel' ? 'Saves when you let go' : 'Esc cancels · Backspace clears'));
    kids.push(el('button', { class: 'btn quiet', onclick: cancelRec }, 'Cancel'));
    if (rec.error) kids.push(el('div', { class: 'msg error', role: 'alert' }, rec.error));
  }
  return el('li', { class: 'bind recording', id: 'rec-row', tabindex: '-1', 'aria-live': 'polite' }, ...kids);
}

function actionBlock(info) {
  const list = (settings.bindings || []).filter((b) => b.action === info.action);
  const max = info.max || MAX_BINDINGS;
  const recording = rec && rec.action === info.action;
  const items = list.map((b) => (recording && rec.replaceId === b.id ? recRow(info) : bindRow(info, b, list.length)));
  if (recording && !rec.replaceId) items.push(recRow(info));
  const single = max === 1 && list.length > 0;
  return el('div', { class: 'action' },
    el('div', { class: 'action-head' },
      el('div', { class: 'grow' },
        el('div', { class: 'title' }, info.title, info.badge ? el('span', { class: 'badge' }, info.badge) : null),
        el('div', { class: 'desc' }, info.desc)),
      single ? null : el('button', {
        class: 'btn',
        disabled: list.length >= max || recording,
        'aria-label': `Add shortcut for ${info.title}`,
        onclick: () => startRec(info.action),
      }, `+ Add${list.length ? ` (${list.length} of ${max})` : ''}`)),
    items.length ? el('ul', { class: 'binds' }, items) : el('div', { class: 'desc muted' }, 'Not set. Add one if you want it.'));
}

function renderShortcuts() {
  if (!settings) return;
  for (const group of ['start', 'during', 'after']) {
    const blocks = ACTION_INFO.filter((a) => a.group === group).map(actionBlock);
    if (group === 'start') {
      blocks.push(el('div', { class: 'legend' }, ...BEHAVIOURS.map(([, name, hint]) => el('span', {}, el('b', {}, name), ` ${hint.toLowerCase()}.`))));
    }
    $(`#g-${group}`).replaceChildren(...blocks);
  }
  if (rec) $('#rec-row')?.focus({ preventScroll: true });
}

api.onShortcutRecording((e) => {
  if (!rec || (e.action && e.action !== rec.action)) return;
  if (e.done) {
    const was = rec;
    rec = null;
    if (!e.cancelled && e.keys) {
      const what = (ACTION_TITLE[was.action] || was.action).toLowerCase();
      toast(`${keyText(e.keys)}${e.binding && e.binding.trigger === 'doubleTap' ? ' double-tap' : ''} → ${what}`);
    }
  } else if (e.cleared) rec = { ...rec, keys: [], error: null, warning: null };
  else if (e.warning) rec = { ...rec, keys: e.keys, error: null, warning: e.warning };
  else if (e.error) rec = { ...rec, keys: [], error: e.error, warning: null };
  else rec = { ...rec, keys: e.keys || [], error: null };
  renderShortcuts();
});

// The hook does the recording; the window only has to keep keys from typing or clicking.
document.addEventListener('keydown', (e) => {
  if (rec || (document.activeElement === $('#tester') && e.key !== 'Tab')) e.preventDefault();
}, true);
['mousedown', 'mouseup', 'auxclick'].forEach((type) => document.addEventListener(type, (e) => {
  if (e.button > 0 && (rec || e.target.closest('#tester'))) e.preventDefault();
}, true));

$('#sc-reset').addEventListener('click', async () => {
  if (!confirm('Put every shortcut back to how Pauli Speaks came? Your own shortcuts are removed.')) return;
  rec = null;
  settings = await api.resetShortcuts();
  renderAll();
  toast('Shortcuts reset');
});

// ----- "Test a key, pedal or mouse button": the main-process hook reports what it sees

const tester = $('#tester');
tester.addEventListener('focus', () => api.setKeyTest(true));
tester.addEventListener('blur', () => api.setKeyTest(false));
window.addEventListener('blur', () => document.activeElement === tester && tester.blur());
api.onKeyTest((d) => {
  $('#tester-keys').replaceChildren(...keyChips(d.keys), ...(d.doubleTap ? [el('span', { class: 'tap' }, '×2')] : []));
  const what = `${keyText(d.keys)}${d.doubleTap ? ' double-tap' : ''}`;
  const beh = d.behaviour ? ` (${BEHAVIOURS.find(([v]) => v === d.behaviour)[1].toLowerCase()})` : '';
  $('#tester-out').textContent = d.action ? `${what} → ${ACTION_TITLE[d.action] || d.action}${beh}` : `${what} → not used by Pauli Speaks`;
});

// ----- links and command line

function renderRemoteLinks(info) {
  const exe = info.packaged ? `"${info.exePath}"` : '"Pauli Speaks.exe"';
  const lines = [
    [`${info.protocol}://dictate/toggle`, info.portable ? 'Links work only in the installed app' : 'Start or stop'],
    [`${info.protocol}://dictate/start`, 'Start hands-free'],
    [`${info.protocol}://dictate/stop`, 'Finish and paste'],
    [`${exe} --toggle`, 'Also --start, --stop, --cancel, --paste-last, --copy-last, --undo-last, --press-enter'],
  ];
  $('#remote-links').replaceChildren(...lines.map(([text, desc]) => el('div', { class: 'link' },
    el('code', {}, text),
    el('button', { class: 'icon-btn', title: 'Copy', 'aria-label': `Copy ${text}`, html: ICONS.copy, onclick: async () => { await api.copy(text); toast('Copied'); } }),
    el('span', { class: 'desc' }, desc))));
}

// ----- voice commands

function describeCommand(c) {
  if (c.action === 'key') return `Press ${c.arg}`;
  if (c.action === 'undo') return 'Remove the last dictation';
  if (c.action === 'snippet') return `Insert snippet “${c.arg}”`;
  if (c.arg === '\n') return 'Insert a line break';
  if (c.arg === '\n\n') return 'Insert a blank line';
  return `Type “${c.arg.replace(/\n/g, '↵')}”`;
}

function renderVoiceCommands() {
  const list = settings.voiceCommands || [];
  const removePhrase = (i, p) => {
    const next = list.map((c, j) => (j === i ? { ...c, phrases: c.phrases.filter((x) => x !== p) } : c)).filter((c) => c.phrases.length);
    save({ voiceCommands: next }, `Removed “${p}”`);
  };
  $('#vc-list').replaceChildren(...(list.length ? list.map((c, i) => el('div', { class: 'vc-row' },
    el('div', { class: 'phrases' }, ...c.phrases.map((p) => el('span', { class: 'phrase' }, `“${p}”`,
      el('button', { title: 'Remove', 'aria-label': `Remove “${p}”`, html: ICONS.x, onclick: () => removePhrase(i, p) })))),
    el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
    el('span', { class: 'does', title: c.action === 'key' || c.action === 'undo' ? 'Only at the start or end of what you say' : 'Anywhere in what you say' }, describeCommand(c)),
  )) : [el('div', { class: 'empty' }, 'No voice commands. Add one below.')]));
  const snip = $('#vc-snippet');
  snip.replaceChildren(...(settings.snippets || []).map((s) => el('option', { value: s.trigger }, s.trigger)));
  $('#vc-form').classList.toggle('off', !settings.voiceCommandsEnabled);
}

function syncVoiceForm() {
  const kind = $('#vc-do').value;
  $('#vc-text').hidden = kind !== 'text';
  $('#vc-snippet').hidden = kind !== 'snippet';
}
$('#vc-do').addEventListener('change', syncVoiceForm);

$('#vc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phrase = $('#vc-say').value.replace(/\s+/g, ' ').trim();
  if (!phrase) return;
  const list = settings.voiceCommands || [];
  if (list.some((c) => c.phrases.some((p) => p.toLowerCase() === phrase.toLowerCase()))) return toast(`“${phrase}” is already a voice command`);
  const preset = VC_PRESETS[$('#vc-do').value];
  const typed = $('#vc-text').value.replace(/\\n/g, '\n'); // a one-line field: "\n" means a line break
  const arg = preset.action === 'snippet' ? $('#vc-snippet').value : preset.action === 'insert' && preset.arg === undefined ? typed : preset.arg;
  if ((preset.action === 'snippet' || preset.action === 'insert') && !arg) {
    return toast(preset.action === 'snippet' ? 'Add a snippet on the Dictionary page first' : 'Type the text to insert');
  }
  const same = list.findIndex((c) => c.action === preset.action && c.arg === arg);
  const next = same >= 0
    ? list.map((c, i) => (i === same ? { ...c, phrases: [...c.phrases, phrase] } : c))
    : [...list, { phrases: [phrase], action: preset.action, arg }];
  await save({ voiceCommands: next }, `Say “${phrase}”: ${describeCommand({ action: preset.action, arg }).toLowerCase()}`);
  $('#vc-say').value = '';
  $('#vc-text').value = '';
  $('#vc-say').focus();
});

// ------------------------------------------------------------------ settings: translation

function renderTranslation() {
  const t = settings.translation;
  const tr = modelState?.translator;
  $('#tr-always').checked = t.always;
  const supported = tr ? tr.languages : LANGUAGES.map(([c]) => c);
  const select = $('#tr-target');
  select.replaceChildren(...LANGUAGES.filter(([c]) => supported.includes(c)).map(([c, n]) => el('option', { value: c }, n)));
  select.value = t.target;

  const needsBest = t.target !== 'en';
  const turbo = settings.engine === 'local' && /turbo/i.test(settings.localModel);
  const quality = needsBest ? 'best' : t.quality;
  document.querySelectorAll('#tr-quality button').forEach((b) => {
    b.classList.toggle('active', b.dataset.quality === quality);
    b.disabled = needsBest && b.dataset.quality === 'fast';
  });
  $('#tr-quality-desc').textContent = needsBest
    ? 'Translating into languages other than English always uses the offline translator.'
    : quality === 'fast'
      ? `Whisper translates while it listens, so nothing extra is downloaded. Best with Whisper Small or larger.${turbo ? ' Large v3 Turbo can\'t translate, so the offline translator is used instead.' : ''}`
      : 'Transcribes first, then translates with NLLB-200. More accurate, about 2–3 s slower.';

  const usesNllb = needsBest || quality === 'best' || turbo;
  $('#tr-model-row').hidden = !usesNllb;
  if (tr) {
    const busy = tr.status === 'downloading' || tr.status === 'loading';
    $('#tr-model-desc').textContent = tr.status === 'downloading' ? `Downloading… ${tr.percent}%`
      : tr.status === 'loading' ? 'Loading…'
      : tr.status === 'ready' ? 'Ready'
      : tr.status === 'error' ? `Error: ${tr.error}`
      : tr.downloaded ? 'Downloaded - loads on first use' : `NLLB-200, ${tr.size}, one-time download`;
    const btn = $('#tr-download');
    btn.hidden = tr.status === 'ready' || (tr.downloaded && tr.status === 'idle');
    btn.disabled = busy;
    btn.textContent = tr.status === 'error' ? 'Retry' : 'Download';
  }
}

$('#tr-always').addEventListener('change', (e) => save({ translation: { always: e.target.checked } }, e.target.checked ? 'Translation on' : 'Translation off'));
$('#tr-target').addEventListener('change', (e) => save({ translation: { target: e.target.value } }));
document.querySelectorAll('#tr-quality button').forEach((b) =>
  b.addEventListener('click', () => save({ translation: { quality: b.dataset.quality } })));
$('#tr-download').addEventListener('click', () => api.loadTranslator());

// ------------------------------------------------------------------ settings: speech

function renderEngine() {
  document.querySelectorAll('#engine button').forEach((b) => b.classList.toggle('active', b.dataset.engine === settings.engine));
  $('#local-settings').hidden = settings.engine !== 'local';
  $('#cloud-settings').hidden = settings.engine !== 'cloud';
  $('#cloud-url').value = settings.cloud.baseUrl;
  $('#cloud-model').value = settings.cloud.model;
  $('#cloud-key').placeholder = settings.cloud.hasApiKey ? '•••••••• saved - type to replace' : 'gsk_…';
}
document.querySelectorAll('#engine button').forEach((b) => b.addEventListener('click', () => save({ engine: b.dataset.engine })));
$('#cloud-url').addEventListener('change', (e) => save({ cloud: { baseUrl: e.target.value.trim() || 'https://api.groq.com/openai/v1' } }));
$('#cloud-model').addEventListener('change', (e) => save({ cloud: { model: e.target.value.trim() || 'whisper-large-v3-turbo' } }));
$('#cloud-key').addEventListener('change', async (e) => {
  await save({ cloud: { apiKey: e.target.value } }, e.target.value ? 'API key saved (encrypted)' : 'API key removed');
  e.target.value = '';
});
$('#cloud-test').addEventListener('click', async () => {
  const out = $('#cloud-result');
  out.textContent = 'Testing…';
  out.style.color = '';
  const r = await api.testCloud();
  out.textContent = r.ok ? 'Connected' : r.error;
  out.style.color = r.ok ? 'var(--ok)' : 'var(--signal)';
});

function renderModels() {
  if (!modelState) return;
  $('#models').replaceChildren(...modelState.models.map((m) => {
    const active = m.id === settings.localModel;
    let state = m.downloaded ? 'Downloaded' : m.size;
    let cls = m.downloaded ? '' : '';
    if (active && modelState.model === m.id) {
      if (modelState.status === 'downloading') [state, cls] = [`${modelState.percent}%`, 'busy'];
      else if (modelState.status === 'loading') [state, cls] = ['Loading…', 'busy'];
      else if (modelState.status === 'ready') [state, cls] = ['In use', 'ok'];
      else if (modelState.status === 'error') state = 'Error';
    }
    return el('label', { class: 'model' },
      el('input', { type: 'radio', name: 'model', checked: active, onchange: () => save({ localModel: m.id }, `Switched to Whisper ${m.label}`) }),
      el('div', {}, el('div', { class: 'title' }, `Whisper ${m.label}`), el('div', { class: 'desc' }, m.note)),
      el('span', { class: `state ${cls}` }, state));
  }));
}

function renderLanguages() {
  const chosen = settings.languages || [];
  $('#languages').replaceChildren(
    el('button', { class: chosen.length === 0 ? 'active' : '', onclick: () => save({ languages: [] }) }, 'Auto'),
    ...LANGUAGES.map(([c, name]) => el('button', {
      class: chosen.includes(c) ? 'active' : '',
      onclick: () => save({ languages: chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c] }),
    }, name)));
}

function renderAcceleration() {
  const accel = settings.acceleration === 'cpu' ? 'cpu' : 'auto';
  document.querySelectorAll('#accel button').forEach((b) => b.classList.toggle('active', b.dataset.accel === accel));
  const m = modelState;
  let desc = 'Uses the graphics card (DirectML) when there is one - usually 2-3x faster.';
  if (m && m.status === 'ready') {
    desc = m.device === 'dml'
      ? 'Running on your graphics card (DirectML).'
      : accel === 'cpu' ? 'Running on the processor.' : `Running on the processor${m.gpuError ? ` - the GPU couldn't be used (${m.gpuError})` : ''}.`;
  }
  $('#accel-desc').textContent = desc;
}
document.querySelectorAll('#accel button').forEach((b) =>
  b.addEventListener('click', () => save({ acceleration: b.dataset.accel }, b.dataset.accel === 'cpu' ? 'Using the CPU' : 'Using the GPU when available')));

$('#auto-stop').addEventListener('change', (e) => save({ autoStopSilence: Number(e.target.value) }));

// ----- app styles

let recentApps = [];

function renderAppStyles() {
  const st = settings.appStyles;
  $('#styles-on').checked = st.enabled;
  const styleSelect = (value, onchange) => el('select', { onchange },
    ...Object.entries(STYLE_LABELS).map(([k, v]) => el('option', { value: k, selected: k === value }, v)));
  $('#app-rules').replaceChildren(...st.rules.map((r, i) =>
    el('div', { class: 'rule' },
      el('span', {}, r.app),
      styleSelect(r.style, (e) => save({ appStyles: { rules: st.rules.map((x, j) => (j === i ? { ...x, style: e.target.value } : x)) } })),
      el('button', { class: 'icon-btn danger', title: 'Remove', 'aria-label': `Remove ${r.app}`, html: ICONS.trash,
        onclick: () => save({ appStyles: { rules: st.rules.filter((_, j) => j !== i) } }, 'Removed') }))));
  const sel = $('#rule-style');
  if (!sel.options.length) sel.replaceChildren(...Object.entries(STYLE_LABELS).map(([k, v]) => el('option', { value: k }, v)));
  const known = new Set(st.rules.map((r) => r.app.toLowerCase()));
  $('#recent-apps').replaceChildren(...recentApps.filter((a) => !known.has(a.toLowerCase())).map((a) => el('option', { value: a })));
}
$('#styles-on').addEventListener('change', (e) => save({ appStyles: { enabled: e.target.checked } }));
$('#rule-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const app = $('#rule-app').value.trim().toLowerCase();
  if (!app) return;
  const name = app.endsWith('.exe') ? app : `${app}.exe`;
  const rules = settings.appStyles.rules.filter((r) => r.app.toLowerCase() !== name);
  save({ appStyles: { rules: [...rules, { app: name, style: $('#rule-style').value }] } }, `Added ${name}`);
  $('#rule-app').value = '';
});

// ----- command mode

function renderCommand() {
  $('#cmd-chips').replaceChildren(...bindingChips(firstBinding('command')));
  if (document.activeElement !== $('#cmd-model')) $('#cmd-model').value = settings.command.model;
  $('#cmd-key-state').textContent = settings.cloud.hasApiKey ? 'API key saved.' : 'No API key yet - add one under Speech recognition → Cloud API.';
}
$('#cmd-model').addEventListener('change', (e) => save({ command: { model: e.target.value.trim() || 'llama-3.3-70b-versatile' } }));
$('#cmd-test').addEventListener('click', async () => {
  const out = $('#cmd-result');
  out.textContent = 'Testing…';
  out.style.color = '';
  const r = await api.testCommand();
  out.textContent = r.ok ? `Works ("hello" → "${r.output}")` : r.error;
  out.style.color = r.ok ? 'var(--ok)' : 'var(--signal)';
});

// ----- read aloud

function renderReadAloud() {
  $('#read-chips').replaceChildren(...bindingChips(firstBinding('readAloud')));
  const voices = speechSynthesis.getVoices();
  const select = $('#tts-voice');
  select.replaceChildren(el('option', { value: '' }, 'System default'),
    ...voices.map((v) => el('option', { value: v.name }, `${v.name} (${v.lang})`)));
  select.value = voices.some((v) => v.name === settings.readAloud.voice) ? settings.readAloud.voice : '';
  $('#tts-rate').value = settings.readAloud.rate;
  $('#tts-rate-value').textContent = `${Number(settings.readAloud.rate).toFixed(1)}×`;
}
speechSynthesis.addEventListener('voiceschanged', () => settings && renderReadAloud());
$('#tts-voice').addEventListener('change', (e) => save({ readAloud: { voice: e.target.value } }));
$('#tts-rate').addEventListener('input', (e) => ($('#tts-rate-value').textContent = `${Number(e.target.value).toFixed(1)}×`));
$('#tts-rate').addEventListener('change', (e) => save({ readAloud: { rate: Number(e.target.value) } }));
$('#tts-test').addEventListener('click', () => {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('Hi, this is Pauli Speaks reading your selected text.');
  const v = speechSynthesis.getVoices().find((x) => x.name === settings.readAloud.voice);
  if (v) u.voice = v;
  u.rate = settings.readAloud.rate;
  speechSynthesis.speak(u);
});

// ------------------------------------------------------------------ settings: microphone

async function renderMics() {
  const select = $('#mic');
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch {
    // no permission yet
  }
  const opts = [el('option', { value: 'default' }, 'System default')];
  for (const d of devices) {
    if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
    opts.push(el('option', { value: d.deviceId }, d.label || 'Microphone'));
  }
  select.replaceChildren(...opts);
  select.value = devices.some((d) => d.deviceId === settings.microphoneId) ? settings.microphoneId : 'default';
}
$('#mic').addEventListener('change', (e) => save({ microphoneId: e.target.value }));
navigator.mediaDevices.addEventListener('devicechange', renderMics);

$('#mic-test').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const meter = $('#mic-meter');
  btn.disabled = true;
  let stream;
  try {
    const audio = settings.microphoneId !== 'default' ? { deviceId: { exact: settings.microphoneId } } : true;
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    meter.hidden = false;
    const end = performance.now() + 5000;
    await new Promise((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        meter.firstElementChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 600)}%`;
        if (performance.now() < end) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    ctx.close();
    await renderMics();
  } catch (err) {
    toast(`Microphone error: ${err.message}`);
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    meter.hidden = true;
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------ settings: toggles

function renderToggles() {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    input.checked = !!settings[input.dataset.setting];
  });
}
document.querySelectorAll('[data-setting]').forEach((input) =>
  input.addEventListener('change', () => save({ [input.dataset.setting]: input.checked })));

document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => api.openPath(b.dataset.open)));

// ------------------------------------------------------------------ wiring

function renderAll() {
  renderStrip();
  renderLive();
  renderShortcuts();
  renderVoiceCommands();
  renderTranslation();
  renderEngine();
  renderModels();
  renderAcceleration();
  renderLanguages();
  renderToggles();
  renderDictionary();
  renderSnippets();
  renderAppStyles();
  renderCommand();
  renderReadAloud();
  renderBanner();
  $('#auto-stop').value = String(settings.autoStopSilence || 0);
  $('#file-target').textContent = LANG_NAME[settings.translation.target] || code(settings.translation.target);
}

// ------------------------------------------------------------------ updates

function renderUpdate(u) {
  if (!u) return;
  const ready = u.status === 'ready';
  $('#update-banner').hidden = !ready;
  $('#update-banner-title').textContent = ready ? `Pauli Speaks ${u.version} is ready` : '';
  document.querySelectorAll('[data-update-install]').forEach((b) => (b.hidden = !ready));
  $('#update-title').textContent = `Pauli Speaks ${u.current}`;
  const desc = {
    disabled: 'Automatic updates run in the installed app (not when started with npm start).',
    idle: 'Updates install automatically from GitHub.',
    checking: 'Checking for updates…',
    'up-to-date': "You're on the latest version.",
    available: `Version ${u.version} is out. Portable copies don't update themselves: download the new one from GitHub.`,
    downloading: `Downloading ${u.version || 'update'}… ${u.percent || 0}%`,
    ready: `Version ${u.version} is downloaded. Restart to install it, or it installs the next time you quit.`,
    error: `Couldn't check for updates: ${u.error}`,
  }[u.status] || '';
  $('#update-desc').textContent = desc;
  $('#update-check').disabled = ['checking', 'downloading', 'disabled'].includes(u.status) || ready;
  $('#update-meter').hidden = u.status !== 'downloading';
  $('#update-meter').firstElementChild.style.width = `${u.percent || 0}%`;
  $('#update-download').hidden = u.status !== 'available';
  $('#update-download').onclick = () => api.openExternal(`https://github.com/izscaryu/pauli-speaks/releases/tag/v${u.version}`);
}
$('#update-check').addEventListener('click', () => api.checkForUpdates());
document.querySelectorAll('[data-update-install]').forEach((b) => b.addEventListener('click', () => api.installUpdate()));
api.onUpdateState(renderUpdate);
api.getUpdateState().then(renderUpdate);

function showPage(page) {
  document.querySelector(`.nav[data-page="${page}"]`)?.click();
}
api.onNavigate(showPage);

async function init() {
  const [s, m, info, status] = await Promise.all([api.getSettings(), api.getModelState(), api.appInfo(), api.getDictationStatus()]);
  settings = s;
  modelState = m;
  dictation = status;
  const hour = new Date().getHours();
  $('#greeting').textContent = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#about-version').textContent = `Version ${info.version} · free · speech by OpenAI Whisper, translation by Meta NLLB-200`;
  renderRemoteLinks(info);
  if (info.portable) {
    document.querySelectorAll('[data-portable]').forEach((e) => (e.hidden = false));
    $('[data-setting="launchAtLogin"]').disabled = true;
  }
  syncVoiceForm();
  renderAll();
  renderStats();
  loadHistory();
  if (!settings.onboarded) Welcome.start();
  HomeNotices.start();
}

api.onSettings((s) => {
  settings = s;
  renderAll();
});
api.onModelState((m) => {
  modelState = m;
  renderModels();
  renderTranslation();
  renderAcceleration();
  renderBanner();
  renderStrip();
});
api.onHistory(() => {
  loadHistory();
  renderStats();
});
api.onDictationStatus((d) => {
  dictation = d;
  renderLive();
});
api.onError(({ message }) => toast(message.length > 90 ? `${message.slice(0, 90)}…` : message));

// After every script on the page (welcome.js) has run: IPC replies can arrive between script tags.
document.addEventListener('DOMContentLoaded', init);
