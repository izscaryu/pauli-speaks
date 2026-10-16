'use strict';
// Auto-update from GitHub Releases (izscaryu/pauli-speaks) via electron-updater.
// Checks shortly after start and every 6 hours, downloads in the background,
// then offers "Restart to update". Installs on quit if the user ignores it.
// Only active in the packaged app - `npm start` never updates itself.
//
// Portable copies (portable.js) only check: the installer can't update a
// portable exe, so they report "available" and About links to the release.
//
// "Get early versions" (settings.betaUpdates) also accepts GitHub
// pre-releases (x.y.z-beta.N). A newer regular release still wins:
// electron-updater then takes the newest release of either kind, and never
// goes back a version when the option is turned off again.

const { EventEmitter } = require('node:events');
const { app } = require('electron');
const log = require('./logger');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;

class Updater extends EventEmitter {
  /** @param {{portable?: boolean, prerelease?: boolean}} [options] */
  constructor({ portable = false, prerelease = false } = {}) {
    super();
    this.portable = portable;
    this.prerelease = prerelease;
    this.state = { status: 'idle', version: null, percent: 0, error: null, current: app.getVersion() };
    this.enabled = app.isPackaged || !!process.env.PAULI_UPDATE_DEV;
    this.timer = null;
    this.autoUpdater = null;
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  start() {
    if (!this.enabled) {
      this.#set({ status: 'disabled' });
      return;
    }
    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.logger = { info: log.info, warn: log.warn, error: log.error, debug: log.debug };
    autoUpdater.autoDownload = !this.portable;
    // PAULI_UPDATE_NO_INSTALL: test builds download but never install over the real app
    autoUpdater.autoInstallOnAppQuit = !this.portable && !process.env.PAULI_UPDATE_NO_INSTALL;
    // Set explicitly: electron-updater turns it on by itself when this version is a beta.
    autoUpdater.allowPrerelease = this.prerelease;
    if (process.env.PAULI_UPDATE_DEV) autoUpdater.forceDevUpdateConfig = true;

    autoUpdater.on('checking-for-update', () => this.#set({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => this.#set({ status: 'up-to-date', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) =>
      this.#set(this.portable ? { status: 'available', version: info.version } : { status: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => this.#set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => {
      log.info(`Update ${info.version} downloaded`);
      this.#set({ status: 'ready', version: info.version, percent: 100 });
    });
    autoUpdater.on('error', (err) => {
      log.warn(`Update check failed: ${err.message}`);
      this.#set({ status: 'error', error: err.message.split('\n')[0] });
    });

    setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  async check() {
    if (!this.autoUpdater) return this.state;
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (err) {
      this.#set({ status: 'error', error: err.message.split('\n')[0] });
    }
    return this.state;
  }

  /** "Get early versions": used from the next check, which starts now when it is turned on. */
  setPrerelease(on) {
    this.prerelease = !!on;
    if (!this.autoUpdater) return;
    this.autoUpdater.allowPrerelease = this.prerelease;
    if (this.prerelease) this.check();
  }

  /** Quit and run the downloaded installer silently, then relaunch. */
  install() {
    if (this.state.status !== 'ready') return false;
    setImmediate(() => this.autoUpdater.quitAndInstall(true, true));
    return true;
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = { Updater };
