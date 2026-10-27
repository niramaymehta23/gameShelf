// Document store: JSON documents at slash-separated paths, persisted to one JSON file.
// Shape mirrors what the client expects (get / set / update with deep merge / delete),
// so the game logic didn't have to change when it moved off the Claude runtime.

import fs from 'node:fs';
import path from 'node:path';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function deepMerge(target, patch) {
  for (const k of Object.keys(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const v = patch[k];
    if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

// Only two document shapes exist: a table, and a match under a table.
const TABLE = /^tables\/[A-Z]{4}$/;
const MATCH = /^tables\/[A-Z]{4}\/matches\/[a-z0-9]{4,24}$/;
export const validPath = (p) => typeof p === 'string' && (TABLE.test(p) || MATCH.test(p));

export const MAX_DOC_BYTES = 64 * 1024;
const STALE_MS = 30 * 24 * 3600 * 1000; // tables untouched for 30 days are cleared

export class Store {
  constructor(file) {
    this.file = file;
    this.docs = new Map();      // path -> { data, updated }
    this.listeners = new Set(); // (path, data|undefined) => void
    this.saveTimer = null;
    this.load();
    this.prune();
    setInterval(() => this.prune(), 6 * 3600 * 1000).unref();
  }

  load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [p, v] of Object.entries(raw.docs || {})) if (validPath(p)) this.docs.set(p, v);
      console.log(`store: loaded ${this.docs.size} documents from ${this.file}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('store: could not read', this.file, e.message);
    }
  }

  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const body = JSON.stringify({ v: 1, docs: Object.fromEntries(this.docs) });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file); // atomic replace, so a crash never leaves half a file
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(p) { const d = this.get(p); for (const fn of this.listeners) fn(p, d); }

  get(p) { const e = this.docs.get(p); return e ? clone(e.data) : undefined; }

  check(p, data) {
    if (!validPath(p)) throw new StoreError('invalid_argument', 'bad path');
    if (data !== undefined) {
      if (!isObj(data)) throw new StoreError('invalid_argument', 'document must be an object');
      if (JSON.stringify(data).length > MAX_DOC_BYTES) throw new StoreError('invalid_argument', 'document too large');
    }
  }

  set(p, data) {
    this.check(p, data);
    this.docs.set(p, { data: clone(data), updated: Date.now() });
    this.scheduleSave();
    this.emit(p);
  }

  update(p, patch) {
    this.check(p, patch);
    const cur = this.docs.get(p);
    if (!cur) throw new StoreError('invalid_argument', 'document does not exist');
    const next = deepMerge(clone(cur.data), patch);
    if (JSON.stringify(next).length > MAX_DOC_BYTES) throw new StoreError('invalid_argument', 'document too large');
    this.docs.set(p, { data: next, updated: Date.now() });
    this.scheduleSave();
    this.emit(p);
  }

  delete(p) {
    if (!validPath(p)) throw new StoreError('invalid_argument', 'bad path');
    const existed = this.docs.delete(p);
    // deleting a table also clears its matches
    if (TABLE.test(p)) for (const k of [...this.docs.keys()]) if (k.startsWith(p + '/')) { this.docs.delete(k); this.emit(k); }
    if (existed) { this.scheduleSave(); this.emit(p); }
  }

  prune() {
    const now = Date.now();
    let n = 0;
    for (const [p, e] of this.docs) {
      if (!TABLE.test(p)) continue;
      let last = e.updated;
      for (const [k, m] of this.docs) if (k.startsWith(p + '/')) last = Math.max(last, m.updated);
      if (now - last > STALE_MS) { this.delete(p); n++; }
    }
    if (n) console.log(`store: cleared ${n} stale tables`);
  }
}

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
