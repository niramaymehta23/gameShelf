'use strict';
// ---------- app state ----------
const G = {
  dev: null, name: '', code: null, table: null, tableMissing: false, seat: null,
  matchId: null, match: null, joining: false, claimed: false, leftByMe: false, pendingJoin: null,
  unsubTable: null, unsubMatch: null,
};
const partnerName = () => (G.table && G.seat && G.table[other(G.seat)] && G.table[other(G.seat)].name) || 'Your partner';
const myName = () => (G.table && G.seat && G.table[G.seat] && G.table[G.seat].name) || G.name || 'You';

// Codes belong to this device, not to a name (two people may have the same name).
const TableHistory = {
  ignored: new Set(),
  list() {
    try { const rows = JSON.parse(Pref.get('tables-history') || '[]'); return Array.isArray(rows) ? rows.filter(x => x && /^[A-Z]{4}$/.test(x.code)).slice(0, 20) : []; }
    catch (_) { return []; }
  },
  remember(t, seat) {
    if (!seat || !t[seat] || t[seat].dev !== G.dev || this.ignored.has(t.code)) return;
    const rows = this.list(), old = rows.find(x => x.code === t.code);
    const row = { code: t.code, created: t.created || 0, host: t.host.dev, me: t[seat].name, partner: t[other(seat)]?.name || '', at: Date.now() };
    if (old && ['created', 'host', 'me', 'partner'].every(k => old[k] === row[k]) && Date.now() - old.at < 60000) return;
    Pref.set('tables-history', JSON.stringify([row, ...rows.filter(x => x.code !== t.code)].slice(0, 20)));
  },
  forget(code) { this.ignored.add(code); Pref.set('tables-history', JSON.stringify(this.list().filter(x => x.code !== code))); },
  async rejoin(row, button) {
    button.disabled = true;
    try {
      const snap = await Net.doc('tables/' + row.code).get(), t = snap.exists && snap.data();
      if (!t || t.host.dev !== row.host || (row.created && t.created !== row.created)) { toast('That table has been cleared. You can remove it from your history.'); return; }
      if (![t.host?.dev, t.guest?.dev].includes(G.dev)) { toast('This device no longer has a seat at that table.'); return; }
      closeSheet(); openTable(row.code);
    } catch (_) { toast('Couldn’t reach that table. Try again when you’re connected.'); }
    finally { button.disabled = false; }
  },
};

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
  TableHistory.ignored.delete(code);
  G.code = code; G.joining = joining; G.claimed = false;
  G.table = null; G.tableMissing = false;
  Pref.set('table', code);
  G.unsubTable = Net.doc('tables/' + code).onSnapshot(onTableSnap, (e) => console.warn('table listener', e));
  Live.join(code);
  Chat.join(code);
  route();
}
function closeTable(clearPref = true) {
  if (G.unsubTable) G.unsubTable();
  if (G.unsubMatch) G.unsubMatch();
  G.unsubTable = G.unsubMatch = null;
  Live.leave();
  Chat.leave();
  chatUnread(false);
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
  TableHistory.remember(G.table, G.seat);
  if (G.seat && prev) {
    const p = other(G.seat);
    if (!prev[p] && G.table[p]) { toast(`${G.table[p].name} sat down at the table`); Sound.ding(); }
    const fresh = G.table.notice && (!prev.notice || prev.notice.id !== G.table.notice.id);
    if (prev.current && !G.table.current && !G.leftByMe && !fresh) toast(`${partnerName()} went back to the shelf`);
  }
  G.leftByMe = false;
  const cur = G.table.current || null;
  if (cur !== G.matchId) watchMatch(cur);
  route();
  showNotice();
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
    const prev = G.match;
    G.match = s.exists ? s.data() : null;
    if (prev && G.match && G.seat && !joinedBy(prev, other(G.seat)) && joinedBy(G.match, other(G.seat))) {
      if (G.waitToast) { G.waitToast.remove(); G.waitToast = null; }
      toast(`${partnerName()} joined`); Sound.ding();
    }
    route();
  }, (e) => console.warn('match listener', e));
}
// ---------- opening, joining, saving and quitting games ----------
// table.saved  {c4: matchId|null, bs: …, hu: …, ip: …}  the game of each kind you can carry on later
// table.notice {id, by, kind, game, match} what one of you just did, for the other phone to show:
//   'saved' saved and quit · 'quit' quit without saving (the other decides: keep it saved, or quit too)
//   'discarded' both quit, so it's gone · 'declined' said "not now" to a game the other opened
// match.joined {host, guest}  who is in; whoever opens a game is, the other phone is asked to join
// match.quit   {host, guest}  who chose to quit without saving
const joinedBy = (m, seat) => !m.joined || m.joined[seat] !== false; // older matches have no joined map: both are in
const hasProgress = (m) => !!m && (['rps', 'moves', 'shots', 'plays', 'bids'].some((k) => Object.keys(m[k] || {}).length > 0) || !!(m.fleets && (m.fleets.host || m.fleets.guest)));
const matchPath = (id) => `tables/${G.code}/matches/${id}`;
const notice = (kind, m) => ({ id: Date.now().toString(36) + rid().slice(0, 4), by: G.seat, kind, game: m.game, match: m.id });

