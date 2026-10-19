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
```

Write the test first, watch it fail, then make it pass. Code that touches Electron, Windows or the speech
engine takes them through a `deps` object, so it can be tested with fakes (see `dictation-flow.js` and its
test for the pattern).

## Where things live

| Path | What |
|------|------|
| `src/main/main.js` | Wiring only: windows, tray, IPC, startup. Logic goes into its own module. |
| `src/main/dictation-*.js`, `typing.js` | What happens to a recording: speech gate, transcription, clean-up, paste, Retry and Undo |
| `src/main/keyboard.js`, `shortcut-*.js` | The global keyboard hook and exact shortcut matching |
| `src/main/asr/` | Speech engines: local Whisper in a utility process, voice-activity detection, NLLB translation, cloud |
| `src/main/text-cleanup.js`, `voice-commands.js` | Fillers, voice commands, dictionary, snippets, per-app styles |
| `src/main/privacy*.js`, `history.js`, `audio-history.js` | History, recordings and the privacy controls |
| `src/main/diagnostics*.js` | About → Copy diagnostic info / Report a problem |
| `src/renderer/` | The main window (`app.html`) and the floating pill (`overlay.html`) |
| `test/` | Unit tests; `test/e2e/` end-to-end tests |

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
