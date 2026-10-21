'use strict';
// The main window. Text goes through t() (i18n.js, loaded first); dates and numbers through I18n.

const api = window.pauli;
const $ = (sel) => document.querySelector(sel);

const KEY_LABELS = {
  Ctrl: 'Ctrl', CtrlRight: 'RCtrl', Alt: 'Alt', AltRight: 'RAlt', Shift: 'Shift',
  ShiftRight: 'RShift', Meta: 'Win', MetaRight: 'RWin', Escape: 'Esc', CapsLock: 'Caps',
  Mouse3: t('keys.mouse', { n: 3 }), Mouse4: t('keys.mouse', { n: 4 }), Mouse5: t('keys.mouse', { n: 5 }), Space: t('keys.space'), Backquote: '`',
};
const ORDER = ['Ctrl', 'CtrlRight', 'Meta', 'MetaRight', 'Alt', 'AltRight', 'Shift', 'ShiftRight'];
// The Shortcuts page, grouped as in docs/design/redesign-concept.html. talk = per-shortcut Hold / Toggle / Both.
// Titles and descriptions: action.<action>.title / .desc in the locale files.
const ACTION_INFO = [
  { action: 'dictate', group: 'start', talk: true, min: 1, max: 8 }, // one per mode (Talk & translate is one of them since 1.5)
  { action: 'command', group: 'start', talk: true },
  { action: 'cancel', group: 'during', min: 1, max: 1 },
  { action: 'cycleMode', group: 'during', badge: 'new' },
  { action: 'pasteLast', group: 'after' },
  { action: 'copyLast', group: 'after', badge: 'new' },
  { action: 'undoLast', group: 'after', badge: 'new' },
  { action: 'pressEnter', group: 'after', badge: 'new' },
  { action: 'readAloud', group: 'after' },
];
const actionTitle = (action) => t(`action.${action}.title`);
const MAX_BINDINGS = 4;
const BEHAVIOURS = ['hold', 'toggle', 'both'];
const behaviourName = (value) => t(`behaviour.${value}.name`);
const MOUSE_NOTE = new Set(['Mouse3', 'Mouse4', 'Mouse5']);
const VC_PRESETS = {
  enter: { action: 'key', arg: 'Enter' },
  tab: { action: 'key', arg: 'Tab' },
  newline: { action: 'insert', arg: '\n' },
  paragraph: { action: 'insert', arg: '\n\n' },
  undo: { action: 'undo', arg: '' },
  text: { action: 'insert' },
  snippet: { action: 'snippet' },
};
const STYLES = ['normal', 'casual', 'formal', 'code'];
// The languages Pauli Speaks offers for dictation, named in the UI language.
const LANGUAGES = [
  'en', 'hr', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'sr', 'bs', 'sl', 'cs', 'sk', 'hu', 'ro', 'uk', 'ru', 'tr', 'sv',
  'da', 'no', 'fi', 'el', 'ar', 'hi', 'ja', 'ko', 'zh',
].map((c) => [c, I18n.languageName(c)]);
const LANG_NAME = Object.fromEntries(LANGUAGES);
const ICONS = { copy: Icons.svg('copy'), trash: Icons.svg('delete'), x: Icons.svg('dismiss') }; // icons.js (Fluent)

let settings = null;
let modelState = null;
let rec = null; // shortcut being recorded: { action, replaceId, keys, error, warning }
let historyItems = [];
document.documentElement.classList.toggle('mica', new URLSearchParams(location.search).get('look') === 'mica'); // window-look.js
let dictation = { status: 'idle' };

// ------------------------------------------------------------------ helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  const iconButton = /\bicon-btn\b/.test(attrs.class || '');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'title' && iconButton && v) node.dataset.tooltip = v; // tooltip.js shows it (not the browser's title)
    else if (k === 'html') node.innerHTML = v; // only used with the static ICONS above
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  if (iconButton && node.dataset.tooltip && !node.hasAttribute('aria-label')) node.setAttribute('aria-label', node.dataset.tooltip);
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}

function keyChips(keys) {
  const sorted = [...(keys || [])].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  if (!sorted.length) return [el('span', { class: 'key empty' }, t('shortcuts.notSet'))];
  return sorted.map((k) => el('kbd', { class: 'key' }, KEY_LABELS[k] || k.replace(/^Digit/, '')));
}

const keyText = (keys) => [...keys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((k) => KEY_LABELS[k] || k.replace(/^Digit/, '')).join(' + ');

/** "Ctrl + Win", or "Ctrl double-tap" for a double-tap binding. */
const bindingText = (keys, doubleTap) => (doubleTap ? t('shortcuts.withDoubleTap', { keys: keyText(keys) }) : keyText(keys));

/** A shortcut-rules message from the main process ({ code, params }) in the UI language. */
function shortcutMessage(m) {
  if (!m || typeof m !== 'object') return m ? String(m) : '';
  const p = m.params || {};
  return t(`shortcuts.msg.${m.code}`, {
    ...p,
    keys: Array.isArray(p.keys) ? keyText(p.keys) : p.keys,
    action: p.action ? actionTitle(p.action) : undefined,
    what: p.what ? t(`shortcuts.common.${p.what}`) : undefined,
    reason: p.reason ? t(`shortcuts.reserved.${p.reason}`) : undefined,
  });
}

/** First binding of an action that passes `test`, or null. */
const firstBinding = (action, test = () => true) => (settings.bindings || []).find((b) => b.action === action && test(b)) || null;

/** Keycaps for a binding: a double-tap shows its key twice-marked. */
function bindingChips(b) {
  if (!b) return keyChips([]);
  return b.trigger === 'doubleTap' ? [...keyChips(b.keys), el('span', { class: 'tap', title: t('shortcuts.doubleTap') }, '×2')] : keyChips(b.keys);
}
const code = (c) => (c || '??').toUpperCase();

/** An icon from icons.js as a node, for el() children. */
function icon(name) {
  const box = document.createElement('span');
  box.innerHTML = Icons.svg(name);
  return box.firstChild;
}

/**
 * A segmented control's choice. The control is a radio group: the chosen button is checked (aria-checked) and the
 * only one in the Tab order; the arrow keys move the choice (below).
 */
function markChoice(selector, chosen) {
  document.querySelectorAll(selector).forEach((b) => {
    b.classList.toggle('active', chosen(b));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(chosen(b)));
    b.tabIndex = chosen(b) ? 0 : -1;
  });
}

