'use strict';
// Shortcut matcher:
//  * keeps a map of currently-held keys -> press timestamp
//  * ignores auto-repeat (a press for an already-held key only refreshes it)
//  * a binding fires when the held set EXACTLY equals its keys
//  * an action may have several bindings; every event names the one that matched
//  * "shortcut upgrade": moving from a subset to a superset binding with the
//    same action and behaviour keeps the action alive instead of re-firing it
//    (a superset with another behaviour - Ctrl+Win -> Ctrl+Win+Space - fires)
//  * the action ends when any key of the active binding is released
//  * the cancel binding fires even while other keys are held
//  * stale keys (missed key-ups) are evicted by asking the OS
// Pauli Speaks adds a second trigger kind: double-tapping a single key
// (`trigger: 'doubleTap'`). A tap is a press and release under TAP_MAX_MS with
// no other key involved; the second tap must end within DOUBLE_TAP_MS of the first.
// It is pure (no Electron / native imports) so it can be unit tested.

const { EventEmitter } = require('node:events');

const STALE_AFTER_MS = 2000;
const TAP_MAX_MS = 250;
const DOUBLE_TAP_MS = 400;

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const isSubset = (small, big) => small.every((k) => big.includes(k));

class ShortcutEngine extends EventEmitter {
  constructor({ now = Date.now } = {}) {
    super();
    this.now = now;
    this.pressed = new Map();
    this.chords = [];
    this.doubleTaps = [];
    this.active = null;
    this.recording = false;
    this.tap = null; // { key, at, clean } - the key that may become a tap
    this.lastTap = null; // { key, at } - the first tap of a possible pair
  }

  /** @param {{id?: string, action: string, keys: string[], behaviour?: string, trigger?: string}[]} bindings */
  setBindings(bindings) {
    const usable = bindings.filter((b) => b.keys && b.keys.length > 0);
    this.chords = usable.filter((b) => b.trigger !== 'doubleTap');
    this.doubleTaps = usable.filter((b) => b.trigger === 'doubleTap' && b.keys.length === 1);
    this.active = null;
  }

  pressedKeys() {
    return [...this.pressed.keys()];
  }

  setRecording(on) {
    this.recording = on;
    this.active = null;
    this.tap = null;
    this.lastTap = null;
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
    this.#trackTapPress(key, keys);

    if (this.recording) {
      this.emit('recording', { keys, isRelease: false });
      return;
    }

    const cancel = this.chords.find((b) => b.action === 'cancel' && b.keys.includes(key));
    if (cancel && isSubset(cancel.keys, keys) && !sameSet(cancel.keys, keys)) {
      this.emit('action', { action: 'cancel', phase: 'down', keys, binding: cancel });
      return;
    }

    const match = this.chords.find((b) => sameSet(b.keys, keys));
    if (match) {
      const a = this.active;
      if (a && a.action === match.action && a.behaviour === match.behaviour && isSubset(a.keys, match.keys)) {
        this.active = match;
        return;
      }
      this.active = match.action === 'cancel' ? null : match;
      this.emit('action', { action: match.action, phase: 'down', keys, binding: match });
      return;
    }

    if (this.active && isSubset(this.active.keys, keys)) {
      this.emit('chord', { keys, active: this.active.action });
    }
  }

  #release(key) {
    const doubleTap = this.#trackTapRelease(key);
    if (this.recording) {
      const keys = this.pressedKeys();
      this.pressed.delete(key);
      this.emit('recording', { keys, isRelease: true, remaining: this.pressedKeys(), doubleTap });
      return;
    }
    if (this.active && this.active.keys.includes(key)) {
      const binding = this.active;
      this.active = null;
      this.pressed.delete(key);
      this.emit('action', { action: binding.action, phase: 'up', keys: this.pressedKeys(), binding });
    } else {
      this.pressed.delete(key);
    }
    if (doubleTap) {
      const binding = this.doubleTaps.find((b) => b.keys[0] === key);
      if (binding) this.emit('action', { action: binding.action, phase: 'down', keys: [key], binding });
    }
  }

  // ----- double-tap detection

  #trackTapPress(key, keys) {
    if (this.lastTap && this.lastTap.key !== key) this.lastTap = null;
    if (this.tap) this.tap.clean = false; // a second key while the first is held
    this.tap = keys.length === 1 ? { key, at: this.now(), clean: true } : null;
  }

  /** @returns {boolean} true when this release completes a double-tap */
  #trackTapRelease(key) {
    const t = this.tap;
    this.tap = null;
    const now = this.now();
    if (!t || t.key !== key || !t.clean || now - t.at >= TAP_MAX_MS) {
      this.lastTap = null;
      return false;
    }
    if (this.lastTap && this.lastTap.key === key && now - this.lastTap.at < DOUBLE_TAP_MS) {
      this.lastTap = null;
      return true;
    }
    this.lastTap = { key, at: now };
    return false;
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
    this.tap = null;
    this.lastTap = null;
  }
}

module.exports = { ShortcutEngine, sameSet, isSubset, STALE_AFTER_MS, TAP_MAX_MS, DOUBLE_TAP_MS };
