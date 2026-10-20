'use strict';
// Which mode a dictation runs in (modes.js resolveMode) with the live parts filled in: the modes from
// settings, the app in front, and the Switch mode choice, which lasts until switched back (in memory: a
// restart is Automatic again). The controller asks once when a dictation starts, so switching apps
// mid-dictation doesn't change it. Unit tested with fakes.

const { resolveMode, findMode, nextMode } = require('./modes');

/**
 * @param {object} d
 * @param {{get: () => {modes: object[], translation: {target: string}}}} d.settings
 * @param {() => {exe: string}|null} d.foregroundApp
 */
function createModeSession(d) {
  let switched = null; // a mode id, or null for Automatic
  let lastApp = null; // the app the last dictation started in

  const live = (o) => {
    const s = d.settings.get();
    if (switched && !findMode(s.modes, switched)) switched = null; // deleted meanwhile
    return resolveMode({ ...o, switched, modes: s.modes, translateTarget: s.translation.target });
  };

  /**
   * @param {{binding?: object, link?: string, kept?: {mode?: string, translate?: boolean, app?: {exe: string}|null}}} [request]
   *   kept: a recording run again (Retry / Undo / Recover) - the mode it was recorded in
   * @returns {{mode: object, app: {exe: string}|null}} app: the app in front, null for a kept recording
   */
  function resolve(request = {}) {
    const { kept } = request;
    if (kept) {
      const s = d.settings.get();
      const mode = findMode(s.modes, kept.mode)
        || resolveMode({ binding: kept.translate ? { action: 'translate' } : null, exe: kept.app && kept.app.exe, modes: s.modes, translateTarget: s.translation.target });
      return { mode, app: null };
    }
    lastApp = d.foregroundApp();
    return { mode: live({ binding: request.binding, link: request.link, exe: lastApp && lastApp.exe }), app: lastApp };
  }

  /**
   * Switch mode: the next one after `current` (the running dictation's mode) or after the last choice.
   * @returns {{switched: string|null, mode: object}} mode: what a running dictation goes on in
   */
  function cycle(current) {
    const { modes } = d.settings.get();
    if (switched && !findMode(modes, switched)) switched = null;
    switched = nextMode(modes, current === undefined ? switched : current);
    return { switched, mode: live({ exe: lastApp && lastApp.exe }) };
  }

  return {
    resolve, cycle,
    get switched() { return switched; },
  };
}

module.exports = { createModeSession };
