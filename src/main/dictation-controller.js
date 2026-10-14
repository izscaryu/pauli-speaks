'use strict';
// Push-to-talk state machine - a port of Wispr Flow's dictation handlers
// (webpack module 63205: `je` = PTT down, `Ge` = PTT up, `Ye` = hands-free,
// `Ze` = dismiss, `Xe` = tap timeout) with its constants from module 59725:
//   DICTATION_DEBOUNCE_DELAY = 500 ms, DICTATION_DURATION_TIMEOUT = 20 min.
//
//   PTT down  idle                       -> start (hold mode)
//   PTT down  listening, < 500ms, !lock  -> lock (double-tap = hands-free)
//   PTT down  listening, locked          -> stop + transcribe
//   PTT up    listening, !lock, >= 500ms -> stop + transcribe
//   PTT up    listening, !lock, < 500ms  -> wait 500ms for a 2nd tap, else dismiss
//   Hands-free down idle                 -> start locked
//   Hands-free down while holding PTT    -> convert to locked
//   Hands-free down locked               -> stop (or dismiss if < 500ms)
//   Cancel                               -> dismiss, discard audio
//   Other chord within 1s of PTT start   -> dismiss (user meant another shortcut)
//   Translate down                       -> like PTT, but the session is translated
//                                           (adding it to a held PTT upgrades the session)

const { EventEmitter } = require('node:events');

const DEBOUNCE_MS = 500;
const OTHER_SHORTCUT_WINDOW_MS = 1000;
const MAX_DURATION_MS = 20 * 60 * 1000;

class DictationController extends EventEmitter {
  /**
   * @param {object} deps
   * @param {() => void} deps.start          begin capturing audio
   * @param {() => Promise<void>} deps.finish stop capturing, transcribe, paste
   * @param {(reason: string) => void} deps.dismiss stop capturing, discard
   */
  constructor(deps, { now = Date.now, timers = { setTimeout, clearTimeout } } = {}) {
    super();
    this.deps = deps;
    this.now = now;
    this.timers = timers;
    this.status = 'idle';
    this.locked = false;
    this.translate = false;
    this.command = false;
    this.startTime = 0;
    this.tapTimer = null;
    this.maxTimer = null;
  }

  get isListening() {
    return this.status === 'listening';
  }

  #set(status) {
    this.status = status;
    this.emit('status', { status, locked: this.locked, translate: this.translate, command: this.command });
  }

  #clearTimers() {
    if (this.tapTimer) this.timers.clearTimeout(this.tapTimer);
    if (this.maxTimer) this.timers.clearTimeout(this.maxTimer);
    this.tapTimer = null;
    this.maxTimer = null;
  }

  #begin(locked, translate = false, command = false) {
    this.locked = locked;
    this.translate = translate;
    this.command = command;
    this.startTime = this.now();
    this.maxTimer = this.timers.setTimeout(() => this.stop('max-duration'), MAX_DURATION_MS);
    this.#set('listening');
    this.deps.start();
  }

  #lock() {
    this.locked = true;
    if (this.tapTimer) this.timers.clearTimeout(this.tapTimer);
    this.tapTimer = null;
    this.#set('listening');
  }

  #busy() {
    this.emit('busy');
  }

  pttDown() {
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(false);
    const elapsed = this.now() - this.startTime;
    if (!this.locked && elapsed < DEBOUNCE_MS) return this.#lock();
    if (this.locked) return this.stop('ptt');
  }

  translateDown() {
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(false, true);
    if (!this.translate && !this.command) {
      this.translate = true;
      return this.#set('listening');
    }
    return this.pttDown();
  }

  /** Command mode: the speech is an instruction for the selected text (Wispr's Ctrl+Win+Alt "Lens"). */
  commandDown() {
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(false, false, true);
    if (!this.command) {
      this.command = true;
      this.translate = false;
      return this.#set('listening');
    }
    return this.pttDown();
  }

  pttUp() {
    if (!this.isListening || this.locked) return;
    const elapsed = this.now() - this.startTime;
    if (elapsed >= DEBOUNCE_MS) return this.stop('release');
    if (this.tapTimer) this.timers.clearTimeout(this.tapTimer);
    this.tapTimer = this.timers.setTimeout(() => {
      this.tapTimer = null;
      if (this.isListening && !this.locked) this.dismiss('tap');
    }, DEBOUNCE_MS);
  }

  handsFreeDown() {
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(true);
    if (!this.locked) return this.#lock();
    if (this.now() - this.startTime < DEBOUNCE_MS) return this.dismiss('double-press');
    return this.stop('hands-free');
  }

  /** Toggle used by the overlay pill / tray menu. */
  toggle() {
    if (this.status === 'idle') return this.#begin(true);
    if (this.isListening) return this.stop('toggle');
  }

  otherChord() {
    if (this.isListening && !this.locked && this.now() - this.startTime < OTHER_SHORTCUT_WINDOW_MS) {
      this.dismiss('other-shortcut');
    }
  }

  cancel() {
    if (this.isListening) return this.dismiss('cancel');
    if (this.status === 'processing') {
      this.cancelled = true;
      this.emit('cancel-processing');
    }
  }

  dismiss(reason) {
    if (!this.isListening) return;
    this.#clearTimers();
    this.locked = false;
    this.#set('idle');
    this.deps.dismiss(reason);
  }

  async stop(reason) {
    if (!this.isListening) return;
    this.#clearTimers();
    this.cancelled = false;
    this.#set('processing');
    try {
      await this.deps.finish(reason);
    } finally {
      this.locked = false;
      this.#set('idle');
    }
  }
}

module.exports = { DictationController, DEBOUNCE_MS, MAX_DURATION_MS, OTHER_SHORTCUT_WINDOW_MS };
