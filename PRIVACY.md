# Privacy

Pauli Speaks turns your speech into text **on your own PC**. There is no account, no analytics
and no telemetry. Nothing you say leaves your computer unless you turn on a cloud option, and
the app says so next to that option.

## What stays on your PC

- **Audio.** The microphone is recorded only while you dictate. The recording is kept in memory
  until it has been turned into text, and is never saved to disk.
- **Transcripts.** Your last 500 dictations are kept in History so you can copy or paste them
  again. Clear them any time with *Clear* on the Transcripts page.
- **Your dictionary, snippets, voice commands and settings.**
- **Logs.** For troubleshooting, the app logs timings, the detected language, the name of the app
  you dictated into (for example `chrome.exe`), which voice commands ran, and errors. It doesn't
  log what you said.

## What leaves your PC, only if you choose it

| You turn on | What is sent | To |
|---|---|---|
| **Cloud API** speech recognition (Settings → Speech recognition) | The audio of each dictation, and of files you transcribe | The provider you set up (Groq by default: `api.groq.com`) |
| **Command mode** (select text, hold the command shortcut, speak) | The selected text and your spoken instruction (as text) | The same provider |

These options need an API key that you get from the provider yourself. The key is encrypted
with Windows (DPAPI) and stored in your settings file. On a PC where Windows encryption isn't
available, it is stored unencrypted. What the provider does with your data is governed by its
own privacy policy.

## Network connections the app makes by itself

- **Update checks** to GitHub (`github.com` and GitHub's download servers), 15 seconds after
  start and then every 6 hours. Only the release information and, when there is an update, the
  installer are downloaded. Nothing about you or your use of the app is sent beyond what any web
  request contains (your IP address, for example). The portable copy makes the same check but
  never downloads anything; About shows a link to the new version instead. With *About → Get
  early versions* on, the same check also looks at GitHub pre-releases.
- **Model downloads** from Hugging Face (`huggingface.co` and its download servers), the first
  time you use a speech or translation model. After that the model works offline.

Nothing else. *Read aloud* uses the voices installed in Windows. The `pauli-speaks://` links and
command-line flags only control the app on your PC.

## Where your data is, and how to delete it

Everything is in `%APPDATA%\Pauli Speaks\` (paste that into the Explorer address bar, or use
About → *Data folder*). The portable copy keeps the same files in a `Pauli Speaks Data` folder
next to its `.exe` instead; to delete everything, delete the `.exe` and that folder.

| File or folder | Contains |
|---|---|
| `settings.json` | Settings, dictionary, snippets, voice commands, the encrypted API key. Older copies (`settings.v1.json`, …) are kept after an upgrade. |
| `history.json` | Your last 500 transcripts |
| `models\` | Downloaded speech and translation models (can be several GB) |
| `logs\` | Log files |

To delete everything: quit Pauli Speaks (tray icon → *Quit Pauli Speaks*), uninstall it from
Windows Settings → Apps, then delete the `%APPDATA%\Pauli Speaks` folder.

## Questions

Open an issue at [github.com/izscaryu/pauli-speaks/issues](https://github.com/izscaryu/pauli-speaks/issues).
Changes to this statement are visible in this file's history.
