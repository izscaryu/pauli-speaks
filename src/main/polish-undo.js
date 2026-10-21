'use strict';
// Undo AI edit: after a polished paste the pill shows "Polished. Undo" for 4 seconds. Undo takes the polished text
// back with the same Backspaces as "Undo last dictation" (last-paste.js decides whether that's safe: the same app,
// not sent with Enter) and pastes what was said, as it would have been pasted without polish. The History entry
// then shows what was said and keeps the polished version (`polished`, `unpolished`).
// Only the latest offer counts, and only while its text is still the last thing Pauli Speaks typed.
// Typing, History and the clock come in through `deps`, so it is unit tested with fakes.

const { UNDO_MS } = require('./retry-offers');
const { countWords } = require('./text-cleanup');
const { t } = require('./strings');

/**
 * @param {object} d
 * @param {{undoLast: () => Promise<boolean>, paste: (text: string) => Promise<object>}} d.typing  typing.js
 * @param {{list: () => object[], resolve: (id: string, entry: object) => object|null}} d.history
 * @param {() => string|null} d.lastPasted  the text Pauli Speaks typed last (last-paste.js)
 * @param {(text: string) => void} d.flash
 * @param {{setTimeout: Function, clearTimeout: Function}} [d.timers]
 * @param {number} [d.undoMs]
 */
function createPolishUndo(d) {
  const timers = d.timers || { setTimeout, clearTimeout };
  const undoMs = d.undoMs || UNDO_MS;
  let offer = null; // { id, historyId, polished, unpolished, timer }
  let nextId = 1;

  function end() {
    if (offer) timers.clearTimeout(offer.timer);
    offer = null;
  }

  return {
    /**
     * A polished dictation was pasted. @returns {{id: string, label: string}} the pill's button
     * @param {{historyId: string|null, polished: string, unpolished: string}} o  as pasted (with the trailing space)
     */
    offer({ historyId, polished, unpolished }) {
      end();
      const id = `unpolish-${nextId++}`;
      const held = { id, historyId, polished, unpolished, timer: null };
      held.timer = timers.setTimeout(() => { if (offer === held) offer = null; }, undoMs);
      offer = held;
      return { id, label: t('overlay.undo') };
    },

    /** The pill's Undo. @returns {Promise<boolean>} the text that was said is back */
    async take(actionId) {
      const held = offer && offer.id === actionId ? offer : null;
      if (held) end(); // once; a stale button leaves the current offer alone
      if (!held || d.lastPasted() !== held.polished) {
        d.flash(t('errors.nothingToUndo'));
        return false;
      }
      if (!(await d.typing.undoLast())) return false; // undoLast said why (another app in front, sent with Enter)
      await d.typing.paste(held.unpolished);
      const item = held.historyId && d.history.list().find((i) => i.id === held.historyId);
      if (item) d.history.resolve(item.id, { ...item, text: held.unpolished.trim(), words: countWords(held.unpolished) });
      return true;
    },

    /** A new dictation starts: its paste replaces the one this offer would take back. */
    expire: end,
    /** Delete all my data. */
    clear: end,
  };
}

module.exports = { createPolishUndo, UNDO_MS };
