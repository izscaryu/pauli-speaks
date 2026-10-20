'use strict';
// Settings → Privacy: the transcript-history choice, the recordings switch, and the two delete buttons with their
// in-page confirmation (no window.confirm). The crash-recovery switch is an ordinary data-setting toggle in app.js.
// It also keeps Settings → Speech's list of downloaded models (size, last use, Delete), from the same data.
// Loaded after app.js and home-notices.js; uses these app.js globals: api, $, el, save, settings, toast, ICONS.

const Privacy = (() => {
  const RETENTION_DESC = {
    keep: 'privacy.retention.keep',
    '24h': 'privacy.retention.24h',
    off: 'privacy.retention.off',
  };

  /** Whisper models keep their name; the translator's is said in the UI language. */
  const modelName = (m) => (m.kind === 'translator' ? t('translation.model.title') : m.label);

  let crashRecovery = null;
  let models = { models: [], bytes: 0 };

  const size = (bytes) => (bytes >= 1e9
    ? `${I18n.num(bytes / 1e9, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
    : `${I18n.num(Math.max(1, Math.round(bytes / 1e6)))} MB`);

  // ---------------------------------------------------------------- the settings

  function render() {
    $('#history-retention').value = settings.historyRetention;
    const desc = Object.hasOwn(RETENTION_DESC, settings.historyRetention) ? t(RETENTION_DESC[settings.historyRetention]) : '';
    $('#retention-desc').textContent = settings.historyRetention === 'off' && settings.audioHistory === '24h'
      ? `${desc} ${t('privacy.retention.recordingsKept')}` : desc;
    $('#audio-history').checked = settings.audioHistory === '24h';
  }

  /** Switching to a choice that deletes saved transcripts asks first, with how many; Cancel puts the choice back. */
  $('#history-retention').addEventListener('change', async (e) => {
    const select = e.target;
    const next = select.value;
    let drops = null; // unknown: ask anyway
    try {
      drops = next === 'keep' ? 0 : await api.retentionDrops(next);
    } catch (err) {
      console.error('counting transcripts failed', err);
    }
    if (drops === 0) return save({ historyRetention: next });
    confirmBox({
      title: t(next === 'off' ? 'privacy.confirm.offTitle' : 'privacy.confirm.24hTitle'),
      items: [drops ? t('privacy.confirm.deletes', { count: drops }) : t('privacy.confirm.deletesAll')],
      note: t(next === 'off' ? 'privacy.confirm.offNote' : 'privacy.confirm.24hNote'),
      label: t('privacy.confirm.switch'),
      run: () => save({ historyRetention: next }),
      onCancel: () => { select.value = settings.historyRetention; },
    });
  });
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
    button.textContent = models.models.length ? t('privacy.models.deleteSize', { size: size(models.bytes) }) : t('privacy.models.none');
    $('#models-desc').textContent = models.models.length
      ? t('privacy.models.list', { names: I18n.list(models.models.map(modelName)) })
      : t('privacy.models.empty');
    renderDisk();
  }

  /** Settings → Speech: each downloaded model with its size, when it was last used, and Delete. */
  function renderDisk() {
    $('#model-disk-row').hidden = !models.models.length;
    $('#model-disk-title').textContent = t('models.disk.title', { size: size(models.bytes) });
    $('#model-disk').replaceChildren(...models.models.map((m) => el('div', { class: 'disk-item' },
      el('span', { class: 'name' }, modelName(m)),
      el('span', { class: 'desc' }, `${size(m.bytes)} · ${t('models.disk.lastUsed', { date: I18n.date(m.lastUsed, { day: 'numeric', month: 'short', year: 'numeric' }) })}`),
      el('button', {
        class: 'icon-btn danger', title: t('common.remove'), 'aria-label': t('models.disk.delete', { name: modelName(m) }), html: ICONS.trash,
        onclick: () => deleteOne(m),
      }))));
  }

  async function deleteOne(m) {
    if (!confirm(t('models.disk.confirm', { name: modelName(m), size: size(m.bytes) }))) return;
    const r = await api.deleteModel(m.id);
    toast(r.ok ? t('models.disk.deleted', { name: modelName(m) }) : r.error || t('privacy.models.failed'));
    await refreshModels();
  }

  // ---------------------------------------------------------------- the confirmation

  const box = () => $('#privacy-confirm');
  const close = () => { box().hidden = true; box().replaceChildren(); };
  let onCancelOpen = null; // what Cancel undoes for the confirmation on screen (a retention choice goes back)

  /** Cancel, Escape, or another confirmation taking its place. */
  function cancelOpen() {
    const undo = onCancelOpen;
    onCancelOpen = null;
    close();
    if (undo) undo();
  }

  /** A confirmation in the page: what goes, then Cancel / the destructive button. */
  function confirmBox({ title, items, note, label, run, onCancel = null }) {
    if (onCancelOpen) cancelOpen();
    onCancelOpen = onCancel;
    const cancel = el('button', { class: 'btn', onclick: cancelOpen }, t('common.cancel'));
    const go = el('button', { class: 'btn danger primary' }, label);
    go.addEventListener('click', async () => {
      onCancelOpen = null;
      go.disabled = true;
      cancel.disabled = true;
      go.textContent = t('privacy.deleting');
      try {
        await run();
      } catch (err) {
        console.error('deleting failed', err);
        toast(t('privacy.deleteFailed'));
      } finally {
        close();
      }
    });
    const panel = box();
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-label', title);
    panel.onkeydown = (e) => { if (e.key === 'Escape' && !cancel.disabled) { e.stopPropagation(); cancelOpen(); } };
    panel.replaceChildren(
      el('h3', {}, title),
      el('ul', {}, ...items.map((item) => el('li', {}, item))),
      el('p', { class: 'desc' }, note),
      el('div', { class: 'buttons' }, cancel, go));
    panel.hidden = false;
    cancel.focus();
    panel.scrollIntoView({ block: 'nearest' });
  }

  function askDeleteAll() {
    confirmBox({
      title: t('privacy.all.confirmTitle'),
      items: ['privacy.all.history', 'privacy.all.recordings', 'privacy.all.dictionary', 'privacy.all.settings'].map((key) => t(key)),
      note: t('privacy.all.note'),
      label: t('privacy.all.title'),
      run: async () => {
        const r = await api.deleteAllData();
        HomeNotices.refreshRecovery(); // a leftover recording is gone too
        toast(r.ok ? t('privacy.all.done') : r.error || t('privacy.all.partly'));
      },
    });
  }

  async function askDeleteModels() {
    await refreshModels();
    if (!models.models.length) return;
    confirmBox({
      title: t('privacy.models.confirmTitle'),
      items: models.models.map((m) => `${modelName(m)} (${size(m.bytes)})`),
      note: t('privacy.models.note'),
      label: t('privacy.models.confirm', { size: size(models.bytes) }),
      run: async () => {
        const r = await api.deleteModels();
        toast(r.ok ? t('privacy.models.done') : r.error || t('privacy.models.failed'));
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
