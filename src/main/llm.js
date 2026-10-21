'use strict';
// Command mode: select text, hold the command shortcut, say what to do with it. Uses any
// OpenAI-compatible chat endpoint - by default Groq's free tier, with the same
// API key as cloud transcription.

const { t } = require('./strings');

const SYSTEM_EDIT = [
  'You are the editing engine of a voice dictation app.',
  'The user selected some text and spoke an instruction about it.',
  'Apply the instruction to the selected text and reply with ONLY the resulting text:',
  'no preamble, no quotes, no markdown fences, no explanations.',
  'Keep the original language unless the instruction asks for another one.',
  'Preserve line breaks and formatting that the instruction does not ask you to change.',
].join(' ');

const SYSTEM_WRITE = [
  'You are the writing engine of a voice dictation app.',
  'The user spoke a request for text to be inserted at their cursor (an email, a reply, a list, code...).',
  'Reply with ONLY the text to insert: no preamble, no quotes, no markdown fences, no explanations.',
  'Write in the language the user spoke unless they ask for another one.',
].join(' ');

/** @returns {{role: string, content: string}[]} */
function buildCommandMessages(instruction, selection) {
  if (selection && selection.trim()) {
    return [
      { role: 'system', content: SYSTEM_EDIT },
      { role: 'user', content: `Instruction: ${instruction}\n\nSelected text:\n<<<\n${selection}\n>>>` },
    ];
  }
  return [
    { role: 'system', content: SYSTEM_WRITE },
    { role: 'user', content: instruction },
  ];
}

/** Strip wrappers models sometimes add despite instructions (and a reasoning model's <think> block). */
function cleanCompletion(text) {
  let out = String(text || '').replace(/^\s*<think>[\s\S]*?<\/think>/, '').trim();
  const fence = out.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fence) out = fence[1];
  out = out.replace(/^<<<\n?/, '').replace(/\n?>>>$/, '');
  if (/^"[^"]*"$/.test(out)) out = out.slice(1, -1);
  return out.trim();
}

/**
 * @param {{baseUrl: string, apiKey: string, model: string}} cfg
 * @param {{role: string, content: string}[]} messages
 * @param {{signal?: AbortSignal, requireKey?: boolean, temperature?: number, maxTokens?: number, redirect?: RequestRedirect}} [opts]
 *   requireKey: false for a server on this PC (Ollama, LM Studio, Foundry Local), which takes no key
 *   redirect: 'error' so the text is never re-sent to wherever a server points (AI polish)
 */
async function chatComplete(cfg, messages, { signal = AbortSignal.timeout(45000), requireKey = true, temperature = 0.3, maxTokens = 2048, redirect = 'follow' } = {}) {
  if (requireKey && !cfg.apiKey) {
    throw new Error(t('errors.commandNeedsKey'));
  }
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens }),
    signal,
    redirect,
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(t('errors.commandFailed', { status: String(res.status), body }));
  }
  const json = await res.json();
  return cleanCompletion(json.choices?.[0]?.message?.content);
}

module.exports = { buildCommandMessages, chatComplete, cleanCompletion };
