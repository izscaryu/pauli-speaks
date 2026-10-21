---
name: pauli-speaks
description: Start and stop hands-free voice dictation in Pauli Speaks (a local, private voice typing app for Windows) through its pauli-speaks:// links, so the user can speak instead of type. Use when the user on Windows asks to "start dictation", "let me talk", "listen to me", "start Pauli", "stop dictation", "stop listening" or "cancel dictation", optionally in a named Pauli Speaks mode (e.g. "dictate in code mode").
---

# Pauli Speaks

[Pauli Speaks](https://github.com/izscaryu/pauli-speaks) turns speech into text on Windows, on the
user's own PC. It registers `pauli-speaks://` links, so any command line can start and stop
dictation. This skill installs and configures nothing, and sends nothing anywhere.

Typical use: the user wants to say their next message instead of typing it. Start dictation, they
talk, and Pauli Speaks pastes the text where the cursor is when dictation stops.

Needs Pauli Speaks installed with its normal installer (the portable version has no links).

## Start dictation (hands-free)

From cmd:

```bat
start "" "pauli-speaks://dictate/start"
```

From a Bash shell on Windows (Git Bash, as Claude Code uses), go through cmd:

```bash
cmd //c start "" "pauli-speaks://dictate/start"
```

From PowerShell:

```powershell
Start-Process "pauli-speaks://dictate/start"
```

It keeps listening until it is stopped. If Pauli Speaks isn't running, the link starts it. The
empty `""` after `start` is the window title; without it cmd takes the link for a title. The
examples below use the cmd form; swap in the one for your shell.

To use one of the user's modes, add its id (shown at the end of the mode's link on the app's
**Modes** page):

```bat
start "" "pauli-speaks://dictate/start?mode=code"
```

A mode id is letters, digits, `-` and `_` only (at most 40). Put nothing else in the link; the app
ignores a mode that isn't a plain id.

## Stop and paste

```bat
start "" "pauli-speaks://dictate/stop"
```

Stops listening, turns the speech into text and pastes it.

## Cancel

```bat
start "" "pauli-speaks://dictate/cancel"
```

Stops listening and throws the recording away. Nothing is pasted.

## Limits

- **You can't read back what was said.** The links only start and stop dictation; nothing comes
  back to the command line. Pauli Speaks pastes into the window that has the keyboard focus. If
  the user wants to talk to you, their cursor must be in your input box, and the text arrives
  there as their next message. Don't go looking for it in the app's history or data folders.
- **No answer, no state.** Opening a link returns at once, whether or not dictation started. You
  can't ask whether it is listening; the user sees that on the app's pill.
- **Start is ignored while the app is busy** (still turning the last dictation into text). Tell the
  user to try again in a moment rather than sending links in a loop.
- **Only when asked.** The microphone is the user's: start dictation only when they ask, and say it
  is on and how it ends ("Listening. Press your Pauli Speaks shortcut, or ask me, to stop.").
- **Links can't paste, press keys or change settings.** The app allows only dictation through
  links, because any web page can open one. Other actions (paste last, undo last, press Enter) need
  the app's command line, e.g. `"%LOCALAPPDATA%\Programs\Pauli Speaks\Pauli Speaks.exe" --paste-last`;
  use those only when the user asks for exactly that.
- **Windows only.** On macOS or Linux there is no Pauli Speaks; say so instead of trying.
