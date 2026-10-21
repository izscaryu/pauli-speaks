'use strict';
// The floating pill: its language chip (click it while you speak to choose the language of this dictation) and
// where it sits (drag it to the left, the centre or the right of the screen; Settings remembers). Pure, unit tested.

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

module.exports = { nextLanguage, canSwitchLanguage, pillBounds, snapPosition, POSITIONS };
