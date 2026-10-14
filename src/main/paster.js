'use strict';
// Text insertion. Same strategy as Wispr Flow's helper (PasteTextInternal):
//   1. wait until the user lets go of modifier keys (else Ctrl+V becomes
//      Ctrl+Win+V etc.); if they stay down, synthesise key-ups
//   2. snapshot the clipboard
//   3. put the transcript on the clipboard, send Ctrl+V with SendInput
//   4. after a short delay restore the previous clipboard - unless something
//      else changed it in the meantime ("Clipboard changed since paste,
//      skipping restoration")

const { clipboard } = require('electron');
const win32 = require('./win32');
const log = require('./logger');

const MODIFIER_VKS = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c];
const RESTORE_DELAY_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForModifiersReleased(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!MODIFIER_VKS.some(win32.isKeyDown)) return true;
    await sleep(15);
  }
  return false;
}

function snapshot() {
  const formats = clipboard.availableFormats();
  if (formats.length === 0) return null;
  const snap = {};
  const text = clipboard.readText();
  if (text) snap.text = text;
  if (formats.includes('text/html')) snap.html = clipboard.readHTML();
  if (formats.includes('text/rtf')) snap.rtf = clipboard.readRTF();
  if (formats.some((f) => f.startsWith('image/'))) {
    const image = clipboard.readImage();
    if (!image.isEmpty()) snap.image = image;
  }
  return Object.keys(snap).length ? snap : null;
}

function restore(snap) {
  if (snap) clipboard.write(snap);
  else clipboard.clear();
}

let pending = null;

/**
 * @param {string} text
 * @param {{restoreClipboard?: boolean}} opts
 */
async function pasteText(text, { restoreClipboard = true } = {}) {
  if (!(await waitForModifiersReleased(1500))) {
    log.warn('Modifiers still held before paste, releasing them');
    win32.releaseModifiers(MODIFIER_VKS);
    await sleep(20);
  }

  // A new paste supersedes a queued restore of the previous one.
  let snap;
  if (pending) {
    clearTimeout(pending.timer);
    snap = pending.snap;
    pending = null;
  } else {
    snap = restoreClipboard ? snapshot() : null;
  }

  clipboard.writeText(text);
  await sleep(25);
  const ok = win32.sendPaste();
  if (!ok) log.warn('SendInput for Ctrl+V was blocked (is the target app running as administrator?)');

  if (restoreClipboard) {
    const timer = setTimeout(() => {
      pending = null;
      if (clipboard.readText() === text) restore(snap);
      else log.info('Clipboard changed since paste, skipping restoration');
    }, RESTORE_DELAY_MS);
    pending = { timer, snap };
  }
  return ok;
}

/**
 * Selected text of the focused app, via a clipboard round-trip (Wispr's
 * GetSelectedTextViaCopy): snapshot, clear, Ctrl+C, read, restore.
 * @returns {Promise<string>} '' when nothing is selected
 */
async function getSelectedText() {
  if (!(await waitForModifiersReleased(1500))) {
    win32.releaseModifiers(MODIFIER_VKS);
    await sleep(20);
  }
  const snap = pending ? pending.snap : snapshot();
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  clipboard.clear();
  win32.sendCopy();
  let text = '';
  const end = Date.now() + 450;
  while (Date.now() < end) {
    await sleep(30);
    text = clipboard.readText();
    if (text) break;
  }
  restore(snap);
  return text;
}

module.exports = { pasteText, getSelectedText, waitForModifiersReleased };
