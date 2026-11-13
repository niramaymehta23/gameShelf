// Player page. Renders whatever state the server pushes; game screens come from SabhaGames[gameId]
// (public/js/games/*.js). Phones never decide anything: they show and send taps.
'use strict';

window.SabhaGames = window.SabhaGames || {};

const P = {
  room: null, creds: null, state: null, screenKey: null, gameEl: null, gameSeg: null, pending: false,
  replaced: false, lastPhase: null, hbTimer: null,
};
const app = () => document.getElementById('app');

function credsKey(room) { return skey('player:' + room); }
function saveCreds(c) { store.set(credsKey(c.room), c); store.set(skey('lastRoom'), c.room); }

function setTeamColour(team) {
  document.body.dataset.team = team || '';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = team === 'red' ? '#c4362c' : team === 'blue' ? '#2459a6' : '#1d2433';
}

// ---------- boot ----------
function boot() {
  const qs = new URLSearchParams(location.search);
  P.room = (qs.get('r') || store.get(skey('lastRoom')) || '').toUpperCase() || null;
  if (qs.get('r')) store.set(skey('lastRoom'), P.room);
  Net.connect();
  Net.socket.on('state', s => onState(s));
  Net.socket.on('fx', d => onFx(d));
  Net.socket.on('replaced', () => { P.replaced = true; P.creds = null; render(); });
  Net.socket.on('joined', c => { clearPending(); saveCreds(c); P.creds = c; hello(); });
  Net.on('connect', () => { if (P.creds) hello(); else if (P.pending) recheckPending(); renderConn(); });
  Net.on('disconnect', renderConn);
  P.creds = P.room ? store.get(credsKey(P.room)) : null;
  if (!P.creds && P.room && store.get(pendingKey(P.room))) P.pending = store.get(pendingKey(P.room));
  P.hbTimer = setInterval(() => { if (P.creds && Net.connected) Net.socket.emit('hb'); }, 3000);
  setInterval(tick, 200);
  render();
}

// waiting for the host to say whether this is the same person on a new phone
function pendingKey(room) { return skey('pending:' + room); }
function clearPending() { if (P.room) store.del(pendingKey(P.room)); P.pending = false; }
async function recheckPending() {
  const r = await Net.call('p:pending', { room: P.room, reqId: P.pending });
  if (r && r.creds) { clearPending(); saveCreds(r.creds); P.creds = r.creds; hello(); }
  else if (!r || r.error) { clearPending(); render(); }
}
async function cancelPending() {
  await Net.call('p:cancel', { room: P.room, reqId: P.pending });
  clearPending(); render();
}

async function hello() {
  const r = await Net.call('p:hello', P.creds);
  if (r && r.error) {
    if (r.error === 'noroom') { P.room = null; store.del(skey('lastRoom')); }
    store.del(credsKey(P.creds.room)); P.creds = null; P.state = null; render();
  }
}

function onState(s) {
  const prev = P.state;
  P.state = s;
  Net.setClock(s.clock);
  if (s.me) setTeamColour(s.me.team);
  // sounds for moments everyone shares
  if (prev && prev.phase !== s.phase) {
    if (s.phase === 'time') { Sound.time(); buzz([80, 60, 80]); }
    if (s.phase === 'live') { Sound.go(); }
    if (s.phase === 'final') Sound.win();
  }
  if (['countdown', 'live'].includes(s.phase)) Wake.on(); else if (!['intro', 'results', 'dsi', 'time'].includes(s.phase)) Wake.off();
  render();
}

function onFx(d) {
  const st = P.state;
  const mod = st && st.game && SabhaGames[st.game.id];
  if (d && d.kind && !d.game) {
    if (d.kind === 'good' || d.kind === 'bad') { flash(d.kind); (d.kind === 'good' ? Sound.good() : Sound.bad()); }
  }
  if (mod && mod.fx && P.gameEl) { try { mod.fx(d, gameApi()); } catch (e) { console.error(e); } }
}

