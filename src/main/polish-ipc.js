'use strict';
// Settings → AI polish, the main-process side: "Find servers" (Ollama and LM Studio on this PC, polish-servers.js),
// "Test" (a fixed sentence through the chosen model, so the user sees it work and how long it takes), and Foundry
// Local's models (foundry-local.js): the list, a download the window asked the user about first, cancel, remove.
// Electron, the chat client and the clock come in through `deps`, so it is unit tested with fakes.

const { buildPolishMessages } = require('./polish-prompts');
const { t } = require('./strings');

const TEST_SENTENCE = 'so um this is a test of the the polish';
const TEST_TIMEOUT_MS = 60 * 1000; // the first request may have to load the model

const ERRORS = { 'not-set-up': 'errors.polishNotSetUp', starting: 'errors.polishStarting' };

/**
 * @param {{handle: Function}} ipcMain
 * @param {object} d
 * @param {{endpoint: () => object}} d.polisher  polish.js
 * @param {() => Promise<object[]>} d.detectServers  polish-servers.js
 * @param {(cfg, messages, opts) => Promise<string>} d.chat  llm.js chatComplete
 * @param {ReturnType<import('./foundry-local').createFoundryLocal>} [d.foundry]
 * @param {() => number} [d.now]
 */
function registerPolishIpc(ipcMain, d) {
  const now = d.now || Date.now;

  ipcMain.handle('polish:detect', () => d.detectServers());

  ipcMain.handle('polish:test', async () => {
    let target = d.polisher.endpoint();
    if (target.error === 'starting' && d.foundry) {
      try {
        await d.foundry.start(); // Test waits for Foundry Local; a dictation never does
      } catch (err) {
        return { ok: false, error: err.message };
      }
      target = d.polisher.endpoint();
    }
    if (target.error) return { ok: false, error: t(ERRORS[target.error] || ERRORS['not-set-up']) };
    const t0 = now();
    try {
      const output = await d.chat({ baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model },
        buildPolishMessages({ level: 'medium', text: TEST_SENTENCE, language: 'en' }),
        { signal: AbortSignal.timeout(TEST_TIMEOUT_MS), requireKey: target.requireKey, temperature: 0.2, maxTokens: 100 });
      return { ok: true, ms: now() - t0, output };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  if (!d.foundry) return;
  const { foundry } = d;
  ipcMain.handle('foundry:catalog', async () => {
    try {
      return await foundry.catalog();
    } catch (err) {
      return { error: err.message };
    }
  });
  // The window shows the model's size and asks before it calls this; the worker only takes a model from its list.
  ipcMain.handle('foundry:download', async (_e, id) => {
    try {
      await foundry.download(String(id));
      return { ok: true };
    } catch (err) {
      return { ok: false, cancelled: err.code === 'AbortError', error: err.message };
    }
  });
  ipcMain.handle('foundry:cancel', () => foundry.cancel());
  ipcMain.handle('foundry:remove', async (_e, id) => {
    try {
      await foundry.remove(String(id));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerPolishIpc, TEST_SENTENCE };