async function startMatch(game) {
  const id = Date.now().toString(36) + rid().slice(0, 4);
  const ok = await write(matchPath(id), { id, game, ...(game === 'hu' ? { hueVersion: 2, hueRules: null } : {}), ...(game === 'st' ? { stRulesVersion: 2 } : {}), created: Date.now(), by: G.seat, seed: rid() + rid(), rps: {}, moves: {}, shots: {}, plays: {}, bids: {}, fleets: {}, joined: { [G.seat]: true, [other(G.seat)]: false }, quit: {} }, { set: true });
  // a new game takes the place of a saved one of the same kind
  if (ok) await write('tables/' + G.code, { current: id, saved: { [game]: null } });
}
async function resumeMatch(id) {
  const ok = await write(matchPath(id), { joined: { [G.seat]: true, [other(G.seat)]: false }, quit: {} });
  if (ok) await write('tables/' + G.code, { current: id });
}
async function joinMatch(m) { await write(matchPath(m.id), { joined: { [G.seat]: true } }); }
async function declineMatch(m) {
  G.leftByMe = true;
  await write('tables/' + G.code, { current: null, notice: notice('declined', m) });
}
async function saveAndQuit(m) {
  G.leftByMe = true;
  await write(matchPath(m.id), { quit: {} });
  if (await write('tables/' + G.code, { current: null, saved: { [m.game]: m.id }, notice: notice('saved', m) })) toast('Saved. It’s on the shelf for next time.');
}
async function quitGame(m) {
  G.leftByMe = true;
  const both = !!(m.quit && m.quit[other(G.seat)]);
  await write(matchPath(m.id), { quit: { [G.seat]: true } });
  // one quit only pauses the game: it stays saved until the other one quits too
  const ok = await write('tables/' + G.code, both
    ? { current: null, saved: { [m.game]: null }, notice: notice('discarded', m) }
    : { current: null, saved: { [m.game]: m.id }, notice: notice('quit', m) });
  if (ok) toast(both ? 'Game put away without saving.' : `You quit. ${partnerName()} can still keep it saved.`, 3200);
}
async function rematch(fromId, game) {
  if (!G.table || G.table.current !== fromId) return;
  await startMatch(game);
}