function gameApi() {
  const st = P.state || {};
  return {
    me: st.me, team: st.me && st.me.team, round: st.round, state: st, el: P.gameEl,
    now: () => Net.now(),
    send(type, data = {}) { Net.socket.emit('act', { actionId: newId(), type, ...data }); },
    flash, buzz, sound: Sound, h, Keypad, fmtClock,
  };
}

// ---------- screens ----------
function render() {
  const root = app();
  const st = P.state;
  if (P.replaced) return show('replaced', () => screen('', [h('h1', { text: 'You are playing on another phone now.' }), h('p.sub', { text: 'This phone has been handed over by the host.' })]));
  if (P.pending) return show('pending', () => screen('', [h('h1', { text: 'Asking the host…' }),
    h('p.sub', { text: 'Someone with your name is already playing. The host will check it is you on a new phone.' }),
    h('button.link', { onclick: cancelPending, text: 'Cancel' })]));
  if (!P.room) return show('code', codeScreen);
  if (!P.creds) return show('join:' + P.room, joinScreen);
  if (!st) return show('loading', () => screen('', [h('p.sub', { text: 'Connecting…' })]));
  const me = st.me;
  if (st.phase === 'removed') return show('removed', () => screen('', [h('h1', { text: 'The host has taken you out of this game.' }), h('p.sub', { text: 'Ask them if that was a mistake.' })]));

  if (!me.team || me.waiting) return show('queue:' + (me.team || '') + me.waiting + st.locked, () => queueScreen(st));

  switch (st.phase) {
    case 'lobby': case 'ready': return show('wait:' + me.team + ':' + me.seat + ':' + st.locked + ':' + st.phase, () => waitingScreen(st));
    case 'intro': return show('intro:' + st.game.id, () => introScreen(st));
    case 'countdown': return show('cd:' + st.round.segId, () => countdownScreen(st));
    case 'live':
      if (!st.playing) return show('watch:' + st.round.segId + st.watching, () => watchScreen(st));
      return liveScreen(st);
    case 'time': return show('time:' + (st.last ? st.last.label : ''), () => screen('big-word', [h('div.huge', { text: 'Time!' })]));
    case 'results': return show('res:' + JSON.stringify([st.last, st.teamTotal, st.next]), () => betweenScreen(st));
    case 'gameover': return show('go:' + JSON.stringify(st.gameover), () => gameoverScreen(st));
    case 'dsi': return show('dsi:' + JSON.stringify(st.dsi), () => dsiScreen(st));
    case 'final': return show('final', () => finalScreen(st));
    default: return show('?' + st.phase, () => screen('', [h('p.sub', { text: 'Waiting for the host' })]));
  }
}

// Rebuild the screen only when its key changes (so inputs don't lose what's typed).
function show(key, build) {
  if (key !== 'live') { P.gameEl = null; P.gameSeg = null; }
  if (P.screenKey === key) { renderPaused(); return; }
  P.screenKey = key;
  const root = app();
  root.replaceChildren(topStrip(), build() || h('div'));
  renderConn(); renderPaused();
}

function screen(cls, kids) { return h('main.screen' + (cls ? '.' + cls : ''), null, kids); }

function topStrip() {
  const me = P.state && P.state.me;
  return h('header.strip', null,
    h('span.strip-me', { text: me ? `${me.name}${me.team ? ' · ' + TEAM_NAME[me.team] + (me.seat ? ' #' + me.seat : '') : ''}` : 'Sabha Games' }),
    h('span.strip-room', { text: P.room || '' }),
    h('i.conn', { title: 'connection' }));
}
function renderConn() { const c = document.querySelector('.conn'); if (c) c.classList.toggle('off', !Net.connected); }
function renderPaused() {
  const st = P.state;
  const paused = st && st.clock && st.clock.at != null && ['live', 'countdown'].includes(st.phase);
  let ov = document.getElementById('paused');
  if (paused && !ov) document.body.append(h('div.paused', { id: 'paused' }, h('div', { text: 'Paused' }), h('p', { text: 'The host has paused the game.' })));
  if (!paused && ov) ov.remove();
}

