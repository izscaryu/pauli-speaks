'use strict';
// A History item whose recording is saved (Settings → Privacy → "Keep recordings for 24 hours") gets a Play
// button, and Retry transcribes that recording again (a normal entry's text is replaced and copied).
// The recording comes from the main process as bytes and plays from a blob, so the window never touches the disk.
// Loaded after app.js; uses these app.js globals: api, el, toast.

const HistoryAudio = (() => {
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
  const REDO = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5"/></svg>';

  let playing = null; // { id, audio, url, button }

  function show(button, on) {
    button.innerHTML = on ? STOP : PLAY;
    button.title = on ? 'Stop' : 'Play the recording';
    button.setAttribute('aria-label', on ? 'Stop the recording' : 'Play the recording');
  }

  function stop() {
    if (!playing) return;
    const { audio, url, button } = playing;
    playing = null;
    audio.pause();
    URL.revokeObjectURL(url);
    show(button, false);
  }

  async function toggle(entry, button) {
    const wasThis = playing && playing.id === entry.id;
    stop();
    if (wasThis) return;
    let bytes = null;
    try {
      bytes = await api.historyAudio(entry.id);
    } catch (err) {
      console.error('reading the recording failed', err);
    }
    if (!bytes) return toast('That recording is no longer available');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const audio = new Audio(url);
    playing = { id: entry.id, audio, url, button };
    audio.addEventListener('ended', stop);
    audio.addEventListener('error', () => { stop(); toast("Couldn't play the recording"); });
    show(button, true);
    audio.play().catch(() => { if (playing && playing.audio === audio) stop(); });
  }

  /** @returns {HTMLElement|null} */
  function playButton(entry, attrs = { class: 'icon-btn' }) {
    if (!entry.hasAudio) return null;
    const button = el('button', attrs);
    show(button, false);
    button.addEventListener('click', () => toggle(entry, button));
    if (playing && playing.id === entry.id) { // History was redrawn while it plays
      playing.button = button;
      show(button, true);
    }
    return button;
  }

  /** Retry on a normal entry: the recording is transcribed again and replaces the text. */
  function retryButton(entry) {
    if (!entry.hasAudio) return null;
    const button = el('button', { class: 'icon-btn', title: 'Transcribe the recording again', 'aria-label': 'Transcribe the recording again', html: REDO });
    button.addEventListener('click', async () => {
      button.disabled = true;
      toast('Transcribing…');
      try {
        const r = await api.retryHistory(entry.id);
        toast(r.copied ? 'Copied the new text' : r.error);
      } catch (err) {
        console.error('retrying failed', err);
        toast("Couldn't transcribe. Try again.");
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  return {
    /** The extra buttons of a normal History item. */
    buttons: (entry) => [playButton(entry), retryButton(entry)],
    playButton,
  };
})();