// The other phone's notices. A quit asks for a decision and stays up until it's answered;
// the rest are shown once per phone.
let noticeSheet = null;
function showNotice() {
  const n = G.table && G.table.notice;
  if (!n || !G.seat || n.by === G.seat || !GAMES[n.game]) return;
  const P = partnerName(), g = GAMES[n.game].name;
  if (n.kind === 'quit') {
    const open = !G.table.current && G.table.saved && G.table.saved[n.game] === n.match;
    if (!open || (noticeSheet === n.id && !$('#sheet').hidden)) return;
    noticeSheet = n.id;
    const decide = async (fn) => { const s = await Net.doc(matchPath(n.match)).get().catch(() => null); if (s && s.exists) fn(s.data()); };
    openSheet({
      title: `${P} quit ${g}`,
      body: 'The game is paused where you left it. Keep it saved to finish another time, or quit too and it’s gone.',
      dismissible: false,
      actions: [
        { label: 'Keep it saved', kind: 'primary', onClick: () => decide(saveAndQuit) },
        { label: 'Quit too', kind: 'ink', onClick: () => decide(quitGame) },
      ],
    });
    return;
  }
  if (Pref.get('notice') === n.id) return;
  Pref.set('notice', n.id);
  const text = {
    saved: [`${P} saved ${g}`, `${P} went back to the shelf. Pick ${g} to carry on where you left off.`],
    discarded: [`${P} quit too`, `${g} has been put away without saving.`],
    declined: [`${P} can’t play right now`, `${P} said not now to ${g}.`],
  }[n.kind];
  if (text) { Sound.ding(); openSheet({ title: text[0], body: text[1], actions: [{ label: 'OK', kind: 'ghost' }] }); }
}

// Asked to join a game the other phone opened (or a saved one they want to carry on).
let inviteFor = null, inviteTok = 0;
function syncInvite() {
  const m = G.match;
  const want = (G.seat && G.table && m && G.table.current === m.id && !joinedBy(m, G.seat)) ? m.id : null;
  if (want === inviteFor) return;
  if (inviteFor && !want) closeSheet(inviteTok);
  inviteFor = want;
  if (!want) return;
  const P = partnerName(), g = GAMES[m.game].name, saved = hasProgress(m);
  Sound.ding();
  inviteTok = openSheet({
    title: saved ? `${P} wants to carry on ${g}` : `${P} opened ${g}`,
    body: saved ? 'Your saved game is ready where you left it.' : 'Join them for a new game?',
    dismissible: false,
    actions: [
      { label: saved ? 'Carry on' : 'Join', kind: 'primary', onClick: () => joinMatch(m) },
      { label: 'Not now', kind: 'ghost', onClick: () => declineMatch(m) },
    ],
  });
}
async function backToShelf() {
  G.leftByMe = true;
  await write('tables/' + G.code, { current: null });
}
function recordResult(m, w) {
  if (!G.table || (G.table.results && G.table.results[m.id])) return;
  const finishedSaved = G.table.saved && G.table.saved[m.game] === m.id;
  write('tables/' + G.code, { results: { [m.id]: { g: m.game, w } }, ...(finishedSaved ? { saved: { [m.game]: null } } : {}) });
}

