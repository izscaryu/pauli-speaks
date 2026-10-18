'use strict';
// "Sounds like Croatian. Add it to your languages?": after you keep speaking a language that isn't in
// your list, Home offers to add it. The speech engine reports the language it thinks it heard
// (`likely`) after each dictation; three in a row for the same language outside the list make a hint,
// once per language ever (`languageHints.shown` in the settings). The streak and the waiting hint
// live in memory only; only the languages you answered for are saved.
//
// Channels: 'language-hint:state' (the language waiting for an answer, or null), 'language-hint:add' and
// 'language-hint:dismiss' (the language code), and the 'language-hint:changed' broadcast.

const DETECTIONS_FOR_HINT = 3;

/**
 * @param {{streak: Record<string, number>, shown: string[]}} state
 * @param {{chosen: string[], likely: string|null|undefined}} heard
 * @returns {{state: {streak: Record<string, number>, shown: string[]}, hint: string|null}}
 *   Never changes `state`. The returned `shown` already holds the hinted language.
 */
function nextLanguageHint(state, { chosen, likely }) {
  const { streak, shown } = state;
  if (!chosen || !chosen.length || typeof likely !== 'string' || !likely) return { state, hint: null };
  if (chosen.includes(likely)) return { state: { streak: {}, shown }, hint: null }; // heard one of yours: start over
  if (shown.includes(likely)) return { state: { streak: {}, shown }, hint: null };

  const count = (Object.hasOwn(streak, likely) ? streak[likely] : 0) + 1;
  if (count >= DETECTIONS_FOR_HINT) return { state: { streak: {}, shown: [...shown, likely] }, hint: likely };
  return { state: { streak: Object.fromEntries([[likely, count]]), shown }, hint: null }; // "in a row": other languages start over
}

/**
 * @param {object} deps
 * @param {() => {languages: string[], languageHints: {shown: string[]}}} deps.getSettings
 * @param {(patch: object) => void} deps.updateSettings
 * @param {(channel: string, payload: any) => void} deps.broadcast
 * @param {{warn: Function}} [deps.log]
 */
function createLanguageHints({ getSettings, updateSettings, broadcast, log = { warn() {} } }) {
  let streak = {};
  let pending = null; // the language waiting for Add / No thanks

  /** After a successful dictation. Never throws: a hint must not fail a dictation. */
  function feed({ chosen, likely }) {
    if (pending) return;
    try {
      const shown = getSettings().languageHints.shown;
      const next = nextLanguageHint({ streak, shown }, { chosen, likely });
      streak = next.state.streak;
      if (!next.hint) return;
      pending = next.hint;
      broadcast('language-hint:changed', pending);
    } catch (err) {
      log.warn('language hint failed:', err && err.message);
    }
  }

  const answered = () => {
    pending = null;
    broadcast('language-hint:changed', null);
  };

  /** Always a new array: the settings may share their default one. */
  const markShown = (code) => ({ shown: [...getSettings().languageHints.shown, code] });

  function registerIpc(ipcMain) {
    ipcMain.handle('language-hint:state', () => pending);
    ipcMain.handle('language-hint:add', (_e, code) => {
      if (typeof code !== 'string' || code !== pending) return;
      const { languages } = getSettings();
      updateSettings({
        languages: languages.includes(code) ? [...languages] : [...languages, code],
        languageHints: markShown(code),
      });
      answered();
    });
    ipcMain.handle('language-hint:dismiss', (_e, code) => {
      if (typeof code !== 'string' || code !== pending) return;
      updateSettings({ languageHints: markShown(code) });
      answered();
    });
  }

  /** Delete all my data: the streak and the waiting hint go with the settings. */
  function forget() {
    streak = {};
    if (pending) answered();
  }

  return { feed, registerIpc, forget };
}

module.exports = { nextLanguageHint, createLanguageHints, DETECTIONS_FOR_HINT };
