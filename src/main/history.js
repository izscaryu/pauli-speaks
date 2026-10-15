'use strict';
// Transcript history, kept in a local JSON file.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const LIMIT = 500;
const TYPING_WPM = 40;

class History extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.items = [];
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

  last() {
    return this.items[0] || null;
  }

  /** @param {{text: string, rawText: string, durationMs: number, words: number, engine: string, language: string|null}} entry */
  add(entry) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
    this.items.unshift(item);
    if (this.items.length > LIMIT) this.items.length = LIMIT;
    this.#save();
    return item;
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.#save();
  }

  clear() {
    this.items = [];
    this.#save();
  }

  stats() {
    const today = new Date().toDateString();
    let words = 0;
    let ms = 0;
    let wordsToday = 0;
    for (const i of this.items) {
      words += i.words || 0;
      ms += i.durationMs || 0;
      if (new Date(i.createdAt).toDateString() === today) wordsToday += i.words || 0;
    }
    const minutes = ms / 60000;
    return {
      dictations: this.items.length,
      words,
      wordsToday,
      wpm: minutes > 0 ? Math.round(words / minutes) : 0,
      minutesSaved: Math.max(0, Math.round(words / TYPING_WPM - minutes)),
      ...dailyStats(this.items),
    };
  }

  #save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items));
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