// Arrow keys in a segmented radio group choose the next or previous option (skipping disabled ones), as Windows
// does. A choice that saves may draw the group again: focus then goes to the new button in the same place.
document.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const group = step && e.target.closest?.('.segmented[role="radiogroup"]');
  if (!group) return;
  const options = [...group.querySelectorAll('[role="radio"]')];
  const from = options.indexOf(e.target);
  const next = [...options.slice(from + 1), ...options.slice(0, from)].filter((b) => !b.disabled).at(step > 0 ? 0 : -1);
  if (!next) return;
  e.preventDefault();
  const at = options.indexOf(next);
  next.focus();
  next.click();
  const until = Date.now() + 1000;
  (function refocus() {
    const now = document.getElementById(group.id)?.querySelectorAll('[role="radio"]')[at];
    if (now && now !== document.activeElement && (!document.activeElement || document.activeElement === document.body)) return now.focus();
    if (Date.now() < until) requestAnimationFrame(refocus);
  })();
});

let toastTimer = null;
function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 1800);
}
/** A toast belongs to the page it was shown on: it goes when the page changes. */
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

/** Settings save themselves (the page says so), so a save says nothing unless there is a `message` for it. */
async function save(patch, message = null) {
  settings = await api.updateSettings(patch);
  if (message) toast(message);
}

const fmtNum = (n) => (n >= 10000 ? I18n.num(n, { notation: 'compact', maximumFractionDigits: 1 }) : I18n.num(n));
const timeOf = (d) => I18n.date(d, { hour: 'numeric', minute: '2-digit' });
const timeWithSeconds = (d) => I18n.date(d, { hour: 'numeric', minute: '2-digit', second: '2-digit' }); // the tooltip: two at the same minute
const modelSlug = (id) => String(id).split('/').pop();
const modelNoteText = (m) => t(`models.note.${modelSlug(m.id)}`);

function modelLabel() {
  if (settings.engine === 'cloud') return t('engine.cloudLabel', { model: settings.cloud.model });
  const m = modelState?.models.find((x) => x.id === settings.localModel);
  const gpu = modelState?.status === 'ready' && modelState.device === 'dml' ? ' · GPU' : '';
  return `Whisper ${m ? m.label : settings.localModel}${gpu}`;
}

/** The first Dictate shortcut whose mode translates, and that mode. */
function translateBinding() {
  for (const b of settings.bindings || []) {
    const m = b.action === 'dictate' && b.mode ? Modes.find(b.mode) : null;
    if (m && m.translateTo) return { b, m };
  }
  return null;
}

function translationLabel() {
  const def = settings.modes[0];
  if (def.translateTo) return t('side.translateAlways', { code: code(def.translateTo) });
  const tb = translateBinding();
  return tb ? t('side.translateShortcut', { code: code(tb.m.translateTo) }) : t('translation.off');
}

// ------------------------------------------------------------------ navigation

document.querySelectorAll('.nav').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((n) => {
      n.classList.toggle('active', n === b);
      if (n === b) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    document.querySelectorAll('.page').forEach((p) => (p.hidden = p.id !== `page-${b.dataset.page}`));
    // A screen reader hears where it went: the page's heading takes the focus.
    const heading = document.querySelector(`#page-${b.dataset.page} h1`);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (rec) api.stopRecordingShortcut();
    rec = null;
    hideToast();
    Tooltip.hide();
    renderShortcuts();
    if (b.dataset.page === 'settings') renderMics();
  }),
);
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.go)));

// ------------------------------------------------------------------ transcripts page

function renderStrip() {
  $('#ptt-chips').replaceChildren(...bindingChips(firstBinding('dictate', (b) => b.behaviour !== 'toggle')));
  $('#hf-chips').replaceChildren(...bindingChips(firstBinding('dictate', (b) => b.behaviour === 'toggle')));
  const tb = translateBinding();
  $('#tr-chips').parentElement.hidden = !tb;
  if (tb) {
    $('#tr-chips').replaceChildren(...bindingChips(tb.b));
    $('#tr-label').textContent = t('home.strip.translate', { language: LANG_NAME[tb.m.translateTo] || code(tb.m.translateTo) });
  }
  $('#cancel-chips').replaceChildren(...bindingChips(firstBinding('cancel')));
  $('#side-engine').textContent = modelLabel();
  $('#side-translate').textContent = translationLabel();
  pressKeys();
}

/** Home's keycaps go down while you talk: Hold to talk while you hold it, Hands-free while it listens by itself. */
function pressKeys() {
  const listening = dictation.status === 'listening' && dictation.mode !== 'command';
  document.querySelectorAll('#ptt-chips .key').forEach((k) => k.classList.toggle('pressed', listening && !dictation.locked));
  document.querySelectorAll('#hf-chips .key').forEach((k) => k.classList.toggle('pressed', listening && !!dictation.locked));
}

/** Why dictation can't work yet: the chosen speech model is missing, downloading, loading or broken. [class, text] or null. */
function modelProblem() {
  if (!settings || settings.engine !== 'local' || !modelState) return null;
  const ours = modelState.model === settings.localModel;
  if (ours && modelState.status === 'ready') return null;
  if (ours && modelState.status === 'downloading') return ['warn', t('live.downloading', { percent: modelState.percent || 0 })];
  if (ours && modelState.status === 'loading') return ['warn', t('live.loadingModel')];
  if (ours && modelState.status === 'error') return ['error', t('live.modelError')];
  const m = modelState.models.find((x) => x.id === settings.localModel);
  return m && !m.downloaded ? ['warn', t('live.needsModel')] : null;
}

