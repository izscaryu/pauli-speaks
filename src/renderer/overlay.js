'use strict';
// Floating status pill + microphone recorder + read-aloud voice.
// The pill window is non-focusable (it never steals focus from the app you
// are dictating into) and click-through except while hovering the pill.

const pill = document.getElementById('pill');
const wave = document.getElementById('wave');
const label = document.getElementById('label');
const tip = document.getElementById('tip');
const badge = document.getElementById('badge');
const timer = document.getElementById('timer');
const previewEl = document.getElementById('preview');
const actionBtn = document.getElementById('action');
const BARS = 13;
const bars = [];
for (let i = 0; i < BARS; i++) {
  const b = document.createElement('span');
  wave.appendChild(b);
  bars.push(b);
}

let ui = { state: 'idle' };
let messageTimer = null;
let level = 0;
let listeningSince = 0;
let noSound = false; // the microphone has delivered nothing but silence since this dictation started

// ------------------------------------------------------------------ UI

function render(state) {
  if (state.state === 'listening' && ui.state !== 'listening') {
    listeningSince = performance.now();
    noSound = false;
  }
  ui = state;
  clearTimeout(messageTimer);

  const command = state.mode === 'command';
  badge.hidden = !((state.state === 'listening' || state.state === 'processing') && (command || state.translateTo));
  badge.textContent = command ? '✦ AI' : state.translateTo ? `→ ${state.translateTo.toUpperCase()}` : '';
  badge.classList.toggle('ai', command);

  pill.className = 'pill';
  pill.classList.add(state.state === 'message' ? 'message' : state.state);
  if (state.locked) pill.classList.add('locked');
  if (state.kind === 'error') pill.classList.add('error');
  label.textContent = '';
  if (state.state === 'processing' && state.text) {
    pill.classList.add('with-text');
    label.textContent = state.text;
  }
  if (state.state === 'reading') label.textContent = 'Reading aloud';
  if (state.state === 'message') {
    label.textContent = state.text;
    messageTimer = setTimeout(() => render({ ...ui, state: 'idle', kind: null, action: null }), state.ms || 2600);
  }
  // Retry / Undo: clicking it doesn't take the focus (the pill window can't have it), so the text goes to the app in front
  const action = state.state === 'message' && state.action ? state.action : null;
  actionBtn.hidden = !action;
  if (action) {
    actionBtn.textContent = action.label;
    actionBtn.setAttribute('aria-label', action.label === 'Undo' ? 'Undo the cancel and transcribe' : 'Retry the transcription');
  }
  if (state.state !== 'idle') tip.hidden = true;

  if (state.state !== 'listening') noSound = false;
  showNoSound();

  const preview = state.state === 'listening' && state.preview ? state.preview.trim() : '';
  previewEl.hidden = !preview;
  // keep the end visible: that's what the user is saying right now
  previewEl.textContent = preview.length > 160 ? `…${preview.slice(-160)}` : preview;
}

/** Amber warning in the pill while listening to a dead microphone; the dictation itself carries on. */
function showNoSound() {
  const on = noSound && ui.state === 'listening';
  pill.classList.toggle('warn', on);
  if (on) label.textContent = 'No sound. Is your mic muted?';
}

function setNoSound(on) {
  if (noSound === on) return;
  noSound = on;
  if (!on && ui.state === 'listening') label.textContent = '';
  showNoSound();
}

window.pauli.onOverlayState(render);

pill.addEventListener('mouseenter', () => {
  window.pauli.setOverlayHover(true);
  if (ui.state === 'idle' && ui.shortcut) {
    tip.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = ui.shortcut;
    tip.append('Click or hold ', b, ' to dictate');
    tip.hidden = false;
  }
});
pill.addEventListener('mouseleave', () => {
  window.pauli.setOverlayHover(false);
  tip.hidden = true;
});
pill.addEventListener('click', (e) => {
  if (e.target.closest('.icon-btn, .pill-action')) return;
  if (ui.state === 'idle') window.pauli.toggleDictation();
});
document.getElementById('stop').addEventListener('click', () => window.pauli.toggleDictation());
document.getElementById('cancel').addEventListener('click', () => window.pauli.cancelDictation());
actionBtn.addEventListener('click', () => {
  if (!ui.action) return;
  window.pauli.pillAction(ui.action.id);
  render({ ...ui, action: null }); // once: main answers with the next state
});

