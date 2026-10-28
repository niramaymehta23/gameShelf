'use strict';
/* =========================================================
   net.js — everything that talks to Firebase.

   FB    the Firebase app: Firestore (fs) for documents, Realtime Database (db) for presence.
         On localhost or a LAN address it talks to the local emulators (npm start); otherwise it
         uses FIREBASE_CONFIG and App Check from the generated firebase-config.js.
   Pref  per-device settings in localStorage (device id, name, last table, sound).
   Net   documents. Net.doc(path) gives get / set / update / delete / onSnapshot, the same
         shape the game code was written against. update deep-merges, like before.
   Live  presence inside a table: which seat each open phone is in, what
         screen it's on, where its finger is (column hover, aim square).
   Chat  reactions and short notes between the two phones (Realtime Database).

   Two players on ONE computer (for testing): add ?as=2 to the second tab's
   URL. It gets its own device id, so it can sit in the other seat.
   ========================================================= */

// ---------- Firebase ----------
const EMULATED = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(location.hostname);
const FB = (() => {
  const cfg = EMULATED
    ? { apiKey: 'demo', projectId: 'demo-gameshelf', databaseURL: 'https://demo-gameshelf.firebaseio.com' }
    : FIREBASE_CONFIG;
  firebase.initializeApp(cfg);
  // App Check: Firestore and the Realtime Database only answer requests that carry a reCAPTCHA-backed token from this site
  if (!EMULATED && FIREBASE_APPCHECK_KEY) firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(FIREBASE_APPCHECK_KEY), true);
  const fs = firebase.firestore(), db = firebase.database();
  if (EMULATED) { fs.useEmulator(location.hostname, 8080); db.useEmulator(location.hostname, 9000); }
  return { fs, db };
})();

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

// ---------- documents ----------
// {fleets:{host:[…]}} → {'fleets.host': […]}, so an update merges into nested maps instead of replacing them
function fieldPaths(obj, pre = '', out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    if (isObj(v) && Object.keys(v).length) fieldPaths(v, pre + k + '.', out);
    else out[pre + k] = v;
  }
  return out;
}

const Net = {
  online: false,
  serverOffset: 0,
  now() { return Date.now() + this.serverOffset; },
  started: false,
  subs: new Map(),      // path -> number of listeners (for debugging)
  statusFns: new Set(),

  // "online" follows the Realtime Database connection; Firestore reconnects on its own alongside it
  connect() {
    if (this.started) return;
    this.started = true;
    FB.db.ref('.info/serverTimeOffset').on('value', s => { this.serverOffset = Number(s.val()) || 0; });
    FB.db.ref('.info/connected').on('value', (s) => {
      const on = !!s.val();
      if (on) Live.publish();
      this.setOnline(on);
    });
  },
  setOnline(v) {
    if (this.online === v) return;
    this.online = v;
    for (const fn of this.statusFns) { try { fn(v); } catch (e) { console.error(e); } }
  },
  onStatus(fn) { this.statusFns.add(fn); return () => this.statusFns.delete(fn); },
  // Firestore holds writes made offline until it reconnects; give up waiting after 15 s like before
  timed(p) {
    let t;
    const late = new Promise((_, reject) => { t = setTimeout(() => reject({ code: 'unavailable', message: 'no answer from Firebase' }), 15000); });
    return Promise.race([p, late]).finally(() => clearTimeout(t));
  },
  snap(path, s) {
    const d = s.exists ? clone(s.data()) : undefined;
    return { id: path.split('/').pop(), exists: !!s.exists, data: () => d };
  },
  doc(path) {
    const self = this;
    const ref = FB.fs.doc(path);
    return {
      path,
      async get() { return self.snap(path, await self.timed(ref.get())); },
      async set(data) { await self.timed(ref.set(clone(data))); },
      async update(data) { await self.timed(ref.update(fieldPaths(clone(data)))); },
      async delete() {
        // a table takes its matches with it
        if (path.split('/').length === 2) {
          const ms = await self.timed(ref.collection('matches').get());
          const batch = FB.fs.batch();
          ms.forEach((m) => batch.delete(m.ref));
          batch.delete(ref);
          await self.timed(batch.commit());
        } else await self.timed(ref.delete());
      },
      onSnapshot(fn, onError) {
        self.subs.set(path, (self.subs.get(path) || 0) + 1);
        const off = ref.onSnapshot((s) => fn(self.snap(path, s)), (e) => onError && onError(e));
        return () => {
          off();
          const n = (self.subs.get(path) || 1) - 1;
          if (n) self.subs.set(path, n); else self.subs.delete(path);
        };
      },
    };
  },
};

