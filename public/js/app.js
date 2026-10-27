'use strict';
// ---------- app state ----------
const G = {
  dev: null, name: '', code: null, table: null, tableMissing: false, seat: null,
  matchId: null, match: null, joining: false, claimed: false, leftByMe: false, pendingJoin: null,
  unsubTable: null, unsubMatch: null,
};
const partnerName = () => (G.table && G.seat && G.table[other(G.seat)] && G.table[other(G.seat)].name) || 'Your partner';
const myName = () => (G.table && G.seat && G.table[G.seat] && G.table[G.seat].name) || G.name || 'You';

async function write(path, patch, { set = false } = {}) {
  try {
    const ref = Net.doc(path);
    await (set ? ref.set(patch) : ref.update(patch));
    return true;
  } catch (e) {
    console.warn('write failed', path, e);
    if (e && e.code === 'unavailable') toast('Couldn’t reach the table. Check your connection and try again.');
    else toast('Couldn’t save that. Try again.');
    return false;
  }
}

function openTable(code, { joining = false } = {}) {
  closeTable(false);
  G.code = code; G.joining = joining; G.claimed = false;
  G.table = null; G.tableMissing = false;
  Pref.set('table', code);
  G.unsubTable = Net.doc('tables/' + code).onSnapshot(onTableSnap, (e) => console.warn('table listener', e));
  Live.join(code);
  route();
}
function closeTable(clearPref = true) {
  if (G.unsubTable) G.unsubTable();
  if (G.unsubMatch) G.unsubMatch();
  G.unsubTable = G.unsubMatch = null;
  Live.leave();
  G.code = null; G.table = null; G.seat = null; G.matchId = null; G.match = null; G.tableMissing = false;
  if (clearPref) Pref.del('table');
}
function onTableSnap(s) {
  if (!G.code) return;
  if (!s.exists) { G.table = null; G.tableMissing = true; route(); return; }
  const prev = G.table;
  G.table = s.data();
  G.tableMissing = false;
  resolveSeat();
  if (G.seat && prev) {
    const p = other(G.seat);
    if (!prev[p] && G.table[p]) { toast(`${G.table[p].name} sat down at the table`); Sound.ding(); }
    if (prev.current && !G.table.current && !G.leftByMe) toast(`${partnerName()} went back to the shelf`);
  }
  G.leftByMe = false;
  const cur = G.table.current || null;
  if (cur !== G.matchId) watchMatch(cur);
  route();
}
function resolveSeat() {
  const t = G.table, d = G.dev;
  if (t.host && t.host.dev === d) G.seat = 'host';
  else if (t.guest && t.guest.dev === d) G.seat = 'guest';
  else {
    G.seat = null;
    if (!t.guest && G.joining && !G.claimed) {
      G.claimed = true;
      write('tables/' + G.code, { guest: { dev: G.dev, name: G.name || 'Player 2' } });
    }
  }
  if (G.seat) Live.set({ seat: G.seat });
}
function watchMatch(id) {
  if (G.unsubMatch) G.unsubMatch();
  G.unsubMatch = null; G.matchId = id; G.match = null;
  if (!id) return;
  G.unsubMatch = Net.doc(`tables/${G.code}/matches/${id}`).onSnapshot((s) => {
    if (G.matchId !== id) return;
    G.match = s.exists ? s.data() : null;
    route();
  }, (e) => console.warn('match listener', e));
}
async function startMatch(game) {
  const id = Date.now().toString(36) + rid().slice(0, 4);
  const ok = await write(`tables/${G.code}/matches/${id}`, { id, game, created: Date.now(), by: G.seat, rps: {}, moves: {}, shots: {}, fleets: {} }, { set: true });
  if (ok) await write('tables/' + G.code, { current: id });
}
async function rematch(fromId, game) {
  if (!G.table || G.table.current !== fromId) return;
  await startMatch(game);
}
async function backToShelf() {
  G.leftByMe = true;
  await write('tables/' + G.code, { current: null });
}
function recordResult(m, w) {
  if (!G.table || (G.table.results && G.table.results[m.id])) return;
  write('tables/' + G.code, { results: { [m.id]: { g: m.game, w } } });
}

