'use strict';
// ContentDialog: the one way the main window asks before something can't be undone (clear history, reset
// shortcuts, delete a mode, a model or all data, a history setting that deletes transcripts). A native modal
// <dialog>: the page behind can't be reached, Tab stays inside, Esc is Cancel, and focus goes back to the button
// that opened it. Buttons in Windows order, [Delete] [Cancel] on the right; a dangerous one starts on Cancel.
// What it shows (dialogSpec) and how it ends (answer) are pure and tested in test/dialog.test.js; in the window
// it is the global Dialog. Loaded before app.js.

(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.Dialog = core;
})(typeof self !== 'undefined' ? self : this, () => {
  const TONES = ['primary', 'danger'];
  const lines = (v) => [v].flat().filter((x) => x != null && x !== '').map(String);

  /**
   * @param {{title: string, body?: string|string[], list?: string[], note?: string, confirm: string, cancel: string,
   *   tone?: 'primary'|'danger'}} o
   */
  function dialogSpec({ title, body = [], list = [], note = '', confirm, cancel, tone = 'primary' }) {
    if (!title || !confirm || !cancel) throw new TypeError('a dialog needs a title, a confirm label and a cancel label');
    if (!TONES.includes(tone)) throw new TypeError(`unknown dialog tone: ${tone}`);
    const danger = tone === 'danger';
    return {
      title: String(title),
      body: lines(body),
      list: lines(list),
      note: note ? String(note) : '',
      danger,
      buttons: [
        { id: 'confirm', label: String(confirm), className: danger ? 'btn danger primary' : 'btn primary' },
        { id: 'cancel', label: String(cancel), className: 'btn' },
      ],
      initialFocus: danger ? 'cancel' : 'confirm',
    };
  }

  /** How the <dialog> closed (its returnValue): only the confirm button says yes. */
  const answer = (how) => how === 'confirm';

  let count = 0;

  /**
   * Shows the dialog and waits for the answer.
   * @returns {Promise<boolean>} true for the confirm button; false for Cancel and Esc
   */
  function confirmDialog(o) {
    const spec = dialogSpec(o);
    const doc = document;
    const trigger = doc.activeElement;
    const id = `dialog-${++count}`;
    const node = (tag, attrs = {}, ...children) => {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      n.append(...children);
      return n;
    };
    const buttons = spec.buttons.map((b) => node('button', { type: 'submit', value: b.id, class: b.className, 'data-dialog': b.id }, b.label));
    const content = [
      ...spec.body.map((p) => node('p', {}, p)),
      ...(spec.list.length ? [node('ul', {}, ...spec.list.map((li) => node('li', {}, li)))] : []),
      ...(spec.note ? [node('p', {}, spec.note)] : []),
    ];
    const dialog = node('dialog', { class: `dialog${spec.danger ? ' danger' : ''}`, 'aria-labelledby': `${id}-title`, ...(content.length ? { 'aria-describedby': `${id}-body` } : {}) },
      node('form', { method: 'dialog' },
        node('h2', { id: `${id}-title` }, spec.title),
        ...(content.length ? [node('div', { id: `${id}-body`, class: 'dialog-body' }, ...content)] : []),
        node('div', { class: 'dialog-buttons' }, ...buttons)));
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        dialog.remove();
        if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
        resolve(answer(dialog.returnValue));
      }, { once: true });
      doc.body.append(dialog);
      dialog.showModal();
      buttons[spec.buttons.findIndex((b) => b.id === spec.initialFocus)].focus();
    });
  }

  return { dialogSpec, answer, confirmDialog };
});