function renderLive() {
  const live = $('#live');
  const { status, locked, translateTo, mode, chip } = dictation;
  const problem = status === 'listening' || status === 'processing' ? null : modelProblem();
  live.className = `live ${status === 'listening' ? 'listening' : status === 'processing' ? 'processing' : problem ? problem[0] : ''}`;
  pressKeys();
  if (problem) {
    $('#live-text').textContent = problem[1];
    return;
  }
  let text = t('live.ready');
  if (status === 'listening' && mode === 'command') text = t('live.command');
  else if (status === 'listening') {
    text = t(locked ? 'live.handsFree' : 'live.listening');
    if (translateTo) text = t('live.to', { state: text, code: code(translateTo) });
    if (chip) text = `${text} · ${chip.name}`;
  } else if (status === 'processing') text = t('live.transcribing');
  else if (settings?.modes[0].translateTo) text = t('live.to', { state: text, code: code(settings.modes[0].translateTo) });
  $('#live-text').textContent = text;
}

async function renderStats() {
  const st = await api.getStats();
  $('#st-words').textContent = fmtNum(st.words);
  $('#st-wpm').textContent = I18n.num(st.wpm);
  $('#st-saved').textContent = fmtNum(st.minutesSaved);
  $('#st-count').textContent = fmtNum(st.dictations);
  $('#st-streak').textContent = I18n.num(st.streak || 0);
  const max = Math.max(1, ...(st.daily || []).map((d) => d.words));
  const todayKey = (st.daily || []).at(-1)?.date;
  $('#week-bars').replaceChildren(...(st.daily || []).map((d) => {
    const date = new Date(`${d.date}T12:00:00`);
    const label = t('home.week.bar', { date: I18n.date(date, { weekday: 'short', day: 'numeric' }), count: d.words });
    return el('div', { class: `wbar${d.date === todayKey ? ' today' : ''}`, 'data-tip': label, 'aria-label': label, role: 'img' },
      el('i', { style: `height:${Math.max(2, Math.round((d.words / max) * 100))}%` }));
  }));
}

async function loadHistory() {
  historyItems = await api.listHistory();
  recentApps = [...new Set(historyItems.map((i) => i.app).filter(Boolean))].slice(0, 20);
  renderHistory();
  renderRecent();
  if (settings) Modes.render();
}

function historyItem(item) {
  if (item.status === 'failed') return FailedHistory.item(item); // history-failed.js
  const d = new Date(item.createdAt);
  const secs = Math.max(1, Math.round((item.durationMs || 0) / 1000));
  const meta = el('div', { class: 'meta' },
    item.kind === 'command' ? el('span', { class: 'tag ai' }, '✦ AI') : null,
    item.polished ? el('span', { class: 'tag ai' }, t(item.text === item.polished ? 'history.polished' : 'history.polishUndone')) : null,
    item.translatedTo
      ? el('span', { class: 'tag tr' }, `${code(item.language)} → ${code(item.translatedTo)}`)
      : item.language ? el('span', { class: 'tag' }, code(item.language)) : null,
    item.app ? el('span', { class: 'tag app', title: item.app }, AppNames.appName(item.app)) : null,
    t('history.meta', { count: item.words, secs, engine: item.engine }));
  const body = el('div', {},
    item.instruction ? el('div', { class: 'instr' }, `“${item.instruction}”`) : null,
    el('p', {}, item.text), meta);
  if (item.original) {
    const orig = el('p', { class: 'orig', hidden: true }, item.original);
    meta.append(el('button', {
      class: 'linkish',
      onclick: (e) => {
        orig.hidden = !orig.hidden;
        e.target.textContent = t(orig.hidden ? 'history.showOriginal' : 'history.hideOriginal');
      },
    }, t('history.showOriginal')));
    body.insertBefore(orig, meta);
  }
  return el('div', { class: 'item' },
    el('time', { datetime: item.createdAt, title: timeWithSeconds(d) }, timeOf(d)),
    body,
    el('div', { class: 'actions' },
      ...HistoryAudio.buttons(item), // history-audio.js
      el('button', { class: 'icon-btn', title: t('common.copy'), 'aria-label': t('history.copyLabel'), html: ICONS.copy, onclick: async () => { await api.copy(item.text); toast(t('common.copied')); } }),
      el('button', { class: 'icon-btn danger', title: t('common.delete'), 'aria-label': t('history.deleteLabel'), html: ICONS.trash, onclick: () => api.deleteHistory(item.id) })));
}

function renderHistory() {
  const box = $('#history');
  $('#clear-history').disabled = !historyItems.length; // nothing to clear
  const q = $('#history-search').value.trim().toLowerCase();
  const items = q
    ? historyItems.filter((i) => (i.text || '').toLowerCase().includes(q) || (i.original || '').toLowerCase().includes(q))
    : historyItems;
  if (!items.length) {
    box.replaceChildren(el('div', { class: 'empty' }, t(q ? 'history.noMatch' : 'history.empty')));
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
      out.push(el('div', { class: 'day' }, day === today ? t('history.today') : day === yesterday ? t('history.yesterday')
        : I18n.date(d, { weekday: 'long', month: 'short', day: 'numeric' })));
    }
    out.push(historyItem(item));
  }
  box.replaceChildren(...out);
}

/** Home's Recent: the last three dictations, like History shows them. */
function renderRecent() {
  const recent = historyItems.slice(0, 3);
  $('#recent').replaceChildren(...(recent.length ? recent.map(historyItem) : [el('div', { class: 'empty' }, t('history.empty'))]));
}

