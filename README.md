# Pauli Speaks

Free push-to-talk voice typing for Windows. Hold **Ctrl + Win**, speak, let go: your words
are typed into whatever app has the cursor. Speech recognition runs **on your own PC**
(OpenAI Whisper), so it is free, works offline and nothing you say leaves your computer.

The push-to-talk behaviour is modelled on Wispr Flow's design.

**Download:** grab the latest `Pauli-Speaks-Setup-x.y.z.exe` from
[Releases](https://github.com/izscaryu/pauli-speaks/releases/latest). Installed copies update
themselves.

## Features

- **Push-to-talk**: hold the shortcut while you speak, release to paste.
- **Hands-free**: double-tap the shortcut (or press Ctrl + Win + Space) to keep recording,
  then press it again to finish. Up to 20 minutes per dictation.
- **Esc** cancels, **Shift + Alt + Z** pastes the last transcript again.
- Any shortcut you like: 1–3 keys, a single F-key, a right-side modifier (e.g. Right Alt) or a
  mouse side button.
- **Local Whisper** (Tiny / Base / Small / Large v3 Turbo). The model downloads once and then
  runs offline.
- Optional **cloud mode** with any OpenAI-compatible API (Groq's free tier by default), with
  your key encrypted by Windows.
- Multi-language: pick the languages you speak (English, Croatian, …) and it detects which one
  you used.
- **Speak one language, paste another**: turn on *Always translate*, or hold **Ctrl + Win + Shift**
  (adding Shift to a held Ctrl + Win also works mid-sentence) to dictate in Croatian and paste
  English. *Fast* uses Whisper's built-in translator (English only, no extra download). *Best*
  uses Meta's NLLB-200 offline (30+ target languages, ~900 MB one-time download, ~2–3 s per
  sentence).
- Cleanup: removes "um/uh", voice commands ("new line", "new paragraph", "novi red"),
  sentence capitalization, and a personal dictionary for names and jargon. Dictionary words are
  also fed to Whisper as a prompt, so it hears them right the first time.
- **GPU acceleration** via DirectML (any DX12 GPU), with an automatic CPU fallback: 2–3× faster
  (Whisper Small: 3.1 s → 1.5 s for 7.6 s of speech on an RTX 3060 laptop).
- **Snippets**: say "my email" and your address is typed.
- **App styles**: no capitals or final full stop in code editors and terminals, no final full stop
  in chat apps, and always-punctuated text in Outlook and Word. Editable per app.
- **Command mode** (Ctrl + Win + Alt): select text and say "make this more formal" or "translate to
  German", or say what to write with nothing selected. Uses a free Groq key.
- **Read aloud** (Shift + Alt + S): reads the selected text with Windows voices.
- **Transcribe files**: drop audio or video and save a `.txt` or `.srt`, optionally translated.
- **Live preview** of your words while you speak, and **auto-stop** after silence in hands-free
  mode. Both are opt-in.
- Weekly words chart and a day streak.
- Floating status pill with a live waveform, start/stop sounds, history with copy, and
  stats (words, WPM, time saved).
- Restores your clipboard after pasting, runs in the tray, and can start with Windows.

## Run it

Requirements: Windows 10/11 x64, Node.js 22+.

```bash
npm install
npm start
```

On first start it downloads the Whisper Base model (~150 MB) and shows progress on the
Home screen. Click into the **Try it here** box, hold **Ctrl + Win**, say something and release.

## Build an installer

```bash
npm run dist
```

This creates `dist/Pauli-Speaks-Setup-1.0.0.exe`. Use `npm run dist:portable` for a single
portable `.exe`.

## Updates and releases

The installed app checks
[GitHub Releases](https://github.com/izscaryu/pauli-speaks/releases) 15 seconds after it starts
and then every 6 hours (`electron-updater`). It downloads new versions in the background and
offers **Restart to update** in the tray, the main window and About. If you ignore that, the
update installs the next time you quit.

To publish a new version (needs the GitHub CLI logged in to an account with push access):

1. Change `"version"` in `package.json` (e.g. `1.0.1`), commit and push.
2. Run:

```bash
npm run release
```

This runs the tests, builds the installer and uploads it with `latest.yml` (the file the
updater reads) to a new `v1.0.1` release.

## Tests

```bash
npm test
```

## How it works

```
uiohook-napi (WH_KEYBOARD_LL / WH_MOUSE_LL on a native thread)
   └─► shortcut-engine.js     exact key-set matching, auto-repeat filter, stale-key eviction
        └─► dictation-controller.js   hold / double-tap lock / hands-free / cancel, 500 ms debounce
             ├─► overlay window   mic capture (AudioWorklet, 16 kHz mono) + status pill
             ├─► asr/             Whisper in an Electron utility process (or cloud API)
             ├─► text-cleanup.js  fillers, voice commands, dictionary
             └─► paster.js        clipboard snapshot → Ctrl+V via SendInput → restore
```

| File | Purpose |
|---|---|
| `src/main/main.js` | App wiring: tray, windows, IPC, dictation pipeline |
| `src/main/keyboard.js` | Global hook adapter + Start-menu masking for Win-key shortcuts |
| `src/main/shortcut-engine.js` | Port of Wispr Flow's Keyboard Service matching rules |
| `src/main/dictation-controller.js` | Port of Wispr Flow's push-to-talk state machine |
| `src/main/win32.js` | `SendInput` / `GetAsyncKeyState` via koffi |
| `src/main/paster.js` | Text insertion with clipboard restore |
| `src/main/asr/whisper-local.js` | Whisper via transformers.js + onnxruntime-node, language detection |
| `src/main/asr/cloud.js` | OpenAI-compatible `/audio/transcriptions` client |
| `src/renderer/overlay.*` | Floating pill + microphone recorder |
| `src/renderer/app.*` | Main window (Home, Dictionary, Settings, About) |

Data lives in `%APPDATA%\Pauli Speaks\`: `settings.json`, `history.json`, `models\`, `logs\`.

## Troubleshooting

- **Nothing happens when I hold Ctrl + Win.** Another dictation app (e.g. Wispr Flow) might be
  using the same shortcut. Quit it or change the shortcut in Settings.
- **Text doesn't appear in one specific app.** Windows blocks simulated input into apps running
  as administrator unless Pauli Speaks also runs as administrator. Use **Paste last transcript**,
  or copy from History.
- **"Microphone blocked".** Turn on *Windows Settings → Privacy & security → Microphone → Let
  desktop apps access your microphone*.
- **Slow transcription.** Use Whisper Base or Tiny, pick a single language, or switch to cloud
  mode with a free Groq key.
- Developer self-test: put a 16 kHz `speech.wav` in a folder and run with
  `PAULI_SELFTEST=<folder>`. The app transcribes the file, writes `selftest.json` and window
  screenshots to that folder, then quits.
