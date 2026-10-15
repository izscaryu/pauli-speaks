'use strict';
// Text insertion:
//   1. wait until the user lets go of modifier keys (else Ctrl+V becomes
//      Ctrl+Win+V etc.); if they stay down, synthesise key-ups
//   2. snapshot the clipboard
//   3. put the transcript on the clipboard, send Ctrl+V with SendInput
//   4. after a short delay restore the previous clipboard - unless something
//      else changed it in the meantime ("Clipboard changed since paste,
//      skipping restoration")
//
// Electron 44 replaced the old synchronous clipboard API (availableFormats,
// readHTML, readImage...) with an async W3C-style one: read() returns
// ClipboardItems carrying every format - including raw Windows formats - and
// write() puts them back atomically.

const { clipboard, ClipboardItem } = require('electron');
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

/**
 * Copy of everything on the clipboard (text, HTML, images, files, app formats).
 * Payloads are read eagerly so the snapshot survives the clipboard changing.
 * Best effort: on failure we paste anyway and just can't restore.
 * @returns {Promise<ClipboardItem[]|null>} null = clipboard was empty
 */
async function snapshot() {
  try {
    const items = await clipboard.read();
    const out = [];
    for (const item of items) {
      const data = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {
          // a format that can't be read back is skipped, the rest is kept
        }
      }
      if (Object.keys(data).length) out.push(new ClipboardItem(data));
    }
    return out.length ? out : null;
  } catch (err) {
    log.warn(`Could not snapshot the clipboard: ${err.message}`);
    return undefined;
  }
}

async function restore(snap) {
  if (snap === undefined) return;
  try {
    if (snap) await clipboard.write(snap);
    else clipboard.clear();
  } catch (err) {
    log.warn(`Could not restore the clipboard: ${err.message}`);
  }
}

let pending = null;

/** Take over a queued restore (a newer paste/copy supersedes it) and return its snapshot. */
function takePending() {
  if (!pending) return null;
  clearTimeout(pending.timer);
  const { snap } = pending;
  pending = null;
  return { snap };
}

/** Synthetic keys must not combine with a modifier the user still holds (Shift+Enter, Ctrl+Win+V...). */
async function ensureModifiersUp() {
  if (!(await waitForModifiersReleased(1500))) {
    log.warn('Modifiers still held before sending keys, releasing them');
    win32.releaseModifiers(MODIFIER_VKS);
    await sleep(20);
  }
}

/** Press a key (Enter, Tab, Backspace...) `count` times in the focused app. */
async function pressKey(vk, count = 1) {
  await ensureModifiersUp();
  const steps = [];
  for (let i = 0; i < count; i++) steps.push({ vk }, { vk, up: true });
  const ok = win32.sendKeys(steps);
  if (!ok) log.warn('SendInput was blocked (is the target app running as administrator?)');
  return ok;
}

/**
 * @param {string} text
 * @param {{restoreClipboard?: boolean}} opts
 */
async function pasteText(text, { restoreClipboard = true } = {}) {
  await ensureModifiersUp();

  const queued = takePending();
  const snap = queued ? queued.snap : restoreClipboard ? await snapshot() : undefined;

  await clipboard.writeText(text);
  await sleep(25);
  const ok = win32.sendPaste();
  if (!ok) log.warn('SendInput for Ctrl+V was blocked (is the target app running as administrator?)');

  if (restoreClipboard && snap !== undefined) {
    const timer = setTimeout(async () => {
      pending = null;
      try {
        if ((await clipboard.readText()) === text) await restore(snap);
        else log.info('Clipboard changed since paste, skipping restoration');
      } catch (err) {
        log.warn(`Clipboard restore check failed: ${err.message}`);
      }
    }, RESTORE_DELAY_MS);
    pending = { timer, snap };
  }
  return ok;
}

/**
 * Selected text of the focused app, via a clipboard round-trip: snapshot, clear, Ctrl+C, read, restore.
 * @returns {Promise<string>} '' when nothing is selected
 */
async function getSelectedText() {
  if (!(await waitForModifiersReleased(1500))) {
    win32.releaseModifiers(MODIFIER_VKS);
    await sleep(20);
  }
  const queued = takePending();
  const snap = queued ? queued.snap : await snapshot();
  clipboard.clear();
  win32.sendCopy();
  let text = '';
  const end = Date.now() + 450;
  while (Date.now() < end) {
    await sleep(30);
    text = await clipboard.readText();
    if (text) break;
  }
  await restore(snap);
  return text;
}

module.exports = { pasteText, pressKey, getSelectedText, waitForModifiersReleased, snapshot, restore };
