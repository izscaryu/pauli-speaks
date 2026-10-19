'use strict';
// Languages so close that Whisper often reports one when the speaker used the other. Used by the cloud
// engine when the provider reports no confidence (keep the chosen language close to the one it heard) and
// by the "Sounds like <Language>" hint (a close relative of a chosen language is not a new language).
// Kept short on purpose: only pairs that are well-known Whisper confusions belong here.

const RELATIVES = [
  ['hr', 'sr', 'bs'], // Croatian, Serbian, Bosnian: one mutually intelligible standard, often swapped
  ['no', 'nb', 'nn', 'da'], // Norwegian (Bokmål, Nynorsk) and Danish: near-identical in writing
  ['ms', 'id'], // Malay and Indonesian: two standards of one language
  ['gl', 'pt'], // Galician and Portuguese: very close, Galician is often heard as Portuguese
  ['cs', 'sk'], // Czech and Slovak: mutually intelligible, short clips get swapped
  ['uk', 'ru', 'be'], // Ukrainian, Russian, Belarusian: East Slavic, short clips get swapped
];

const GROUP = new Map(RELATIVES.flatMap((group, i) => group.map((code) => [code, i])));

/** Same language, or both in one group. */
function areRelated(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return GROUP.has(a) && GROUP.get(a) === GROUP.get(b);
}

/**
 * The chosen language that `returned` is (or is a close relative of); null when none is.
 * @param {string|null} returned  what the engine heard
 * @param {string[]} chosen  the user's languages, in their order
 * @returns {string|null}
 */
function relatedChosen(returned, chosen) {
  if (typeof returned !== 'string' || !returned || !Array.isArray(chosen)) return null;
  if (chosen.includes(returned)) return returned;
  return chosen.find((c) => areRelated(returned, c)) || null;
}

module.exports = { RELATIVES, areRelated, relatedChosen };
