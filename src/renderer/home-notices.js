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
        el('strong', {}, "Pauli Speaks can't see your shortcut."),
        el('span', { class: 'desc' }, 'Dictation by shortcut will not work until this is fixed. ',
          el('a', { href: TROUBLESHOOTING_URL, target: '_blank' }, 'Read the troubleshooting steps'))));
    }
    const names = health.conflicts || [];
    const key = names.join('|');
    const box = $('#conflict-banner');
    box.hidden = !names.length || key === dismissedConflicts;
    if (!box.hidden) {
      const verb = names.length === 1 ? 'is' : 'are';
      box.replaceChildren(
        el('div', { class: 'grow' }, el('strong', {}, `${names.join(', ')} ${verb} running. It may use the same shortcut as Pauli Speaks.`)),
        el('button', { class: 'btn quiet', onclick: () => { dismissedConflicts = key; drawHealth(); } }, 'Dismiss'));
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
    const when = offer.startedAt ? ` from ${new Date(offer.startedAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : '';
    const recover = el('button', { class: 'btn primary' }, 'Recover');
    const discard = el('button', { class: 'btn quiet' }, 'Discard');
    const busy = (on) => {
      recover.disabled = on;
      discard.disabled = on;
      recover.textContent = on ? 'Transcribing…' : 'Recover';
    };
    recover.addEventListener('click', async () => {
      busy(true);
      try {
        const r = await api.recoverDictation();
        if (r.copied) toast('Copied');
        else if (r.cancelled) toast('Cancelled. You can retry it from History.');
        else if (r.failed) toast("Couldn't transcribe. You can retry it from History.");
        else toast(r.error);
      } catch (err) {
        console.error('recovery failed', err);
        toast("Couldn't recover the dictation. Try again.");
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
        toast("Couldn't discard the recording. Try again.");
      } finally {
        busy(false);
        drawRecovery();
      }
    });
    box.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, 'Recover your last dictation?'),
        el('span', { class: 'desc' }, `A ${secs}-second recording${when} was left when Pauli Speaks closed. Recovering it copies the text to your clipboard.`)),
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
        toast("Couldn't save that. Try again.");
        refreshLanguageHint();
      }
    };
    box.replaceChildren(
      el('div', { class: 'grow' }, el('strong', {}, `Sounds like ${LANG_NAME[code]}. Add it to your languages?`)),
      el('button', { class: 'btn primary', onclick: done(api.addHintedLanguage) }, 'Add'),
      el('button', { class: 'btn quiet', onclick: done(api.dismissLanguageHint) }, 'No thanks'));
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
      el('div', { class: 'grow' }, el('strong', {}, 'New: a guided setup for languages, microphone, speech engine and shortcut.')),
      el('button', { class: 'btn primary', onclick: runSetup }, 'Run setup'),
      el('button', { class: 'btn quiet', onclick: () => save({ setupCard: false }, null) }, 'Dismiss'));
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
      el('div', { class: 'panel-head' }, el('h2', {}, `What's new in Pauli Speaks ${info.version}`),
        el('button', { class: 'btn quiet', onclick: () => { card.hidden = true; } }, 'Got it')),
      el('div', { class: 'whatsnew-body' }, ...whatsNewBody(info.text)));
    card.hidden = false;
    api.whatsNewSeen(); // shown once: it is not offered again on the next start
  }

  // ---------------------------------------------------------------- Download again

  async function redownload() {
    const r = await api.redownloadModel();
    if (!r || !r.ok) toast("Couldn't remove the model files. Close other programs using them and try again.");
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
