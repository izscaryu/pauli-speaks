'use strict';
// The app around dictation: first start, settings migration on a real file, diagnostics, downloaded models, and a
// command-line flag handed over by a second launch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { launch, waitFor, ROOT, SETTINGS_VERSION } = require('./helpers');

test('first start: the welcome flow opens', async (t) => {
  const run = await launch({ settings: null });
  t.after(run.close);
  await run.page.locator('#page-welcome').waitFor({ state: 'visible', timeout: 10000 });
  assert.ok(await run.page.locator('#welcome-step').isVisible());
});

test('an older settings file is migrated in place, and the old one is kept as a backup', async (t) => {
  const run = await launch({ rawSettings: JSON.stringify({ settingsVersion: 4, onboarded: true, setupCard: false }) });
  t.after(run.close);
  const file = path.join(run.dir, 'settings.json');
  const migrated = await waitFor(() => {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s.settingsVersion === SETTINGS_VERSION ? s : null;
  }, { what: 'the migrated settings' });
  assert.equal(migrated.silenceDetection, true);
  assert.equal(migrated.crashRecovery, true);
  assert.equal(migrated.historyRetention, 'keep');
  assert.equal(migrated.uiLanguage, 'system');
  assert.equal(JSON.parse(fs.readFileSync(path.join(run.dir, 'settings.v4.json'), 'utf8')).settingsVersion, 4);
});

test('About → Copy diagnostic info copies the block, without the Windows account name', async (t) => {
  const run = await launch();
  t.after(run.close);
  await run.page.locator('button.nav[data-page="settings"]').click(); // About & updates is a section of Settings
  await run.page.locator('.settings-nav a[data-section="about"]').click();
  await run.page.locator('#diagnostics-copy').click();
  const { clipboard } = await waitFor(async () => { const s = await run.state(); return s.clipboard.length ? s : null; }, { what: 'the copy' });
  const text = clipboard[0];
  assert.match(text, /^### Pauli Speaks diagnostics/);
  assert.ok(text.includes('dictate: F13 (both)'));
  assert.match(text, /Keyboard hook: (running|failed)/, 'CI runners may not allow the global hook; the line is there either way');
  assert.ok(text.includes('starting'), 'the log lines are in it');
  assert.ok(!text.toLowerCase().includes(os.homedir().toLowerCase()), 'no home folder (the account name)');
  await run.page.locator('#toast').waitFor({ state: 'visible' });
  assert.match(await run.page.locator('#toast').textContent(), /copied/i);
});

test('a second launch with --press-enter hands the flag to the running copy, which presses Enter', async (t) => {
  const run = await launch();
  t.after(run.close);
  await new Promise((r) => setTimeout(r, 1500)); // flags wait until the pill is ready
  const second = spawn(require('electron'), [ROOT, '--press-enter'], {
    cwd: ROOT, env: { ...process.env, PAULI_E2E: '1', PAULI_USER_DATA_DIR: run.dir }, stdio: 'ignore',
  });
  const exited = new Promise((resolve) => second.on('exit', resolve));
  const state = await waitFor(async () => { const s = await run.state(); return s.keys.length ? s : null; }, { what: 'Enter' });
  assert.deepEqual(state.keys, [{ vk: 0x0d, times: 1 }]);
  assert.equal(await Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('still running'), 10000))]), 'exited', 'the second copy hands over and quits');
});

test('Settings → Speech lists the downloaded models and deletes one of them', async (t) => {
  const run = await launch();
  t.after(run.close);
  for (const id of ['onnx-community/whisper-base', 'Xenova/nllb-200-distilled-600M']) {
    const dir = path.join(run.dir, 'models', ...id.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.pauli-ready'), 'x');
    fs.writeFileSync(path.join(dir, 'model.onnx'), Buffer.alloc(4096));
  }
  await run.page.click('.nav[data-page="settings"]');
  await run.page.evaluate(() => window.SettingsSearch.jump('speech'));
  // One list of models: Whisper Base says it is downloaded, with its size and Delete in its own row; the offline
  // translator's Delete is in Settings → Translation.
  const deletes = () => run.page.$$eval('#models .model-action .icon-btn', (bs) => bs.map((b) => b.getAttribute('aria-label')));
  await waitFor(async () => (await deletes()).length === 1, { what: 'Delete on the downloaded model' });
  assert.match((await deletes())[0], /Whisper Base/);
  assert.equal(await run.page.locator('#tr-delete-slot .icon-btn').count(), 1, 'the translator can be deleted too');
  await run.page.click('#models .model-action .icon-btn');
  await run.page.click('dialog[open] [data-dialog="confirm"]'); // the app's own dialog (dialogs.e2e.js)
  await waitFor(async () => (await deletes()).length === 0, { what: 'Whisper Base deleted' });
  assert.equal(fs.existsSync(path.join(run.dir, 'models', 'onnx-community', 'whisper-base')), false);
  assert.ok(fs.existsSync(path.join(run.dir, 'models', 'Xenova', 'nllb-200-distilled-600M')));
  assert.equal(await run.page.locator('#tr-delete-slot .icon-btn').count(), 1, 'the translator is still there');
});
