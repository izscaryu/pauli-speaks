'use strict';
// The notices on Home: the shortcut-hook and conflicting-app banners, the "Recover your last dictation?"
// banner after a crash, the setup card for people who were already using the app, the What's new card, and the "Run setup again" button in Settings.
// Loaded after app.js and welcome.js; uses these app.js globals: api, $, el, save, settings, modelState, toast, LANG_NAME.
//
// Everything is built with `el` (never innerHTML): the What's new text comes from CHANGELOG.md.

const HomeNotices = (() => {
  const TROUBLESHOOTING_URL = 'https://github.com/izscaryu/pauli-speaks#troubleshooting';

  let health = { hookError: null, conflicts: [] };
  let dismissedConflicts = ''; // the names the user dismissed; a different set shows the banner again
  let lastBindings = null;

  // ---------------------------------------------------------------- health banners

  function drawHealth() {
    const hook = $('#hook-banner');
    hook.hidden = !health.hookError;
    if (health.hookError) {
      hook.replaceChildren(el('div', { class: 'grow', title: health.hookError },
        el('strong', {}, t('notices.hook.title')),
        el('span', { class: 'desc' }, ...I18n.nodes('notices.hook.desc', { link: el('a', { href: TROUBLESHOOTING_URL, target: '_blank' }, t('notices.hook.link')) }))));
    }
    const names = health.conflicts || [];
    const key = names.join('|');
    const box = $('#conflict-banner');
    box.hidden = !names.length || key === dismissedConflicts;
    if (!box.hidden) {
      box.replaceChildren(
        el('div', { class: 'grow' }, el('strong', {}, t('notices.conflict', { names: I18n.list(names), count: names.length }))),
        el('button', { class: 'btn quiet', onclick: () => { dismissedConflicts = key; drawHealth(); } }, t('common.dismiss')));
    }
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
    const box = $('#recovery-banner');
    let offer = null;
    try {
      offer = await api.recoveryState();
    } catch (err) {
      console.error('recovery check failed', err);
    }
    box.hidden = !offer;
    if (!offer) return;
    const secs = Math.max(1, Math.round(offer.seconds));
    const when = offer.startedAt ? I18n.date(offer.startedAt, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '';
    const recover = el('button', { class: 'btn primary' }, t('notices.recovery.recover'));
    const discard = el('button', { class: 'btn quiet' }, t('notices.recovery.discard'));
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
    box.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, t('notices.recovery.title')),
        el('span', { class: 'desc' }, t(when ? 'notices.recovery.descWhen' : 'notices.recovery.desc', { count: secs, when }))),
      recover, discard);
  }

  // ---------------------------------------------------------------- language hint

  /** After repeated dictations in a language that isn't in the list: add it, or not (asked once per language). @param {string|null} code */
  function drawLanguageHint(code) {
    const box = $('#language-banner');
    if (code && !Object.hasOwn(LANG_NAME, code)) { // not a language the app supports: nothing to offer
      api.dismissLanguageHint(code).catch((err) => console.error('dismissing the language hint failed', err));
      code = null;
    }
    box.hidden = !code;
    if (!code) return;
    const done = (call) => async () => {
      box.hidden = true;
      try {
        await call(code);
      } catch (err) {
        console.error('answering the language hint failed', err);
        toast(t('notices.saveFailed'));
        refreshLanguageHint();
      }
    };
    box.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, t('notices.language.title', { language: LANG_NAME[code] }))),
      el('button', { class: 'btn primary', onclick: done(api.addHintedLanguage) }, t('common.add')),
      el('button', { class: 'btn quiet', onclick: done(api.dismissLanguageHint) }, t('notices.language.no')));
  }

  async function refreshLanguageHint() {
    try {
      drawLanguageHint(await api.languageHint());
    } catch (err) {
      console.error('language hint check failed', err);
    }
  }

  // ---------------------------------------------------------------- setup card

  function drawSetupCard() {
    const card = $('#setup-card');
    card.hidden = !settings.setupCard;
    if (card.hidden) return;
    card.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, t('notices.setup.title'))),
      el('button', { class: 'btn primary', onclick: runSetup }, t('notices.setup.run')),
      el('button', { class: 'btn quiet', onclick: () => save({ setupCard: false }, null) }, t('common.dismiss')));
  }

  async function runSetup() {
    await save({ setupCard: false }, null);
    Welcome.start();
  }

  // ---------------------------------------------------------------- What's new

  /** "- " lines become bullets, any other line a paragraph; blank lines end a list. */
  function whatsNewBody(text) {
    const out = [];
    let list = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { list = null; continue; }
      if (line.startsWith('- ')) {
        if (!list) { list = el('ul'); out.push(list); }
        list.append(el('li', {}, line.slice(2).trim()));
      } else {
        list = null;
        out.push(el('p', {}, line));
      }
    }
    return out;
  }

  async function showWhatsNew() {
    let info;
    try {
      info = await api.getWhatsNew();
    } catch (err) {
      console.error('whatsnew failed', err);
      return;
    }
    if (!info) return;
    const card = $('#whatsnew-card');
    card.replaceChildren(
      el('div', { class: 'panel-head' }, el('h2', {}, t('notices.whatsNew.title', { version: info.version })),
        el('button', { class: 'btn quiet', onclick: () => { card.hidden = true; } }, t('notices.whatsNew.ok'))),
      el('div', { class: 'whatsnew-body' }, ...whatsNewBody(info.text)));
    card.hidden = false;
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

  // Settings changed: the card follows `setupCard`; a changed shortcut gets the conflict check again.
  api.onSettings((s) => {
    drawSetupCard();
    const now = JSON.stringify(s.bindings);
    if (lastBindings !== null && now !== lastBindings) refreshHealth();
    lastBindings = now;
  });

  api.onLanguageHint(drawLanguageHint);

  $('#run-setup').addEventListener('click', () => Welcome.start());

  return { start, redownload, canRedownload, refreshRecovery: drawRecovery, TROUBLESHOOTING_URL };
})();
