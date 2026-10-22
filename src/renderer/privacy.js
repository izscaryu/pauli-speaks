'use strict';
// Settings → Privacy: the transcript-history choice, the recordings switch, and the two delete buttons, which ask
// first in a dialog (dialog.js). The crash-recovery switch is an ordinary data-setting toggle in app.js.
// It also knows the downloaded models (size, last use) for Settings → Speech's model list and deletes one at a time.
// Loaded after app.js and home-notices.js; uses these app.js globals: api, $, el, save, settings, toast, ICONS,
// renderModels.

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
    ask({
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

  /**
   * Settings → Speech lists the models once (app.js renderModels, with the size and Delete from here); the offline
   * translator's Delete sits in Settings → Translation.
   */
  function renderDisk() {
    if (typeof renderModels === 'function') renderModels();
    const tr = models.models.find((m) => m.kind === 'translator');
    $('#tr-delete-slot').replaceChildren(...(tr ? [el('button', {
      class: 'icon-btn danger', type: 'button', title: t('common.delete'), 'aria-label': t('models.disk.delete', { name: modelName(tr) }), html: ICONS.trash,
      onclick: () => deleteOne(tr),
    })] : []));
  }

  async function deleteOne(m) {
    const yes = await Dialog.confirmDialog({
      title: t('models.disk.dialogTitle', { name: modelName(m) }), body: t('models.disk.dialogBody', { size: size(m.bytes) }),
      confirm: t('common.delete'), cancel: t('common.cancel'), tone: 'danger',
    });
    if (!yes) return;
    const r = await api.deleteModel(m.id);
    toast(r.ok ? t('models.disk.deleted', { name: modelName(m) }) : r.error || t('privacy.models.failed'));
    await refreshModels();
  }

  // ---------------------------------------------------------------- the confirmation

  /**
   * Asks in a dialog what goes, with [label] [Cancel]; on yes runs `run` while the button that asked says
   * "Deleting…", on no (Cancel or Esc) runs `onCancel` (a retention choice goes back).
   */
  async function ask({ title, items, note, label, run, onCancel = null }) {
    const trigger = document.activeElement;
    const yes = await Dialog.confirmDialog({ title, list: items, note, confirm: label, cancel: t('common.cancel'), tone: 'danger' });
    if (!yes) {
      if (onCancel) onCancel();
      return;
    }
    const busy = trigger instanceof HTMLButtonElement ? trigger : null;
    const was = busy && busy.textContent;
    if (busy) { busy.disabled = true; busy.textContent = t('privacy.deleting'); }
    try {
      await run();
    } catch (err) {
      console.error('deleting failed', err);
      toast(t('privacy.deleteFailed'));
    } finally {
      if (busy && busy.textContent === t('privacy.deleting')) { busy.textContent = was; busy.disabled = false; }
    }
  }

  function askDeleteAll() {
    ask({
      title: t('privacy.all.confirmTitle'),
      items: ['privacy.all.history', 'privacy.all.recordings', 'privacy.all.dictionary', 'privacy.all.settings'].map((key) => t(key)),
      note: t('privacy.all.note'),
      label: t('privacy.all.confirm'),
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
    ask({
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

  return {
    start,
    /** A model on disk ({ id, bytes, lastUsed, … }) by its id, or null. */
    disk: (id) => models.models.find((m) => m.id === id) || null,
    /** How much all downloaded models take, in bytes. */
    total: () => models.bytes || 0,
    size,
    /** Deletes one downloaded model, after asking. */
    deleteModel: deleteOne,
  };
})();
