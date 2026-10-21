# Privacy

Pauli Speaks turns your speech into text **on your own PC**. There is no account, no analytics
and no telemetry. Nothing you say leaves your computer unless you turn on a cloud option, and
the app says so next to that option.

## What stays on your PC

- **Audio.** The microphone is recorded only while you dictate. *Silence detection* (Settings →
  Dictation) finds the speech in it with a small model that ships with the app and runs on your PC;
  it downloads nothing and sends nothing. So that a crash doesn't lose what
  you said, a copy of the recording in progress is written to the `recovery\` folder while you
  dictate. It is the raw audio and is not encrypted. It is deleted when the dictation ends: after the
  text is pasted, 4 seconds after you cancel (while you can still undo), or when no speech was heard.
  If the app crashes or is closed while you dictate, the copy stays in that folder. The next time
  Pauli Speaks starts, Home asks whether to recover it (it is transcribed and copied to your
  clipboard) or discard it, and the copy is deleted after either choice. A leftover copy shorter than
  half a second is deleted at start without asking. A dictation you start before choosing replaces
  the leftover copy. You can turn this off under **Settings → Privacy → Recover dictation after a
  crash** (on by default): nothing is written while you dictate, and turning it off deletes any
  leftover copy straight away (and at every start), unless a dictation is running right then, in which
  case that one finishes as usual and the next ones aren't written.
- **Recordings (off by default).** With **Settings → Privacy → Keep recordings for 24 hours** on, the
  audio of each dictation is saved as a 16 kHz mono WAV file in the `audio\` folder, named after its
  History entry, and not encrypted. History then shows a play button on that entry and Retry
  transcribes the recording again (a normal entry gets the new text, which is copied). Recordings are
  deleted 24 hours after they were made (checked every hour and at start), when you delete the entry
  or clear History, when no History entry lists them any more (at once when a *Transcript history*
  change deletes entries, otherwise at the hourly check), and all at once when you turn the
  switch off. A dictation that couldn't be transcribed is saved the same way, so Retry works after a
  restart.
- **Retry and Undo.** If a dictation can't be transcribed (for example the cloud service is
  unreachable), its audio is kept in memory, not on disk (unless *Keep recordings for 24 hours* is on), so you can retry it from the pill or from
  History until you quit Pauli Speaks. At most the last 5 such recordings or 10 minutes of audio are
  kept; deleting the entry in History deletes its audio. A cancelled dictation is kept in memory the
  same way for 4 seconds, so you can undo the cancel.
- **Transcripts.** By default your last 500 dictations are kept in History so you can copy or paste
  them again. A dictation that couldn't be transcribed is listed there too, with the error and without
  text. **Settings → Privacy → Transcript history** changes that: *Keep* (the default), *Delete
  after 24 hours* (older entries are deleted, checked every hour and at start) or *Don't keep*
  (nothing is written to `history.json`, and what was saved is deleted when you choose it). When the
  choice would delete saved entries, the app first asks, with how many, and changes nothing if you
  cancel. With
  *Don't keep* and *Delete after 24 hours* the entries and failed dictations follow the same rule.
  With *Don't keep* a dictation stays in the list in memory until you close Pauli Speaks, so *Paste
  last*, *Copy last* and *Undo last dictation* still work for the current session. Clear them any
  time with *Clear* on the Transcripts page.
- **Clipboard history.** To paste, Pauli Speaks briefly puts your text on the clipboard. That
  temporary text is marked, whenever Windows allows it (in the rare case it doesn't, a plain copy is made and the log says so), so that Windows clipboard history (Win+V) and cloud clipboard sync don't
  record it, and clipboard managers that respect the marking skip it. Your own clipboard content is
  put back afterwards unless you turned that off. When the app in front runs as administrator,
  Windows doesn't allow the paste: the text then stays on the clipboard (still marked, and your earlier
  clipboard content is not put back) so you can press Ctrl+V yourself. The text copied after *Retry*
  in History and after *Recover* is marked the same way. What you copy yourself (*Copy last* and
  *Copy* in History) is an ordinary copy, which Windows clipboard history may keep.
- **AI polish on this PC (off by default).** With **Settings → AI polish** set to Ollama, LM Studio, Foundry
  Local or another server at `localhost`/`127.0.0.1`, the text of each dictation in a mode with a polish level
  (after the usual clean-up, plus the mode's own instructions) goes to that program on your PC, and its answer
  is pasted. Nothing leaves the PC for it. History then keeps both versions (what you said and the polished
  text), so *Undo* can put back what you said. Opening Settings with Ollama or LM Studio chosen, or pressing
  *Find*, asks `127.0.0.1` (ports 11434 and 1234) whether they run. Foundry Local runs its model inside Pauli
  Speaks and keeps its models in `models\foundry`.
- **Your dictionary, snippets, voice commands and settings.**
- **Logs.** For troubleshooting, the app logs timings, the detected language, the name of the app
  you dictated into (for example `chrome.exe`), which voice commands ran, and errors. It doesn't
  log what you said.

## What leaves your PC, only if you choose it

| You turn on | What is sent | To |
|---|---|---|
| **Cloud API** speech recognition (Settings → Speech recognition) | The audio of each dictation, and of files you transcribe, plus your dictionary words as a hint for the recognition (while *Use dictionary words as hints* is on) | The provider you set up (Groq by default: `api.groq.com`) |
| **Command mode** (select text, hold the command shortcut, speak) | The selected text and your spoken instruction (as text) | The same provider |
| **AI polish** with *Cloud API*, or *Another server* at an address that isn't this PC (Settings → AI polish, and a polish level on a mode) | The text of each dictation in that mode (after clean-up; not the audio) and the mode's own polish instructions | The Cloud API provider (Groq by default: `api.groq.com`), or the server you entered. A custom server's API key is encrypted like the Cloud API key |
| **AI polish with Foundry Local**: *Show models* and *Download* | Which models are offered, and the model you download. Your text is never sent | Microsoft's Foundry Local catalogue and its download servers (`ai.azure.com`, Azure storage) |

With Cloud API recognition and several languages chosen, a dictation that comes back in a language that isn't one of yours (for example Polish or Bosnian when you chose Croatian and English) is sent again to the same provider, once for each of your languages, and the result the speech model is surest of is kept. Files you transcribe are not sent more than once.

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

- **Foundry Local, only while it is chosen for AI polish.** Pauli Speaks starts Microsoft's Foundry Local with
  its optional telemetry switched off. Microsoft documents that Foundry Local may still send a minimal event
  about the process (`ProcessInfo`) to Microsoft (`mobile.events.data.microsoft.com`) when it starts; it
  contains nothing you dictated. Choose another AI polish option to avoid it.

Nothing else. *Read aloud* uses the voices installed in Windows. The `pauli-speaks://` links and
command-line flags only control the app on your PC.