// ---------- toast + sheet ----------
function toast(text, ms = 2400) {
  const box = $('#toast');
  const t = h('div', { class: 'toast' }, text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
}
let sheetToken = 0;
function openSheet({ title, sub, body, art, actions = [], dismissible = true }) {
  const sh = $('#sheet');
  const token = ++sheetToken;
  sh.className = '';
  sh.replaceChildren();
  const panel = h('div', { class: 'panel paper', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'tape' }), h('div', { class: 'grip' }));
  if (art) panel.append(art);
  if (title) panel.append(h('div', { class: 'sheet-title' }, title));
  if (sub) panel.append(h('div', { class: 'sheet-sub' }, sub));
  if (body) panel.append(typeof body === 'string' ? h('div', { class: 'sheet-body' }, body) : body);
  const row = h('div', { class: 'btn-row', style: 'flex-direction:column' });
  for (const a of actions) {
    row.append(h('button', {
      class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'felt' ? 'btn-felt' : a.kind === 'ink' ? 'btn-ink' : 'btn-ghost'),
      onclick: () => { Sound.tap(); if (!a.keepOpen) closeSheet(); a.onClick && a.onClick(); },
    }, a.label));
  }
  if (actions.length) panel.append(row);
  const scrim = h('div', { class: 'scrim', onclick: () => { if (dismissible) closeSheet(); } });
  sh.append(scrim, panel);
  sh.hidden = false;
  return token;
}
function closeSheet(token) {
  const sh = $('#sheet');
  if (sh.hidden || (token && token !== sheetToken)) return;
  sh.classList.add('closing');
  const t = sheetToken;
  setTimeout(() => { if (t === sheetToken) { sh.hidden = true; sh.replaceChildren(); sh.className = ''; } }, 220);
}

// ---------- router ----------
const Screens = {};
let cur = { name: null, obj: null, el: null };
function route() {
  let name;
  if (!G.code) name = 'landing';
  else if (!G.table) name = G.tableMissing ? 'missing' : 'loading';
  else if (!G.seat) name = 'seat';
  else if (!G.table.guest || !G.table.host) name = 'waiting';
  else if (!G.table.current) name = 'shelf';
  else if (!G.match || G.match.id !== G.table.current) name = 'loading';
  else name = 'match:' + G.match.id;
  show(name);
  updateBar();
}
function show(name) {
  if (cur.name === name) { cur.obj.update && cur.obj.update(); return; }
  const stage = $('#stage');
  if (cur.el) {
    try { cur.obj.unmount && cur.obj.unmount(); } catch (e) { console.error(e); }
    const old = cur.el; old.classList.add('leaving'); setTimeout(() => old.remove(), 230);
  }
  const key = name.split(':')[0];
  const obj = Screens[key]();
  const el = h('section', { class: 'screen ' + (obj.cls || '') });
  stage.append(el);
  cur = { name, obj, el };
  obj.mount(el);
  obj.update && obj.update();
  Live.set({ screen: key });
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { cur.obj && cur.obj.relayout && cur.obj.relayout(); }, 180); });

// ---------- top bar ----------
function updateBar() {
  const bar = $('#bar');
  const inTable = !!(G.code && G.table && G.seat);
  bar.hidden = !inTable;
  if (!inTable) return;
  const codeBox = $('#barCode');
  if (codeBox.dataset.code !== G.code) {
    codeBox.dataset.code = G.code;
    codeBox.replaceChildren(...G.code.split('').map((ch) => h('span', { class: 'tile' }, ch)));
  }
  const p = G.table[other(G.seat)];
  const online = !!Live.partner();
  $('#partnerDot').classList.toggle('on', online && Net.online);
  $('#partnerName').textContent = !Net.online ? 'Reconnecting…' : p ? (online ? `${p.name} is here` : `${p.name} is away`) : 'Waiting for a partner';
}
Live.onChange(() => { updateBar(); cur.obj && cur.obj.onPeers && cur.obj.onPeers(); });
// Losing the connection for more than a moment gets a note; coming back is quiet unless it was noticed.
let offlineNoticeT = null, offlineNoticed = false;
Net.onStatus((on) => {
  clearTimeout(offlineNoticeT);
  if (!on) offlineNoticeT = setTimeout(() => { offlineNoticed = true; toast('Lost the connection. Reconnecting…', 3200); updateBar(); }, 2500);
  else if (offlineNoticed) { offlineNoticed = false; toast('Back online'); }
  updateBar();
});
function paintSoundBtn() { const b = $('#soundBtn'); b.innerHTML = Sound.on ? ICON.soundOn : ICON.soundOff; b.setAttribute('aria-pressed', String(Sound.on)); }
$('#soundBtn').addEventListener('click', () => { Sound.on = !Sound.on; Pref.set('sound', Sound.on ? 'on' : 'off'); paintSoundBtn(); Sound.ensure(); Sound.tap(); });

// ---------- wake lock while a game is on screen ----------
const Wake = {
  lock: null,
  async on() { try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch (e) { this.lock = null; } },
  off() { try { this.lock && this.lock.release(); } catch (e) {} this.lock = null; },
};

