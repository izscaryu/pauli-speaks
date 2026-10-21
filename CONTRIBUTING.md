# Contributing to Pauli Speaks

Thanks for helping. Bug reports, language samples, ideas and pull requests are all welcome.

## Reporting a problem

In the app, **About → Report a problem** copies diagnostic info and opens a bug report on GitHub. Paste it
into the form. It contains versions, settings, shortcuts and the last 100 log lines, never what you
dictated and never your API key. For words that come out wrong in your language, use the
"Language problem" form.

## Run it from source

You need Windows 10 or 11 and Node.js 24.

```powershell
$env:FOUNDRY_LOCAL_NUGET_FEEDS = "https://api.nuget.org/v3/index.json"   # Foundry Local's ONNX Runtime from nuget.org only, as in CI
npm install
$env:PAULI_USER_DATA_DIR = "$env:TEMP\pauli-scratch"   # a scratch data folder, so your own setup is untouched
npm start
```

`PAULI_USER_DATA_DIR` only works in a development run. Close an installed Pauli Speaks first if it uses the
same shortcut: two copies both react to it.

## Tests

```powershell
npm test            # unit tests (node:test), a few seconds
npm run test:e2e    # end-to-end: starts the real app with fake keys, a fake paster and a fake speech engine
npm run test:packaged  # builds dist/win-unpacked and checks the packed app starts (tray, floating bar, keyboard hook)
```

Write the test first, watch it fail, then make it pass. Code that touches Electron, Windows or the speech
engine takes them through a `deps` object, so it can be tested with fakes (see `dictation-flow.js` and its
test for the pattern).

## Comparing speech engines

```powershell
npm run bench -- C:\path\to\recordings --engines whisper:base,whisper:small --languages hr
```

The folder holds your recordings with what was said in each: `clip.wav` (16-bit PCM) next to `clip.txt`. Keep it
outside the repository; the script only reads it. It prints each engine's word error rate, real-time factor and
cold and warm start times (`--details` adds every clip). Whisper models go to a folder in your temp directory
unless you pass `--models <folder>`. `cloud` sends the recordings to the service and needs `PAULI_BENCH_API_KEY`.

## Where things live

| Path | What |
|------|------|
| `src/main/main.js` | Wiring only: windows, tray, IPC, startup. Logic goes into its own module. |
| `src/main/dictation-*.js`, `typing.js` | What happens to a recording: speech gate, transcription, clean-up, paste, Retry and Undo |
| `src/main/keyboard.js`, `shortcut-*.js` | The global keyboard hook and exact shortcut matching |
| `src/main/modes.js`, `mode-session.js` | Modes: language, translation, style and voice commands per shortcut, link or app, and which one a dictation uses |
| `src/main/files.js` | Files → transcribe a whole audio or video file |
| `src/main/asr/` | Speech engines: local Whisper in a utility process, voice-activity detection, NLLB translation, cloud |
| `src/main/text-cleanup.js`, `voice-commands.js` | Fillers, voice commands, dictionary, snippets, styles |
| `src/main/polish*.js`, `foundry-local.js`, `foundry/` | AI polish: prompts per level, deadline and fallback, servers on this PC, Undo, Foundry Local |
| `src/main/privacy*.js`, `history.js`, `audio-history.js` | History, recordings and the privacy controls |
| `src/main/diagnostics*.js` | About → Copy diagnostic info / Report a problem |
| `src/renderer/` | The main window (`app.html`) and the floating pill (`overlay.html`) |
| `src/renderer/locales/` | Every word the app shows, one JSON file per language (`en.json` is the source) |
| `src/renderer/i18n.js`, `src/main/strings.js` | `t()` for the windows and for the main process (tray, pill messages, errors) |
| `test/` | Unit tests; `test/e2e/` end-to-end tests |

## Translate Pauli Speaks

A language is one file. You don't need to write code.

1. Copy `src/renderer/locales/en.json` to a file named after your language's code: `de.json` for German,
   `es.json` for Spanish, `pt-br.json` for Brazilian Portuguese.
2. Translate the text on the right of each line. Keep the key on the left exactly as it is. Set
   `"language.name"` to your language's name in your language (`"Deutsch"`); that is what the language list shows.
3. Keep every `{placeholder}` as it is, in the place your sentence needs it: `"Hold {keys} while you speak"`
   becomes `"Halte {keys} gedrückt, während du sprichst"`. Translate the surrounding words only.
4. Plurals: a key ending in `.one` / `.other` is one sentence in its singular and plural forms. Give the forms
   your language uses (Croatian, Polish and Slovenian have more, for example `.few` and `.many`).
   `npm run i18n:check` tells you which ones it expects.
5. Run the check and the app in your language:

   ```powershell
   npm run i18n:check   # lists missing, extra and changed keys and {placeholders}
   npm start            # Settings → Language → App language
   ```

6. Open a pull request. Say which language it is and whether you are a native speaker.

Language names in the lists (Croatian, German…), dates and numbers come from Windows, so they are right in
every language without translation. In the app, anything left out shows in English; the check (and CI) only
passes once every key is there.

Voice commands ("new line", "send it" and the rest) are separate: their phrases per language are in
`VOICE_PACKS` in `src/main/voice-commands.js`. Adding your language there means a line of code and a test in
`test/voice-commands.test.js`; open an issue with the phrases if you'd rather not.

### Adding text to the app

New text never goes into the code as a sentence. Put the English in `en.json` under a key that says where it
appears (`settings.language.title`), then use it: `t('settings.language.title')` in a script,
`data-i18n="settings.language.title"` in the HTML (`data-i18n-placeholder`, `-title` and `-aria-label` for
those attributes). Add the Croatian to `hr.json` too, or ask in the pull request. `npm run i18n:check` runs in CI
and fails on missing, unused or untranslated keys.

## Rules of the house

- **No dictated text in logs.** Log lengths, timings and states. Diagnostics send the last log lines to GitHub.
- **Privacy first.** Nothing leaves the PC unless the user chose a cloud engine. Update `PRIVACY.md` when that changes.
- **Small modules with tests.** Keep `main.js` under about 1,240 lines; move logic out rather than adding to it.
- **Plain language** in the app and the docs. Write for someone who has never heard of Whisper.
- **Changelog.** Add a line to `CHANGELOG.md` under the coming version when users will notice a change.

## Releases

Releases are built by GitHub Actions from a `v*` tag (`npm run release -- 1.3.0`). See `docs/RELEASING.md`.
Only the maintainer tags releases.

## Licence

By contributing you agree that your work is released under the [MIT License](LICENSE).