// ---------- toast + sheet ----------
function toast(text, ms = 2400) {
  const box = $('#toast');
  const t = h('div', { class: 'toast' }, text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
  return t;
}
let sheetToken = 0;
function openSheet({ title, sub, body, art, actions = [], dismissible = true }) {
  const sh = $('#sheet');
  const token = ++sheetToken;
  sh.className = '';
  sh.replaceChildren();
  const panel = h('div', { class: 'panel paper', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Table options' }, h('div', { class: 'tape' }), h('div', { class: 'grip' }));
  const content = h('div', { class: 'sheet-content', role: 'region', tabindex: '0', 'aria-label': title || 'Details' });
  if (art) content.append(art);
  if (title) content.append(h('div', { class: 'sheet-title' }, title));
  if (sub) content.append(h('div', { class: 'sheet-sub' }, sub));
  if (body) content.append(typeof body === 'string' ? h('div', { class: 'sheet-body' }, body) : body);
  panel.append(content);
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
  if (G.localStonks) name = 'stonks';
  else if (!G.code) name = 'landing';
  else if (!G.table) name = G.tableMissing ? 'missing' : 'loading';
  else if (!G.seat) name = 'seat';
  else if (!G.table.guest || !G.table.host) name = 'waiting';
  else if (!G.table.current) name = 'shelf';
  else if (!G.match || G.match.id !== G.table.current) name = 'loading';
  else if (!joinedBy(G.match, G.seat)) name = 'shelf';
  else name = 'match:' + G.match.id;
  show(name);
  updateBar();
  syncInvite();
}
function show(name) {
  if (cur.name === name) { cur.obj.update && cur.obj.update(); return; }
  const stage = $('#stage');
  if (cur.el) {
    try { cur.obj.unmount && cur.obj.unmount(); } catch (e) { console.error(e); }
    const old = cur.el; old.classList.add('leaving'); setTimeout(() => old.remove(), 230);
  }
  const key = name.split(':')[0];
  setBar({});
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
// One row on every table screen: [screen's buttons] [title, partner dot] [chat, sound].
// A screen puts its own buttons and title in with setBar() when it mounts; show() clears them.
function setBar({ title = '', left = [] }) {
  $('#barTitle').textContent = title;
  $('#barTitle').hidden = !title;
  $('#barLeft').replaceChildren(...left);
}
// The partner dot: green when they're on the same screen as you, amber when they're at the table
// somewhere else (the shelf, another game), red when they're not connected.
function presence() {
  const p = G.table && G.table[other(G.seat)];
  const peer = Live.partner();
  const where = peer && peer.pres && peer.pres.screen;
  if (!p) return { state: 'gone', name: 'Partner', text: 'Waiting for your partner to join the table' };
  const first = p.name.split(' ')[0];
  if (!Net.online) return { state: 'gone', name: first, text: 'You’re offline. Reconnecting…' };
  if (!peer) return { state: 'gone', name: first, text: `${p.name} isn’t connected right now` };
  if (where === cur.name.split(':')[0]) return { state: 'here', name: first, text: `${p.name} is here with you` };
  return { state: 'near', name: first, text: `${p.name} is ${where === 'shelf' ? 'at the shelf' : where === 'match' ? 'in a game' : 'at the table'}` };
}
function updateBar() {
  const bar = $('#bar');
  const inTable = !G.localStonks && !!(G.code && G.table && G.seat);
  bar.hidden = !inTable;
  if (!inTable) return;
  const ps = presence();
  $('#partnerDot').className = 'dot ' + ps.state;
  $('#partnerName').textContent = ps.name;
  $('#presence').setAttribute('aria-label', ps.text);
}
$('#presence').addEventListener('click', () => { Sound.tap(); toast(presence().text); });
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

// ---------- chat: reactions and short notes ----------
const CHAT_EMOJI = [['😭', 'Crying'], ['😂', 'Laughing'], ['😮‍💨', 'Phew'], ['💀', 'Dead'], ['😏', 'Smirk'], ['😡', 'Angry'], ['💋', 'Kiss'], ['👀', 'Eyes'], ['😉', 'Wink']];
const CHAT_QUICK = ['Your turn!', 'Nice one', 'Nooo', 'Hurry up', 'One sec', 'Good game', 'Rematch?', 'Love you'];
let chatTok = 0, chatThread = null;
const chatOpen = () => !$('#sheet').hidden && sheetToken === chatTok;
function chatUnread(on) { $('#chatBtn').classList.toggle('has', !!on); }
function chatLine(m) {
  const mine = m.seat === G.seat;
  return h('div', { class: 'chat-line ' + (mine ? 'me' : 'them') },
    h('span', { class: 'who' }, mine ? 'You' : partnerName()),
    m.e ? h('span', { class: 'e' }, m.e) : h('span', null, m.t));
}
function openChat() {
  Sound.tap();
  chatUnread(false);
  const recent = Chat.list;
  chatThread = h('div', { class: 'chat-thread' }, ...(recent.length ? recent.map(chatLine) : [h('div', { class: 'chat-empty' }, `Nothing yet. Say hi to ${partnerName()}.`)]));
  const input = h('input', { class: 'chat-input', type: 'text', maxlength: '80', placeholder: 'Write a note…', enterkeyhint: 'send', autocomplete: 'off', 'aria-label': 'Your note' });
  const body = h('div', { class: 'chat-panel' },
    chatThread,
    h('div', { class: 'chat-emoji' }, ...CHAT_EMOJI.map(([e, name]) => h('button', { 'aria-label': name, onclick: () => chatSend({ e }) }, e))),
    h('div', { class: 'chat-chips' }, ...CHAT_QUICK.map((t) => h('button', { class: 'chip', onclick: () => chatSend({ t }) }, t))),
    h('form', { class: 'chat-form', onsubmit: (ev) => { ev.preventDefault(); const t = input.value.trim().slice(0, 80); if (t) chatSend({ t }); } },
      input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send')));
  chatTok = openSheet({ title: 'Say something', body });
  requestAnimationFrame(() => { chatThread.scrollTop = chatThread.scrollHeight; });
}
function chatSend(m) {
  if (!Chat.send(m)) return;
  closeSheet(chatTok);
  vibrate(6);
  if (m.e) chatPop(m.e, true); else toast('Sent');
}
// a big emoji bursting out under the partner's name (or a small one rising from the chat button for your own)
function chatPop(e, mine) {
  if (!mine) return chatRain(e);
  const r = $('#chatBtn').getBoundingClientRect();
  const el = h('div', { class: 'chat-pop mine' }, e);
  el.style.left = r.left + r.width / 2 + 'px';
  el.style.top = r.top + 'px';
  $('#chatfx').append(el);
  settle(el.animate([{ transform: 'translate(-50%, 0) scale(.6)', opacity: 1 }, { transform: 'translate(-50%, -46px) scale(1)', opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' }), 900).then(() => el.remove());
}
// their reaction rains down over the top third of the screen: nine copies, each its own size, sway and pace
function chatRain(e) {
  const W = innerWidth, fall = innerHeight * 0.34;
  for (let i = 0; i < 9; i++) {
    const el = h('div', { class: 'chat-pop' }, e);
    const size = 30 + Math.random() * 26;
    const x = Math.min(W - size / 2 - 30, Math.max(size / 2 + 30, W * ((i + Math.random()) / 9)));
    const sway = (Math.random() - 0.5) * 50, spin = (Math.random() - 0.5) * 50;
    const dur = 1700 + Math.random() * 900, delay = Math.random() * 650;
    el.style.cssText = `left:${x}px;top:-60px;font-size:${size}px`;
    $('#chatfx').append(el);
    settle(el.animate([
      { transform: 'translate(-50%, 0) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${sway * 0.4}px), ${fall * 0.25 + 60}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.2 },
      { transform: `translate(calc(-50% + ${sway}px), ${fall * 0.8 + 60}px) rotate(${spin}deg)`, opacity: 1, offset: 0.75 },
      { transform: `translate(calc(-50% + ${sway * 1.2}px), ${fall + 60}px) rotate(${spin * 1.2}deg)`, opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' }), dur + delay).then(() => el.remove());
  }
}
// a taped note from your partner, in the same stack as toasts; tap it away or it goes by itself
function chatNote(text) {
  const box = $('#toast');
  const note = h('button', { class: 'chat-note' }, h('b', null, partnerName()), h('span', null, text));
  const bye = () => { if (!note.isConnected) return; note.classList.add('out'); setTimeout(() => note.remove(), 240); };
  note.addEventListener('click', bye);
  box.append(note);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(bye, 4800);
}
Chat.onMessage((m, live) => {
  if (chatThread && chatThread.isConnected) {
    chatThread.querySelector('.chat-empty')?.remove();
    chatThread.append(chatLine(m));
    while (chatThread.children.length > 30) chatThread.firstChild.remove();
    chatThread.scrollTop = chatThread.scrollHeight;
  }
  if (!live || m.seat === G.seat || !G.seat) return;
  Sound.pop(); vibrate(10);
  if (m.e) chatPop(m.e, false); else chatNote(m.t);
  if (!chatOpen()) chatUnread(true);
});
$('#chatBtn').insertAdjacentHTML('afterbegin', ICON.chat);
$('#chatBtn').addEventListener('click', openChat);

// ---------- wake lock while a game is on screen ----------
const Wake = {
  lock: null,
  async on() { try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch (e) { this.lock = null; } },
  off() { try { this.lock && this.lock.release(); } catch (e) {} this.lock = null; },
};

