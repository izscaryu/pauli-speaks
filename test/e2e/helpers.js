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

/** A set-up profile: past the welcome flow, F13 to dictate (no Win key: that would send a real masking key), English UI. */
function setUpSettings(more = {}) {
  return {
    settingsVersion: 6, onboarded: true, setupCard: false, lastSeenVersion: version, uiLanguage: 'en',
    engine: 'local', languages: ['en'], silenceDetection: false, sounds: false,
    bindings: [
      { id: 'dictate-1', action: 'dictate', keys: ['F13'], behaviour: 'both' },
      { id: 'cancel-1', action: 'cancel', keys: ['Escape'] },
    ],
    ...more,
  };
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
    page = await waitFor(() => app.windows().find((w) => w.url().endsWith('app.html')), { what: 'the main window' });
    await page.waitForLoadState('domcontentloaded');
    await waitFor(() => app.evaluate(() => !!global.__pauliE2E), { what: 'e2e mode' });
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
    close: async () => {
      await app.close().catch(() => {});
      removeDir();
    },
  };
}

module.exports = { launch, setUpSettings, waitFor, ROOT, version };
