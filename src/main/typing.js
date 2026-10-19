'use strict';
// Typing into the app in front: the paste (remembered, so "undo last" can take it back), Enter,
// the voice commands said around a dictation, and the selection for command mode and read aloud.
// Windows, the clipboard and the keyboard hook come in through `deps`, so it is unit tested with fakes.

/**
 * @param {object} d
 * @param {{get: () => object}} d.settings
 * @param {import('./last-paste').LastPaste} d.lastPaste
 * @param {{last: () => object|null}} d.history
 * @param {{isListening: boolean, status: string, stop: (reason: string) => void}} d.controller
 * @param {Record<string, number>} d.VK
 * @param {(text, opts) => Promise<{mode: string}>} d.pasteText  paster.js
 * @param {(vk: number, times?: number) => Promise<void>} d.pressKey  paster.js
 * @param {() => Promise<string>} d.getSelectedText  paster.js
 * @param {() => {exe: string}|null} d.foregroundApp
 * @param {() => number} d.keysDown  keys the global hook sees held
 * @param {(text: string) => Promise<void>|void} d.writeClipboard
 * @param {(text, kind?, ms?) => void} d.flash
 * @param {{warn: Function}} d.log
 * @param {() => number} [d.now]
 * @param {(ms: number) => Promise<void>} [d.sleep]
 */
function createTyping(d) {
  const { settings, lastPaste, history, controller, VK } = d;
  const now = d.now || Date.now;
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let enterAfterPaste = false; // "Press Enter" during a dictation: Enter once it is pasted

  /** Paste into the focused app and remember it, so "undo last" can take it back. Administrator windows get copy-only. */
  async function paste(text) {
    const result = await d.pasteText(text, { restoreClipboard: settings.get().restoreClipboard });
    if (result.mode === 'copy-only') {
      lastPaste.forget(); // nothing was typed, so nothing to undo
      d.flash('Copied. Press Ctrl+V (this app runs as administrator)', 'info', 4500);
      return result;
    }
    const target = d.foregroundApp();
    lastPaste.remember(text, target && target.exe);
    return result;
  }

  async function pasteLast() {
    const last = history.last();
    if (!last) return d.flash('Nothing to paste yet');
    await waitForKeysReleased();
    await paste(last.text + (settings.get().addTrailingSpace ? ' ' : ''));
  }

  function copyLast(notify = false) {
    const last = history.last();
    if (!last) return notify ? d.flash('Nothing to copy yet') : undefined;
    Promise.resolve(d.writeClipboard(last.text))
      .then(() => notify && d.flash('Copied your last dictation'))
      .catch((err) => d.log.warn(`Copy failed: ${err.message}`));
  }

  /** Take back the text Pauli Speaks typed last (rules in last-paste.js). @returns {Promise<boolean>} removed */
  async function undoLast() {
    const target = d.foregroundApp();
    const plan = lastPaste.undoPlan(target && target.exe);
    if (plan.error) {
      d.flash(plan.error);
      return false;
    }
    await waitForKeysReleased();
    await d.pressKey(VK.Backspace, plan.backspaces);
    return true;
  }

  async function pressEnterNow() {
    enterAfterPaste = false;
    await waitForKeysReleased();
    await d.pressKey(VK.Enter);
    lastPaste.markSent();
  }

  /** "Press Enter" shortcut: while dictating it finishes and sends; otherwise it presses Enter now. */
  function pressEnter() {
    if (controller.isListening) {
      enterAfterPaste = true;
      return controller.stop('enter');
    }
    if (controller.status === 'processing') {
      enterAfterPaste = true;
      return;
    }
    return pressEnterNow();
  }

  /** A voice command said at the start or end of a dictation. */
  async function runVoiceAction(c, alone) {
    if (c.action === 'undo') {
      if ((await undoLast()) && alone) d.flash('Removed the last dictation');
      return;
    }
    if (c.action === 'key' && VK[c.arg]) {
      if (c.arg === 'Enter') return pressEnterNow();
      await waitForKeysReleased();
      await d.pressKey(VK[c.arg]);
    }
  }

  /**
   * Before we synthesise Ctrl+C, every key of the user's shortcut must be up -
   * otherwise a still-held letter (the S of Shift+Alt+S) turns it into Ctrl+S.
   */
  async function waitForKeysReleased(timeoutMs = 1500) {
    const end = now() + timeoutMs;
    while (d.keysDown() > 0 && now() < end) await sleep(15);
  }

  async function selectedText() {
    await waitForKeysReleased();
    return d.getSelectedText();
  }

  return {
    paste, pasteLast, copyLast, undoLast, pressEnterNow, pressEnter, runVoiceAction, waitForKeysReleased, selectedText,
    get enterAfterPaste() { return enterAfterPaste; },
    set enterAfterPaste(on) { enterAfterPaste = on; },
  };
}

module.exports = { createTyping };