// ---------- presence: who is at the table right now ----------
// presence/{CODE}/{pushId} = {pres, at}; Firebase removes it when this phone disconnects
const Live = {
  code: null, pres: {}, peers: [], listeners: new Set(),
  ref: null, off: null,
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  fire() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } },
  join(code) {
    if (this.code) this.leave();
    this.code = code;
    this.peers = [];
    const room = FB.db.ref('presence/' + code);
    this.ref = room.push();
    this.publish();
    const cb = room.on('value', (s) => this.onPeers(s.val() || {}), (e) => console.warn('presence listener', e));
    this.off = () => room.off('value', cb);
    this.fire();
  },
  // (re)write my whole entry; also runs on every reconnect, since the disconnect removed it
  publish() {
    if (!this.ref) return;
    this.ref.onDisconnect().remove().catch(() => {});
    this.ref.set({ pres: this.pres, at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  },
  leave() {
    if (this.off) this.off();
    if (this.ref) { this.ref.onDisconnect().cancel().catch(() => {}); this.ref.remove().catch(() => {}); }
    this.ref = this.off = null;
    this.code = null; this.peers = [];
    this.fire();
  },
  set(patch) {
    let changed = false;
    const up = {};
    for (const k in patch) {
      if (JSON.stringify(this.pres[k]) !== JSON.stringify(patch[k])) changed = true;
      if (patch[k] === null) delete this.pres[k]; else this.pres[k] = patch[k];
      up['pres/' + k] = patch[k];
    }
    if (changed && this.ref) { up.at = firebase.database.ServerValue.TIMESTAMP; this.ref.update(up).catch(() => {}); }
  },
  onPeers(all) {
    const me = this.ref && this.ref.key;
    this.peers = Object.entries(all).filter(([id]) => id !== me).map(([id, p]) => ({ id, pres: (p && p.pres) || {}, at: (p && p.at) || 0 }));
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

// ---------- chat: quick reactions and short notes between the two phones ----------
// chat/{CODE}/{pushId} = {seat, e (emoji) | t (text, ≤ 80), at}. Talk only: never game state.
// Messages already there when the table opens are history (shown in the thread, never popped up).
const Chat = {
  code: null, list: [], listeners: new Set(), off: null, ready: false, last: 0,
  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  join(code) {
    if (this.code) this.leave();
    this.code = code; this.list = []; this.ready = false;
    const room = FB.db.ref('chat/' + code);
    const q = room.orderByChild('at').startAt(Date.now() - 12 * 3600e3).limitToLast(30);
    const cb = q.on('child_added', (s) => {
      const v = s.val();
      if (!v || !v.seat || (!v.e && !v.t)) return;
      const msg = { id: s.key, seat: v.seat, e: v.e || null, t: v.t || null, at: v.at || 0 };
      this.list.push(msg);
      if (this.list.length > 30) this.list.shift();
      for (const fn of this.listeners) { try { fn(msg, this.ready); } catch (e) { console.error(e); } }
    }, (e) => console.warn('chat listener', e));
    q.once('value').then(() => { if (this.code === code) this.ready = true; }).catch(() => {});
    this.off = () => q.off('child_added', cb);
    // tidy up: notes older than a day
    room.orderByChild('at').endAt(Date.now() - 24 * 3600e3).once('value')
      .then((old) => old.forEach((c) => { c.ref.remove().catch(() => {}); })).catch(() => {});
  },
  leave() {
    if (this.off) this.off();
    this.off = null; this.code = null; this.list = []; this.ready = false;
  },
  // false when there's no table or it's too soon after the last one (a light guard against button-mashing)
  send(msg) {
    if (!this.code || !G.seat) return false;
    const now = Date.now();
    if (now - this.last < 600) return false;
    this.last = now;
    FB.db.ref('chat/' + this.code).push({ seat: G.seat, ...msg, at: firebase.database.ServerValue.TIMESTAMP }).catch((e) => console.warn('chat send', e));
    return true;
  },
};
