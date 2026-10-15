'use strict';
// Global input listener. uiohook-napi installs WH_KEYBOARD_LL / WH_MOUSE_LL
// hooks on its own native thread, so the hook never waits on JS. It only
// listens for shortcuts: keystrokes are never stored.

const { EventEmitter } = require('node:events');
const { uIOhook } = require('uiohook-napi');
const { ShortcutEngine } = require('./shortcut-engine');
const { keyName, mouseName, VK } = require('./keys');
const win32 = require('./win32');
const log = require('./logger');

const SWEEP_INTERVAL_MS = 1000;
const WIN_KEYS = ['Meta', 'MetaRight'];

class KeyboardService extends EventEmitter {
  constructor() {
    super();
    this.engine = new ShortcutEngine();
    this.started = false;
    this.sweepTimer = null;

    this.engine.on('action', (e) => {
      if (e.phase === 'down' && e.keys.some((k) => WIN_KEYS.includes(k))) win32.sendMaskKey();
      this.emit('action', e);
    });
    this.engine.on('chord', (e) => this.emit('chord', e));
    this.engine.on('recording', (e) => {
      if (!e.isRelease && e.keys.length > 1 && e.keys.some((k) => WIN_KEYS.includes(k))) win32.sendMaskKey();
      this.emit('recording', e);
    });
    this.engine.on('stale', ({ key }) => log.warn(`Evicted stale key ${key}`));
  }

  start() {
    if (this.started) return;
    uIOhook.on('keydown', (e) => this.engine.handleKey(keyName(e.keycode), true));
    uIOhook.on('keyup', (e) => this.engine.handleKey(keyName(e.keycode), false));
    uIOhook.on('mousedown', (e) => this.engine.handleKey(mouseName(e.button), true));
    uIOhook.on('mouseup', (e) => this.engine.handleKey(mouseName(e.button), false));
    uIOhook.start();
    this.started = true;
    this.sweepTimer = setInterval(() => {
      if (this.engine.pressed.size === 0) return;
      this.engine.sweepStale((key) => (VK[key] ? win32.isKeyDown(VK[key]) : undefined));
    }, SWEEP_INTERVAL_MS);
    log.info('Global keyboard hook started');
  }

  stop() {
    if (!this.started) return;
    clearInterval(this.sweepTimer);
    uIOhook.removeAllListeners();
    uIOhook.stop();
    this.started = false;
  }

  /** @param {{id: string, action: string, keys: string[], behaviour?: string, trigger?: string}[]} bindings */
  setBindings(bindings) {
    this.engine.setBindings(bindings);
  }

  setRecording(on) {
    this.engine.setRecording(on);
  }
}

module.exports = { KeyboardService };
