'use strict';
// A History item whose recording is saved (Settings → Privacy → "Keep recordings for 24 hours") gets a Play
// button, and Retry transcribes that recording again (a normal entry's text is replaced and copied).
// The recording comes from the main process as bytes and plays from a blob, so the window never touches the disk.
// Loaded after app.js; uses these app.js globals: api, el, toast.

const HistoryAudio = (() => {
  const PLAY = Icons.svg('play');
  const STOP = Icons.svg('stop');
  const REDO = Icons.svg('retry');

  let playing = null; // { id, audio, url, button }

  function show(button, on) {
    button.innerHTML = on ? STOP : PLAY;
    button.title = t(on ? 'history.audio.stop' : 'history.audio.play');
    button.setAttribute('aria-label', t(on ? 'history.audio.stopLabel' : 'history.audio.play'));
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
    if (!bytes) return toast(t('history.audio.gone'));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const audio = new Audio(url);
    playing = { id: entry.id, audio, url, button };
    audio.addEventListener('ended', stop);
    audio.addEventListener('error', () => { stop(); toast(t('history.audio.playFailed')); });
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
    const button = el('button', { class: 'icon-btn', title: t('history.audio.again'), 'aria-label': t('history.audio.again'), html: REDO });
    button.addEventListener('click', async () => {
      button.disabled = true;
      toast(t('common.transcribing'));
      try {
        const r = await api.retryHistory(entry.id);
        toast(r.copied ? t('history.audio.copiedNew') : r.error);
      } catch (err) {
        console.error('retrying failed', err);
        toast(t('history.audio.failed'));
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
