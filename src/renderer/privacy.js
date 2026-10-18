'use strict';
// Settings → Privacy: the transcript-history choice, the recordings switch, and the two delete buttons with their
// in-page confirmation (no window.confirm). The crash-recovery switch is an ordinary data-setting toggle in app.js.
// Loaded after app.js and home-notices.js; uses these app.js globals: api, $, el, save, settings, toast.

const Privacy = (() => {
  const RETENTION_DESC = {
    keep: 'Your last 500 dictations stay in History until you delete them.',
    '24h': 'Dictations older than 24 hours are deleted, checked every hour.',
    off: "Nothing is saved to disk. Dictations stay in History until you close Pauli Speaks, so Paste last and Undo still work.",
  };

  let crashRecovery = null;
  let models = { models: [], bytes: 0 };

  const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

  // ---------------------------------------------------------------- the settings

  function render() {
    $('#history-retention').value = settings.historyRetention;
    $('#retention-desc').textContent = RETENTION_DESC[settings.historyRetention] || '';
    $('#audio-history').checked = settings.audioHistory === '24h';
  }

  $('#history-retention').addEventListener('change', (e) => save({ historyRetention: e.target.value }));
  $('#audio-history').addEventListener('change', (e) => save({ audioHistory: e.target.checked ? '24h' : 'off' }));

  // ---------------------------------------------------------------- downloaded models

  async function refreshModels() {
    try {
      models = await api.privacyModels();
    } catch (err) {
      console.error('listing the models failed', err);
      return;
    }
    const button = $('#delete-models');
    button.disabled = !models.models.length;
    button.textContent = models.models.length ? `Delete downloaded models (${size(models.bytes)})` : 'No models downloaded';
    $('#models-desc').textContent = models.models.length
      ? `${models.models.map((m) => m.label).join(', ')}. They are downloaded again when you need them.`
      : 'Speech and translation models you download are listed here.';
  }

  // ---------------------------------------------------------------- the confirmation

  const box = () => $('#privacy-confirm');
  const close = () => { box().hidden = true; box().replaceChildren(); };

  /** A confirmation in the page: what goes, then Cancel / the destructive button. */
  function confirmBox({ title, items, note, label, run }) {
    const cancel = el('button', { class: 'btn', onclick: close }, 'Cancel');
    const go = el('button', { class: 'btn danger primary' }, label);
    go.addEventListener('click', async () => {
      go.disabled = true;
      cancel.disabled = true;
      go.textContent = 'Deleting…';
      try {
        await run();
      } catch (err) {
        console.error('deleting failed', err);
        toast("Couldn't delete everything. Try again.");
      } finally {
        close();
      }
    });
    const panel = box();
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-label', title);
    panel.onkeydown = (e) => { if (e.key === 'Escape' && !cancel.disabled) { e.stopPropagation(); close(); } };
    panel.replaceChildren(
      el('h3', {}, title),
      el('ul', {}, ...items.map((t) => el('li', {}, t))),
      el('p', { class: 'desc' }, note),
      el('div', { class: 'buttons' }, cancel, go));
    panel.hidden = false;
    cancel.focus();
    panel.scrollIntoView({ block: 'nearest' });
  }

  function askDeleteAll() {
    confirmBox({
      title: 'Delete all my data?',
      items: [
        'Your transcript history',
        'Saved recordings (the audio kept for 24 hours)',
        'Your dictionary and snippets',
        'Your settings, shortcuts and API key',
      ],
      note: "Downloaded models are kept (delete them separately). This can't be undone. Pauli Speaks starts over with its welcome setup the next time you open it.",
      label: 'Delete all my data',
      run: async () => {
        const r = await api.deleteAllData();
        HomeNotices.refreshRecovery(); // a leftover recording is gone too
        toast(r.ok ? 'All your data was deleted.' : "Some data couldn't be deleted. Try again.");
      },
    });
  }

  async function askDeleteModels() {
    await refreshModels();
    if (!models.models.length) return;
    confirmBox({
      title: 'Delete downloaded models?',
      items: models.models.map((m) => `${m.label} (${size(m.bytes)})`),
      note: 'Only these model files are deleted. Speech recognition downloads a model again the next time you use it.',
      label: `Delete models (${size(models.bytes)})`,
      run: async () => {
        const r = await api.deleteModels();
        toast(r.ok ? 'Models deleted.' : r.error || "Couldn't delete the models.");
        await refreshModels();
      },
    });
  }

  $('#delete-all').addEventListener('click', askDeleteAll);
  $('#delete-models').addEventListener('click', askDeleteModels);

  // ---------------------------------------------------------------- wiring

  function start() {
    crashRecovery = settings.crashRecovery;
    render();
    refreshModels();
  }

  api.onSettings((s) => {
    render();
    if (crashRecovery !== s.crashRecovery) { // switched off: a leftover recording and its banner are gone
      crashRecovery = s.crashRecovery;
      HomeNotices.refreshRecovery();
    }
  });
  let onDisk = '';
  api.onModelState((m) => { // a model finished downloading or was deleted (not on every download percent)
    const key = JSON.stringify([...(m.models || []).map((x) => x.downloaded), m.translator && m.translator.downloaded]);
    if (key !== onDisk) { onDisk = key; refreshModels(); }
  });
  document.querySelector('.nav[data-page="settings"]').addEventListener('click', refreshModels);

  return { start };
})();
