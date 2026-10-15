# Pauli Speaks: what to build next

Prioritised with the product-lens "feature prioritization" method:
**ICE = Impact × Confidence ÷ Effort** (each 1–5). Higher is better.

**Who it's for:** someone who writes a lot on Windows (chat, email, code, school), in
Croatian and English, and wants push-to-talk dictation without paying or sending audio
to a server.
**What success looks like:** most days have at least one dictation, and "time saved" keeps
growing. Both are already measured on the Transcripts page.
**Anti-goals:** accounts, cloud sync, team features, a meeting bot. They add cost and
privacy risk, and the target user doesn't need them.

## Shipped in this round

| Feature | Notes |
|---|---|
| Speak Croatian → paste English (or 30+ languages) | "Always translate" toggle, target language, Fast (Whisper) / Best (NLLB-200) quality, plus a **Ctrl+Win+Shift** hold-to-translate shortcut that can be added mid-sentence |
| Redesign ("quiet instrument") | Transcripts first, keycap shortcuts, live status chip, Windows-style settings rows |
| History search, "show original" for translations | |
| Microphone level test | Settings → Microphone → Test |

## Status (round 3)

Built: #1 GPU (DirectML, measured 2–3× faster), #2 snippets, #3 auto-stop on silence,
#4 dictionary as Whisper prompt (verified "polyspeaks" → "Pauli Speaks" without the dictionary
fix-up), #5 per-app styles, #6 weekly chart and streak, #7 file transcription with SRT,
#8 command mode, #9 live preview, #11 read aloud.

Not built: **#10 auto-update**. It needs a place to publish releases (e.g. a GitHub repository
with Releases). Once one exists, add `electron-updater` with a `publish` block in
`package.json`'s `build` section.

## Candidates, ranked

| # | Feature | What it does | I | C | E | ICE |
|---|---|---|---|---|---|---|
| 1 | **GPU acceleration (DirectML)** | onnxruntime-node already ships `DirectML.dll`; running Whisper with `device: 'dml'` should make Small/Turbo several times faster on any DX12 GPU | 5 | 3 | 1 | **15** |
| 2 | **Snippets / voice shortcuts** | Say "my email" → pastes your address; say "sign off" → full signature. paid apps charge for this | 4 | 5 | 2 | **10** |
| 3 | **Auto-stop on silence** (hands-free) | Ends a hands-free dictation after N seconds of silence, so there's no second keypress | 3 | 5 | 2 | 7.5 |
| 4 | **Dictionary as Whisper prompt** | Feeds dictionary words to Whisper as the initial prompt, so names are recognised correctly instead of only being fixed afterwards | 4 | 3 | 2 | 6 |
| 5 | **Per-app behaviour** | e.g. in VS Code / terminal: no auto-capitalisation or trailing period; in Slack: no trailing period. Uses `GetForegroundWindow` → exe name | 4 | 4 | 3 | 5.3 |
| 6 | **Weekly stats & streaks** | Small chart of words per day | 2 | 5 | 2 | 5 |
| 7 | **Transcribe a file** | Drag an audio/video file onto the window → text, `.txt` / `.srt` export | 3 | 5 | 3 | 5 |
| 8 | **Command mode with a free LLM** | Select text, hold a shortcut, say "make this more formal" / "fix grammar"; uses Groq's free Llama endpoint (cloud key) | 5 | 3 | 4 | 3.75 |
| 9 | **Live preview while speaking** | Partial transcript shown in the overlay every ~2 s | 4 | 3 | 4 | 3 |
| 10 | **Auto-update** | electron-updater + GitHub Releases | 3 | 4 | 4 | 3 |
| 11 | **Read aloud** | Shortcut speaks the selected text (Windows TTS); also good for proof-reading | 2 | 4 | 3 | 2.7 |

## Recommendation

Next build: **#1 GPU acceleration** (it removes the main reason to pick a smaller, less
accurate model, which matters for Croatian) and **#2 Snippets**, the most visible "wow"
feature for the least work. Then #3 and #5 as quick follow-ups.

Next step for #1: try `device: 'dml'` in `src/main/asr/whisper-local.js` with a CPU fallback
on error, and measure Whisper Small on 10 s of speech.
