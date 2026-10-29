# Changelog

What changed in each version of Pauli Speaks. The app shows the newest section once after an update.

## 1.8.0

- Fixed: with a shortcut set to Both, double-tapping a combination like Ctrl+Win didn't keep listening: the bar said "Hold Ctrl+Win while you speak" instead. Tapping two keys twice takes a moment longer, and the second tap now counts from when you let go of the first. When a tap is too quick or too slow, the bar reminds you that you can hold the shortcut or double-tap it.

## 1.7.0

- A new look, closer to Windows 11: calmer colours with more contrast (in the dark theme above all), one set of text sizes, Windows-style buttons, fields, switches and option groups, Windows' own icons and a thin scrollbar.
- Choose the theme in Settings › General: System (follows Windows), Light or Dark. The window, its Windows 11 backdrop and the bar follow it; the bar is light in the light theme.
- A tidier sidebar: Home, History and Files first, then Shortcuts, Modes and Dictionary & snippets under "Customize", and Settings at the bottom with a status line that says whether dictation is ready, which microphone it uses and whether it translates. In a window under 1,000 px wide it shrinks to icons, and every page fits.
- Home starts with your shortcut ("Hold F13 to talk anywhere"; the key presses down while you talk), says "Model needed" with a Download button until the speech model is there, and has quick choices for the language, the mode and the microphone, and a field to try it. Notices show one at a time, then Recent, then This week as four numbers and a small chart.
- Settings is in sections (General, Speech & microphone, Translation, AI, Cloud services, Read aloud, Privacy & data, About & updates): pick one on the left and only that one shows. The search looks through all of them and finds things on other pages too. About is one of the sections now, the Groq key has its own place (Cloud services, which says what uses it), and the speech models are one list with their size and Download or Delete.
- History: filters for the app, the language and the mode, app names you know ("Word", not WINWORD), times like 9:44 PM, and Clear history in a ⋯ menu.
- Shortcuts: "Test a key" opens a small tester, an action without a shortcut is one short line with "Add shortcut", each Hold / Toggle / Both says what it does, the voice commands are a "You say / It does" table, and the pedal and link help is folded away.
- Modes: all your modes in view, the editor in groups (Identity, When it's used, What it does, AI polish), the style says what it does, and Delete is at the bottom.
- Files: a "Choose file…" button (so the keyboard can open a file), a note when the speech model is missing, how far a file has got ("12:04 of 42:10"), and this session's files to open again.
- The bar: a blocked or missing microphone gets a short message and a button that fixes it ("Open settings" opens the microphone privacy page in Windows, "Choose mic" opens Settings › Microphone). After you cancel a dictation it offers "Transcribe anyway".
- Anything that deletes or resets asks first in the app's own window, which says what goes, starts on Cancel and closes with Esc.
- Easier with a keyboard and a screen reader: buttons with only an icon say what they do, option groups work with the arrow keys, and a Windows contrast theme keeps every control's edge. No more "Saved" pop-up after each change, and clearer wording in English and Croatian.

## 1.6.0

- AI polish (off by default): give a mode a level on the Modes page and an AI model tidies what you said before it is pasted. Light fixes punctuation and obvious mis-hearings, Medium also takes out repetitions and false starts, High rewrites clearly, and Prompt turns rambling into clear instructions for ChatGPT, Claude or a terminal, with file names and code kept exactly as said. Each mode can add its own instructions ("Use British spelling").
- It runs on your PC: Settings → AI polish finds Ollama and LM Studio, or sets up Foundry Local for you (it lists the models with their size and downloads one only after you confirm). The cloud API or another server works too, and Settings says next to each choice whether your text leaves the PC.
- Polish never holds a dictation up: if the model takes longer than 2.5 seconds (4 in the cloud), fails, or answers with something that isn't your text, your words are pasted as you said them. Dictations under four words aren't polished.
- After a polished paste the pill shows "Polished. Undo" for 4 seconds: Undo takes the polished text back and pastes what you said. History keeps both versions.
- A Windows 11 look: on Windows 11 the window uses Mica (the desktop's colour shows through softly), with Windows 11 corners and type. The sidebar now reads Home, Shortcuts, Modes, Dictionary & snippets, History, Files and Settings: History has its own page, and Home shows your three most recent dictations.
- Settings has links to each section and a search box that keeps only the settings that match.
- A new icon: an ink tile with a coral voice line. The tray icon shows when Pauli Speaks is listening (coral) or working (amber).
- The pill: with two or more languages, click the language chip while you speak to pick the language for that dictation. Drag the pill to the left, the centre or the right of the screen, and it stays there.
- Easier to use with a keyboard, a screen reader or a Windows contrast theme: the current page is announced, contrast themes use your system colours, text in the light theme is easier to read, and "Reduce motion" stops the pill's pulsing and the page animations.
- Your settings file is brought up to date (the old one is kept as settings.v7.json).

## 1.5.1

- Fixed: since 1.3.0 the installed app stopped part-way through starting. The tray icon, the floating bar, your shortcuts and automatic updates were missing, while the window still opened. If your copy is 1.3.0 to 1.5.0, end Pauli Speaks in Task Manager, then install this version from the GitHub releases page: the old version can't update itself.

## 1.5.0

- Modes: a mode bundles the language you speak, a language to translate into, a style and voice commands. Give a mode its own shortcut ("F13 → Croatian chat"), let it switch on by itself when an app is in front ("Outlook → formal English", "VS Code → code style"), or start it with a link or flag (`pauli-speaks://dictate/toggle?mode=code`, `--mode=code`). Set them up on the new Modes page.
- Each Dictate shortcut has a mode: Automatic (the app in front decides) or one you pick. Dictate takes up to eight shortcuts, so each mode can have one.
- The Switch mode shortcut works: it steps through your modes and back to Automatic, also while you talk. The pill shows the mode's colour and name while you dictate.
- Your settings come along: App styles become the Chat, Code and Formal modes with the same apps, "Always translate" becomes a translating mode, and the Talk & translate shortcut opens the new "Translate to …" mode. Your old settings file is kept as settings.v6.json.
- Command mode listens in the language of the mode you are in.
- Backups now carry your modes instead of app styles; a backup from an older version brings its app styles in as modes.
- Settings → Speech shows the downloaded speech and translation models with their size and when each was last used, and deletes them one at a time.

## 1.4.0

- Pauli Speaks speaks your language: the app, the welcome setup, the bar and the tray menu are in Croatian (Hrvatski) as well as English. It follows the Windows language; Settings → Language changes it. Dates and numbers follow it too.
- Picking your languages in the welcome setup adds voice commands in them: German, Spanish, Italian, Polish, Slovenian and Serbian join English and Croatian ("neue Zeile", "abschicken", "lösch das"…).
- A new language is one file: CONTRIBUTING.md explains how to translate Pauli Speaks.

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
