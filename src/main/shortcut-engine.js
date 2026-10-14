'use strict';
// Shortcut matcher - a port of Wispr Flow's "[Keyboard Service]" (webpack
// module 86862 in v1.6.1147):
//  * keeps a map of currently-held keys -> press timestamp
//  * ignores auto-repeat (a press for an already-held key only refreshes it)
//  * a binding fires when the held set EXACTLY equals its keys
//  * "shortcut upgrade": moving from a subset to a superset binding with the
//    same action keeps the action alive instead of re-firing it
//  * the action ends when any key of the active binding is released
//  * the cancel binding fires even while other keys are held
//  * stale keys (missed key-ups) are evicted by asking the OS
// It is pure (no Electron / native imports) so it can be unit tested.

const { EventEmitter } = require('node:events');

const STALE_AFTER_MS = 2000;

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const isSubset = (small, big) => small.every((k) => big.includes(k));

class ShortcutEngine extends EventEmitter {
  constructor({ now = Date.now } = {}) {
    super();
    this.now = now;
    this.pressed = new Map();
    this.bindings = [];
    this.active = null;
    this.recording = false;
  }

  /** @param {{action: string, keys: string[]}[]} bindings */
  setBindings(bindings) {
    this.bindings = bindings.filter((b) => b.keys && b.keys.length > 0);
    this.active = null;
  }

  pressedKeys() {
    return [...this.pressed.keys()];
  }

  setRecording(on) {
    this.recording = on;
    this.active = null;
  }

  handleKey(key, isPress) {
    if (!key) return;
    if (isPress) this.#press(key);
    else this.#release(key);
  }

  #press(key) {
    if (this.pressed.has(key)) {
      this.pressed.set(key, this.now());
      return;
    }
    this.pressed.set(key, this.now());
    const keys = this.pressedKeys();

    if (this.recording) {
      this.emit('recording', { keys, isRelease: false });
      return;
    }

    const cancel = this.bindings.find((b) => b.action === 'cancel');
    if (cancel && cancel.keys.includes(key) && isSubset(cancel.keys, keys) && !sameSet(cancel.keys, keys)) {
      this.emit('action', { action: 'cancel', phase: 'down', keys });
      return;
    }

    const match = this.bindings.find((b) => sameSet(b.keys, keys));
    if (match) {
      if (this.active && this.active.action === match.action && isSubset(this.active.keys, match.keys)) {
        this.active = match;
        return;
      }
      this.active = match.action === 'cancel' ? null : match;
      this.emit('action', { action: match.action, phase: 'down', keys });
      return;
    }

    if (this.active && isSubset(this.active.keys, keys)) {
      this.emit('chord', { keys, active: this.active.action });
    }
  }

  #release(key) {
    if (this.recording) {
      const keys = this.pressedKeys();
      this.pressed.delete(key);
      this.emit('recording', { keys, isRelease: true, remaining: this.pressedKeys() });
      return;
    }
    if (this.active && this.active.keys.includes(key)) {
      const { action } = this.active;
      this.active = null;
      this.pressed.delete(key);
      this.emit('action', { action, phase: 'up', keys: this.pressedKeys() });
      return;
    }
    this.pressed.delete(key);
  }

  /**
   * Drop keys whose key-up we missed (lock screen, UAC prompt, focus games...).
   * @param {(key: string) => boolean | undefined} isDown OS truth; undefined = unknown
   */
  sweepStale(isDown) {
    const now = this.now();
    for (const [key, at] of [...this.pressed]) {
      if (now - at < STALE_AFTER_MS) continue;
      if (isDown(key) === false) {
        this.emit('stale', { key });
        this.#release(key);
      }
    }
  }

  reset() {
    this.pressed.clear();
    this.active = null;
  }
}

module.exports = { ShortcutEngine, sameSet, isSubset, STALE_AFTER_MS };
