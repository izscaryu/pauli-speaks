'use strict';
// Push-to-talk state machine. Timings: 500 ms tap / double-tap window,
// 20 minutes maximum per dictation.
//
//   PTT down  idle                       -> start (hold mode)
//   PTT down  listening, < 500ms, !lock  -> lock (double-tap = hands-free)
//   PTT down  listening, locked          -> stop + transcribe
//   PTT up    listening, !lock, >= 500ms -> stop + transcribe
//   PTT up    listening, !lock, < 500ms  -> wait 500ms for a 2nd tap, else dismiss
//   Hands-free down idle                 -> start locked
//   Hands-free down while holding PTT    -> convert to locked
//   Hands-free down locked               -> stop (or dismiss if < 500ms)
//   Cancel                               -> dismiss (main keeps the audio 4 s for Undo)
//   process(run) idle                    -> processing kept audio (Retry / Undo), then idle
//   Other chord within 1s of PTT start   -> dismiss (user meant another shortcut)
//   Translate down                       -> like PTT, but the session is translated
//                                           (adding it to a held PTT upgrades the session)
//
// Every shortcut carries its own behaviour, so the same rules are driven by
// talkDown/talkUp({ behaviour, kind }):
//   'both'   = PTT above (hold, or double-tap to lock)
//   'toggle' = hands-free above (press to start, press again to finish)
//   'hold'   = hold only: release stops, a quick tap is dropped at once
// kind 'translate' / 'command' starts (or upgrades a session to) that mode.

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

  /** Adding translate / command to a running session switches it to that mode. @returns {boolean} upgraded */
  #upgrade(kind) {
    if (kind === 'translate' && !this.translate && !this.command) {
      this.translate = true;
      return true;
    }
    if (kind === 'command' && !this.command) {
      this.command = true;
      this.translate = false;
      return true;
    }
    return false;
  }

  /**
   * A talk shortcut went down.
   * @param {{behaviour?: 'hold'|'toggle'|'both', kind?: 'dictate'|'translate'|'command'}} opts
   */
  talkDown({ behaviour = 'both', kind = 'dictate' } = {}) {
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(behaviour === 'toggle', kind === 'translate', kind === 'command');
    if (this.#upgrade(kind)) {
      if (behaviour === 'toggle' && !this.locked) return this.#lock();
      return this.#set('listening');
    }
    const elapsed = this.now() - this.startTime;
    if (behaviour === 'toggle') {
      if (!this.locked) return this.#lock();
      if (elapsed < DEBOUNCE_MS) return this.dismiss('double-press');
      return this.stop('hands-free');
    }
    if (behaviour === 'hold') {
      if (this.locked) return this.stop('hold');
      return;
    }
    if (!this.locked && elapsed < DEBOUNCE_MS) return this.#lock();
    if (this.locked) return this.stop('ptt');
  }

  /** A talk shortcut was released. Toggle shortcuts ignore their release. */
  talkUp({ behaviour = 'both' } = {}) {
    if (behaviour === 'toggle' || !this.isListening || this.locked) return;
    const elapsed = this.now() - this.startTime;
    if (elapsed >= DEBOUNCE_MS) return this.stop('release');
    if (behaviour === 'hold') return this.dismiss('tap');
    if (this.tapTimer) this.timers.clearTimeout(this.tapTimer);
    this.tapTimer = this.timers.setTimeout(() => {
      this.tapTimer = null;
      if (this.isListening && !this.locked) this.dismiss('tap');
    }, DEBOUNCE_MS);
  }

  pttDown() {
    return this.talkDown({ behaviour: 'both' });
  }

  translateDown() {
    return this.talkDown({ behaviour: 'both', kind: 'translate' });
  }

  /** Command mode: the speech is an instruction for the selected text (Ctrl+Win+Alt by default). */
  commandDown() {
    return this.talkDown({ behaviour: 'both', kind: 'command' });
  }

  pttUp() {
    return this.talkUp({ behaviour: 'both' });
  }

  handsFreeDown() {
    return this.talkDown({ behaviour: 'toggle' });
  }

  /** Toggle used by the overlay pill / tray menu / deep links. */
  toggle() {
    if (this.status === 'idle') return this.#begin(true);
    if (this.isListening) return this.stop('toggle');
  }

  /** Deep link / command-line "start": a hands-free session; a held one is locked, a running one is left alone. */
  start() {
    if (this.status === 'idle') return this.#begin(true);
    if (this.isListening && !this.locked) return this.#lock();
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

  /**
   * Retry / Undo: transcribe audio kept from an earlier dictation, like a stop does, in the
   * mode it was recorded in. Only from idle; Cancel works on it as on any processing.
   * @param {() => Promise<void>} run
   * @param {{translate?: boolean, command?: boolean}} [mode]
   * @returns {Promise<boolean>} false when busy (nothing ran)
   */
  async process(run, { translate = false, command = false } = {}) {
    if (this.status !== 'idle') {
      this.#busy();
      return false;
    }
    this.translate = !!translate && !command;
    this.command = !!command;
    this.cancelled = false;
    this.#set('processing');
    try {
      await run();
    } finally {
      this.locked = false;
      this.#set('idle');
    }
    return true;
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