## Where your data is, and how to delete it

Everything is in `%APPDATA%\Pauli Speaks\` (paste that into the Explorer address bar, or use
About → *Data folder*). The portable copy keeps the same files in a `Pauli Speaks Data` folder
next to its `.exe` instead; to delete everything, delete the `.exe` and that folder.

| File or folder | Contains |
|---|---|
| `settings.json` | Settings, dictionary, snippets, voice commands, the encrypted API key. Older copies (`settings.v1.json`, …) are kept after an upgrade. |
| `history.json` | Your last 500 transcripts (empty with *Don't keep*, only the last 24 hours with *Delete after 24 hours*) |
| `audio\` | Recordings, one WAV file per History entry (`<id>.wav`), only with *Keep recordings for 24 hours*. Deleted after 24 hours |
| `models\` | Downloaded speech and translation models, and Foundry Local's AI polish models in `models\foundry` (can be several GB) |
| `logs\` | Log files |
| `recovery\` | Unencrypted audio of the dictation in progress (`current.pcm`, and `current.json` with its start time and mode). Deleted when the dictation ends; after a crash or a quit mid-dictation it stays until you choose Recover or Discard on the next start (or until a new dictation replaces it). A copy under half a second is deleted at start |

**Delete all my data** (Settings → Privacy) deletes your history, the recordings, a leftover crash
recording, the recordings kept in memory for Retry and Undo, your dictionary, snippets and settings
(including the API key and the older `settings.v<N>.json` copies). It waits until no dictation is
running (finish or cancel it first). Settings go back to their defaults and the welcome setup runs again the
next time you open the app. Downloaded models are kept; **Delete downloaded models** removes the
models (and nothing else) after its own confirmation, and they are downloaded again when you need
them; it waits until no dictation, file transcription or model download is running. Logs are not touched by either button.

To remove everything including logs: quit Pauli Speaks (tray icon → *Quit Pauli Speaks*), uninstall it from
Windows Settings → Apps, then delete the `%APPDATA%\Pauli Speaks` folder.

## Questions

Open an issue at [github.com/izscaryu/pauli-speaks/issues](https://github.com/izscaryu/pauli-speaks/issues).
Changes to this statement are visible in this file's history.
