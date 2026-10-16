'use strict';
// Settings → Backup: the "Export settings" and "Import settings" buttons.
// Loaded after app.js; uses these app.js globals: api, $, toast. The dialogs run in the main process.

(() => {
  // A cancelled dialog is silent; everything else is one short message.
  async function run(button, call, done) {
    button.disabled = true;
    try {
      const r = await call();
      if (r && r.ok) toast(done);
      else if (r && r.error) toast(r.error);
    } catch {
      toast('Something went wrong. Try again.');
    } finally {
      button.disabled = false;
    }
  }

  const exportButton = $('#export-settings');
  const importButton = $('#import-settings');
  exportButton.addEventListener('click', () => run(exportButton, api.exportSettings, 'Settings exported.'));
  importButton.addEventListener('click', () => run(importButton, api.importSettings, 'Settings imported.'));
})();
