'use strict';
// Settings → AI polish, the main-process side: "Find servers" (Ollama and LM Studio on this PC, polish-servers.js)
// and "Test" (a fixed sentence through the chosen model, so the user sees it work and how long it takes).
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
 * @param {() => number} [d.now]
 */
function registerPolishIpc(ipcMain, d) {
  const now = d.now || Date.now;

  ipcMain.handle('polish:detect', () => d.detectServers());

  ipcMain.handle('polish:test', async () => {
    const target = d.polisher.endpoint();
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
}

module.exports = { registerPolishIpc, TEST_SENTENCE };
