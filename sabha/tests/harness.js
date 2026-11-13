'use strict';
// Drive a real Room with a fake clock and a recording transport: no sockets, no timers, fully
// deterministic. Game unit tests use this; see tests/unit/core.test.js for an example.
//
//   const H = require('../harness');
//   const t = H.setup({ red: 5, blue: 5 });          // players joined, teams picked, locked
//   t.startGame('maths');                              // host picks the game (phase intro)
//   t.startRound();                                    // countdown, then live (clock advanced 3 s)
//   t.view(pid)                                        // that player's last pushed view (state.view)
//   t.act(pid, { type: 'answer', value: 21 })          // a tap from a phone (actionId added)
//   t.advance(5000)                                    // move the clock on, ticking every 250 ms
//   t.offline(pid) / t.online(pid)
//   t.finishRound()                                    // run the clock to the end of the round
//   t.events / t.room.segments / t.lastResult()

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Room, registerGame, GAMES } = require('../server/room');

for (const f of fs.readdirSync(path.join(__dirname, '..', 'server', 'games'))) {
  if (f.endsWith('.js')) { const m = require(path.join(__dirname, '..', 'server', 'games', f)); if (m && m.id && !GAMES[m.id]) registerGame(m); }
}

function setup({ red = 4, blue = 4, lock = true, seed } = {}) {
  let now = 1_700_000_000_000;
  const log = { player: {}, fx: {}, host: [], all: [], kicks: [], req: [] };
  const t = {};
  const transport = {
    player: (pid, ev, data) => {
      if (ev === 'state') log.player[pid] = data;
      else (log.fx[pid] = log.fx[pid] || []).push({ ev, data, at: now });
    },
    team: (team, ev, data) => {
      for (const p of Object.values(room.players)) if (p.team === team) (log.fx[p.id] = log.fx[p.id] || []).push({ ev, data, at: now, team: true });
    },
    all: (ev, data) => { log.all.push({ ev, data }); for (const id in room.players) (log.fx[id] = log.fx[id] || []).push({ ev, data, at: now, all: true }); },
    host: (ev, data) => { log.host.push(data); },
    kick: pid => log.kicks.push(pid),
    req: (id, ev, data) => log.req.push({ id, ev, data }),
  };
  const room = new Room('TEST', { clock: () => now, transport });
  const ids = { red: [], blue: [] };
  let n = 0;
  for (const team of ['red', 'blue']) {
    for (let i = 0; i < (team === 'red' ? red : blue); i++) {
      const r = room.join(`${team === 'red' ? 'R' : 'B'}${++n}`);
      room.pickTeam(r.player.id, team);
      ids[team].push(r.player.id);
    }
  }
  if (lock) room.hostCmd({ cmd: 'lock' });
  let aid = 0;
  Object.assign(t, {
    room, ids, log, all: () => [...ids.red, ...ids.blue],
    host: c => { const r = room.hostCmd(c); if (r && r.error) throw new Error('host refused: ' + r.error); return r; },
    hostTry: c => room.hostCmd(c),
    // move the clock forward, ticking like the server does (every 250 ms); heartbeats keep online players online
    advance(ms, { heartbeats = true } = {}) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 250);
        if (heartbeats) for (const p of Object.values(room.players)) if (p.online && !t.silent.has(p.id)) p.lastSeen = now;
        room.tick();
      }
    },
    silent: new Set(),
    offline(pid) { t.silent.add(pid); t.advance(10500); },
    online(pid) { t.silent.delete(pid); room.heartbeat(pid); },
    state: pid => log.player[pid],
    view: pid => (log.player[pid] || {}).view,
    fx: pid => log.fx[pid] || [],
    clearFx() { for (const k in log.fx) log.fx[k] = []; },
    act(pid, a) { now += 1; room.action(pid, { actionId: 'a' + (++aid), ...a }); },
    startGame(game, opts) { t.host({ cmd: 'game', game, opts }); },
    startRound() { t.host({ cmd: 'start' }); t.advance(3000); assert.strictEqual(room.phase, 'live', 'round should be live after the countdown'); },
    finishRound() {
      for (let i = 0; i < 2000 && ['live', 'countdown'].includes(room.phase); i++) t.advance(1000);
      t.advance(3000); // through "Time!"
    },
    lastResult: () => room.segments[room.segments.length - 1],
    inst: () => room.current && room.current.seg && room.current.seg.inst,
    ctx: () => room.current && room.current.seg && room.current.seg.ctx,
  });
  // live getters (Object.assign would have read them once)
  Object.defineProperty(t, 'now', { get: () => now });
  Object.defineProperty(t, 'events', { get: () => room.events });
  return t;
}

module.exports = { setup, assert };
