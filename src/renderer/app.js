'use strict';

const api = window.pauli;
const $ = (sel) => document.querySelector(sel);

const KEY_LABELS = {
  Ctrl: 'Ctrl', CtrlRight: 'RCtrl', Alt: 'Alt', AltRight: 'RAlt', Shift: 'Shift',
  ShiftRight: 'RShift', Meta: 'Win', MetaRight: 'RWin', Escape: 'Esc', CapsLock: 'Caps',
  Mouse3: 'Mouse 3', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5', Space: 'Space', Backquote: '`',
};
const ORDER = ['Ctrl', 'CtrlRight', 'Meta', 'MetaRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight'];
const SHORTCUTS = [
  { action: 'ptt', title: 'Push-to-talk', desc: 'Hold while speaking, release to paste. Double-tap to lock hands-free.' },
  { action: 'handsFree', title: 'Hands-free', desc: 'Press to start, press again to finish.' },
  { action: 'translate', title: 'Talk & translate', desc: 'Hold to dictate in the translation language. Add it to a held push-to-talk to switch mid-sentence.' },
  { action: 'command', title: 'Command mode', desc: 'Hold and say what to do with the selected text, or what to write.' },
  { action: 'readAloud', title: 'Read aloud', desc: 'Reads the selected text out loud. Press again to stop.' },
  { action: 'cancel', title: 'Cancel', desc: 'Throw away the current dictation, or stop reading.' },
  { action: 'pasteLast', title: 'Paste last transcript', desc: 'Paste your previous dictation again.' },
];
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
};

let settings = null;
let modelState = null;
let recording = null;
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

const fillChips = (target, keys) => target.replaceChildren(...keyChips(keys));
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
    if (recording) api.stopRecordingShortcut();
    recording = null;
    renderShortcuts();
    if (b.dataset.page === 'settings') renderMics();
  }),
);

// ------------------------------------------------------------------ transcripts page

function renderStrip() {
  const s = settings.shortcuts;
  fillChips($('#ptt-chips'), s.ptt);
  fillChips($('#hf-chips'), s.handsFree);
  fillChips($('#tr-chips'), s.translate);
  fillChips($('#cancel-chips'), s.cancel);
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
    ? historyItems.filter((i) => i.text.toLowerCase().includes(q) || (i.original || '').toLowerCase().includes(q))
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

function renderBanner() {
  const banner = $('#model-banner');
  const side = $('#side-progress');
  if (!modelState) return;
  const jobs = [];
  if (settings.engine === 'local') jobs.push({ name: modelLabel(), ...modelState, retry: api.loadModel });
  const tr = modelState.translator;
  if (tr && tr.status !== 'idle' && tr.status !== 'ready') jobs.push({ name: 'Translator (NLLB-200)', ...tr, retry: api.loadTranslator });
  const job = jobs.find((j) => j.status === 'error') || jobs.find((j) => j.status === 'downloading' || j.status === 'loading');
  if (!job) {
    banner.hidden = true;
    side.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.classList.toggle('error', job.status === 'error');
  if (job.status === 'error') {
    banner.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, `Couldn't load ${job.name}`), el('span', { class: 'desc' }, job.error || '')),
      el('button', { class: 'btn', onclick: () => job.retry() }, 'Retry'));
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
    downloading ? el('b', {}, `${job.percent}%`) : null);
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

// ------------------------------------------------------------------ settings: shortcuts

function renderShortcuts() {
  $('#shortcut-rows').replaceChildren(...SHORTCUTS.map(({ action, title, desc }) => {
    const isRec = recording && recording.action === action;
    const keys = isRec ? recording.keys : settings.shortcuts[action];
    return el('div', { class: `row${isRec ? ' recording' : ''}` },
      el('div', {}, el('div', { class: 'title' }, title), el('div', { class: 'desc' }, desc)),
      el('div', { class: 'inline' },
        el('span', { class: 'chips' }, isRec && !keys.length ? el('span', { class: 'key empty' }, 'Press keys…') : keyChips(keys)),
        isRec
          ? el('button', { class: 'btn', onclick: () => { api.stopRecordingShortcut(); recording = null; renderShortcuts(); } }, 'Cancel')
          : el('button', { class: 'btn', onclick: () => { recording = { action, keys: [] }; api.recordShortcut(action); renderShortcuts(); } }, 'Change')),
      isRec && recording.error ? el('div', { class: 'err' }, recording.error) : null);
  }));
}

api.onShortcutRecording((e) => {
  if (!recording || e.action !== recording.action) return;
  if (e.done) {
    recording = null;
    if (!e.cancelled) toast('Shortcut saved');
  } else if (e.error) recording = { ...recording, keys: [], error: e.error };
  else recording = { ...recording, keys: e.keys, error: null };
  renderShortcuts();
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
  fillChips($('#cmd-chips'), settings.shortcuts.command);
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
  fillChips($('#read-chips'), settings.shortcuts.readAloud);
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
    downloading: `Downloading ${u.version || 'update'}… ${u.percent || 0}%`,
    ready: `Version ${u.version} is downloaded. Restart to install it, or it installs the next time you quit.`,
    error: `Couldn't check for updates: ${u.error}`,
  }[u.status] || '';
  $('#update-desc').textContent = desc;
  $('#update-check').disabled = ['checking', 'downloading', 'disabled'].includes(u.status) || ready;
  $('#update-meter').hidden = u.status !== 'downloading';
  $('#update-meter').firstElementChild.style.width = `${u.percent || 0}%`;
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
  renderAll();
  renderStats();
  loadHistory();
  if (!settings.onboarded) {
    $('#try-box').focus();
    api.updateSettings({ onboarded: true });
  }
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

init();