$('#history-search').addEventListener('input', renderHistory);
$('#clear-history').addEventListener('click', async () => {
  const yes = await Dialog.confirmDialog({
    title: t('history.clearDialog.title'), body: t('history.clearDialog.body', { count: historyItems.length }),
    confirm: t('history.clearDialog.confirm'), cancel: t('common.cancel'), tone: 'danger',
  });
  if (yes) await api.clearHistory();
});

let slowNoteDismissed = false; // the "Large v3 Turbo is slow" note, hidden for this session
/** Home notes when no model job runs: the chosen model isn't on disk yet, or Large v3 Turbo fell back to the CPU. */
function modelNote() {
  if (settings.engine !== 'local') return null;
  const m = modelState.models.find((x) => x.id === settings.localModel);
  if (m && !m.downloaded && modelState.status === 'idle') {
    return [el('div', { class: 'grow' }, el('strong', {}, t('banner.model.notDownloaded')), el('span', { class: 'desc' }, t('banner.model.oneTime'))),
      el('button', { class: 'btn primary', onclick: () => api.loadModel() }, t('banner.model.download', { name: `Whisper ${m.label}`, size: m.size }))];
  }
  if (modelState.offerSmaller && modelState.model === settings.localModel && !slowNoteDismissed) {
    return [el('div', { class: 'grow' }, el('strong', {}, t('banner.model.slow'))),
      el('button', { class: 'btn', onclick: () => save({ localModel: 'onnx-community/whisper-small' }, t('models.switched', { name: 'Whisper Small' })) }, t('banner.model.useSmall')),
      el('button', { class: 'btn', onclick: () => { slowNoteDismissed = true; renderBanner(); } }, t('common.dismiss'))];
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
  if (tr && tr.status !== 'idle' && tr.status !== 'ready') jobs.push({ name: t('banner.translatorName'), ...tr, retry: api.loadTranslator });
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
      el('div', { class: 'grow' }, el('strong', {}, t('banner.loadFailed', { name: job.name })), el('span', { class: 'desc' }, job.error || '')),
      el('button', { class: 'btn', onclick: () => job.retry() }, t('common.retry')),
      ...(job.again?.() ? [el('button', { class: 'btn', onclick: HomeNotices.redownload }, t('banner.downloadAgain'))] : []));
    side.hidden = true;
    return;
  }
  const downloading = job.status === 'downloading';
  const meter = el('div', { class: 'meter' }, el('i', { style: `width:${downloading ? job.percent : 100}%` }));
  banner.replaceChildren(
    el('div', { class: 'grow' },
      el('strong', {}, t(downloading ? 'banner.downloading' : 'banner.loading', { name: job.name })),
      downloading ? el('span', { class: 'desc' }, t('banner.model.oneTime')) : null,
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
    list.replaceChildren(el('div', { class: 'empty' }, t('dictionary.empty')));
    return;
  }
  list.replaceChildren(...entries.map((e, i) =>
    el('div', { class: 'dict-item' },
      el('span', { class: 'from' }, e.from), el('span', { class: 'arrow' }, '→'), el('strong', {}, e.to),
      el('button', { class: 'icon-btn danger', title: t('common.remove'), 'aria-label': t('common.removeItem', { name: e.from }), html: ICONS.trash,
        onclick: () => save({ dictionary: entries.filter((_, j) => j !== i) }, t('common.removed')) }))));
}

$('#dict-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('#dict-from').value.trim();
  const to = $('#dict-to').value.trim();
  if (!from || !to) return;
  const rest = (settings.dictionary || []).filter((d) => d.from.toLowerCase() !== from.toLowerCase());
  await save({ dictionary: [...rest, { from, to }] }, t('common.added'));
  $('#dict-from').value = '';
  $('#dict-to').value = '';
  $('#dict-from').focus();
});

// ------------------------------------------------------------------ snippets

function renderSnippets() {
  const list = $('#snip-list');
  const entries = settings.snippets || [];
  if (!entries.length) {
    list.replaceChildren(el('div', { class: 'empty' }, t('snippets.empty')));
    return;
  }
  list.replaceChildren(...entries.map((s, i) =>
    el('div', { class: 'snip-item' },
      el('strong', {}, `“${s.trigger}”`), el('span', { class: 'body' }, s.text),
      el('button', { class: 'icon-btn danger', title: t('common.remove'), 'aria-label': t('snippets.removeLabel', { name: s.trigger }), html: ICONS.trash,
        onclick: () => save({ snippets: entries.filter((_, j) => j !== i) }, t('common.removed')) }))));
}