function codeScreen() {
  const input = h('input.text-in.code-in', { maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', placeholder: 'ABCD', 'aria-label': 'Game code' });
  const err = h('p.err');
  const go = async () => {
    Sound.ensure();
    const code = input.value.trim().toUpperCase();
    const r = await Net.call('room:exists', code);
    if (!r || !r.ok) { err.textContent = 'No game with that code. Check with the host.'; return; }
    P.room = code; store.set(skey('lastRoom'), code); P.creds = store.get(credsKey(code)); render();
    if (P.creds) hello();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  return screen('join', [h('h1.title', { text: 'Sabha Games' }), h('label.lbl', { text: 'Game code' }), input, err, h('button.btn.main', { onclick: go, text: 'Next' })]);
}

function joinScreen() {
  const last = store.get(skey('lastName')) || '';
  const input = h('input.text-in', { maxlength: 12, value: last, autocomplete: 'off', autocapitalize: 'words', placeholder: 'Your name', 'aria-label': 'Your name' });
  const err = h('p.err');
  let busy = false;
  const join = async (team) => {
    if (busy) return;
    Sound.ensure(); // the first tap unlocks sound on iPhones
    const name = input.value.trim();
    if (!name) { err.textContent = 'Type your name first.'; input.focus(); return; }
    busy = true;
    store.set(skey('lastName'), name);
    const r = await Net.call('p:join', { room: P.room, name });
    busy = false;
    if (!r || r.error) { err.textContent = (r && r.error) || 'Could not join. Try again.'; return; }
    if (r.pending) { P.pending = r.reqId; store.set(pendingKey(P.room), r.reqId); render(); return; }
    saveCreds(r); P.creds = r;
    await hello();
    if (team) await Net.call('p:team', { team });
  };
  const st = { locked: false };
  const teams = h('div.team-pick', null,
    h('button.btn.team-btn.red', { onclick: () => join('red'), text: 'Red' }),
    h('button.btn.team-btn.blue', { onclick: () => join('blue'), text: 'Blue' }));
  const late = h('button.btn.main', { onclick: () => join(null), text: 'Join', hidden: true });
  Net.call('room:exists', P.room).then(r => { if (r && r.locked) { teams.hidden = true; late.hidden = false; hint.textContent = 'Teams are already picked. The host will put you in one.'; } });
  const hint = h('p.sub', { text: 'Type your name, then pick a team.' });
  return screen('join', [
    h('h1.title', { text: 'Sabha Games' }), h('p.room-code', { text: 'Game ' + P.room }),
    input, hint, err, teams, late,
    h('button.link', { onclick: () => { P.room = null; store.del(skey('lastRoom')); render(); }, text: 'Different game code' }),
  ]);
}

function queueScreen(st) {
  if (!st.locked && !st.me.team) {
    // joined but no team yet (e.g. came back after a reload before picking)
    return screen('join', [h('h1', { text: `Hi ${st.me.name}` }), h('p.sub', { text: 'Pick a team.' }),
      h('div.team-pick', null,
        h('button.btn.team-btn.red', { onclick: () => Net.call('p:team', { team: 'red' }), text: 'Red' }),
        h('button.btn.team-btn.blue', { onclick: () => Net.call('p:team', { team: 'blue' }), text: 'Blue' }))]);
  }
  return screen('', [h('h1', { text: `Hi ${st.me.name}` }), h('p.big', { text: 'Waiting for host' }), h('p.sub', { text: 'Teams are already locked. The host will put you in a team, and you play from the next round.' })]);
}

function waitingScreen(st) {
  const me = st.me;
  return screen('waiting', [
    h('p.sub', { text: me.name }),
    h('div.team-word', { text: TEAM_NAME[me.team] }),
    me.seat ? h('div.seat', null, h('span', { text: '#' }), String(me.seat)) : null,
    me.seat ? h('p.sub', { text: 'Remember your number.' }) : null,
    h('p.big', { text: 'Waiting for host' }),
    !st.locked ? h('button.btn.ghost', { onclick: () => Net.call('p:team', { team: other(me.team) }), text: `Switch to ${TEAM_NAME[other(me.team)]}` }) : null,
  ]);
}

function roundName(r, total) {
  if (!r) return '';
  if (r.practice) return 'Practice round (no points)';
  return `${r.label || 'Round ' + r.n}${total > 1 ? ' of ' + total : ''}`;
}

function introScreen(st) {
  return screen('intro', [
    h('p.kicker', { text: 'Next game' }),
    h('h1.game-name', { text: st.game.name }),
    h('p.rule', { text: st.game.rule }),
    h('p.sub', { text: st.next ? roundName(st.next, st.game.rounds) + ' starts soon' : '' }),
  ]);
}

function countdownScreen(st) {
  const num = h('div.huge.count', { text: '3' });
  const meTeam = st.me.team;
  const watching = !st.playing;
  return screen('countdown', [
    h('p.kicker', { text: `${st.game.name} · ${roundName(st.round, st.game.rounds)}` }),
    num,
    h('p.rule', { text: watching ? (st.watching === 'late' ? 'You play from the next round.' : `${TEAM_NAME[st.watching]} plays now. Watch them!`) : st.game.rule }),
  ]);
}

function watchScreen(st) {
  const t = st.watching === 'late' ? null : st.watching;
  return screen('watch', [
    h('p.kicker', { text: st.game.name }),
    h('h1', { text: t ? `${TEAM_NAME[t]} is playing` : 'You join from the next round' }),
    h('p.sub', { text: t ? `Watch them! ${TEAM_NAME[st.me.team]} plays next.` : 'Watch your team and get ready.' }),
    h('div.timer-big', { 'data-ends': st.round.endsAt || '' }),
  ]);
}

function liveScreen(st) {
  const mod = SabhaGames[st.game.id];
  const seg = st.round.segId;
  if (!P.gameEl || P.gameSeg !== seg || P.screenKey !== 'live') {
    P.screenKey = 'live';
    P.gameSeg = seg;
    P.gameEl = h('main.screen.game.game-' + st.game.id);
    app().replaceChildren(topStrip(), P.gameEl);
    renderConn();
    P.gameEl.dataset.fresh = '1';
  }
  renderPaused();
  if (!mod) { P.gameEl.replaceChildren(h('p.sub', { text: 'This game is missing on this phone. Reload the page.' })); return; }
  const fresh = P.gameEl.dataset.fresh === '1';
  delete P.gameEl.dataset.fresh;
  try { mod.render(P.gameEl, st.view || {}, { ...gameApi(), fresh }); } catch (e) { console.error(e); }
}

function betweenScreen(st) {
  const last = st.last;
  const t = st.me.team;
  if (last && !last.played && !last.practice) {
    // turn-based: the other team just played
    return screen('between', [h('p.kicker', { text: st.game.name }), h('h1', { text: `${TEAM_NAME[other(t)]} has played` }),
      st.next && (st.next.teams || []).includes(t) ? h('p.big', { text: `${TEAM_NAME[t]}, you're next!` }) : null,
      h('p.sub', { text: `${TEAM_NAME[t]} so far: ${st.teamTotal || 0}` }), h('p.big', { text: 'Waiting for host' })]);
  }
  return screen('between', [
    h('p.kicker', { text: st.game.name }),
    last && !last.practice ? h('p.sub', { text: `${TEAM_NAME[t]} so far` }) : null,
    last && !last.practice ? h('div.score', { text: String(st.teamTotal || 0) }) : h('h1', { text: 'Practice over' }),
    last && last.line ? h('p.line', { text: last.line }) : null,
    st.next ? h('p.sub', { text: 'Next: ' + roundName(st.next, st.game.rounds) }) : null,
    h('p.big', { text: 'Waiting for host' }),
  ]);
}

function champLine(total) { return `Red ${total.red} · Blue ${total.blue}`; }

function gameoverScreen(st) {
  const g = st.gameover;
  const r = g && g.result;
  const t = st.me.team;
  return screen('gameover', [
    h('p.kicker', { text: `${st.game.name} is over` }),
    r && r.winner ? h('h1', { text: r.winner === t ? `${TEAM_NAME[t]} won it!` : `${TEAM_NAME[r.winner]} won that one` }) : h('h1', { text: r ? 'A draw!' : 'Game over' }),
    h('p.sub', { text: 'Championship so far' }),
    h('div.champ', null, h('span.c-red', { text: `Red ${g.total.red}` }), h('span.dot', { text: '·' }), h('span.c-blue', { text: `Blue ${g.total.blue}` })),
    h('p.big', { text: 'Waiting for host' }),
  ]);
}

function dsiScreen(st) {
  const d = st.dsi;
  const t = d.turn;
  return screen('dsi', [
    h('p.kicker', { text: "Don't Say It" }),
    h('p.rule', { text: 'Describe the word without saying the word or the banned words. The other team is watching you.' }),
    h('div.champ', null, h('span.c-red', { text: `Red ${d.points.red}` }), h('span.dot', { text: '·' }), h('span.c-blue', { text: `Blue ${d.points.blue}` })),
    t && !t.over ? h('p.big', { text: `${TEAM_NAME[t.team]} is describing` }) : h('p.big', { text: 'Next turn coming up' }),
    t && !t.over ? h('div.timer-big', { 'data-ends': t.endsAt }) : null,
  ]);
}

function finalScreen(st) {
  const f = st.final;
  const t = st.me.team;
  const kids = [h('p.kicker', { text: 'The champion is' })];
  kids.push(h('div.team-word.champion' + (f.champion ? '.c-' + f.champion : ''), { text: f.champion ? TEAM_NAME[f.champion] : 'A tie!' }));
  if (f.champion === t) kids.push(h('p.big', { text: 'That\'s you!' }));
  kids.push(h('div.champ', null, h('span.c-red', { text: `Red ${f.total.red}` }), h('span.dot', { text: '·' }), h('span.c-blue', { text: `Blue ${f.total.blue}` })));
  if (f.byTiebreak) kids.push(h('p.sub', { text: 'Level on points: decided by the faster Maths Chain time.' }));
  const list = h('ul.final-list');
  for (const g of f.games) list.append(h('li', null, h('b', { text: g.name }), ' ', g.winner ? `${TEAM_NAME[g.winner]} won` : 'a draw'));
  if (f.dsi) list.append(h('li', null, h('b', { text: "Don't Say It" }), ' ', f.dsi.winner ? `${TEAM_NAME[f.dsi.winner]} won (Red ${f.dsi.points.red}, Blue ${f.dsi.points.blue})` : 'a draw'));
  kids.push(list);
  const mine = f.mvps.filter(m => m.team === t);
  if (mine.length) {
    kids.push(h('p.kicker', { text: `${TEAM_NAME[t]} stars` }));
    kids.push(h('ul.final-list', null, mine.map(m => h('li', null, h('b', { text: m.label }), ` ${m.name} (${m.value})`))));
  }
  return screen('final', kids);
}

// ---------- every 200 ms: countdown numbers and timers ----------
let lastCount = null;
function tick() {
  const st = P.state;
  if (!st) return;
  const now = Net.now();
  if (st.phase === 'countdown' && st.round) {
    const left = Math.ceil((st.round.startsAt - now) / 1000);
    const el = document.querySelector('.count');
    const v = Math.max(1, left);
    if (el && el.textContent !== String(v)) { el.textContent = String(v); }
    if (left !== lastCount && left > 0 && left <= 3) Sound.tick();
    lastCount = left;
  }
  for (const el of document.querySelectorAll('[data-ends]')) {
    const ends = Number(el.dataset.ends);
    el.textContent = ends ? fmtClock(ends - now) : '';
  }
  if (st.phase === 'live' && st.playing && P.gameEl) {
    const mod = SabhaGames[st.game.id];
    if (mod && mod.tick) { try { mod.tick(P.gameEl, gameApi()); } catch (e) { console.error(e); } }
  }
}

document.addEventListener('DOMContentLoaded', boot);
