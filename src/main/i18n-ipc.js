'use strict';
// The UI language between main and the windows. Takes Electron's parts through `deps`:
//   deps = { getSettings, systemLanguages: () => string[] (app.getPreferredSystemLanguages), broadcast(channel, data) }
// i18n:get is synchronous (the preload asks once per page load, before any script runs). A uiLanguage change
// switches strings.js and sends i18n:changed: the main window reloads itself, the pill swaps its strings in place.

const strings = require('./strings');

function registerI18nIpc(ipcMain, deps) {
  const system = () => {
    try {
      return deps.systemLanguages() || [];
    } catch {
      return [];
    }
  };
  const apply = () => strings.setLanguage((deps.getSettings() || {}).uiLanguage, system());

  apply();
  ipcMain.on('i18n:get', (e) => {
    e.returnValue = strings.payload();
  });

  return {
    /** Call with every settings patch. @returns {boolean} whether the language setting changed */
    settingsChanged(patch) {
      if (!patch || !('uiLanguage' in patch)) return false;
      apply();
      deps.broadcast('i18n:changed', strings.payload());
      return true;
    },
  };
}

module.exports = { registerI18nIpc };
