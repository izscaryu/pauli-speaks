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
//   Shortcut for another mode down       -> like PTT; while one is held it switches the running
//                                           dictation to that mode (e.g. Translate to English)
//
// Every shortcut carries its own behaviour, so the same rules are driven by
// talkDown/talkUp({ behaviour, kind }):
//   'both'   = PTT above (hold, or double-tap to lock)
//   'toggle' = hands-free above (press to start, press again to finish)
//   'hold'   = hold only: release stops, a quick tap is dropped at once
// kind 'command' starts (or upgrades a session to) command mode; kind 'translate' is the old Talk & translate
// action, a Dictate shortcut for the Translate mode.
//
// Each dictation carries its mode (modes.js), asked for once when it starts (deps.resolveMode, mode-session.js):
// switching apps mid-dictation doesn't change it; only another mode's shortcut or Switch mode (setMode) does.

const { EventEmitter } = require('node:events');
const { pinsMode } = require('./modes');

const DEBOUNCE_MS = 500;
const OTHER_SHORTCUT_WINDOW_MS = 1000;
const MAX_DURATION_MS = 20 * 60 * 1000;

class DictationController extends EventEmitter {
  /**
   * @param {object} deps
   * @param {() => void} deps.start          begin capturing audio
   * @param {() => Promise<void>} deps.finish stop capturing, transcribe, paste
   * @param {(reason: string) => void} deps.dismiss stop capturing, discard
   * @param {(request: {binding?: object, link?: string, kept?: object}) => object} [deps.resolveMode] the dictation's mode
   */
  constructor(deps, { now = Date.now, timers = { setTimeout, clearTimeout } } = {}) {
    super();
    this.deps = deps;
    this.now = now;
    this.timers = timers;
    this.status = 'idle';
    this.locked = false;
    this.command = false;
    this.mode = null;
    this.startTime = 0;
    this.tapTimer = null;
    this.maxTimer = null;
  }

  get isListening() {
    return this.status === 'listening';
  }

  /** The running dictation translates (its mode has a target); command mode never does. */
  get translate() {
    return !this.command && !!(this.mode && this.mode.translateTo);
  }

  #resolve(request) {
    return this.deps.resolveMode ? this.deps.resolveMode(request) : null;
  }

  #set(status) {
    this.status = status;
    this.emit('status', { status, locked: this.locked, translate: this.translate, command: this.command, mode: this.mode });
  }

  #clearTimers() {
    if (this.tapTimer) this.timers.clearTimeout(this.tapTimer);
    if (this.maxTimer) this.timers.clearTimeout(this.maxTimer);
    this.tapTimer = null;
    this.maxTimer = null;
  }

  #begin(locked, command = false, request = {}) {
    this.locked = locked;
    this.command = command;
    this.mode = this.#resolve(request);
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

  /** Command mode, or another mode's shortcut, added to a running session switches it. @returns {boolean} upgraded */
  #upgrade(kind, binding) {
    if (kind === 'command') {
      if (this.command) return false;
      this.command = true;
      return true;
    }
    if (this.command || !pinsMode(binding) || (this.mode && binding.mode === this.mode.id)) return false;
    const mode = this.#resolve({ binding });
    if (!mode || (this.mode && mode.id === this.mode.id)) return false;
    this.mode = mode;
    return true;
  }

  /**
   * A talk shortcut went down.
   * @param {{behaviour?: 'hold'|'toggle'|'both', kind?: 'dictate'|'translate'|'command', binding?: object}} opts
   *   binding: the shortcut, for its mode (resolveMode)
   */
  talkDown({ behaviour = 'both', kind = 'dictate', binding = null } = {}) {
    if (kind === 'translate') binding = { ...binding, action: 'translate' }; // the old action: the Translate mode
    if (this.status === 'processing') return this.#busy();
    if (this.status === 'idle') return this.#begin(behaviour === 'toggle', kind === 'command', { binding });
    if (this.#upgrade(kind, binding)) {
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

  /** Toggle used by the overlay pill / tray menu / deep links (`link`: a ?mode= or --mode= mode). */
  toggle({ link = null } = {}) {
    if (this.status === 'idle') return this.#begin(true, false, { link });
    if (this.isListening) return this.stop('toggle');
  }

  /** Deep link / command-line "start": a hands-free session; a held one is locked, a running one is left alone. */
  start({ link = null } = {}) {
    if (this.status === 'idle') return this.#begin(true, false, { link });
    if (this.isListening && !this.locked) return this.#lock();
  }

  /** Switch mode while talking: the running dictation goes on in `mode`. */
  setMode(mode) {
    if (!this.isListening || !mode) return;
    this.mode = mode;
    this.#set('listening');
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
   * @param {{mode?: string, translate?: boolean, command?: boolean, app?: object}} [meta] how it was recorded
   * @returns {Promise<boolean>} false when busy (nothing ran)
   */
  async process(run, meta = {}) {
    if (this.status !== 'idle') {
      this.#busy();
      return false;
    }
    this.command = !!meta.command;
    this.mode = this.#resolve({ kept: meta });
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