$('#snip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const trigger = $('#snip-trigger').value.trim();
  const text = $('#snip-text').value;
  if (!trigger || !text.trim()) return;
  const rest = (settings.snippets || []).filter((s) => s.trigger.toLowerCase() !== trigger.toLowerCase());
  await save({ snippets: [...rest, { trigger, text }] }, t('snippets.added'));
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
    status.textContent = t('files.decoding');
    const audio = await decodeToMono16k(file);
    const minutes = audio.length / 16000 / 60;
    const duration = minutes < 1 ? t('files.seconds', { n: Math.round(minutes * 60) }) : t('files.minutes', { n: Number(minutes.toFixed(1)) });
    status.textContent = t('files.transcribing', { duration });
    const t0 = performance.now();
    const result = await api.transcribeFile(audio, $('#file-translate').checked);
    fileJob = { name: file.name, ...result };
    $('#file-text').value = result.text || t('files.noSpeech');
    status.textContent = `${t('files.done', { secs: Math.round((performance.now() - t0) / 1000), count: result.segments.length })}${result.language ? ` · ${code(result.language)}` : ''}${result.translatedTo ? ` → ${code(result.translatedTo)}` : ''}`;
    ['#file-copy', '#file-txt', '#file-srt'].forEach((s) => ($(s).disabled = !result.text));
  } catch (err) {
    status.textContent = t('files.failed', { error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
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
// A button inside the drop zone's label doesn't open the picker by itself; this is the way in from the keyboard.
$('#file-choose').addEventListener('click', () => $('#file-input').click());
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
  toast(t('common.copied'));
});
for (const format of ['txt', 'srt']) {
  $(`#file-${format}`).addEventListener('click', async () => {
    if (!lastFile) return;
    const r = await api.saveTranscript({ name: lastFile.name, format, text: $('#file-text').value, segments: lastFile.segments });
    if (r.saved) toast(t('files.saved', { name: r.filePath.split(/[\\/]/).pop() }));
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
  if (b.trigger === 'doubleTap') return el('span', { class: 'desc', title: t('shortcuts.doubleTapToggles') }, behaviourName('toggle'));
  const label = keyText(b.keys);
  return el('div', { class: 'segmented small three', id: `behaviour-${b.id}`, role: 'radiogroup', 'aria-label': t('shortcuts.behaviourFor', { keys: label }) },
    ...BEHAVIOURS.map((value) => el('button', {
      class: b.behaviour === value ? 'active' : '',
      title: t(`behaviour.${value}.hint`),
      role: 'radio',
      'aria-checked': String(b.behaviour === value),
      tabindex: b.behaviour === value ? 0 : -1,
      onclick: () => b.behaviour !== value && saveBindings(settings.bindings.map((x) => (x.id === b.id ? { ...x, behaviour: value } : x)), t('shortcuts.behaviourSaved', { keys: label, behaviour: behaviourName(value) })),
    }, behaviourName(value))));
}

function bindRow(info, b, count) {
  const label = bindingText(b.keys, b.trigger === 'doubleTap');
  const remove = () => {
    if (count <= (info.min || 0)) return toast(t('shortcuts.needsOne', { action: actionTitle(info.action) }));
    saveBindings(settings.bindings.filter((x) => x.id !== b.id), t('common.removedItem', { name: label }));
  };
  const mouse = b.keys.find((k) => MOUSE_NOTE.has(k));
  const note = b.trigger === 'doubleTap' ? t('shortcuts.doubleTap') : mouse ? t(`shortcuts.mouseNote.${mouse}`) : /^F(1[3-9]|2[0-4])$/.test(b.keys[0]) && b.keys.length === 1 ? t('shortcuts.pedal') : null;
  return el('li', { class: 'bind' },
    el('span', { class: 'chips' }, bindingChips(b)),
    note ? el('span', { class: 'note' }, note) : null,
    el('span', { class: 'spacer' }),
    info.action === 'dictate' ? Modes.bindingSelect(b, label) : null,
    info.talk ? behaviourControl(b) : null,
    info.max === 1 ? el('button', { class: 'btn quiet', onclick: () => startRec(info.action, b.id) }, t('shortcuts.change')) : null,
    el('button', { class: 'icon-btn danger', title: t('common.remove'), 'aria-label': t('common.removeItem', { name: label }), html: ICONS.x, onclick: remove }));
}

function recRow(info) {
  const kids = [rec.keys.length
    ? el('span', { class: 'chips' }, keyChips(rec.keys))
    : el('span', { class: 'prompt' }, t('shortcuts.rec.prompt'))];
  kids.push(el('span', { class: 'spacer' }));
  if (rec.warning) {
    kids.push(el('button', { class: 'btn', onclick: () => api.retryShortcut() }, t('shortcuts.rec.tryAnother')));
    kids.push(el('button', { class: 'btn primary', onclick: () => api.confirmShortcut() }, t('shortcuts.rec.useAnyway')));
    kids.push(el('div', { class: 'msg warn', role: 'alert' }, shortcutMessage(rec.warning)));
  } else {
    kids.push(el('span', { class: 'hint' }, t(info.action === 'cancel' ? 'shortcuts.rec.savesOnRelease' : 'shortcuts.rec.hint')));
    kids.push(el('button', { class: 'btn quiet', onclick: cancelRec }, t('common.cancel')));
    if (rec.error) kids.push(el('div', { class: 'msg error', role: 'alert' }, shortcutMessage(rec.error)));
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
        el('div', { class: 'title' }, actionTitle(info.action), info.badge ? el('span', { class: 'badge' }, t(`badge.${info.badge}`)) : null),
        el('div', { class: 'desc' }, t(`action.${info.action}.desc`))),
      single ? null : el('button', {
        class: 'btn',
        disabled: list.length >= max || recording,
        'aria-label': t('shortcuts.addFor', { action: actionTitle(info.action) }),
        onclick: () => startRec(info.action),
      }, list.length ? t('shortcuts.addCount', { n: list.length, max }) : t('shortcuts.add'))),
    items.length ? el('ul', { class: 'binds' }, items) : el('div', { class: 'desc muted' }, t('shortcuts.notSetDesc')));
}

function renderShortcuts() {
  if (!settings) return;
  for (const group of ['start', 'during', 'after']) {
    const blocks = ACTION_INFO.filter((a) => a.group === group).map(actionBlock);
    if (group === 'start') {
      blocks.push(el('div', { class: 'legend' }, ...BEHAVIOURS.map((value) => el('span', {}, el('b', {}, behaviourName(value)), ` ${t(`behaviour.${value}.legend`)}`))));
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
      toast(t('shortcuts.saved', { keys: bindingText(e.keys, e.binding && e.binding.trigger === 'doubleTap'), action: actionTitle(was.action) }));
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
  const yes = await Dialog.confirmDialog({
    title: t('shortcuts.resetDialog.title'), body: t('shortcuts.resetDialog.body'),
    confirm: t('shortcuts.resetDialog.confirm'), cancel: t('common.cancel'), tone: 'danger',
  });
  if (!yes) return;
  rec = null;
  settings = await api.resetShortcuts();
  renderAll();
  toast(t('shortcuts.resetDone'));
});

// ----- "Test a key, pedal or mouse button": the main-process hook reports what it sees

const tester = $('#tester');
tester.addEventListener('focus', () => api.setKeyTest(true));
tester.addEventListener('blur', () => api.setKeyTest(false));
window.addEventListener('blur', () => document.activeElement === tester && tester.blur());
api.onKeyTest((d) => {
  $('#tester-keys').replaceChildren(...keyChips(d.keys), ...(d.doubleTap ? [el('span', { class: 'tap' }, '×2')] : []));
  const what = bindingText(d.keys, d.doubleTap);
  const beh = d.behaviour ? ` (${behaviourName(d.behaviour)})` : '';
  $('#tester-out').textContent = d.action ? `${what} → ${actionTitle(d.action)}${beh}` : t('tester.unused', { keys: what });
});

// ----- links and command line

function renderRemoteLinks(info) {
  const exe = info.packaged ? `"${info.exePath}"` : '"Pauli Speaks.exe"';
  const lines = [
    [`${info.protocol}://dictate/toggle`, t(info.portable ? 'remote.portable' : 'remote.toggle')],
    [`${info.protocol}://dictate/start`, t('remote.start')],
    [`${info.protocol}://dictate/stop`, t('remote.stop')],
    [`${info.protocol}://dictate/toggle?mode=code`, t('remote.mode')],
    [`${exe} --toggle`, t('remote.flags', { flags: '--start, --stop, --cancel, --paste-last, --copy-last, --undo-last, --press-enter, --mode=code' })],
  ];
  $('#remote-links').replaceChildren(...lines.map(([text, desc]) => el('div', { class: 'link' },
    el('code', {}, text),
    el('button', { class: 'icon-btn', title: t('common.copy'), 'aria-label': t('common.copyItem', { name: text }), html: ICONS.copy, onclick: async () => { await api.copy(text); toast(t('common.copied')); } }),
    el('span', { class: 'desc' }, desc))));
}

// ----- voice commands

function describeCommand(c) {
  if (c.action === 'key') return t('voice.does.key', { key: c.arg });
  if (c.action === 'undo') return t('voice.do.undo');
  if (c.action === 'snippet') return t('voice.does.snippet', { name: c.arg });
  if (c.arg === '\n') return t('voice.do.newline');
  if (c.arg === '\n\n') return t('voice.do.paragraph');
  return t('voice.does.type', { text: c.arg.replace(/\n/g, '↵') });
}

function renderVoiceCommands() {
  const list = settings.voiceCommands || [];
  const removePhrase = (i, p) => {
    const next = list.map((c, j) => (j === i ? { ...c, phrases: c.phrases.filter((x) => x !== p) } : c)).filter((c) => c.phrases.length);
    save({ voiceCommands: next }, t('voice.removed', { phrase: p }));
  };
  $('#vc-list').replaceChildren(...(list.length ? list.map((c, i) => el('div', { class: 'vc-row' },
    el('div', { class: 'phrases' }, ...c.phrases.map((p) => el('span', { class: 'phrase' }, `“${p}”`,
      el('button', { title: t('common.remove'), 'aria-label': t('voice.removeLabel', { phrase: p }), html: ICONS.x, onclick: () => removePhrase(i, p) })))),
    el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
    el('span', { class: 'does', title: t(c.action === 'key' || c.action === 'undo' ? 'voice.edgeOnly' : 'voice.anywhere') }, describeCommand(c)),
  )) : [el('div', { class: 'empty' }, t('voice.empty'))]));
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
  if (list.some((c) => c.phrases.some((p) => p.toLowerCase() === phrase.toLowerCase()))) return toast(t('voice.exists', { phrase }));
  const preset = VC_PRESETS[$('#vc-do').value];
  const typed = $('#vc-text').value.replace(/\\n/g, '\n'); // a one-line field: "\n" means a line break
  const arg = preset.action === 'snippet' ? $('#vc-snippet').value : preset.action === 'insert' && preset.arg === undefined ? typed : preset.arg;
  if ((preset.action === 'snippet' || preset.action === 'insert') && !arg) {
    return toast(t(preset.action === 'snippet' ? 'voice.needSnippet' : 'voice.needText'));
  }
  const same = list.findIndex((c) => c.action === preset.action && c.arg === arg);
  const next = same >= 0
    ? list.map((c, i) => (i === same ? { ...c, phrases: [...c.phrases, phrase] } : c))
    : [...list, { phrases: [phrase], action: preset.action, arg }];
  await save({ voiceCommands: next }, t('voice.added', { phrase, action: describeCommand({ action: preset.action, arg }) }));
  $('#vc-say').value = '';
  $('#vc-text').value = '';
  $('#vc-say').focus();
});

// ------------------------------------------------------------------ settings: app language

function renderUiLanguage() {
  const select = $('#ui-language');
  select.replaceChildren(el('option', { value: 'system' }, t('settings.language.system')),
    ...I18n.languages.map((l) => el('option', { value: l.code, lang: l.code }, l.name)));
  select.value = I18n.languages.some((l) => l.code === settings.uiLanguage) ? settings.uiLanguage : 'system';
}
$('#ui-language').addEventListener('change', (e) => save({ uiLanguage: e.target.value }, null));

// The main process switched the language: start this page over in it, on the page that was open.
I18n.onChange(() => {
  try {
    sessionStorage.setItem('pauli.page', document.querySelector('.nav.active')?.dataset.page || 'home');
  } catch {
    // no session storage: Home is fine
  }
  location.reload();
});

// ------------------------------------------------------------------ settings: translation

function renderTranslation() {
  const tr = settings.translation;
  const nllb = modelState?.translator;
  const supported = nllb ? nllb.languages : LANGUAGES.map(([c]) => c);
  const select = $('#tr-target');
  select.replaceChildren(...LANGUAGES.filter(([c]) => supported.includes(c)).map(([c, n]) => el('option', { value: c }, n)));
  select.value = tr.target;

  const needsBest = tr.target !== 'en';
  const turbo = settings.engine === 'local' && /turbo/i.test(settings.localModel);
  const quality = needsBest ? 'best' : tr.quality;
  markChoice('#tr-quality button', (b) => b.dataset.quality === quality);
  document.querySelectorAll('#tr-quality button').forEach((b) => (b.disabled = needsBest && b.dataset.quality === 'fast'));
  $('#tr-quality-desc').textContent = needsBest
    ? t('translation.quality.otherLanguages')
    : quality === 'fast'
      ? `${t('translation.quality.fastDesc')}${turbo ? ` ${t('translation.quality.turboNote')}` : ''}`
      : t('translation.quality.bestDesc');

  const usesNllb = needsBest || quality === 'best' || turbo;
  $('#tr-model-row').hidden = !usesNllb;
  if (nllb) {
    const busy = nllb.status === 'downloading' || nllb.status === 'loading';
    $('#tr-model-desc').textContent = nllb.status === 'downloading' ? t('translation.model.downloading', { percent: nllb.percent })
      : nllb.status === 'loading' ? t('common.loading')
      : nllb.status === 'ready' ? t('translation.model.ready')
      : nllb.status === 'error' ? t('translation.model.error', { error: nllb.error })
      : nllb.downloaded ? t('translation.model.downloaded') : t('translation.model.size', { size: nllb.size });
    const btn = $('#tr-download');
    btn.hidden = nllb.status === 'ready' || (nllb.downloaded && nllb.status === 'idle');
    btn.disabled = busy;
    btn.textContent = t(nllb.status === 'error' ? 'common.retry' : 'common.download');
  }
}

$('#tr-target').addEventListener('change', (e) => save({ translation: { target: e.target.value } }));
document.querySelectorAll('#tr-quality button').forEach((b) =>
  b.addEventListener('click', () => save({ translation: { quality: b.dataset.quality } })));
$('#tr-download').addEventListener('click', () => api.loadTranslator());

// ------------------------------------------------------------------ settings: speech

function renderEngine() {
  markChoice('#engine button', (b) => b.dataset.engine === settings.engine);
  $('#local-settings').hidden = settings.engine !== 'local';
  $('#cloud-settings').hidden = settings.engine !== 'cloud';
  $('#cloud-url').value = settings.cloud.baseUrl;
  $('#cloud-model').value = settings.cloud.model;
  $('#cloud-key').placeholder = settings.cloud.hasApiKey ? t('cloud.keySaved') : 'gsk_…';
}
document.querySelectorAll('#engine button').forEach((b) => b.addEventListener('click', () => save({ engine: b.dataset.engine })));
$('#cloud-url').addEventListener('change', (e) => save({ cloud: { baseUrl: e.target.value.trim() || 'https://api.groq.com/openai/v1' } }));
$('#cloud-model').addEventListener('change', (e) => save({ cloud: { model: e.target.value.trim() || 'whisper-large-v3-turbo' } }));
$('#cloud-key').addEventListener('change', async (e) => {
  await save({ cloud: { apiKey: e.target.value } }, t(e.target.value ? 'cloud.keySavedToast' : 'cloud.keyRemoved'));
  e.target.value = '';
});
$('#cloud-test').addEventListener('click', async () => {
  const out = $('#cloud-result');
  out.textContent = t('common.testing');
  out.style.color = '';
  const r = await api.testCloud();
  out.textContent = r.ok ? t('cloud.connected') : r.error;
  out.style.color = r.ok ? 'var(--ok)' : 'var(--danger)';
});

function renderModels() {
  if (!modelState) return;
  $('#models').replaceChildren(...modelState.models.map((m) => {
    const active = m.id === settings.localModel;
    let state = m.downloaded ? t('models.downloaded') : m.size;
    let cls = '';
    if (active && modelState.model === m.id) {
      if (modelState.status === 'downloading') [state, cls] = [`${modelState.percent}%`, 'busy'];
      else if (modelState.status === 'loading') [state, cls] = [t('common.loading'), 'busy'];
      else if (modelState.status === 'ready') [state, cls] = [t('models.inUse'), 'ok'];
      else if (modelState.status === 'error') state = t('models.error');
    }
    return el('label', { class: 'model' },
      el('input', { type: 'radio', name: 'model', checked: active, onchange: () => save({ localModel: m.id }, t('models.switched', { name: `Whisper ${m.label}` })) }),
      el('div', {}, el('div', { class: 'title' }, `Whisper ${m.label}`), el('div', { class: 'desc' }, modelNoteText(m))),
      el('span', { class: `state ${cls}` }, state));
  }));
}

function renderLanguages() {
  const chosen = settings.languages || [];
  $('#languages').replaceChildren(
    el('button', { class: chosen.length === 0 ? 'active' : '', 'aria-pressed': String(chosen.length === 0), onclick: () => save({ languages: [] }) },
      chosen.length === 0 ? icon('check') : null, t('speech.languages.auto')),
    ...LANGUAGES.map(([c, name]) => el('button', {
      class: chosen.includes(c) ? 'active' : '',
      'aria-pressed': String(chosen.includes(c)),
      onclick: () => save({ languages: chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c] }),
    }, chosen.includes(c) ? icon('check') : null, name)));
}

