'use strict';
// The main window's icons: Fluent UI System Icons (https://github.com/microsoft/fluentui-system-icons), version
// 1.1.344 of @fluentui/svg-icons, copied in as paths so nothing is downloaded or loaded at run time. Regular icons,
// and filled ones for the current page; each is drawn in the text colour. The page fills <span data-icon="name">
// (and data-icon-filled for a second, filled one) when this script loads; scripts use Icons.svg(name).
// Pure apart from that (CommonJS for test/icons.test.js). Loaded before app.js.
//
// Fluent UI System Icons: MIT License, Copyright (c) 2020 Microsoft Corporation. Permission is hereby granted, free
// of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions: The above copyright notice and this
// permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS
// PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else {
    root.Icons = core;
    if (typeof document !== 'undefined') core.fill(document);
  }
})(typeof self !== 'undefined' ? self : this, () => {
  /* eslint-disable max-len */
  const ICONS = {
    'home': { viewBox: '0 0 20 20', d: 'M9 2.39a1.5 1.5 0 0 1 2 0l5.5 4.94c.32.28.5.69.5 1.12v7.05c0 .83-.67 1.5-1.5 1.5H13a1.5 1.5 0 0 1-1.5-1.5V12a.5.5 0 0 0-.5-.5H9a.5.5 0 0 0-.5.5v3.5c0 .83-.67 1.5-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5V8.45c0-.43.18-.84.5-1.12zm1.33.74a.5.5 0 0 0-.66 0l-5.5 4.94a.5.5 0 0 0-.17.38v7.05c0 .28.22.5.5.5H7a.5.5 0 0 0 .5-.5V12c0-.83.67-1.5 1.5-1.5h2c.83 0 1.5.67 1.5 1.5v3.5c0 .28.22.5.5.5h2.5a.5.5 0 0 0 .5-.5V8.45a.5.5 0 0 0-.17-.38z' }, // home_20_regular
    'home-filled': { viewBox: '0 0 20 20', d: 'M11 2.39a1.5 1.5 0 0 0-2 0L3.5 7.33c-.32.28-.5.69-.5 1.12v7.05c0 .83.67 1.5 1.5 1.5h2c.83 0 1.5-.67 1.5-1.5v-4c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5v4c0 .83.67 1.5 1.5 1.5h2c.83 0 1.5-.67 1.5-1.5V8.45c0-.43-.18-.84-.5-1.12z' }, // home_20_filled
    'keyboard': { viewBox: '0 0 20 20', d: 'M5 12.5c0-.28.22-.5.5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M11.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m3.75-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M5.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m2.25 1.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0m2.25.75A.75.75 0 1 0 10 9a.75.75 0 0 0 0 1.5m3.76-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M8.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5M2 5.5C2 4.67 2.67 4 3.5 4h13c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 2 13.5zM3.5 5a.5.5 0 0 0-.5.5v8c0 .28.22.5.5.5h13a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5z' }, // keyboard_20_regular
    'keyboard-filled': { viewBox: '0 0 20 20', d: 'M3.5 4C2.67 4 2 4.67 2 5.5v8c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-8c0-.83-.67-1.5-1.5-1.5zm2.75 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0m6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M5 12.5c0-.28.22-.5.5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M14.5 8a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5M7 10.5A.75.75 0 1 1 7 9a.75.75 0 0 1 0 1.5m3.75-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0m2.26.75A.75.75 0 1 1 13 9a.75.75 0 0 1 0 1.5M9.25 7.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0' }, // keyboard_20_filled
    'options': { viewBox: '0 0 20 20', d: 'M14.95 5a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h7.55a2.5 2.5 0 0 0 4.9 0h2.55a.5.5 0 0 0 0-1zM12.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m-2.55 7a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h2.55a2.5 2.5 0 0 0 4.9 0h7.55a.5.5 0 0 0 0-1zM7.5 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3' }, // options_20_regular
    'options-filled': { viewBox: '0 0 20 20', d: 'M9.95 14a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h2.55a2.5 2.5 0 0 0 4.9 0h7.55a.5.5 0 0 0 0-1zm5-9a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h7.55a2.5 2.5 0 0 0 4.9 0h2.55a.5.5 0 0 0 0-1z' }, // options_20_filled
    'book': { viewBox: '0 0 20 20', d: 'M4 4v12c0 1.1.9 2 2 2h9.5a.5.5 0 0 0 0-1H6a1 1 0 0 1-1-1h10a1 1 0 0 0 1-1V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m10-1a1 1 0 0 1 1 1v11H5V4a1 1 0 0 1 1-1zm-4 2c.2 0 .38.12.46.3l3 7a.5.5 0 0 1-.92.4l-.73-1.7H8.2l-.73 1.7a.5.5 0 0 1-.92-.4l3-7A.5.5 0 0 1 10 5m-1.38 5h2.76L10 6.77z' }, // book_letter_20_regular
    'book-filled': { viewBox: '0 0 20 20', d: 'M6 2a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9.5a.5.5 0 0 0 0-1H6a1 1 0 0 1-1-1h10a1 1 0 0 0 1-1V4a2 2 0 0 0-2-2zm4 3c.2 0 .38.12.46.3l3 7a.5.5 0 0 1-.92.4l-.73-1.7H8.2l-.73 1.7a.5.5 0 0 1-.92-.4l3-7A.5.5 0 0 1 10 5m-1.38 5h2.76L10 6.77z' }, // book_letter_20_filled
    'history': { viewBox: '0 0 20 20', d: 'M10 4a6 6 0 1 1-5.98 5.54.5.5 0 1 0-1-.08L3 10a7 7 0 1 0 2-4.9V3.5a.5.5 0 0 0-1 0v3c0 .28.22.5.5.5h3a.5.5 0 0 0 0-1H5.53c1.1-1.23 2.7-2 4.47-2m0 2.5a.5.5 0 0 0-1 0v4c0 .28.22.5.5.5h3a.5.5 0 0 0 0-1H10z' }, // history_20_regular
    'history-filled': { viewBox: '0 0 20 20', d: 'M10 4a6 6 0 1 1-6 5.78.75.75 0 1 0-1.5-.06V10A7.5 7.5 0 1 0 5 4.41V3.25a.75.75 0 0 0-1.5 0v3c0 .41.34.75.75.75h3a.75.75 0 0 0 0-1.5H6.03A6 6 0 0 1 10 4m.5 2.25a.75.75 0 0 0-1.5 0v4c0 .41.34.75.75.75h3a.75.75 0 0 0 0-1.5H10.5z' }, // history_20_filled
    'document': { viewBox: '0 0 20 20', d: 'M6 2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2m0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm7 3.5a.5.5 0 0 1-.41.5H7.5a.5.5 0 0 1-.09-1h5.09c.28 0 .5.22.5.5m0 3.5a.5.5 0 0 1-.41.5H7.5a.5.5 0 0 1-.09-1h5.09c.28 0 .5.22.5.5m0 3.5a.5.5 0 0 1-.41.5H7.5a.5.5 0 0 1-.09-1h5.09c.28 0 .5.22.5.5' }, // document_one_page_20_regular
    'document-filled': { viewBox: '0 0 20 20', d: 'M6 2a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm1.5 4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M7 13.5c0-.28.22-.5.5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m.5-4h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1' }, // document_one_page_20_filled
    'settings': { viewBox: '0 0 20 20', d: 'M1.91 7.38A8.5 8.5 0 0 1 3.7 4.3a.5.5 0 0 1 .54-.13l1.92.68a1 1 0 0 0 1.32-.76l.36-2a.5.5 0 0 1 .4-.4 9 9 0 0 1 3.55 0q.32.08.38.4l.37 2a1 1 0 0 0 1.32.76l1.92-.68a.5.5 0 0 1 .54.13 8.5 8.5 0 0 1 1.78 3.08q.08.31-.15.54l-1.56 1.32a1 1 0 0 0 0 1.52l1.56 1.32a.5.5 0 0 1 .15.54 8.5 8.5 0 0 1-1.78 3.08.5.5 0 0 1-.54.13l-1.92-.68a1 1 0 0 0-1.32.76l-.37 2a.5.5 0 0 1-.38.4 8.5 8.5 0 0 1-3.56 0 .5.5 0 0 1-.39-.4l-.36-2a1 1 0 0 0-1.32-.76l-1.92.68a.5.5 0 0 1-.54-.13 8.5 8.5 0 0 1-1.78-3.08.5.5 0 0 1 .15-.54l1.56-1.32a1 1 0 0 0 0-1.52L2.06 7.92a.5.5 0 0 1-.15-.54m1.06 0 1.3 1.1a2 2 0 0 1 0 3.04l-1.3 1.1q.45 1.19 1.25 2.16l1.6-.58a2 2 0 0 1 2.63 1.53l.3 1.67a8 8 0 0 0 2.5 0l.3-1.67a2 2 0 0 1 2.64-1.53l1.6.58a8 8 0 0 0 1.24-2.16l-1.3-1.1a2 2 0 0 1 0-3.04l1.3-1.1a8 8 0 0 0-1.25-2.16l-1.6.58a2 2 0 0 1-2.63-1.53l-.3-1.67a8 8 0 0 0-2.5 0l-.3 1.67A2 2 0 0 1 5.81 5.8l-1.6-.58a8 8 0 0 0-1.24 2.16M7.5 10a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0m1 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0' }, // settings_20_regular
    'settings-filled': { viewBox: '0 0 20 20', d: 'M1.91 7.38A8.5 8.5 0 0 1 3.7 4.3a.5.5 0 0 1 .54-.13l1.92.68a1 1 0 0 0 1.32-.76l.36-2a.5.5 0 0 1 .4-.4 9 9 0 0 1 3.55 0q.32.08.38.4l.37 2a1 1 0 0 0 1.32.76l1.92-.68a.5.5 0 0 1 .54.13 8.5 8.5 0 0 1 1.78 3.08q.08.31-.15.54l-1.56 1.32a1 1 0 0 0 0 1.52l1.56 1.32a.5.5 0 0 1 .15.54 8.5 8.5 0 0 1-1.78 3.08.5.5 0 0 1-.54.13l-1.92-.68a1 1 0 0 0-1.32.76l-.37 2a.5.5 0 0 1-.38.4 8.5 8.5 0 0 1-3.56 0 .5.5 0 0 1-.39-.4l-.36-2a1 1 0 0 0-1.32-.76l-1.92.68a.5.5 0 0 1-.54-.13 8.5 8.5 0 0 1-1.78-3.08.5.5 0 0 1 .15-.54l1.56-1.32a1 1 0 0 0 0-1.52L2.06 7.92a.5.5 0 0 1-.15-.54M8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0' }, // settings_20_filled
    'info': { viewBox: '0 0 20 20', d: 'M10.5 8.91a.5.5 0 0 0-1 .09v4.6a.5.5 0 0 0 1-.1V8.91m.3-2.16a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0M3 10a7 7 0 1 1 14 0 7 7 0 0 1-14 0' }, // info_20_regular
    'info-filled': { viewBox: '0 0 20 20', d: 'M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0M9.5 8.91a.5.5 0 0 1 1 0v4.69a.5.5 0 0 1-1 0V8.9m-.25-2.16a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0' }, // info_20_filled
    'copy': { viewBox: '0 0 20 20', d: 'M7 7H5.5C4.67 7 4 7.67 4 8.5v6c0 .83.67 1.5 1.5 1.5h4c.65 0 1.2-.42 1.41-1h1.04a2.5 2.5 0 0 1-2.45 2h-4A2.5 2.5 0 0 1 3 14.5v-6A2.5 2.5 0 0 1 5.5 6H7zm7.5-4A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 8 11.5v-6A2.5 2.5 0 0 1 10.5 3zm-4 1C9.67 4 9 4.67 9 5.5v6c0 .83.67 1.5 1.5 1.5h4c.83 0 1.5-.67 1.5-1.5v-6c0-.83-.67-1.5-1.5-1.5z' }, // copy_20_regular
    'delete': { viewBox: '0 0 20 20', d: 'M8.5 4h3a1.5 1.5 0 0 0-3 0m-1 0a2.5 2.5 0 0 1 5 0h5a.5.5 0 0 1 0 1h-1.05l-1.2 10.34A3 3 0 0 1 12.27 18H7.73a3 3 0 0 1-2.98-2.66L3.55 5H2.5a.5.5 0 0 1 0-1zM5.74 15.23A2 2 0 0 0 7.73 17h4.54a2 2 0 0 0 1.99-1.77L15.44 5H4.56zM8.5 7.5c.28 0 .5.22.5.5v6a.5.5 0 0 1-1 0V8c0-.28.22-.5.5-.5M12 8a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z' }, // delete_20_regular
    'dismiss': { viewBox: '0 0 20 20', d: 'm4.09 4.22.06-.07a.5.5 0 0 1 .63-.06l.07.06L10 9.29l5.15-5.14a.5.5 0 0 1 .63-.06l.07.06c.18.17.2.44.06.63l-.06.07L10.71 10l5.14 5.15c.18.17.2.44.06.63l-.06.07a.5.5 0 0 1-.63.06l-.07-.06L10 10.71l-5.15 5.14a.5.5 0 0 1-.63.06l-.07-.06a.5.5 0 0 1-.06-.63l.06-.07L9.29 10 4.15 4.85a.5.5 0 0 1-.06-.63l.06-.07z' }, // dismiss_20_regular
    'dismiss-small': { viewBox: '0 0 16 16', d: 'm2.59 2.72.06-.07a.5.5 0 0 1 .63-.06l.07.06L8 7.29l4.65-4.64a.5.5 0 0 1 .7.7L8.71 8l4.64 4.65c.18.17.2.44.06.63l-.06.07a.5.5 0 0 1-.63.06l-.07-.06L8 8.71l-4.65 4.64a.5.5 0 0 1-.7-.7L7.29 8 2.65 3.35a.5.5 0 0 1-.06-.63l.06-.07z' }, // dismiss_16_regular
    'play': { viewBox: '0 0 20 20', d: 'M17.22 8.69a1.5 1.5 0 0 1 0 2.62l-10 5.5A1.5 1.5 0 0 1 5 15.5v-11A1.5 1.5 0 0 1 7.22 3.2zm-.48 1.75a.5.5 0 0 0 0-.88l-10-5.5A.5.5 0 0 0 6 4.5v11c0 .38.4.62.74.44z' }, // play_20_regular
    'stop': { viewBox: '0 0 20 20', d: 'M15.5 4c.28 0 .5.22.5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11c0-.28.22-.5.5-.5zm-11-1C3.67 3 3 3.67 3 4.5v11c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5v-11c0-.83-.67-1.5-1.5-1.5z' }, // stop_20_regular
    'retry': { viewBox: '0 0 20 20', d: 'M4 10a6 6 0 0 1 10.47-4H12.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-1 0v1.6a7 7 0 1 0 1.98 4.36.5.5 0 1 0-1 .08L16 10a6 6 0 0 1-12 0' }, // arrow_clockwise_20_regular
    'upload': { viewBox: '0 0 24 24', d: 'M18.25 3.51a.75.75 0 1 0 0-1.5h-13a.75.75 0 1 0 0 1.5zM11.65 22h.1c.38 0 .7-.28.74-.64l.01-.1V7.56l3.72 3.72c.27.27.68.29.98.07l.08-.07a.75.75 0 0 0 .07-.98l-.07-.08-5-5a.75.75 0 0 0-.97-.07l-.09.07-5 5a.75.75 0 0 0 .98 1.13l.08-.07L11 7.58v13.67c0 .38.28.7.65.75' }, // arrow_upload_24_regular
    'keyboard-large': { viewBox: '0 0 24 24', d: 'M19.75 5C20.99 5 22 6 22 7.25v9.5C22 18 20.99 19 19.75 19H4.25C3.01 19 2 18 2 16.75v-9.5C2 6.01 3 5 4.25 5zm0 1.5H4.25a.75.75 0 0 0-.75.75v9.5c0 .42.34.75.75.75h15.5c.41 0 .75-.33.75-.75v-9.5a.75.75 0 0 0-.75-.75m-13 8h10.5a.75.75 0 0 1 .1 1.5H6.75a.75.75 0 0 1-.1-1.5zh10.5zM16.5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2m6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2M6 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2m3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2m3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2m3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2m3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2' }, // keyboard_24_regular
    'severity-info': { viewBox: '0 0 16 16', d: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 5.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m.5 1.25a.5.5 0 0 0-1 0v3a.5.5 0 0 0 1 0z' }, // info_16_filled
    'severity-warning': { viewBox: '0 0 16 16', d: 'M5.82 2.28a2.5 2.5 0 0 1 4.36 0l4.5 8A2.5 2.5 0 0 1 12.5 14h-9a2.5 2.5 0 0 1-2.18-3.72zM8 9.5A.75.75 0 1 0 8 11a.75.75 0 0 0 0-1.5M8 5a.5.5 0 0 0-.5.5V8a.5.5 0 0 0 1 0V5.5A.5.5 0 0 0 8 5' }, // warning_16_filled
    'severity-error': { viewBox: '0 0 16 16', d: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 9a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5m0-5.5a.5.5 0 0 0-.5.5v3.59a.5.5 0 0 0 1-.09V4.91A.5.5 0 0 0 8 4.5' }, // error_circle_16_filled
    'severity-success': { viewBox: '0 0 16 16', d: 'M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8m9.85-1.15a.5.5 0 0 0-.7-.7l-2.9 2.9-1.4-1.4a.5.5 0 1 0-.7.7L6.9 10.1c.2.2.5.2.7 0z' }, // checkmark_circle_16_filled
    'chevron-left': { viewBox: '0 0 16 16', d: 'M10.35 3.15c.2.2.2.5 0 .7L6.21 8l4.14 4.15a.5.5 0 0 1-.7.7l-4.5-4.5a.5.5 0 0 1 0-.7l4.5-4.5c.2-.2.5-.2.7 0' }, // chevron_left_16_regular
    'chevron-right': { viewBox: '0 0 16 16', d: 'M5.65 3.15a.5.5 0 0 0 0 .7L9.79 8l-4.14 4.15a.5.5 0 0 0 .7.7l4.5-4.5a.5.5 0 0 0 0-.7l-4.5-4.5a.5.5 0 0 0-.7 0' }, // chevron_right_16_regular
    'check': { viewBox: '0 0 16 16', d: 'M13.86 3.66a.5.5 0 0 1-.02.7l-7.93 7.48a.6.6 0 0 1-.84-.02L2.4 9.1a.5.5 0 0 1 .72-.7l2.4 2.44 7.65-7.2a.5.5 0 0 1 .7.02' }, // checkmark_16_regular
  };

  /**
   * @param {string} name a key of ICONS
   * @param {string} [extra] another class, such as "filled"
   * @returns {string} the <svg> markup: decorative, so hidden from screen readers (the button has the name)
   */
  function svg(name, extra = '') {
    const icon = ICONS[name];
    if (!icon) throw new Error(`unknown icon: ${name}`);
    return `<svg class="icon${extra ? ` ${extra}` : ''}" viewBox="${icon.viewBox}" aria-hidden="true" focusable="false"><path d="${icon.d}"/></svg>`;
  }

  /** Puts the icons into every <span data-icon> under root (data-icon-filled adds the filled one beside it). */
  function fill(root) {
    root.querySelectorAll('[data-icon]').forEach((span) => {
      span.innerHTML = svg(span.dataset.icon) + (span.hasAttribute('data-icon-filled') ? svg(`${span.dataset.icon}-filled`, 'filled') : '');
    });
  }

  return { ICONS, svg, fill };
});
