'use strict';
// The dictation itself, once the speech gate has let a recording through (dictation-flow.js):
//   - transcribe: speech -> text in the mode's language, translated when the mode says so;
//   - runDictation: clean it up, run the voice commands said at its start / end, put it in History, paste;
//   - runCommand: command mode, the speech is an instruction for the selected text.
// Language, translation, style and voice commands come from the session's mode (controller.mode, modes.js).
// Engines, windows and keys come in through `deps` (typing.js does the typing), so it is unit tested with fakes.

const { cleanTranscript, cleanUtterance, countWords } = require('./text-cleanup');
const { DEFAULT_MODE } = require('./modes');
const { shouldRunFollowUps } = require('./paste-plan');
const { buildCommandMessages } = require('./llm');
const { t } = require('./strings');

/**
 * @param {object} d
 * @param {{get: () => object, getApiKey: () => string}} d.settings
 * @param {{command: boolean, mode: object|null, cancelled: boolean}} d.controller  mode: the session's (modes.js)
 * @param {import('./history').History} d.history
 * @param {ReturnType<import('./typing').createTyping>} d.typing
 * @param {(audio, task: 'transcribe'|'translate', opts: {languages: string[]}) => Promise<object>} d.recognise  the chosen engine, model loaded
 * @param {(text, source, target) => Promise<string>} d.translateText  NLLB
 * @param {(settings: object, target: string) => boolean} d.needsNllb
 * @param {() => {exe: string}|null} d.sessionApp  the app in front when the dictation started
 * @param {() => string} d.engineLabel
 * @param {(historyId: string, audio: Float32Array) => void} d.saveRecording  kept when Privacy says so
 * @param {() => void} d.onRecorded  the dictation went into History (dictation-flow's noteRecorded)
 * @param {(hint: {chosen: string[], likely: string|null}) => void} d.feedLanguage  language-hints.js
 * @param {(opts, messages) => Promise<string>} d.chatComplete  llm.js
 * @param {(state: object) => void} d.sendOverlayState
 * @param {(text, kind?) => void} d.flash
 * @param {{info: Function}} d.log
 * @param {() => number} [d.now]
 */