function animate() {
  if (ui.state === 'listening') {
    const t = performance.now() / 160;
    const l = Math.min(1, level * 9);
    for (let i = 0; i < BARS; i++) {
      const shape = Math.sin((i / (BARS - 1)) * Math.PI);
      const jitter = 0.65 + 0.35 * Math.sin(t + i * 1.7);
      bars[i].style.height = `${4 + Math.round(18 * l * shape * jitter)}px`;
    }
    const secs = Math.floor((performance.now() - listeningSince) / 1000);
    const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (timer.textContent !== text) timer.textContent = text;
  }
  level *= 0.9;
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ------------------------------------------------------------------ sounds

let soundCtx = null;
function chime(freqs, { gain = 0.07, step = 0.075, length = 0.11 } = {}) {
  soundCtx ??= new AudioContext();
  const t0 = soundCtx.currentTime + 0.01;
  freqs.forEach((f, i) => {
    const osc = soundCtx.createOscillator();
    const g = soundCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const s = t0 + i * step;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(gain, s + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, s + length);
    osc.connect(g).connect(soundCtx.destination);
    osc.start(s);
    osc.stop(s + length + 0.02);
  });
}
const sounds = {
  start: () => chime([660, 880]),
  stop: () => chime([880, 660]),
  cancel: () => chime([392], { gain: 0.05, length: 0.14 }),
};

// ------------------------------------------------------------------ recorder

const SPEECH_RMS = 0.03;
const SILENCE_RMS = 0.012;
const CHUNK_SECONDS = 640 / 16000;
// A muted or disconnected microphone delivers exact zeros (or ~1e-6); even a quiet room is far above this
const NO_SOUND_RMS = 0.002;
const NO_SOUND_SECONDS = 2;

let ctx = null;
let stream = null;
let source = null;
let node = null;
let sink = null;
let chunks = [];
let active = false;
let session = 0;
let autoStop = 0;
let vadAutoStop = false; // main's voice-activity detector ends the dictation; the loudness check below only watches
let heardSpeech = false;
let silentFor = 0;
let silenceSent = false;
let heardSound = false;
let quietFor = 0;

/** Warn when the first 2 seconds of a dictation carry no sound at all; clear it once any sound arrives. */
function trackNoSound(rms) {
  if (heardSound) return;
  if (rms >= NO_SOUND_RMS) {
    heardSound = true;
    setNoSound(false);
    return;
  }
  quietFor += CHUNK_SECONDS;
  if (quietFor >= NO_SOUND_SECONDS) setNoSound(true);
}

async function ensureContext() {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('recorder-worklet.js');
  }
  if (ctx.state === 'suspended') await ctx.resume();
}

function teardown() {
  try { source?.disconnect(); } catch { /* already disconnected */ }
  try { node?.disconnect(); } catch { /* already disconnected */ }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  source = null;
  node = null;
}

function concat(list) {
  let total = 0;
  for (const c of list) total += c.length;
  const audio = new Float32Array(total);
  let offset = 0;
  for (const c of list) {
    audio.set(c, offset);
    offset += c.length;
  }
  return audio;
}

function micErrorMessage(err) {
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'Microphone blocked - allow mic access in Windows Settings > Privacy > Microphone';
  }
  if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
    return 'Microphone not found - pick another one in Pauli Speaks settings';
  }
  return `Microphone error: ${err && err.message ? err.message : err}`;
}

/**
 * Auto-stop for hands-free mode: after speech was heard, N seconds of silence ends the dictation.
 * While main's voice-activity detector does this (vadAutoStop), the loudness is still tracked,
 * so falling back to it mid-dictation starts from what was already heard.
 */
function trackSilence(rms) {
  if (!autoStop || silenceSent || !ui.locked) return;
  if (rms > SPEECH_RMS) {
    heardSpeech = true;
    silentFor = 0;
  } else if (rms < SILENCE_RMS && heardSpeech) {
    silentFor += CHUNK_SECONDS;
    if (silentFor >= autoStop && !vadAutoStop) {
      silenceSent = true;
      window.pauli.sendSilence();
    }
  }
}

