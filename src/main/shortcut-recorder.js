'use strict';
// The shortcut recorder behind "+ Add" / "Change" on the Shortcuts page.
// The global hook does the listening (engine recording mode), so the Win key,
// mouse side buttons and pedals record exactly as they will later match:
//   * keyboard shortcuts save when every key is released; mouse buttons on press
//   * Esc alone cancels (except when recording Cancel), Backspace alone clears
//   * a single modifier waits DOUBLE_TAP_MS for a second tap -> double-tap binding
//   * hard errors (shortcut-rules) are shown and recording goes on
//   * common app shortcuts wait for "Use anyway" (confirm) or "Try another" (retry)
// Pure apart from the callbacks, so it can be unit tested.

const { validateShortcut, shortcutWarning, newBindingId, isAction, isTalkAction } = require('./shortcut-rules');
const { DOUBLE_TAP_MS } = require('./shortcut-engine');
const { formatShortcut, sortKeys, MODIFIERS, MOUSE_NAMES } = require('./keys');

class ShortcutRecorder {
  /**
   * @param {object} deps
   * @param {() => object[]} deps.getBindings the saved bindings
   * @param {(update: object) => void} deps.onUpdate progress for the window ({keys} | {error} | {warning} | {cleared} | {done})
   * @param {(bindings: object[], binding: object) => void} deps.onSave the new binding list to store
   * @param {() => void} [deps.onEnd] recording finished (saved, cancelled or stopped)
   */
  constructor({ getBindings, onUpdate, onSave, onEnd = () => {}, timers = { setTimeout, clearTimeout } }) {
    Object.assign(this, { getBindings, onUpdate, onSave, onEnd, timers });
    this.state = null; // { action, replaceId, max, pending, tapTimer }
  }

  get active() {
    return !!this.state;
  }

  start({ action, replaceId = null } = {}) {
    if (!isAction(action)) return false;
    this.#end(false);
    this.state = { action, replaceId, max: [], pending: null, tapTimer: null };
    return true;
  }

  stop() {
    this.#end(true);
  }

  /** @param {{keys: string[], isRelease: boolean, remaining?: string[], doubleTap?: boolean}} e engine 'recording' event */
  handle(e) {
    const r = this.state;
    if (!r || r.pending) return; // nothing to do, or waiting for "Use anyway" / "Try another"
    if (!e.isRelease) {
      this.timers.clearTimeout(r.tapTimer);
      if (e.keys.length >= r.max.length) r.max = e.keys;
      this.#update({ keys: e.keys });
      if (e.keys.some((k) => MOUSE_NAMES.has(k))) this.#finish(e.keys);
      return;
    }
    if (e.doubleTap) {
      this.timers.clearTimeout(r.tapTimer);
      return this.#finish(e.keys, 'doubleTap');
    }
    if (e.remaining && e.remaining.length > 0) return;
    const keys = r.max;
    r.max = [];
    if (keys.length === 1 && keys[0] === 'Escape' && r.action !== 'cancel') {
      this.#end(true);
      return this.onUpdate({ action: r.action, done: true, cancelled: true });
    }
    if (keys.length === 1 && keys[0] === 'Backspace') return this.#update({ keys: [], cleared: true });
    if (keys.length === 1 && MODIFIERS.has(keys[0])) {
      r.tapTimer = this.timers.setTimeout(() => this.state === r && this.#finish(keys), DOUBLE_TAP_MS);
      return;
    }
    this.#finish(keys);
  }

  /** "Use anyway" after a warning. */
  confirm() {
    if (this.state && this.state.pending) this.#save(this.state.pending);
  }

  /** "Try another" after a warning. */
  retry() {
    if (!this.state) return;
    this.state.pending = null;
    this.state.max = [];
    this.#update({ keys: [], cleared: true });
  }

  #update(payload) {
    this.onUpdate({ action: this.state.action, ...payload });
  }

  #finish(keys, trigger) {
    const r = this.state;
    const bindings = this.getBindings();
    let error = validateShortcut(keys, r.action, bindings, { trigger, ignoreId: r.replaceId });
    if (error) {
      if (!trigger && keys.length === 1 && MODIFIERS.has(keys[0]) && !/already|Windows|up to/.test(error)) {
        error = `${formatShortcut(keys)} alone isn't a shortcut. Add a key - or tap it twice quickly for a double-tap.`;
      }
      r.max = [];
      return this.#update({ error, keys });
    }
    const old = r.replaceId && bindings.find((b) => b.id === r.replaceId);
    const binding = { id: old ? old.id : newBindingId(r.action, bindings), action: r.action, keys: sortKeys(keys) };
    if (trigger) binding.trigger = trigger;
    if (isTalkAction(r.action)) binding.behaviour = trigger === 'doubleTap' ? 'toggle' : (old && old.behaviour) || 'both';
    if (old && old.mode) binding.mode = old.mode;
    const warning = shortcutWarning(keys);
    if (warning) {
      r.pending = binding;
      return this.#update({ warning, keys });
    }
    this.#save(binding);
  }

  #save(binding) {
    const { action, replaceId } = this.state;
    const bindings = this.getBindings();
    const next = replaceId ? bindings.map((b) => (b.id === replaceId ? binding : b)) : [...bindings, binding];
    this.#end(true);
    this.onSave(next, binding);
    this.onUpdate({ action, done: true, keys: binding.keys, binding });
  }

  #end(notify) {
    if (!this.state) return;
    this.timers.clearTimeout(this.state.tapTimer);
    this.state = null;
    if (notify) this.onEnd();
  }
}

module.exports = { ShortcutRecorder };