function renderAcceleration() {
  const accel = settings.acceleration === 'cpu' ? 'cpu' : 'auto';
  markChoice('#accel button', (b) => b.dataset.accel === accel);
  const m = modelState;
  let desc = t('accel.desc.default');
  if (m && m.status === 'ready') {
    desc = m.device === 'dml'
      ? t('accel.desc.gpu')
      : accel === 'cpu' || !m.gpuError ? t('accel.desc.cpu') : t('accel.desc.cpuFallback', { error: m.gpuError });
  }
  $('#accel-desc').textContent = desc;
}
document.querySelectorAll('#accel button').forEach((b) =>
  b.addEventListener('click', () => save({ acceleration: b.dataset.accel }, t(b.dataset.accel === 'cpu' ? 'accel.usingCpu' : 'accel.usingGpu'))));

$('#auto-stop').addEventListener('change', (e) => save({ autoStopSilence: Number(e.target.value) }));

// ----- apps seen in History (the Modes page offers them)

let recentApps = [];

// ----- command mode

function renderCommand() {
  $('#cmd-chips').replaceChildren(...bindingChips(firstBinding('command')));
  if (document.activeElement !== $('#cmd-model')) $('#cmd-model').value = settings.command.model;
  $('#cmd-key-state').textContent = t(settings.cloud.hasApiKey ? 'command.keySaved' : 'command.noKey');
}
$('#cmd-model').addEventListener('change', (e) => save({ command: { model: e.target.value.trim() || 'llama-3.3-70b-versatile' } }));
$('#cmd-test').addEventListener('click', async () => {
  const out = $('#cmd-result');
  out.textContent = t('common.testing');
  out.style.color = '';
  const r = await api.testCommand();
  out.textContent = r.ok ? t('command.works', { output: r.output }) : r.error;
  out.style.color = r.ok ? 'var(--ok)' : 'var(--danger)';
});