function createDictationRun(d) {
  const { settings, controller, history, typing } = d;
  const now = d.now || Date.now;

  /** The running dictation's mode; Default before the controller has one. */
  const sessionMode = () => controller.mode || DEFAULT_MODE;

  function translatingNow() {
    return !controller.command && !!sessionMode().translateTo;
  }

  /** The mode's language, or your languages. */
  const languagesFor = (mode) => (mode.language ? [mode.language] : settings.get().languages);

  /** Clean-up options: your settings with the mode's style and voice commands. */
  const cleanOpts = (s, mode, more = {}) => ({ ...s, style: mode.style, voiceCommandsEnabled: s.voiceCommandsEnabled && mode.voiceCommands, ...more });

  /**
   * Speech -> text in the mode's language, translated when the mode has a target:
   *   Fast  (target English): Whisper's own translate task, one pass, no extra download
   *   Best  (or other target): transcribe, clean up, then NLLB-200 text translation
   * @returns {Promise<{text: string, language: string|null, translatedTo: string|null, original?: string}>}
   */
  async function transcribe(audio, mode = sessionMode()) {
    const s = settings.get();
    const target = controller.command ? null : mode.translateTo;
    const languages = languagesFor(mode);
    const fast = target === 'en' && !d.needsNllb(s, target);
    const result = await d.recognise(audio, fast ? 'translate' : 'transcribe', { languages });
    if (!target || result.translatedTo) return result;

    const source = result.language || (languages.length === 1 ? languages[0] : null);
    if (source === target) return result;
    // Voice commands are found in the language they were spoken in ("pošalji"), before translating.
    const { text: original, before, after } = cleanUtterance(result.text, cleanOpts(s, mode, { addTrailingSpace: false, snippets: [] }));
    if (!original.trim()) return result;
    const text = await d.translateText(original, source || 'en', target);
    return { ...result, text, language: source, translatedTo: target, original, before, after };
  }

  /** What Retry / Undo need to run a kept recording again the way it was meant. */
  const keptMeta = (seconds) => ({
    durationMs: Math.round(seconds * 1000), engine: controller.command ? settings.get().command.model : d.engineLabel(),
    command: controller.command, mode: sessionMode().id, translate: translatingNow(), app: d.sessionApp(),
  });

  /** Text plus the voice commands said at its start / end, in the mode's style. */
  function dictationText(result, mode = sessionMode()) {
    const s = settings.get();
    if (!result.original) return cleanUtterance(result.text, cleanOpts(s, mode));
    // NLLB output was already cleaned (and its commands found) before translation: only polish it now.
    const after = result.after || [];
    const keyAfter = after.some((c) => c.action === 'key');
    const text = cleanTranscript(result.text, cleanOpts(s, mode, { removeFillers: false, voiceCommands: false, addTrailingSpace: s.addTrailingSpace && !keyAfter }));
    return { text, before: result.before || [], after };
  }

  /** A transcript for History; `historyId` fills in a failed entry instead of adding one. `audio`: the recording, kept when Privacy says so. */
  function record(entry, historyId, audio) {
    d.onRecorded();
    const item = (historyId && history.resolve(historyId, entry)) || history.add(entry);
    if (audio) d.saveRecording(item.id, audio);
    return item;
  }

  function dictationEntry(result, text, seconds, mode, app) {
    return {
      text: text.trim(),
      rawText: result.text,
      original: result.original || null,
      durationMs: Math.round(seconds * 1000),
      words: countWords(text),
      engine: d.engineLabel(),
      language: result.language || null,
      translatedTo: result.translatedTo || null,
      app: app ? app.exe : null,
      style: mode.style,
      mode: mode.id,
    };
  }

  async function runDictation(audio, seconds, t0, historyId = null, recording = null) {
    const mode = sessionMode();
    const result = await transcribe(audio, mode);
    if (controller.cancelled) return d.sendOverlayState({ state: 'idle' });

    const s = settings.get();
    const app = d.sessionApp();
    const { text: cleaned, before, after } = dictationText(result, mode);
    // "scratch that" at the end throws away what was just said
    const scratched = after.some((c) => c.action === 'undo');
    const text = scratched ? '' : cleaned;
    d.log.info(`Transcribed in ${now() - t0}ms (${result.language || '?'}${result.translatedTo ? ` -> ${result.translatedTo}` : ''}, ${app ? app.exe : '?'}: ${mode.id}, ${mode.style})${before.length + after.length ? `, commands: ${[...before, ...after].map((c) => c.action).join(' ')}` : ''}`);
    if (!text.trim() && !before.length && !after.length) return d.flash(t('flash.noSpeech'));
    d.sendOverlayState({ state: 'idle' });

    for (const c of before) await typing.runVoiceAction(c, !text.trim());
    if (scratched) return d.flash(t('flash.dropped'));
    if (!text.trim()) {
      if (typing.enterAfterPaste) await typing.pressEnterNow();
      return;
    }

    record(dictationEntry(result, text, seconds, mode, app), historyId, recording);
    d.feedLanguage({ chosen: s.languages, likely: result.likelyLanguage ?? result.language });
    if (!shouldRunFollowUps(await typing.paste(text))) return; // enterAfterPaste is reset by the caller
    for (const c of after) await typing.runVoiceAction(c, false);
    if (typing.enterAfterPaste && !after.some((c) => c.arg === 'Enter')) await typing.pressEnterNow();
  }

  /** Command mode: the speech is an instruction for the selected text (or a request to write something). */
  async function runCommand(audio, seconds, historyId = null) {
    const s = settings.get();
    d.sendOverlayState({ state: 'processing', mode: 'command', text: t('overlay.command.listening') });
    const r = await d.recognise(audio, 'transcribe', { languages: languagesFor(sessionMode()) });
    const instruction = cleanTranscript(r.text, { ...s, addTrailingSpace: false, snippets: [] });
    if (!instruction.trim()) return d.flash(t('flash.noSpeech'));
    const selection = await typing.selectedText();
    d.sendOverlayState({ state: 'processing', mode: 'command', text: t(selection.trim() ? 'overlay.command.editing' : 'overlay.command.writing') });
    const output = await d.chatComplete(
      { baseUrl: s.cloud.baseUrl, apiKey: settings.getApiKey(), model: s.command.model },
      buildCommandMessages(instruction, selection),
    );
    if (controller.cancelled) return d.sendOverlayState({ state: 'idle' });
    if (!output) return d.flash(t('flash.aiNothing'), 'error');
    d.log.info(`Command (${instruction.length} chars) on ${selection.length} chars -> ${output.length} chars`);
    const app = d.sessionApp();
    record({
      kind: 'command',
      text: output,
      instruction,
      rawText: r.text,
      original: selection.trim() ? selection : null,
      durationMs: Math.round(seconds * 1000),
      words: countWords(output),
      engine: s.command.model,
      language: r.language || null,
      app: app ? app.exe : null,
    }, historyId);
    d.sendOverlayState({ state: 'idle' });
    if (shouldRunFollowUps(await typing.paste(output)) && typing.enterAfterPaste) await typing.pressEnterNow();
  }

  return { sessionMode, translatingNow, transcribe, keptMeta, dictationText, record, dictationEntry, runDictation, runCommand };
}

module.exports = { createDictationRun };
