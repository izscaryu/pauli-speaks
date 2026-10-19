'use strict';
// IPC behind Settings → Privacy: the two delete buttons, how many saved transcripts a retention
// choice deletes (asked before switching), and the sound of a saved recording.
// Everything Electron-specific comes in through `deps`, so a fake ipcMain can test it.
//
//   deps = {
//     catalog: () => [{id, label, kind}],     // the models the app knows (speech models, the translator)
//     modelsDir: () => string,
//     dictationActive: () => boolean,
//     fileActive?: () => boolean,             // a file is being transcribed
//     modelsBusy?: () => boolean,             // a speech model or the translator is downloading or loading
//     unloadModels: () => Promise<void>,      // stop the speech engine so it lets go of the model files
//     afterModelsDeleted: () => void,         // main forgets the loaded state and tells the windows
//     deleteAll: () => {ok, errors},          // privacy.js deleteAllData with the app's parts
//     audioBytes: (historyId) => Buffer|null, // a saved recording (WAV)
//     retentionDrops: (retention) => number,  // History items that retention would delete now
//     log?,
//   }

const { modelsOnDisk, deleteModels, RETENTIONS } = require('./privacy');
const { t } = require('./strings');

const message = (err) => String((err && err.message) || err);

function registerPrivacyIpc(ipcMain, deps) {
  const log = deps.log || { warn() {} };

  ipcMain.handle('privacy:models', () => {
    const models = modelsOnDisk(deps.modelsDir(), deps.catalog());
    return { models, bytes: models.reduce((sum, m) => sum + m.bytes, 0) };
  });

  ipcMain.handle('privacy:delete-models', async () => {
    if (deps.dictationActive()) return { ok: false, error: t('errors.finishDictation') };
    if (deps.fileActive?.()) return { ok: false, error: t('errors.waitFile') };
    if (deps.modelsBusy?.()) return { ok: false, error: t('errors.waitModel') };
    const root = deps.modelsDir();
    const found = modelsOnDisk(root, deps.catalog());
    if (!found.length) return { ok: true, removed: [], failed: [] };
    try {
      await deps.unloadModels();
    } catch (err) {
      log.warn('privacy: stopping the speech engine failed:', message(err));
      return { ok: false, error: t('errors.stopEngine', { error: message(err) }) };
    }
    const { removed, failed } = deleteModels(root, found);
    for (const f of failed) log.warn(`privacy: deleting model ${f.id} failed:`, f.error);
    if (removed.length) deps.afterModelsDeleted();
    return { ok: failed.length === 0, removed, failed, ...(failed.length ? { error: t('errors.modelsNotDeleted') } : {}) };
  });

  ipcMain.handle('privacy:delete-all', () => {
    // the dictation in progress owns its crash file and its audio: deleting them under it would lose or resurrect data
    if (deps.dictationActive()) return { ok: false, errors: [], error: t('errors.finishDictation') };
    const result = deps.deleteAll();
    for (const e of result.errors) log.warn(`privacy: deleting ${e.part} failed:`, e.error);
    return result;
  });

  ipcMain.handle('privacy:retention-drops', (_e, retention) => {
    if (typeof retention !== 'string' || !RETENTIONS.includes(retention)) return 0;
    return deps.retentionDrops(retention);
  });

  ipcMain.handle('history:audio', (_e, historyId) => {
    if (typeof historyId !== 'string') return null;
    const bytes = deps.audioBytes(historyId);
    return bytes ? Uint8Array.from(bytes) : null;
  });
}

module.exports = { registerPrivacyIpc };
