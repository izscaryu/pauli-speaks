'use strict';
// A dictation that couldn't be transcribed, in the History list: what went wrong and a Retry
// button. Retry transcribes the recording Pauli Speaks kept in memory, fills in the entry and
// copies the text (it isn't typed anywhere). Without a saved recording it is gone after a restart.
// With "Keep recordings for 24 hours" on the recording is also saved on disk: it can be played and retried after a restart.
// Loaded after app.js; uses these app.js globals: api, el, toast, ICONS, and HistoryAudio.

const FailedHistory = (() => {
  async function retry(entry, button) {
    button.disabled = true;
    button.textContent = 'Transcribing…';
    const r = await api.retryHistory(entry.id);
    toast(r.copied ? 'Copied' : r.error);
    button.disabled = false; // History redraws when the entry changes
    button.textContent = 'Retry';
  }

  /** @param {{id, createdAt, durationMs, engine, error, canRetry}} entry */
  function item(entry) {
    const d = new Date(entry.createdAt);
    const secs = Math.max(1, Math.round((entry.durationMs || 0) / 1000));
    const retryBtn = entry.canRetry ? el('button', { class: 'btn', 'aria-label': 'Retry this dictation' }, 'Retry') : null;
    retryBtn?.addEventListener('click', () => retry(entry, retryBtn));
    return el('div', { class: 'item failed' },
      el('time', { datetime: entry.createdAt }, d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
      el('div', {},
        el('p', {}, "Couldn't transcribe this dictation"),
        el('div', { class: 'meta' },
          el('span', { class: 'err', title: entry.error }, entry.error),
          `${secs}s · ${entry.engine}`),
        el('div', { class: 'retry-row' },
          retryBtn || el('span', { class: 'desc' }, 'The recording is no longer available (it is only kept until Pauli Speaks closes).'),
          HistoryAudio.playButton(entry, { class: 'icon-btn' }))),
      el('div', { class: 'actions' },
        el('button', { class: 'icon-btn danger', title: 'Delete', 'aria-label': 'Delete this failed dictation', html: ICONS.trash, onclick: () => api.deleteHistory(entry.id) })));
  }

  return { item };
})();
