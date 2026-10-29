'use strict';
/* =========================================================
   Our Game Shelf — util.js
   Small DOM helpers, icons and the synthesised sound effects.
   Files load in order (see index.html) and share globals:
   util → net → app → lobby → rps → connect4 → battleships → hues → words → quickfire → wheels → wordwheel → stats → boot
   ========================================================= */

// ---------- small utilities ----------
const $ = (s, el = document) => el.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const svgEl = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wait for an animation, but never longer than its own length: a phone that was locked or a
// background tab may pause animations, and the game must not get stuck behind one.
function settle(anim) {
  let ms = 500;
  try { const t = anim.effect.getComputedTiming(); ms = (t.endTime || t.activeDuration || 500); } catch (e) {}
  return Promise.race([anim.finished.catch(() => {}), sleep(ms + 120)]);
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const other = (s) => (s === 'host' ? 'guest' : 'host');
const pad3 = (n) => String(n).padStart(3, '0');
const rid = () => Math.random().toString(36).slice(2, 10);
const newId = () => Date.now().toString(36) + rid().slice(0, 4); // match ids and notice ids
const sortedKeys = (o) => Object.keys(o || {}).sort();
const firstName = (name) => String(name || '').split(' ')[0];
// A quick side-to-side shake for something refused. prop is the property it moves: 'translate'
// (composes with an element's own transform) or 'transform'.
function shake(el, px = 6, ms = 260, prop = 'translate') {
  const at = (x) => (prop === 'translate' ? { translate: x ? `${x}px 0` : '0 0' } : { transform: x ? `translateX(${x}px)` : 'translateX(0)' });
  return el.animate([at(0), at(-px), at(px), at(0)], { duration: ms });
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c5 0 7 10 12 10h3M3 17h3c2 0 3.5-1.6 4.7-3.6M14 8.6C15 7.6 16.3 7 18 7h3"/><path d="M19 4l3 3-3 3M19 14l3 3-3 3"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 13.5h5"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M13 7l4 4"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4c3-1.6 5 1.6 8 0s5 0 6 0v9c-1 0-3-1.6-6 0s-5-1.6-8 0" fill="currentColor" fill-opacity=".12"/></svg>',
  leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4H6v16h8"/><path d="M11 12h10M17.5 8.5L21 12l-3.5 3.5"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
};

// ---------- sound (tiny synth, no files) ----------
const Sound = {
  ctx: null,
  on: true,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  tone(f, dur, { type = 'sine', vol = 0.12, to = null, at = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, { vol = 0.2, freq = 1200, to = null, q = 0.8, at = 0, type = 'lowpass' } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
  },
  tap() { this.tone(720, 0.06, { type: 'triangle', vol: 0.06 }); },
  pick() { this.tone(520, 0.12, { type: 'triangle', vol: 0.1, to: 820 }); },
  clack() { this.noise(0.07, { vol: 0.35, freq: 2400, q: 2, type: 'bandpass' }); this.tone(190, 0.09, { type: 'triangle', vol: 0.12, to: 120 }); },
  whoosh() { this.noise(0.45, { vol: 0.12, freq: 600, to: 2600, q: 1.5, type: 'bandpass' }); },
  splash() { this.noise(0.55, { vol: 0.3, freq: 2200, to: 300, q: 0.6 }); this.tone(900, 0.12, { type: 'sine', vol: 0.05, to: 1500, at: 0.04 }); },
  boom() { this.noise(0.8, { vol: 0.55, freq: 900, to: 60, q: 0.7 }); this.tone(110, 0.5, { type: 'sine', vol: 0.3, to: 38 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.11, at: i * 0.11 })); },
  lose() { [440, 392, 330].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.08, at: i * 0.14 })); },
  pop() { this.tone(640, 0.09, { type: 'triangle', vol: 0.07, to: 980 }); },
  ding() { this.tone(988, 0.25, { type: 'sine', vol: 0.08 }); this.tone(1318, 0.3, { type: 'sine', vol: 0.06, at: 0.08 }); },
};
document.addEventListener('pointerdown', () => Sound.ensure(), { capture: true, passive: true });
