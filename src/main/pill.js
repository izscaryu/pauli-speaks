'use strict';
// The floating pill: its language chip (click it while you speak to choose the language of this dictation) and
// where it sits (drag it to the left, the centre or the right of the screen; Settings remembers), and what its
// microphone messages say and their buttons open. Pure, unit tested.

const POSITIONS = ['left', 'center', 'right'];
const MARGIN = 24; // from the screen edge, on the left or the right
const BOTTOM = 6;

/** Only with two or more languages is there something to switch between. */
const canSwitchLanguage = (languages) => Array.isArray(languages) && languages.length > 1;

/** The chip's next choice: your languages (null) → each language in turn → your languages. */
function nextLanguage(current, languages) {
  const order = [null, ...(languages || [])];
  const i = order.indexOf(current ?? null);
  return i < 0 ? null : order[(i + 1) % order.length];
}

/** Where the pill window goes on a screen's work area. */
function pillBounds({ position, workArea: wa, size }) {
  const x = position === 'left' ? wa.x + MARGIN
    : position === 'right' ? wa.x + wa.width - size.width - MARGIN
      : wa.x + (wa.width - size.width) / 2;
  return { x: Math.round(x), y: Math.round(wa.y + wa.height - size.height - BOTTOM), width: size.width, height: size.height };
}

/** Dropped with its middle at `centerX`: the third of the screen it is in. */
function snapPosition(centerX, wa) {
  const t = (centerX - wa.x) / wa.width;
  return t < 1 / 3 ? 'left' : t > 2 / 3 ? 'right' : 'center';
}

// A blocked or missing microphone: a short message, a longer hint above the pill, and a button that fixes it.
const MIC_PROBLEMS = {
  blocked: { text: 'overlay.mic.blocked', hint: 'overlay.mic.blockedHint', action: 'mic-privacy', log: 'blocked' },
  notFound: { text: 'overlay.mic.notFound', hint: 'overlay.mic.notFoundHint', action: 'mic-choose', log: 'not found' },
};
const MIC_PRIVACY_URL = 'ms-settings:privacy-microphone';

/**
 * What the pill shows for a microphone error the recorder reports: { problem: 'blocked'|'notFound'|'other', detail }
 * (a plain string from an older recorder counts as 'other').
 * @param {(key: string, vars?: object) => string} t
 */
function micFlash(report, t) {
  const r = typeof report === 'string' ? { problem: 'other', detail: report } : report || {};
  const known = Object.hasOwn(MIC_PROBLEMS, r.problem) ? MIC_PROBLEMS[r.problem] : null;
  if (known) return { text: t(known.text), hint: t(known.hint), kind: 'warn', action: { id: known.action }, log: known.log };
  const detail = String(r.detail || r.problem || 'unknown');
  return { text: t('mic.error', { error: detail }), hint: null, kind: 'error', action: null, log: detail };
}

/**
 * Where a pill button other than Retry and Undo goes, chosen here and not by the pill: Windows' microphone
 * privacy page, or this app's Settings → Microphone. Anything else: null.
 */
function pillActionTarget(id) {
  if (id === 'mic-privacy') return { url: MIC_PRIVACY_URL };
  if (id === 'mic-choose') return { page: 'settings#microphone' };
  return null;
}

module.exports = { nextLanguage, canSwitchLanguage, pillBounds, snapPosition, POSITIONS, micFlash, pillActionTarget };
