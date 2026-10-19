'use strict';
// What "Undo last dictation" (and "scratch that") may take back: the text
// Pauli Speaks typed last. It is removed with one Backspace per character,
// which works in editors, browsers and terminals alike (Ctrl+Z would suspend a
// terminal job) - so only in the app it was typed into, only once, and not
// after Enter has sent it. Pure, so it can be unit tested.

const { t } = require('./strings');

const MAX_UNDO_CHARS = 4000;

class LastPaste {
  constructor() {
    this.last = null; // { text, app, sent }
  }

  /** @param {string|null} app exe of the window it went into, null if unknown */
  remember(text, app) {
    this.last = { text, app: app || null, sent: false };
  }

  /** The latest dictation wasn't typed (left on the clipboard instead): nothing to take back. */
  forget() {
    this.last = null;
  }

  /** Enter was pressed after it (a chat message went out): it can't be undone any more. */
  markSent() {
    if (this.last) this.last.sent = true;
  }

  /**
   * @param {string|null} currentApp exe of the focused window now
   * @returns {{backspaces: number} | {error: string}} a plan is only handed out once
   */
  undoPlan(currentApp) {
    const p = this.last;
    if (!p) return { error: t('errors.nothingToUndo') };
    if (p.sent) return { error: t('errors.alreadySent') };
    if (p.app && currentApp && currentApp !== p.app) return { error: t('errors.goBackToUndo', { app: p.app.replace(/\.exe$/i, '') }) };
    const backspaces = [...p.text].length;
    if (backspaces > MAX_UNDO_CHARS) return { error: t('errors.undoTooLong') };
    this.last = null;
    return { backspaces };
  }
}

module.exports = { LastPaste, MAX_UNDO_CHARS };
