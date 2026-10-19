# Changelog

What changed in each version of Pauli Speaks. The app shows the newest section once after an update.

## 1.3.0

- Silence detection: only the parts where you speak go to the speech engine. If you say nothing, nothing is typed and the pill says "No speech detected"; if the microphone gives no sound at all, it says "No sound. Is your mic muted?" and warns you after 2 seconds while you are still recording. Settings has a "Silence detection" switch if words ever get cut.
- With Silence detection on, hands-free auto-stop waits for you to stop speaking instead of for the room to get quiet, so background noise no longer keeps it going.
- If a dictation can't be transcribed, the pill and the entry in History offer "Retry", and your recording is kept until you quit. Esc now shows "Cancelled. Undo" for 4 seconds.
- If the offline speech engine stops responding, the dictation now ends with "Couldn't transcribe." and a Retry button instead of staying on "processing", and the engine restarts by itself.
- Fixed: started from Firefox's download list, the offline speech engine stopped at once ("Speech engine stopped unexpectedly"), because Windows handed it the older ONNX Runtime that recent Windows 11 updates put in System32. Pauli Speaks now always uses its own.
- About has "Report a problem": it copies diagnostic info (versions, settings and recent log lines, never what you dictated or your API key) and opens a bug report on GitHub to paste it into.
- If Pauli Speaks crashes while you dictate, Home offers "Recover your last dictation?" the next time you start it.
- Dictating into a window that runs as administrator no longer fails silently: the text is left on the clipboard and the pill says "Copied. Press Ctrl+V (this app runs as administrator)".
- Dictated text is kept out of Windows clipboard history (Win+V) and cloud clipboard sync.
- New Settings → Privacy section: keep your transcript history, delete it after 24 hours or don't keep it; optionally keep recordings for 24 hours to play them back or transcribe them again; switch crash recovery off; "Delete all my data" and "Delete downloaded models".
- With the cloud engine and several languages chosen, a result in a language that isn't one of yours (Croatian heard as Polish or Bosnian, for example) is transcribed again in each of your languages, and the one the speech model is surest of is kept. If you keep speaking a language that isn't on your list (and isn't a close relative of one on it), Home asks "Sounds like <language>. Add it to your languages?".

## 1.2.0

- A guided setup opens the first time you start the app: it asks for your languages and microphone, picks a speech engine and shows what will be downloaded, lets you set your shortcut, and ends with a first dictation.
- Settings has a "Run setup again" button if you want to go through it again. People who already use the app get a card on Home that offers the setup.
- Home now warns you when Pauli Speaks can't see your shortcut, and when another dictation app is running that may use the same shortcut.
- If a speech model is downloaded but fails to load, the error on Home has a "Download again" button that fetches it fresh.
- A portable version (Pauli-Speaks-Portable) keeps its data in a folder next to the .exe and leaves nothing in the registry.
- Settings has a new Backup section: export your shortcuts, voice commands, dictionary, snippets and app styles to a file and import them on another PC. API keys are never included.
- About has "Get early versions" for trying pre-releases before everyone else. You still get every regular release.
