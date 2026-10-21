# Third-party notices

Pauli Speaks is open source under the [MIT License](LICENSE). It is built on other people's
open-source work, listed here with their licences. Thank you to everyone who made it.

Versions are those used by Pauli Speaks 1.1.0. The full licence text of every bundled package
is inside the installed app (`resources\app.asar` and
`resources\app.asar.unpacked\node_modules\<package>\LICENSE`). This file, `LICENSE`,
`LICENSE.electron.txt` and `LICENSES.chromium.html` are next to `Pauli Speaks.exe` in the
install folder.

## Speech and translation models (downloaded when you first use them)

The models are not part of the installer. The app downloads them from Hugging Face the first
time you use them and keeps them in `%APPDATA%\Pauli Speaks\models`.

| Model | Used for | By | Licence |
|---|---|---|---|
| Whisper Tiny, Base, Small ([ONNX conversions](https://huggingface.co/onnx-community)) | Speech recognition | OpenAI | Released by OpenAI under the [MIT License](https://github.com/openai/whisper/blob/main/LICENSE); the Hugging Face model cards list [Apache-2.0](https://huggingface.co/openai/whisper-base) |
| Whisper Large v3 Turbo ([ONNX conversion](https://huggingface.co/onnx-community/whisper-large-v3-turbo)) | Speech recognition | OpenAI | [MIT](https://huggingface.co/openai/whisper-large-v3-turbo) |
| NLLB-200 distilled 600M ([ONNX conversion](https://huggingface.co/Xenova/nllb-200-distilled-600M)) | *Best* translation | Meta AI | **[CC-BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)** |

**NLLB-200 is licensed for non-commercial use only.** Pauli Speaks is free, so it may use it,
but the *Best* translation option can't be part of anything sold. NLLB-200 is the work of the
NLLB Team, Meta AI: "No Language Left Behind: Scaling Human-Centered Machine Translation"
(2022), [facebook/nllb-200-distilled-600M](https://huggingface.co/facebook/nllb-200-distilled-600M).
The *Fast* translation option uses Whisper and doesn't download NLLB-200.

### AI polish models from Foundry Local (only if you download one)

With **Settings → AI polish → Foundry Local**, the app lists chat models from Microsoft's Foundry Local
catalogue (Qwen 2.5, Phi and others), each with its size and licence, and downloads the one you pick after you
confirm. It is kept in `%APPDATA%\Pauli Speaks\models\foundry`. The licence of each model is shown next to it
in the app (Apache-2.0 or MIT for the models offered); the models are the work of their publishers (Alibaba
Cloud's Qwen team, Microsoft and others).

## Main components in the installer

| Component | What it does here | Licence |
|---|---|---|
| [Electron](https://github.com/electron/electron) 44 (includes Chromium, Node.js and FFmpeg) | The app itself | MIT; Chromium and its parts under their own licences (see `LICENSES.chromium.html`) |
| [Transformers.js](https://github.com/huggingface/transformers.js) and [tokenizers.js](https://github.com/huggingface/tokenizers.js) | Runs Whisper and NLLB-200 | Apache-2.0 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (`onnxruntime-node`) | Model inference on CPU and GPU | MIT |
| DirectML (`DirectML.dll`), shipped with ONNX Runtime | GPU acceleration | Microsoft DirectML licence terms (redistributable) |
| [DirectX Shader Compiler](https://github.com/microsoft/DirectXShaderCompiler) (`dxcompiler.dll`, `dxil.dll`), shipped with ONNX Runtime | GPU acceleration | See its repository's licence |
| [uiohook-napi](https://github.com/SnosMe/uiohook-napi) | Watches for your shortcut | MIT |
| [libuiohook](https://github.com/kwhat/libuiohook), compiled into uiohook-napi | Keyboard and mouse hook | LGPL-3.0-or-later |
| [Koffi](https://koffi.dev/) | Calls Windows functions (key presses for pasting) | MIT |
| [electron-updater](https://github.com/electron-userland/electron-builder) | Automatic updates from GitHub Releases | MIT |
| [sharp](https://sharp.pixelplumbing.com) | Image library required by Transformers.js | Apache-2.0 |
| [libvips](https://github.com/libvips/libvips) (`libvips-42.dll`, in `@img/sharp-win32-x64`) | Used by sharp | LGPL-3.0-or-later |
| [Silero VAD](https://github.com/snakers4/silero-vad) v6.2.3 (`assets\models\silero_vad.onnx`, inside `app.asar`) | Finds the parts of a recording that are speech | MIT |
| [Foundry Local SDK](https://github.com/microsoft/Foundry-Local) (`foundry-local-sdk` 2.1.0, with `foundry_local.dll`) | Runs an AI polish model on this PC, only when you choose Foundry Local | MIT |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) 1.30.0 and [ONNX Runtime GenAI](https://github.com/microsoft/onnxruntime-genai) 0.17.1, shipped with the Foundry Local SDK | Runs that model | MIT |

### Silero VAD model

The voice-activity model is part of the installer, so nothing is downloaded for it. It is the
unmodified `silero_vad.onnx` from the Silero VAD release tag
[v6.2.3](https://github.com/snakers4/silero-vad/releases/tag/v6.2.3), taken from
`https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx`
(SHA-256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`). Silero VAD is
the work of the Silero Team, released under the
[MIT License](https://github.com/snakers4/silero-vad/blob/v6.2.3/LICENSE).

### Icons

The main window's icons are [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)
from Microsoft (version 1.1.344 of `@fluentui/svg-icons`), MIT License, Copyright (c) 2020 Microsoft
Corporation. Their outlines are copied unmodified into `src\renderer\icons.js` (inside `app.asar`), with the
licence text.

### LGPL components

libuiohook and libvips are used unmodified. Their source code is at
[github.com/kwhat/libuiohook](https://github.com/kwhat/libuiohook) (as included in
[uiohook-napi](https://github.com/SnosMe/uiohook-napi)) and
[github.com/libvips/libvips](https://github.com/libvips/libvips); the libvips version is listed
in `@img/sharp-win32-x64/versions.json`. You may replace either with your own build:
`libvips-42.dll` directly, and libuiohook by rebuilding uiohook-napi from source and replacing
`uiohook_napi.node`. If you'd like the source code for an LGPL component of a specific Pauli
Speaks release, open an issue and we'll provide it.

## All other bundled packages

- **MIT**: @huggingface/jinja 0.5.10, @img/colour 1.1.0, @koromix/koffi-win32-x64 3.3.3, @types/node 24.19.2, adm-zip 0.6.1, builder-util-runtime 9.7.0, debug 4.4.3, define-data-property 1.1.4, define-properties 1.2.1, es-define-property 1.0.1, es-errors 1.3.0, escape-string-regexp 4.0.0, fs-extra 10.1.0, globalthis 1.0.4, gopd 1.2.0, has-property-descriptors 1.0.2, js-yaml 4.3.2, jsonfile 6.2.1, lazy-val 1.0.5, lodash.escaperegexp 4.1.2, lodash.isequal 4.5.0, matcher 4.0.0, ms 2.1.3, node-addon-api 8.9.2, node-gyp-build 4.8.4, object-keys 1.1.1, onnxruntime-common 1.30.0, platform 1.3.6, serialize-error 8.1.0, tiny-typed-emitter 2.1.0, undici-types 7.24.6, universalify 2.0.1
- **BSD-3-Clause**: @protobufjs/aspromise 1.1.2, @protobufjs/base64 1.1.2, @protobufjs/codegen 2.0.5, @protobufjs/eventemitter 1.1.1, @protobufjs/fetch 1.1.1, @protobufjs/float 1.0.2, @protobufjs/path 1.1.2, @protobufjs/pool 1.1.0, @protobufjs/utf8 1.1.2, global-agent 4.1.3, protobufjs 7.6.6
- **Apache-2.0**: detect-libc 2.1.2, flatbuffers 25.9.23, long 5.3.2
- **ISC**: graceful-fs 4.2.11, guid-typescript 1.0.9, semver 7.7.4, semver 7.8.5
- **Python-2.0**: argparse 2.0.1
- **BlueOak-1.0.0**: sax 1.6.1
- **0BSD**: tslib 2.8.1
- **MIT or CC0-1.0**: type-fest 0.20.2

## Services you can choose to use

These aren't part of the app and aren't used unless you turn them on: the cloud speech and AI
provider you configure (Groq by default), under that provider's own terms. See
[PRIVACY.md](PRIVACY.md).