// ----- read aloud

const rateText = (rate) => `${I18n.num(Number(rate), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;

function renderReadAloud() {
  $('#read-chips').replaceChildren(...bindingChips(firstBinding('readAloud')));
  const voices = speechSynthesis.getVoices();
  const select = $('#tts-voice');
  select.replaceChildren(el('option', { value: '' }, t('common.systemDefault')),
    ...voices.map((v) => el('option', { value: v.name }, `${v.name} (${v.lang})`)));
  select.value = voices.some((v) => v.name === settings.readAloud.voice) ? settings.readAloud.voice : '';
  $('#tts-rate').value = settings.readAloud.rate;
  $('#tts-rate-value').textContent = rateText(settings.readAloud.rate);
}
speechSynthesis.addEventListener('voiceschanged', () => settings && renderReadAloud());
$('#tts-voice').addEventListener('change', (e) => save({ readAloud: { voice: e.target.value } }));
$('#tts-rate').addEventListener('input', (e) => ($('#tts-rate-value').textContent = rateText(e.target.value)));
$('#tts-rate').addEventListener('change', (e) => save({ readAloud: { rate: Number(e.target.value) } }));
$('#tts-test').addEventListener('click', () => {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t('readAloud.sample'));
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
  const opts = [el('option', { value: 'default' }, t('common.systemDefault'))];
  for (const d of devices) {
    if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
    opts.push(el('option', { value: d.deviceId }, d.label || t('mic.unnamed')));
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
    toast(t('mic.error', { error: err.message }));
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
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
$('#diagnostics-copy').addEventListener('click', async () => {
  const r = await api.copyDiagnostics();
  toast(r.ok ? t('diagnostics.copied') : t('diagnostics.copyFailed', { error: r.error }));
});
$('#diagnostics-report').addEventListener('click', async () => {
  const r = await api.reportProblem();
  toast(r.ok ? t('diagnostics.copiedForm') : t('diagnostics.copyFailed', { error: r.error }));
});

// ------------------------------------------------------------------ wiring

function renderAll() {
  renderStrip();
  renderLive();
  renderShortcuts();
  renderVoiceCommands();
  renderUiLanguage();
  renderTranslation();
  renderEngine();
  renderModels();
  renderAcceleration();
  renderLanguages();
  renderToggles();
  renderDictionary();
  renderSnippets();
  Modes.render();
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
  $('#update-banner-title').textContent = ready ? t('update.readyTitle', { version: u.version }) : '';
  document.querySelectorAll('[data-update-install]').forEach((b) => (b.hidden = !ready));
  $('#update-title').textContent = `Pauli Speaks ${u.current}`;
  const vars = { version: u.version, percent: u.percent || 0, error: u.error };
  const key = {
    disabled: 'update.status.disabled',
    idle: 'update.status.idle',
    checking: 'update.status.checking',
    'up-to-date': 'update.status.upToDate',
    available: 'update.status.available',
    downloading: u.version ? 'update.status.downloading' : 'update.status.downloadingAny',
    ready: 'update.status.ready',
    error: 'update.status.error',
  }[u.status];
  $('#update-desc').textContent = key ? t(key, vars) : '';
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

/** "settings", or "settings#microphone" for one section of it (the pill's Choose mic). */
function showPage(page) {
  const [id, section] = String(page).split('#');
  document.querySelector(`.nav[data-page="${id}"]`)?.click();
  if (section && id === 'settings') window.SettingsSearch?.jump(section); // settings-search.js (not there yet at the very start)
}
api.onNavigate(showPage);

/** The page that was open before a language switch reloaded the window, once. */
function pageBeforeReload() {
  try {
    const page = sessionStorage.getItem('pauli.page');
    sessionStorage.removeItem('pauli.page');
    return page;
  } catch {
    return null;
  }
}

async function init() {
  const [s, m, info, status] = await Promise.all([api.getSettings(), api.getModelState(), api.appInfo(), api.getDictationStatus()]);
  settings = s;
  modelState = m;
  dictation = status;
  const hour = new Date().getHours();
  $('#greeting').textContent = t(hour < 5 ? 'home.greeting.evening' : hour < 12 ? 'home.greeting.morning' : hour < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening');
  $('#about-version').textContent = t('about.version', { version: info.version });
  renderRemoteLinks(info);
  Modes.setProtocol(info.protocol);
  if (info.portable) {
    document.querySelectorAll('[data-portable]').forEach((e) => (e.hidden = false));
    $('[data-setting="launchAtLogin"]').disabled = true;
  }
  syncVoiceForm();
  renderAll();
  renderStats();
  loadHistory();
  const back = pageBeforeReload();
  if (back) showPage(back);
  if (!settings.onboarded) Welcome.start();
  HomeNotices.start();
  Privacy.start();
  Polish.start();
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
  renderLive();
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
