# Pauli Speaks for Stream Deck

Five Stream Deck buttons for [Pauli Speaks](https://github.com/izscaryu/pauli-speaks):
**Toggle dictation**, **Start**, **Stop**, **Cancel** and **Paste last**.

The buttons only send commands to the app. The plugin makes no network calls, reads nothing
back from the app, and the keys always show the same image. They don't light up while you
dictate; the Pauli Speaks pill on screen shows that.

Needs Windows 10 or 11, Stream Deck 7.1 or newer, and Pauli Speaks installed with its normal
installer. (The portable version has no `pauli-speaks://` links, so only Paste last works with it,
and only once you enter its path.)

## Install

1. Get `com.pauli.speaks.streamdeck.streamDeckPlugin`: build it (below) or take it from a release.
2. Double-click it. Stream Deck asks to install it.
3. Drag the buttons from the **Pauli Speaks** group onto your keys.

## What each button does

| Button | What it sends | What happens |
|---|---|---|
| Toggle dictation | `pauli-speaks://dictate/toggle` | Starts dictation; press again to stop and paste. |
| Start | `pauli-speaks://dictate/start` | Starts hands-free dictation (keeps listening until you stop it). Does nothing while the app is still busy with the last one. |
| Stop | `pauli-speaks://dictate/stop` | Stops dictation and pastes the text. |
| Cancel | `pauli-speaks://dictate/cancel` | Stops dictation and throws the recording away. Nothing is pasted. |
| Paste last | `"Pauli Speaks.exe" --paste-last` | Pastes the last dictated text again, where the cursor is. |

The text goes into whatever window has the keyboard focus, as with the app's own shortcuts.
If Pauli Speaks isn't running, any button starts it first.

**Mode** (Toggle and Start): in the key's settings you can enter a mode id, for example `code`. It
is the end of the mode's link on the **Modes** page in Pauli Speaks (`…?mode=code`). Leave it empty
and the app picks the mode as usual. An id may only use letters, digits, `-` and `_`; the key shows a
warning triangle if it doesn't fit.

**Why Paste last runs the app instead of a link:** any web page can open a link, so the app lets
links only start and stop dictation. Pasting needs the app's command line, which only programs
already on your PC can use. The plugin finds the app here, in this order:

1. the program Windows opens `pauli-speaks://` links with (so a changed install folder is found),
2. `%LOCALAPPDATA%\Programs\Pauli Speaks\Pauli Speaks.exe`, where the installer puts it,
3. `%ProgramFiles%\Pauli Speaks\Pauli Speaks.exe`.

The Paste last key's settings show which file it found. To use another one, enter the full path to
`Pauli Speaks.exe` there; **Find it again** goes back to finding it by itself. The path is shared by
every Paste last key.

If a key shows a warning triangle, the plugin's log says why:
`%APPDATA%\Elgato\StreamDeck\Plugins\com.pauli.speaks.streamdeck.sdPlugin\logs`.

## Build

Needs Node.js 24 or newer.

```bash
cd integrations/streamdeck
npm install
npm run pack
```

`npm run pack` bundles the code into `com.pauli.speaks.streamdeck.sdPlugin/bin/plugin.js` and runs
`streamdeck pack` (Elgato's CLI), which checks the manifest and writes
`dist/com.pauli.speaks.streamdeck.streamDeckPlugin`. It runs with `--no-update-check`, so it works
offline.

While working on it: `npm run link` builds and links the folder into Stream Deck, and
`npm run restart` reloads the plugin after a change. `npm run validate` checks the manifest only.

## Files

| Path | What it is |
|---|---|
| `lib/commands.js` | What each button sends, the mode check, where to look for the app. Plain CommonJS, tested by the app's `npm test` (`test/streamdeck-commands.test.js`), which also checks every link against the app's own parser. |
| `src/plugin.mjs` | The plugin: on a key press, opens the link or starts the exe. |
| `com.pauli.speaks.streamdeck.sdPlugin/manifest.json` | Actions, images, Stream Deck and Node.js versions. |
| `com.pauli.speaks.streamdeck.sdPlugin/ui/inspector.html` | The key settings (mode, app path). Self-contained: no web components from a CDN. |
| `scripts/make-images.mjs` | Draws the key and list images (SVG) in the app's ink and coral. `imgs/plugin.png` and `plugin@2x.png` are the app icon from `scripts/make-icon.js` at 256 and 512 px. |

The SDK (`@elgato/streamdeck`), the CLI (`@elgato/cli`) and Rollup are pinned to exact versions in
this folder's `package.json`; none of them is added to the app.
