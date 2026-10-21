'use strict';
// Home's notices, one at a time: the most important InfoBar shows, with "1 of 3" and ‹ › for the others, so a
// new install with a missing model, a hint and What's new doesn't push the app off the screen (HOME-02).
// Pure (CommonJS for test/notice-queue.test.js); in the window it is the global NoticeQueue, used by
// home-notices.js. Loaded before it.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.NoticeQueue = core;
})(typeof self !== 'undefined' ? self : this, () => {
  // What stops dictation first (the shortcut hook, the speech model), then news, then suggestions.
  const ORDER = ['hook', 'model', 'update', 'recovery', 'conflict', 'language', 'setup', 'whatsNew'];
  // The model notice changes its severity (missing = warning, failed = error, downloading = info): it says so itself.
  const SEVERITY = { hook: 'error', update: 'success', recovery: 'warning', conflict: 'warning', language: 'info', setup: 'info', whatsNew: 'info' };

  /** @param {string[]} ids the notices there are now @returns {string[]} in ORDER, once each */
  function ordered(ids) {
    for (const id of ids) if (!ORDER.includes(id)) throw new Error(`unknown notice: ${id}`);
    return ORDER.filter((id) => ids.includes(id));
  }

  /** The one to show: the one the user stepped to while it is still there, else the first. */
  const shown = (ids, current) => (ids.includes(current) ? current : ids[0] || null);

  /** ‹ (delta -1) or › (+1) from what is shown; stops at either end. */
  function step(ids, current, delta) {
    if (!ids.length) return null;
    const at = ids.indexOf(shown(ids, current));
    return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
  }

  return { ORDER, SEVERITY, ordered, shown, step };
});
