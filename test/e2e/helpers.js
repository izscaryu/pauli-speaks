'use strict';
// Starts the real app for an end-to-end test: Playwright's Electron launcher, PAULI_E2E=1 (see
// src/main/e2e.js: fake paster, keys, clipboard and speech engine, fake microphone) and a fresh temporary
// data folder, optionally seeded with a settings.json. Nothing touches your own Pauli Speaks or desktop.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const { version } = require(path.join(ROOT, 'package.json'));
const { SETTINGS_VERSION } = require(path.join(ROOT, 'src', 'main', 'settings'));

/** A set-up profile: past the welcome flow, F13 to dictate (no Win key: that would send a real masking key), English UI. */
function setUpSettings(more = {}) {
  return {
    settingsVersion: SETTINGS_VERSION, onboarded: true, setupCard: false, lastSeenVersion: version, uiLanguage: 'en',
    engine: 'local', languages: ['en'], silenceDetection: false, sounds: false,
    bindings: [
      { id: 'dictate-1', action: 'dictate', keys: ['F13'], behaviour: 'both' },
      { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
    ],
    ...more,
  };
}

/** PAULI_E2E_LOG_DIR=<folder>: each test's app log is copied there before its data folder goes (to see why one failed). */
function keepLogs(dir) {
  const to = process.env.PAULI_E2E_LOG_DIR;
  if (!to) return;
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(path.join(dir, 'logs'))) fs.copyFileSync(path.join(dir, 'logs', name), path.join(to, `${path.basename(dir)}-${name}`));
  } catch {
    // no log yet
  }
}

async function waitFor(fn, { timeout = 15000, every = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/**
 * @param {{settings?: object|null, rawSettings?: string, args?: string[]}} [o]
 * @returns {Promise<{app, page, dir: string, state: () => Promise<object>, set: (field, value) => Promise,
 *   key: (name, down) => Promise, close: () => Promise<void>}>}
 */
async function launch({ settings = setUpSettings(), rawSettings, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pauli-e2e-'));
  if (rawSettings !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), rawSettings);
  else if (settings) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, ...args],
    cwd: ROOT,
    env: { ...process.env, PAULI_E2E: '1', PAULI_USER_DATA_DIR: dir },
  });
  const removeDir = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  let page;
  try {
    page = await waitFor(() => app.windows().find((w) => /\/app\.html(\?|$)/.test(w.url())), { what: 'the main window' }); // ?look=mica on Windows 11
    await page.waitForLoadState('domcontentloaded');
    await waitFor(() => app.evaluate(() => !!global.__pauliE2E), { what: 'e2e mode' });
    // PAULI_E2E_WINDOW=1000x740: the main window at that size, as on a smaller screen (CI's is), where Settings starts
    // at its list of sections and the sidebar can be a rail.
    const size = /^(\d+)x(\d+)$/.exec(process.env.PAULI_E2E_WINDOW || '');
    if (size) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => {
        BrowserWindow.getAllWindows().find((x) => /\/app\.html(\?|$)/.test(x.webContents.getURL())).setContentSize(w, h);
      }, [Number(size[1]), Number(size[2])]);
    }
  } catch (err) {
    await app.close().catch(() => {});
    removeDir();
    throw err;
  }
  return {
    app, page, dir,
    /** What the fakes recorded so far (pasted, keys, clipboard, recognised). */
    state: () => app.evaluate(() => global.__pauliE2E.state),
    /** Sets what the fake speech engine hears, the selection, … */
    set: (field, value) => app.evaluate((_electron, [f, v]) => { global.__pauliE2E.state[f] = v; }, [field, value]),
    /** A key (or mouse button) going down or up, as the global hook would report it. */
    key: (name, down) => app.evaluate((_electron, [k, d]) => global.__pauliE2E.key(k, d), [name, down]),
    /**
     * Push-to-talk, timed from when the app really listens: once it is idle, `key` goes down, the app reports
     * listening, it is held for `ms` (`during` runs halfway and its result is returned), then it goes up.
     */
    dictate: async (key = 'F13', { ms = 1500, during = null } = {}) => {
      const status = async () => (await page.evaluate(() => window.pauli.getDictationStatus())).status;
      await waitFor(async () => (await status()) === 'idle', { what: 'an idle dictation' });
      await app.evaluate((_electron, k) => global.__pauliE2E.key(k, true), key);
      await waitFor(async () => (await status()) === 'listening', { what: 'the app listening', every: 25 });
      await new Promise((r) => setTimeout(r, ms / 2));
      const seen = during ? await during() : null;
      await new Promise((r) => setTimeout(r, ms / 2));
      await app.evaluate((_electron, k) => global.__pauliE2E.key(k, false), key);
      return seen;
    },
    close: async () => {
      await app.close().catch(() => {});
      keepLogs(dir);
      removeDir();
    },
  };
}

/**
 * Opens Settings at one of its sections ('general', 'speech', … 'about'), on a wide window (the list beside the
 * section) or a narrow one (the list is a page of its own: "‹ Settings" goes back to it first).
 */
async function openSettings(page, section = 'general') {
  await page.click('.nav[data-page="settings"]');
  if (await page.isVisible('#settings-back')) await page.click('#settings-back');
  await page.click(`.settings-nav a[data-section="${section}"]`);
}

module.exports = { launch, setUpSettings, waitFor, openSettings, ROOT, version, SETTINGS_VERSION };
