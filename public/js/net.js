'use strict';
/* =========================================================
   net.js — everything that talks to the server.

   Pref  per-device settings in localStorage (device id, name, last table, sound).
   Net   one WebSocket to /ws. Documents live on the server; Net.doc(path)
         gives get / set / update / delete / onSnapshot, the same shape the
         game code was written against.
   Live  presence inside a table: which seat each open phone is in, what
         screen it's on, where its finger is (column hover, aim square).

   Two players on ONE computer (for testing): add ?as=2 to the second tab's
   URL. It gets its own device id, so it can sit in the other seat.
   ========================================================= */

// ---------- per-device preferences ----------
const PROFILE = (() => {
  try { return (new URLSearchParams(location.search).get('as') || '').replace(/[^a-z0-9]/gi, '').slice(0, 12); } catch (e) { return ''; }
})();
const Pref = {
  prefix: 'gs:' + (PROFILE ? PROFILE + ':' : ''),
  mem: {},
  get(k) { try { const v = localStorage.getItem(this.prefix + k); return v ?? this.mem[k] ?? null; } catch (e) { return this.mem[k] ?? null; } },
  set(k, v) { this.mem[k] = v; try { localStorage.setItem(this.prefix + k, v); } catch (e) {} },
  del(k) { delete this.mem[k]; try { localStorage.removeItem(this.prefix + k); } catch (e) {} },
};

// ---------- connection ----------
const Net = {
  ws: null,
  online: false,
  seq: 0,
  pending: new Map(),   // request id -> { resolve, reject, timer, msg }
  outbox: [],           // requests made while offline, sent on reconnect
  subs: new Map(),      // path -> Set<listener>
  cache: new Map(),     // path -> last snapshot
  statusFns: new Set(),
  backoff: 500,
  retryTimer: null,

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  },
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    clearTimeout(this.retryTimer);
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { this.retry(); return; }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoff = 500;
      this.setOnline(true);
      // put back everything this page was listening to
      for (const path of this.subs.keys()) this.raw({ id: this.nextId(), op: 'sub', path });
      if (Live.code) this.raw({ id: this.nextId(), op: 'join', code: Live.code, pres: Live.pres });
      const queued = this.outbox.splice(0);
      for (const m of queued) this.raw(m);
    });
    ws.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'doc') return this.onDoc(msg);
      if (msg.t === 'peers') return Live.onPeers(msg.peers || []);
      if (msg.t === 'pong') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg); else p.reject({ code: msg.code || 'unavailable', message: msg.message || '' });
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setOnline(false);
      this.retry();
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
  },
  retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 1.7, 8000);
  },
  setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    for (const fn of this.statusFns) { try { fn(v); } catch (e) { console.error(e); } }
  },
  onStatus(fn) { this.statusFns.add(fn); return () => this.statusFns.delete(fn); },
  nextId() { return ++this.seq; },
  raw(msg) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; } return false; },
  // A request that expects a reply. Made while offline, it waits for the reconnect (up to 15 s).
  request(msg) {
    return new Promise((resolve, reject) => {
      const id = this.nextId();
      const full = { ...msg, id };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const i = this.outbox.indexOf(full); if (i >= 0) this.outbox.splice(i, 1);
        reject({ code: 'unavailable', message: 'no answer from the server' });
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.raw(full)) { this.outbox.push(full); this.connect(); }
    });
  },
  snap(path, exists, data) {
    const d = exists ? clone(data) : undefined;
    return { id: path.split('/').pop(), exists: !!exists, data: () => d };
  },
  onDoc(msg) {
    const s = this.snap(msg.path, msg.exists, msg.data);
    this.cache.set(msg.path, s);
    const set = this.subs.get(msg.path);
    if (set) for (const fn of [...set]) { try { fn(s); } catch (e) { console.error(e); } }
  },
  doc(path) {
    const self = this;
    return {
      path,
      async get() { const r = await self.request({ op: 'get', path }); return self.snap(path, r.exists, r.data); },
      async set(data) { await self.request({ op: 'set', path, data }); },
      async update(data) { await self.request({ op: 'update', path, data }); },
      async delete() { await self.request({ op: 'delete', path }); },
      onSnapshot(fn, onError) {
        let set = self.subs.get(path);
        const first = !set;
        if (first) { set = new Set(); self.subs.set(path, set); }
        set.add(fn);
        if (first) self.request({ op: 'sub', path }).catch((e) => onError && onError(e));
        else if (self.cache.has(path)) { const s = self.cache.get(path); setTimeout(() => set.has(fn) && fn(s), 0); }
        return () => {
          const cur = self.subs.get(path);
          if (!cur) return;
          cur.delete(fn);
          if (!cur.size) { self.subs.delete(path); self.cache.delete(path); self.raw({ id: self.nextId(), op: 'unsub', path }); }
        };
      },
    };
  },
};
// keep the socket warm, and come straight back when a phone wakes up
setInterval(() => { Net.raw({ op: 'ping' }); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Net.connect(); });
window.addEventListener('online', () => Net.connect());

// ---------- presence: who is at the table right now ----------
const Live = {
  code: null, pres: {}, peers: [], listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  fire() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } },
  join(code) {
    this.code = code;
    this.peers = [];
    Net.request({ op: 'join', code, pres: this.pres }).catch(() => {});
    this.fire();
  },
  leave() {
    if (this.code) Net.raw({ id: Net.nextId(), op: 'leave' });
    this.code = null; this.peers = [];
    this.fire();
  },
  set(patch) {
    let changed = false;
    for (const k in patch) {
      if (JSON.stringify(this.pres[k]) !== JSON.stringify(patch[k])) changed = true;
      if (patch[k] === null) delete this.pres[k]; else this.pres[k] = patch[k];
    }
    if (changed && this.code) Net.raw({ id: Net.nextId(), op: 'pres', patch });
  },
  onPeers(list) {
    this.peers = list.map((p) => ({ id: p.id, pres: p.pres || {}, at: p.at || 0 }));
    this.fire();
  },
  partner() {
    if (!G.seat) return null;
    const want = other(G.seat);
    const list = this.peers.filter((p) => p.pres && p.pres.seat === want);
    if (!list.length) return null;
    return list.sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  },
  seatOnline(seat) { return this.peers.some((p) => p.pres && p.pres.seat === seat); },
};
