'use strict';
// How a dictation reaches the focused window. Pure, so it can be unit tested.
//
// Windows drops synthetic input sent into a window of a higher integrity level
// (an app "Run as administrator" while we run normally), so Ctrl+V would do
// nothing there. Then the text is only put on the clipboard and left there
// for the user to paste.
//
// Our clipboard content carries the formats that keep it out of Windows
// clipboard history (Win+V), the cloud clipboard and clipboard monitors.
// Electron writes raw Windows formats through the
// `electron application/osclipboard;format="<name>"` type.

const EXCLUSION_FORMATS = ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'ExcludeClipboardContentFromMonitorProcessing'];

const rawFormat = (name) => `electron application/osclipboard;format="${name}"`;

/**
 * @param {{ourLevel?: number|null, targetLevel?: number|null}} levels integrity levels, null = unknown
 * @returns {{mode: 'paste'|'copy-only', restoreClipboard: boolean}}
 */
function planPaste({ ourLevel = null, targetLevel = null } = {}) {
  const elevatedTarget = typeof ourLevel === 'number' && typeof targetLevel === 'number' && targetLevel > ourLevel;
  return elevatedTarget ? { mode: 'copy-only', restoreClipboard: false } : { mode: 'paste', restoreClipboard: true };
}

/** @returns {Record<string, Blob|string>} entries for `new ClipboardItem(...)`: the text plus DWORD 0 for each exclusion format */
function clipboardFormatsFor(text) {
  const formats = { 'text/plain': text };
  for (const name of EXCLUSION_FORMATS) formats[rawFormat(name)] = new Blob([new Uint8Array(4)]);
  return formats;
}

module.exports = { planPaste, clipboardFormatsFor, EXCLUSION_FORMATS };
