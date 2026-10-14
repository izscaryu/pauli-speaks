'use strict';
// Local replacement for the FORMAT step of Wispr Flow's server pipeline
// (pipeline steps ASR -> ALIGN -> FORMAT in module 99593). Wispr runs an LLM
// on Baseten; we apply deterministic, offline rules instead.

const ARTIFACTS = [
  /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE|SOUND|APPLAUSE|LAUGHTER|[A-Z _]+)\]/g,
  /\((?:music|silence|applause|laughs?|laughter|noise|inaudible|coughs?|sighs?|upbeat music|static)\)/gi,
  /[♪♫]+/g,
];

// Phrases Whisper tends to hallucinate on silence/very short clips.
const SILENCE_HALLUCINATIONS = /^(?:thank you\.?|thanks for watching!?|thank you for watching!?|you|bye\.?|\.+|hvala\.?|hvala na gledanju!?)$/i;

const FILLERS = /(^|[\s,])(?:u+m+|u+h+|e+r+m+|h+m+|mhm|a+h+|eh+|ovaj+)(?=[\s,.!?]|$)[,]?/gi;

const VOICE_COMMANDS = [
  [/,?[ \t]*\b(?:new paragraph|novi odlomak)\b[,.!]?[ \t]*/gi, '\n\n'],
  [/,?[ \t]*\b(?:new line|newline|novi red)\b[,.!]?[ \t]*/gi, '\n'],
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyDictionary(text, dictionary) {
  let out = text;
  for (const entry of dictionary || []) {
    const from = (entry.from || '').trim();
    if (!from) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(from)}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_, pre) => pre + entry.to);
  }
  return out;
}

const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Snippets (Wispr calls them the same): say the trigger, get the text. A
 * dictation that is only the trigger becomes exactly the snippet; a trigger
 * inside a sentence is replaced in place.
 * @returns {{text: string, whole: boolean}}
 */
function applySnippets(text, snippets) {
  const list = (snippets || []).filter((s) => s.trigger && s.trigger.trim() && typeof s.text === 'string');
  if (!list.length) return { text, whole: false };
  const whole = list.find((s) => normalize(s.trigger) === normalize(text));
  if (whole) return { text: whole.text, whole: true };
  let out = text;
  for (const s of list) {
    const words = normalize(s.trigger).split(' ').map(escapeRegExp).join('[\\s,.-]+');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${words}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_, pre) => pre + s.text);
  }
  return { text: out, whole: false };
}

/** @param {'normal'|'casual'|'formal'|'code'} style */
function applyStyle(text, style) {
  if (style === 'casual' || style === 'code') return text.replace(/(?<!\.)\.$/, '');
  if (style === 'formal' && !/[.!?…:;)"'\n]$/.test(text)) return `${text}.`;
  return text;
}

function capitalizeSentenceStarts(text) {
  return text
    .replace(/^(\s*)(\p{Ll})/u, (_, s, c) => s + c.toUpperCase())
    .replace(/([.!?]\s+|\n\s*)(\p{Ll})/gu, (_, s, c) => s + c.toUpperCase());
}

/**
 * @param {string} raw
 * @param {{removeFillers?: boolean, voiceCommands?: boolean, capitalize?: boolean,
 *          addTrailingSpace?: boolean, dictionary?: {from: string, to: string}[],
 *          snippets?: {trigger: string, text: string}[], style?: string}} opts
 */
function cleanTranscript(raw, opts = {}) {
  let text = String(raw || '');
  for (const re of ARTIFACTS) text = text.replace(re, ' ');
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (SILENCE_HALLUCINATIONS.test(text)) return '';

  if (opts.removeFillers) {
    text = text.replace(FILLERS, '$1').replace(/^[\s,]+/, '').replace(/\s+,/g, ',');
  }
  if (opts.voiceCommands) {
    for (const [re, rep] of VOICE_COMMANDS) text = text.replace(re, rep);
  }
  text = applyDictionary(text, opts.dictionary);
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/,([.!?])/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/g, '');
  if (!text.trim()) return '';
  const style = opts.style || 'normal';
  if (opts.capitalize !== false && style !== 'code') text = capitalizeSentenceStarts(text);
  const snip = applySnippets(text, opts.snippets);
  text = snip.whole ? snip.text : applyStyle(snip.text, style);
  if (opts.addTrailingSpace && !text.endsWith('\n') && !snip.whole) text += ' ';
  return text;
}

function countWords(text) {
  const m = String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** SubRip subtitles from [{start, end, text}] (seconds). */
function toSrt(segments) {
  const ts = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return segments
    .filter((s) => s.text && s.text.trim())
    .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(Math.max(s.end, s.start + 0.5))}\n${s.text.trim()}\n`)
    .join('\n');
}

module.exports = { cleanTranscript, countWords, applyDictionary, applySnippets, applyStyle, toSrt };
