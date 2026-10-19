'use strict';
// Transcript history, kept in a local JSON file. A dictation that couldn't be transcribed
// is listed too (status 'failed', no text) so it can be retried; it never counts as a
// dictation (stats, Paste last) until resolve() fills it in.
// Retention (Settings → Privacy): 'keep', '24h' or 'off'. With 'off' every new item stays in memory
// only (sessionOnly), so Paste last and Undo last still work until Pauli Speaks closes.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { sweepHistory, RETENTIONS } = require('./privacy');

const LIMIT = 500;
const TYPING_WPM = 40;

class History extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.items = [];
    this.sessionOnly = new Set(); // ids kept in memory only, never saved
    this.retention = 'keep';
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(saved)) this.items = saved;
    } catch {
      // first run
    }
  }

  list() {
    return this.items;
  }

  /** The latest transcript (failed items have no text to paste). */
  last() {
    return this.items.find((i) => i.status !== 'failed') || null;
  }

  /** @param {{text: string, rawText: string, durationMs: number, words: number, engine: string, language: string|null}} entry */
  add(entry) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
    if (this.retention === 'off') this.sessionOnly.add(item.id);
    this.items.unshift(item);
    if (this.items.length > LIMIT) this.items.length = LIMIT;
    this.#save();
    return item;
  }

  /**
   * A dictation that couldn't be transcribed; its audio is kept elsewhere under `audioId`.
   * @param {{audioId: string, durationMs: number, engine: string, error: string, translate?: boolean}} failed  translate: a retry translates again
   * @param {{persist?: boolean}} [opts]  false: this session only (transcript history off)
   */
  addFailed({ audioId, durationMs, engine, error, translate = false }, { persist = true } = {}) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'failed', audioId, durationMs, words: 0, engine, error, translate: !!translate };
    if (!persist) this.sessionOnly.add(item.id);
    return this.add(item);
  }

  /** A failed item was transcribed after all: it becomes `entry`, with the same id, time and place. */
  resolve(id, entry) {
    const at = this.items.findIndex((i) => i.id === id);
    if (at < 0) return null;
    const item = { ...entry, id, createdAt: this.items[at].createdAt };
    this.items[at] = item;
    if (this.retention !== 'off') this.sessionOnly.delete(id);
    this.#save();
    return item;
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.sessionOnly.delete(id);
    this.#save();
  }

  /**
   * How long transcripts are kept. Applies at once: 'off' deletes what was saved (from the file and the
   * list), '24h' drops what is older than a day.
   * @param {'keep'|'24h'|'off'} retention
   */
  setRetention(retention, now = Date.now()) {
    this.retention = RETENTIONS.includes(retention) ? retention : 'keep';
    this.#enforce(now);
    this.#save();
  }

  /** How many items setRetention(retention) would delete now (Settings asks before deleting saved transcripts). */
  wouldDrop(retention, now = Date.now()) {
    return this.items.length - this.#kept(RETENTIONS.includes(retention) ? retention : 'keep', now).size;
  }

  /** The hourly sweep for '24h' (saves and announces only when something went). */
  sweep(now = Date.now()) {
    if (this.#enforce(now)) this.#save();
  }

  /** @returns {boolean} an item was dropped */
  #enforce(now) {
    const kept = this.#kept(this.retention, now);
    const before = this.items.length;
    this.items = this.items.filter((i) => kept.has(i));
    for (const id of this.sessionOnly) if (!this.items.some((i) => i.id === id)) this.sessionOnly.delete(id);
    return this.items.length !== before;
  }

  /** The items that stay under `retention`: saved ones follow it; in-memory ones go only when older than 24 hours. */
  #kept(retention, now) {
    const saved = this.items.filter((i) => !this.sessionOnly.has(i.id));
    const inMemory = this.items.filter((i) => this.sessionOnly.has(i.id));
    return new Set([
      ...sweepHistory(saved, retention, now),
      ...(retention === '24h' ? sweepHistory(inMemory, '24h', now) : inMemory),
    ]);
  }

  clear() {
    this.items = [];
    this.sessionOnly.clear();
    this.#save();
  }

  stats() {
    const today = new Date().toDateString();
    const done = this.items.filter((i) => i.status !== 'failed');
    let words = 0;
    let ms = 0;
    let wordsToday = 0;
    for (const i of done) {
      words += i.words || 0;
      ms += i.durationMs || 0;
      if (new Date(i.createdAt).toDateString() === today) wordsToday += i.words || 0;
    }
    const minutes = ms / 60000;
    return {
      dictations: done.length,
      words,
      wordsToday,
      wpm: minutes > 0 ? Math.round(words / minutes) : 0,
      minutesSaved: Math.max(0, Math.round(words / TYPING_WPM - minutes)),
      ...dailyStats(done),
    };
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items.filter((i) => !this.sessionOnly.has(i.id))));
    fs.renameSync(tmp, this.file);
    this.emit('change');
  }
}

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * Words per local day for the last `days` days (oldest first) and the current
 * streak: consecutive days with a dictation, ending today (or yesterday, so a
 * streak isn't "lost" before you've dictated today).
 */
function dailyStats(items, days = 7, now = new Date()) {
  const byDay = new Map();
  for (const i of items) {
    const k = dayKey(i.createdAt);
    byDay.set(k, (byDay.get(k) || 0) + (i.words || 0));
  }
  const daily = [];
  for (let n = days - 1; n >= 0; n--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    daily.push({ date: dayKey(d), words: byDay.get(dayKey(d)) || 0 });
  }
  let streak = 0;
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!byDay.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (byDay.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { daily, streak };
}

module.exports = { History, dailyStats };
