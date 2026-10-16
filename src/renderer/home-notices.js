'use strict';
// The notices on Home: the shortcut-hook and conflicting-app banners, the setup card for people who
// were already using the app, the What's new card, and the "Run setup again" button in Settings.
// Loaded after app.js and welcome.js; uses these app.js globals: api, $, el, save, settings, modelState, toast.
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
    showWhatsNew();
  }

  // Settings changed: the card follows `setupCard`; a changed shortcut gets the conflict check again.
  api.onSettings((s) => {
    drawSetupCard();
    const now = JSON.stringify(s.bindings);
    if (lastBindings !== null && now !== lastBindings) refreshHealth();
    lastBindings = now;
  });

  $('#run-setup').addEventListener('click', () => Welcome.start());

  return { start, redownload, canRedownload, TROUBLESHOOTING_URL };
})();
