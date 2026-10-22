# Changelog

What changed in each version of Pauli Speaks. The app shows the newest section once after an update.

## 1.6.1

- The Modes page fits a narrow window: below about 1,000 px the list of modes moves above the editor and every field stays in view. On the Shortcuts page a shortcut's remove button stays on its own line, and Home's 7-day chart moves under the numbers.
- Home's status says "Model needed" until the speech model is downloaded (and "Downloading 42%", "Loading model…" or "Model didn't load" while that happens), instead of "Ready".
- A blocked or missing microphone gets a short message on the bar with a button that fixes it: "Open settings" opens the microphone privacy page in Windows, and "Choose mic" opens Settings → Microphone. What to do is shown above the bar.
- After you cancel a dictation the bar offers "Transcribe anyway" (it said "Undo").
- Easier to see, in the dark theme above all: grey text, switches, selected options and the delete buttons have more contrast, a switch that is off is an outline, the chosen option in a group has a coloured line under it, fields have a darker bottom edge that turns blue while you type, and links are a darker blue.
- Settings: a section link brings that section to the top and starts a screen reader there.
- Files: a "Choose file…" button, so you can pick a file with the keyboard.
- History and Modes show app names you know ("Word", "Outlook"), times without a leading zero (9:44 PM, with seconds when you point at them), and no typewriter font. "Clear" in History is now "Clear history…" and can't be pressed when there is nothing to clear.
- No more "Saved" pop-up after each change (Settings saves by itself), and a pop-up no longer follows you to another page.
- Clearer wording in places, in English and Croatian; the bar's "Auto" chip reads "Automatski" in Croatian.
- A calmer Windows 11 look: the sidebar sits on the window and the page on a lighter layer, one set of text sizes with headings in normal letters instead of capitals, Windows-style buttons, fields, switches and option groups, and Windows' own icons (a house for Home, and Modes and Settings no longer look the same).
- Anything that deletes or resets asks first in the app's own window, which says what goes ("Deletes all 213 transcripts"), starts on Cancel and closes with Esc. The plain OK/Cancel boxes and the pink box in Settings → Privacy are gone.
- Home shows one notice at a time, the most important first, with ‹ › for the others and ✕ for those you can dismiss. What's new is one line that opens the notes.
- Buttons with only an icon say what they do when you point at them or reach them with Tab; option groups such as GPU / CPU only can be changed with the arrow keys; the keys on Home press down while you talk; and in a Windows contrast theme every switch, button and field keeps an edge.
- A tidier sidebar: Home, History and Files first, then Shortcuts, Modes and Dictionary & snippets under "Customize", and Settings at the bottom with a status line that says whether dictation is ready, which microphone it uses and whether it translates. In a window under 1,000 px wide the sidebar shrinks to icons.
- Home starts with your key: "Hold F13 to talk anywhere", with a large key that presses down while you talk, the Download button when the speech model is missing, quick choices for the language, the mode and the microphone, and a one-line field to try it. Below it: Recent, and This week as four numbers and a small chart (or one line until your first dictation).
- Settings is in sections (General, Speech & microphone, Translation, AI, Cloud services, Read aloud, Privacy & data, About & updates): pick one on the left and only that one shows. The search looks through all of them, and finds things on other pages too ("Shortcuts › Read aloud"). About is one of these sections now, and the Groq key has its own place, Cloud services, which says what uses it.
- One list of speech models in Settings, each saying whether it is downloaded and how big it is, with Download or Delete beside it.
- History has filters for the app, the language and the mode, and a ⋯ menu with Clear history. Under each transcript: "Word · 9 words", with the time it took in the tooltip.
- Shortcuts: "Test a key" opens a small tester under the title, an action without a shortcut is one short line with "Add shortcut", each Hold / Toggle / Both says what it does under it, the voice commands are a "You say / It does" table, and the pedal and link help is folded away.
- Modes: the editor is in groups (Identity, When it's used, What it does, AI polish), the style says what the chosen style does, the link is folded away, and Delete is at the bottom.
- Files says when the speech model is missing, shows how far a file has got ("12:04 of 42:10"), translating is a switch, and the files from this session are listed to open again.
- Choose the theme in Settings › General: System (follows Windows), Light or Dark. The window, its Windows 11 backdrop and the bar follow it, and the bar is light in the light theme.

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
