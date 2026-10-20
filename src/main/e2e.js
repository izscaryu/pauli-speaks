'use strict';
// Test-only hooks for the end-to-end suite (test/e2e). Switched on by PAULI_E2E=1 in a development run,
// never in an installed or portable app. In this mode nothing reaches the real desktop: the paster, the
// key presses, the selection and the clipboard are fakes that record what they were asked, and the speech
// engine answers with a fixed transcript (and records the languages it was asked for). `foreground` names
// the app in front (main.js asks it before Windows), so per-app modes can be tested. The tests drive it through `global.__pauliE2E` (Playwright's
// electronApp.evaluate runs in the main process).

const SAMPLE_RATE = 16000;

/** @param {{isPackaged: boolean}} app  @param {object} env */
function e2eEnabled(app, env = process.env) {
  return !app.isPackaged && env.PAULI_E2E === '1';
}

function createE2E() {
  const state = {
    transcript: 'hello there', language: 'en', selection: '', foreground: null,
    pasted: [], keys: [], clipboard: [], recognised: [],
  };
  const io = {
    pasteText: async (text) => { state.pasted.push(text); return { mode: 'paste' }; },
    pressKey: async (vk, times = 1) => { state.keys.push({ vk, times }); },
    getSelectedText: async () => state.selection,
    writeClipboard: async (text) => { state.clipboard.push(text); },
    recognise: async (audio, task, opts = {}) => {
      state.recognised.push({ task, seconds: Math.round((audio.length / SAMPLE_RATE) * 10) / 10, languages: opts.languages || null });
      return { text: state.transcript, language: state.language };
    },
  };

  /** Hands the tests their handle once the keyboard service exists. */
  function attach({ keyboard, target = global }) {
    keyboard.engine.sweepStale = () => {}; // injected keys are never down for Windows: keep them until released
    target.__pauliE2E = { state, key: (name, down) => keyboard.engine.handleKey(name, down) };
  }

  return { state, io, attach };
}

module.exports = { e2eEnabled, createE2E };
