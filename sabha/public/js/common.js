// Shared by the player and host pages: DOM helper, the socket with a synced clock, sound, buzz,
// screen flash, wake lock and the big number keypad. Classic script; everything hangs off window.
'use strict';

function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const TEAM_NAME = { red: 'Red', blue: 'Blue' };
const other = t => (t === 'red' ? 'blue' : 'red');
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('sabha:' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('sabha:' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('sabha:' + k); } catch (e) {} },
};
// ?as=2 gives a tab its own identity, so several "phones" can run in one browser while testing
const AS = new URLSearchParams(location.search).get('as') || '';
const skey = k => (AS ? `${k}@${AS}` : k);

// ---------- socket + clock ----------
const Net = {
  socket: null,
  offset: 0,          // server time − this phone's time
  rtt: Infinity,
  clock: { total: 0, at: null },
  connected: false,
  listeners: {},
  connect() {
    this.socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    this.socket.on('connect', () => { this.connected = true; this.sync(); this.emitLocal('connect'); });
    this.socket.on('disconnect', () => { this.connected = false; this.emitLocal('disconnect'); });
    return this.socket;
  },
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  emitLocal(ev, d) { (this.listeners[ev] || []).forEach(fn => fn(d)); },
  // a few pings; keep the offset from the one with the shortest round trip
  async sync(n = 5) {
    let best = { rtt: Infinity, off: this.offset };
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      const s = await new Promise(res => { const tm = setTimeout(() => res(null), 2000); this.socket.emit('ping', t0, v => { clearTimeout(tm); res(v); }); });
      const t1 = Date.now();
      if (s != null && t1 - t0 < best.rtt) best = { rtt: t1 - t0, off: s - (t0 + t1) / 2 };
    }
    if (best.rtt < Infinity) { this.offset = best.off; this.rtt = best.rtt; }
  },
  serverNow() { return Date.now() + this.offset; },
  // game time: server time minus the time spent paused (frozen while paused)
  now() { const c = this.clock; return (c.at != null ? c.at : this.serverNow()) - c.total; },
  setClock(c) { if (c) this.clock = c; },
  call(ev, data) { return new Promise(res => this.socket.emit(ev, data, res)); },
};

// ---------- sound (synthesised; iPhones need one tap first, which the join button gives) ----------
const Sound = {
  ctx: null, on: store.get('sound') !== false,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  tone(f, dur, { type = 'sine', vol = 0.15, to = null, at = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  tap() { this.tone(720, 0.05, { type: 'triangle', vol: 0.06 }); },
  good() { this.tone(660, 0.1, { type: 'triangle', vol: 0.14 }); this.tone(990, 0.16, { type: 'triangle', vol: 0.12, at: 0.08 }); },
  bad() { this.tone(220, 0.22, { type: 'square', vol: 0.07, to: 150 }); },
  turn() { [784, 988, 1175].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.16, at: i * 0.09 })); },
  tick() { this.tone(880, 0.07, { type: 'sine', vol: 0.12 }); },
  go() { this.tone(1320, 0.3, { type: 'triangle', vol: 0.16 }); },
  time() { [523, 392, 262].forEach((f, i) => this.tone(f, 0.28, { type: 'square', vol: 0.08, at: i * 0.16 })); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.12, at: i * 0.11 })); },
};
document.addEventListener('pointerdown', () => Sound.ensure(), { capture: true, passive: true });

// Android vibrates; iPhones don't from a web page, so every buzz also flashes and plays a sound.
function buzz(pattern = 120) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {} }

function flash(kind = 'good') {
  const el = h('div.flash.' + kind);
  document.body.append(el);
  setTimeout(() => el.remove(), 450);
}

// ---------- keep the screen awake during games ----------
const Wake = {
  lock: null, want: false,
  async on() {
    this.want = true;
    if (this.lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } catch (e) { this.lock = null; }
  },
  off() { this.want = false; if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; } },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Wake.want) Wake.on(); });

// ---------- the big number keypad (Pair Hunt codes, Maths Chain answers) ----------
// Keypad({maxLen, onSubmit(value), label, autoSubmit}) → {el, clear(), lock(untilGameMs), unlock(), value}
function Keypad({ maxLen = 3, onSubmit, label = 'Enter', autoSubmit = false, submitText = 'Send' } = {}) {
  let value = '', lockedUntil = 0, disabled = false;
  const shown = h('div.kp-value', { 'aria-live': 'polite' });
  const lockNote = h('div.kp-lock');
  const keys = h('div.kp-keys');
  const send = h('button.kp-key.kp-send', { type: 'button', text: submitText });
  const paint = () => {
    shown.textContent = value || ' ';
    shown.classList.toggle('empty', !value);
    const isLocked = disabled || Net.now() < lockedUntil;
    root.classList.toggle('locked', isLocked);
    send.disabled = !value || isLocked;
  };
  const press = d => {
    if (disabled || Net.now() < lockedUntil) return;
    Sound.tap();
    if (d === 'del') value = value.slice(0, -1);
    else if (value.length < maxLen) value += d;
    paint();
    if (autoSubmit && value.length >= maxLen) submit();
  };
  const submit = () => {
    if (!value || disabled || Net.now() < lockedUntil) return;
    const v = value; value = ''; paint();
    onSubmit && onSubmit(v);
  };
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0']) {
    keys.append(h('button.kp-key' + (d === 'del' ? '.kp-del' : ''), { type: 'button', 'data-key': d, 'aria-label': d === 'del' ? 'Delete' : d, onpointerdown: e => { e.preventDefault(); press(d); } }, d === 'del' ? '⌫' : d));
  }
  send.addEventListener('pointerdown', e => { e.preventDefault(); submit(); });
  keys.append(send);
  const root = h('div.keypad', null, h('div.kp-label', { text: label }), shown, lockNote, keys);
  let timer = null;
  const api = {
    el: root,
    get value() { return value; },
    set label(t) { root.querySelector('.kp-label').textContent = t; },
    clear() { value = ''; paint(); },
    // lock until a game-clock time; shows a countdown
    lock(until) {
      lockedUntil = until; paint(); clearInterval(timer);
      const step = () => {
        const left = lockedUntil - Net.now();
        if (left <= 0) { clearInterval(timer); lockNote.textContent = ''; paint(); return; }
        lockNote.textContent = `Wait ${Math.ceil(left / 1000)}`;
      };
      step(); timer = setInterval(step, 200);
    },
    setDisabled(d) { disabled = d; paint(); },
  };
  // a real keyboard works too (handy when testing on a laptop)
  root.tabIndex = -1;
  document.addEventListener('keydown', e => {
    if (!root.isConnected) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') submit();
  });
  paint();
  return api;
}

window.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
