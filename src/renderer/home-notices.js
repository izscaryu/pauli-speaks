'use strict';
// The notices on Home, as InfoBars in one place (#notices), one at a time: the most important first, with "1 of 3"
// and ‹ › for the others (notice-queue.js decides the order). This file keeps the shortcut-hook and
// conflicting-app notices, "Recover your last dictation?" after a crash, the setup notice for people who were
// already using the app, What's new (its notes open in a dialog), and the "Run setup again" button in Settings;
// app.js sets the model and update notices through notice() in app.js.
// Loaded after app.js and welcome.js; uses these app.js globals: api, $, el, save, settings, modelState, toast,
// LANG_NAME, earlyNotices; and Icons, NoticeQueue and Dialog.
//
// Everything is built with `el` (never innerHTML from data): the What's new text comes from CHANGELOG.md.

const HomeNotices = (() => {
  const TROUBLESHOOTING_URL = 'https://github.com/izscaryu/pauli-speaks#troubleshooting';

  let health = { hookError: null, conflicts: [] };
  let dismissedConflicts = ''; // the names the user dismissed; a different set shows the notice again
  let lastBindings = null;

  // ---------------------------------------------------------------- the InfoBar queue

  /** id → { title, message?, actions?, progress?, severity?, onDismiss? }; severity defaults to NoticeQueue.SEVERITY. */
  const notices = {};
  let stepped = null; // the notice the user went to with ‹ ›, while it is there

  /** Puts a notice up, or takes it down with null. */
  function set(id, notice) {
    if (notice) notices[id] = notice;
    else delete notices[id];
    draw();
  }

  /**
   * One InfoBar: a severity icon (so it isn't colour alone), the title and message, its actions, ‹ 1 of 3 › when
   * there are more, and ✕ when it can be dismissed.
   */
  function infoBar(id, n, ids) {
    const severity = n.severity || NoticeQueue.SEVERITY[id] || 'info';
    const at = ids.indexOf(id);
    const stepButton = (delta) => el('button', {
      class: 'icon-btn', 'data-notice-step': String(delta), title: t(delta < 0 ? 'notices.previous' : 'notices.next'),
      disabled: delta < 0 ? at === 0 : at === ids.length - 1, html: Icons.svg(delta < 0 ? 'chevron-left' : 'chevron-right'),
      onclick: () => go(delta),
    });
    for (const a of n.actions || []) a.dataset.noticeAction = '';
    return el('div', { class: `infobar ${severity}`, 'data-notice': id, 'data-severity': severity },
      el('span', { class: 'infobar-icon', html: Icons.svg(`severity-${severity}`) }),
      el('div', { class: 'infobar-text' },
        el('strong', { class: 'infobar-title' }, n.title),
        n.message ? el('span', { class: 'infobar-message' }, ...[n.message].flat()) : null,
        n.progress || null),
      n.actions?.length ? el('div', { class: 'infobar-actions' }, ...n.actions) : null,
      ids.length > 1 ? el('div', { class: 'infobar-steps' },
        stepButton(-1), el('span', { class: 'infobar-pager' }, t('notices.pager', { n: at + 1, total: ids.length })), stepButton(1)) : null,
      n.onDismiss ? el('button', { class: 'icon-btn', 'data-notice-dismiss': '', title: t('common.dismiss'), html: Icons.svg('dismiss-small'), onclick: n.onDismiss }) : null);
  }

  function draw() {
    const box = $('#notices');
    const ids = NoticeQueue.ordered(Object.keys(notices));
    const id = NoticeQueue.shown(ids, stepped);
    // A redraw replaces the bar: ‹ or › that had focus keeps it (or the other one, at an end).
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.noticeStep : null;
    box.replaceChildren(...(id ? [infoBar(id, notices[id], ids)] : []));
    if (focused) {
      const same = box.querySelector(`[data-notice-step="${focused}"]`);
      (same && !same.disabled ? same : box.querySelector('[data-notice-step]:not(:disabled)'))?.focus();
    }
  }

  function go(delta) {
    const ids = NoticeQueue.ordered(Object.keys(notices));
    stepped = NoticeQueue.step(ids, NoticeQueue.shown(ids, stepped), delta);
    draw();
  }

  // ---------------------------------------------------------------- health notices

  function drawHealth() {
    set('hook', health.hookError ? {
      title: t('notices.hook.title'),
      message: I18n.nodes('notices.hook.desc', { link: el('a', { href: TROUBLESHOOTING_URL, target: '_blank' }, t('notices.hook.link')) }),
    } : null);
    const names = health.conflicts || [];
    const key = names.join('|');
    set('conflict', names.length && key !== dismissedConflicts ? {
      title: t('notices.conflict', { names: I18n.list(names), count: names.length }),
      onDismiss: () => { dismissedConflicts = key; drawHealth(); },
    } : null);
  }

  async function refreshHealth() {
    try {
      health = await api.healthState();
    } catch (err) {
      console.error('health check failed', err);
      return;
    }
    drawHealth();
  }

  // ---------------------------------------------------------------- crash recovery

  /** The recording left behind when the app closed mid-dictation: transcribe it or throw it away. */
  async function drawRecovery() {
    let offer = null;
    try {
      offer = await api.recoveryState();
    } catch (err) {
      console.error('recovery check failed', err);
    }
    if (!offer) {
      set('recovery', null);
      return;
    }
    const secs = Math.max(1, Math.round(offer.seconds));
    const when = offer.startedAt ? I18n.date(offer.startedAt, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
    const recover = el('button', { class: 'btn primary' }, t('notices.recovery.recover'));
    const discard = el('button', { class: 'btn' }, t('notices.recovery.discard'));
    const busy = (on) => {
      recover.disabled = on;
      discard.disabled = on;
      recover.textContent = t(on ? 'common.transcribing' : 'notices.recovery.recover');
    };
    recover.addEventListener('click', async () => {
      busy(true);
      try {
        const r = await api.recoverDictation();
        if (r.copied) toast(t('common.copied'));
        else if (r.cancelled) toast(t('notices.recovery.cancelled'));
        else if (r.failed) toast(t('notices.recovery.failed'));
        else toast(r.error);
      } catch (err) {
        console.error('recovery failed', err);
        toast(t('notices.recovery.error'));
      } finally {
        busy(false);
        drawRecovery(); // gone once the file is handled; still there when the app was busy
      }
    });
    discard.addEventListener('click', async () => {
      busy(true);
      try {
        await api.discardRecovery();
      } catch (err) {
        console.error('discarding the recovery failed', err);
        toast(t('notices.recovery.discardFailed'));
      } finally {
        busy(false);
        drawRecovery();
      }
    });
    set('recovery', {
      title: t('notices.recovery.title'),
      message: t(when ? 'notices.recovery.descWhen' : 'notices.recovery.desc', { count: secs, when }),
      actions: [recover, discard],
    });
  }

  // ---------------------------------------------------------------- language hint

  /** After repeated dictations in a language that isn't in the list: add it, or not (asked once per language). @param {string|null} code */
  function drawLanguageHint(code) {
    if (code && !Object.hasOwn(LANG_NAME, code)) { // not a language the app supports: nothing to offer
      api.dismissLanguageHint(code).catch((err) => console.error('dismissing the language hint failed', err));
      code = null;
    }
    if (!code) {
      set('language', null);
      return;
    }
    const done = (call) => async () => {
      set('language', null);
      try {
        await call(code);
      } catch (err) {
        console.error('answering the language hint failed', err);
        toast(t('notices.saveFailed'));
        refreshLanguageHint();
      }
    };
    set('language', {
      title: t('notices.language.title', { language: LANG_NAME[code] }),
      actions: [el('button', { class: 'btn primary', onclick: done(api.addHintedLanguage) }, t('common.add'))],
      onDismiss: done(api.dismissLanguageHint),
    });
  }

  async function refreshLanguageHint() {
    try {
      drawLanguageHint(await api.languageHint());
    } catch (err) {
      console.error('language hint check failed', err);
    }
  }

  // ---------------------------------------------------------------- setup notice

  function drawSetupCard() {
    set('setup', settings.setupCard ? {
      title: t('notices.setup.title'),
      actions: [el('button', { class: 'btn primary', onclick: runSetup }, t('notices.setup.run'))],
      onDismiss: () => save({ setupCard: false }, null),
    } : null);
  }

  async function runSetup() {
    await save({ setupCard: false }, null);
    Welcome.start();
  }

  // ---------------------------------------------------------------- What's new

  /** "- " lines are the list, any other line a paragraph before it. */
  function whatsNewParts(text) {
    const body = [];
    const list = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('- ')) list.push(line.slice(2).trim());
      else if (line) body.push(line);
    }
    return { body, list };
  }

  /** One line on Home; its button opens the notes for this version in a dialog. */
  async function showWhatsNew() {
    let info;
    try {
      info = await api.getWhatsNew();
    } catch (err) {
      console.error('whatsnew failed', err);
      return;
    }
    if (!info) return;
    const title = t('notices.whatsNew.title', { version: info.version });
    const open = () => Dialog.confirmDialog({ title, ...whatsNewParts(info.text), confirm: t('common.close') });
    set('whatsNew', {
      title,
      actions: [el('button', { class: 'btn', onclick: open }, t('notices.whatsNew.open'))],
      onDismiss: () => set('whatsNew', null),
    });
    api.whatsNewSeen(); // shown once: it is not offered again on the next start
  }

  // ---------------------------------------------------------------- Download again

  async function redownload() {
    const r = await api.redownloadModel();
    if (!r || !r.ok) toast(t('notices.redownloadFailed'));
  }

  /** The speech model failed to load although its files are marked as downloaded: offer a fresh download. */
  const canRedownload = () => !!modelState && settings.engine === 'local' && modelState.status === 'error'
    && modelState.model === settings.localModel
    && (modelState.models || []).some((m) => m.id === settings.localModel && m.downloaded === true);

  // ---------------------------------------------------------------- wiring

  function start() {
    lastBindings = JSON.stringify(settings.bindings);
    drawSetupCard();
    refreshHealth();
    drawRecovery();
    refreshLanguageHint();
    showWhatsNew();
  }

  // Settings changed: the setup notice follows `setupCard`; a changed shortcut gets the conflict check again.
  api.onSettings((s) => {
    drawSetupCard();
    const now = JSON.stringify(s.bindings);
    if (lastBindings !== null && now !== lastBindings) refreshHealth();
    lastBindings = now;
  });

  api.onLanguageHint(drawLanguageHint);

  $('#run-setup').addEventListener('click', () => Welcome.start());

  // Notices app.js set before this script loaded (an IPC answer can come between script tags).
  for (const [id, n] of Object.entries(earlyNotices)) set(id, n);

  return { start, set, redownload, canRedownload, refreshRecovery: drawRecovery, TROUBLESHOOTING_URL };
})();