window.pauli.onRecorderStart(async ({ deviceId, sounds: playSounds, autoStopSilence, vadAutoStop: byVad }) => {
  const my = ++session;
  active = true;
  chunks = [];
  autoStop = Number(autoStopSilence) || 0;
  vadAutoStop = !!byVad;
  heardSpeech = false;
  silentFor = 0;
  silenceSent = false;
  heardSound = false;
  quietFor = 0;
  setNoSound(false);
  if (playSounds) sounds.start();
  try {
    await ensureContext();
    const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId && deviceId !== 'default') audio.deviceId = { exact: deviceId };
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      if (!audio.deviceId || err.name !== 'OverconstrainedError') throw err;
      delete audio.deviceId; // saved mic was unplugged: fall back to default
      s = await navigator.mediaDevices.getUserMedia({ audio });
    }
    if (my !== session || !active) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, 'pauli-recorder');
    node.port.onmessage = (e) => {
      if (e.data.samples && my === session) {
        chunks.push(e.data.samples);
        level = Math.max(level, e.data.rms);
        trackSilence(e.data.rms);
        trackNoSound(e.data.rms);
      }
    };
    sink ??= (() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(ctx.destination);
      return g;
    })();
    source.connect(node);
    node.connect(sink);
  } catch (err) {
    active = false;
    teardown();
    window.pauli.sendRecorderError(micErrorMessage(err));
  }
});

window.pauli.onRecorderSnapshot(({ id }) => {
  window.pauli.sendAudio(id, concat(chunks));
});

/** The recording from sample `from` on (main's recording tap asks for only what it hasn't had yet). */
function samplesFrom(from) {
  let skip = Math.max(0, Math.floor(Number(from) || 0));
  const rest = [];
  for (const c of chunks) {
    if (skip >= c.length) {
      skip -= c.length;
      continue;
    }
    rest.push(skip ? c.subarray(skip) : c);
    skip = 0;
  }
  return concat(rest);
}

window.pauli.onRecorderTail(({ id, from }) => window.pauli.sendAudio(id, samplesFrom(from)));

// main's voice-activity detector is unavailable: the loudness auto-stop takes over for this dictation
window.pauli.onRecorderVadFallback(() => {
  vadAutoStop = false;
});

// cancelled: kept for Undo, so the audio comes back, but it sounds like a cancel
window.pauli.onRecorderStop(async ({ id, discard, cancelled, sounds: playSounds }) => {
  const my = session;
  active = false;
  heardSound = true; // the flush below must not raise the warning for a dictation that is ending
  if (playSounds) (discard || cancelled ? sounds.cancel : sounds.stop)();
  if (node) {
    // capture the last ~150 ms the user spoke while releasing the keys
    await new Promise((r) => setTimeout(r, 150));
    await new Promise((resolve) => {
      const n = node;
      const done = (e) => {
        if (e.data.flushed) {
          n.port.removeEventListener('message', done);
          resolve();
        }
      };
      n.port.addEventListener('message', done);
      n.port.postMessage('flush');
      setTimeout(resolve, 120);
    });
  }
  teardown();
  const audio = discard || my !== session ? null : concat(chunks);
  chunks = [];
  if (audio) window.pauli.sendAudio(id, audio);
});

// ------------------------------------------------------------------ read aloud (Windows voices via Web Speech)

let utterance = null;

window.pauli.onTtsSpeak(({ text, voice, rate }) => {
  speechSynthesis.cancel();
  utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const chosen = voices.find((v) => v.name === voice);
  if (chosen) {
    utterance.voice = chosen;
    utterance.lang = chosen.lang;
  }
  utterance.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  const done = () => {
    if (utterance && utterance.text === text) window.pauli.ttsEnded();
  };
  utterance.onend = done;
  utterance.onerror = done;
  speechSynthesis.speak(utterance);
});

window.pauli.onTtsStop(() => {
  utterance = null;
  speechSynthesis.cancel();
});
