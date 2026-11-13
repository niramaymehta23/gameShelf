'use strict';
// Core: join, teams, lock, seats, round flow, timing, pause, offline, spam guard, scoring, persistence.
const { setup, assert } = require('../harness');
const { Room } = require('../../server/room');
const scoring = require('../../server/scoring');

let n = 0; const test = (name, fn) => { fn(); n++; };

test('names are deduped and capped at 12', () => {
  const t = setup({ red: 0, blue: 0, lock: false });
  const a = t.room.join('Ravi').player, b = t.room.join('ravi').player, c = t.room.join('Abcdefghijklmnop').player;
  assert.strictEqual(a.name, 'Ravi'); assert.strictEqual(b.name, 'ravi 2'); assert.strictEqual(c.name, 'Abcdefghijkl');
  assert.strictEqual(t.room.join('Abcdefghijklmn').player.name, 'Abcdefghij 2');
});

test('lock gives seats and blocks switching; late joiners queue', () => {
  const t = setup({ red: 3, blue: 2 });
  assert.strictEqual(t.room.phase, 'ready');
  assert.deepStrictEqual(t.ids.red.map(id => t.room.players[id].seat), [1, 2, 3]);
  assert.ok(t.room.pickTeam(t.ids.red[0], 'blue').error);
  const late = t.room.join('Late').player;
  assert.ok(late.waiting);
  t.host({ cmd: 'assign', pid: late.id, team: 'blue' });
  assert.strictEqual(t.room.players[late.id].seat, 3);
  assert.ok(t.events.some(e => e.type === 'host_move'));
});

test('same name after lock asks the host; yes hands the identity over', () => {
  const t = setup({ red: 2, blue: 2 });
  const target = t.room.players[t.ids.red[0]];
  const r = t.room.join(target.name, 'req1');
  assert.ok(r.pending);
  const oldTok = target.token;
  t.host({ cmd: 'handover', id: 'req1', yes: true });
  assert.notStrictEqual(target.token, oldTok);
  assert.deepStrictEqual(t.log.kicks, [target.id]);
  assert.strictEqual(t.log.req[0].data.playerId, target.id);
  t.room.join(target.name, 'req2'); t.host({ cmd: 'handover', id: 'req2', yes: false });
  assert.notStrictEqual(t.log.req[1].data.playerId, target.id);
});

test('a demo round runs, ends on time with grace, and scores from events', () => {
  const t = setup({ red: 4, blue: 2 });
  t.startGame('demo');
  assert.strictEqual(t.room.phase, 'intro');
  t.host({ cmd: 'start' });
  assert.strictEqual(t.room.phase, 'countdown');
  t.act(t.ids.red[0], { type: 'tap' }); // before live: ignored
  t.advance(3000);
  assert.strictEqual(t.room.phase, 'live');
  const st = t.state(t.ids.red[0]);
  assert.strictEqual(st.round.endsAt - st.round.startsAt, 30000);
  for (let i = 0; i < 4; i++) t.act(t.ids.red[0], { type: 'tap' });
  t.act(t.ids.blue[0], { type: 'tap' });
  assert.strictEqual(t.view(t.ids.red[1]).team, 4);
  t.advance(30000 - 10);
  assert.strictEqual(t.room.phase, 'live');
  t.act(t.ids.blue[0], { type: 'tap' }); // inside the 300 ms grace
  t.advance(400);
  assert.strictEqual(t.room.phase, 'time');
  t.act(t.ids.blue[0], { type: 'tap' }); // too late
  const res = t.lastResult();
  assert.deepStrictEqual(res.raw, { red: 4, blue: 2 });
  assert.deepStrictEqual(res.score, { red: 10, blue: 10 }); // ×10 ÷ team size
  t.advance(3000);
  assert.strictEqual(t.room.phase, 'gameover');
});

test('spam guard: at most 5 actions a second; duplicate actionIds count once', () => {
  const t = setup({ red: 2, blue: 2 });
  t.startGame('demo'); t.startRound();
  const p = t.ids.red[0];
  for (let i = 0; i < 9; i++) t.act(p, { type: 'tap' });
  assert.strictEqual(t.view(p).mine, 5);
  t.advance(1000);
  t.room.action(p, { actionId: 'same', type: 'tap' }); t.room.action(p, { actionId: 'same', type: 'tap' });
  assert.strictEqual(t.view(p).mine, 6);
});

test('pause freezes the round clock and rejects taps', () => {
  const t = setup({ red: 2, blue: 2 });
  t.startGame('demo'); t.startRound();
  const endsAt = t.room.current.seg.endsAt;
  t.advance(5000);
  t.host({ cmd: 'pause' });
  const g = t.room.now();
  t.advance(60000);
  assert.strictEqual(t.room.now(), g);
  t.act(t.ids.red[0], { type: 'tap' });
  assert.strictEqual(t.view(t.ids.red[0]).mine, 0);
  t.host({ cmd: 'resume' });
  t.advance(24000);
  assert.strictEqual(t.room.phase, 'live');
  assert.ok(t.room.now() < endsAt);
  t.advance(2000);
  assert.strictEqual(t.room.phase, 'time');
});

test('offline after 10 s without heartbeat, back on heartbeat', () => {
  const t = setup({ red: 2, blue: 2 });
  const p = t.ids.red[0];
  t.offline(p);
  assert.strictEqual(t.room.players[p].online, false);
  t.online(p);
  assert.strictEqual(t.room.players[p].online, true);
});

test('championship: winner 100, other proportional; adjustments; final + MVPs', () => {
  assert.deepStrictEqual(scoring.toChampionship({ red: 590, blue: 640 }), { red: 92, blue: 100 });
  assert.deepStrictEqual(scoring.toChampionship({ red: 0, blue: 0 }), { red: 0, blue: 0 });
  assert.deepStrictEqual(scoring.toChampionship({ red: -5, blue: 10 }), { red: 0, blue: 100 });
  const t = setup({ red: 2, blue: 2 });
  t.host({ cmd: 'adjust', team: 'red', points: 5, reason: 'test' });
  assert.ok(t.hostTry({ cmd: 'adjust', team: 'red', points: 5, reason: '' }).error);
  const ch = scoring.championship(t.room);
  assert.strictEqual(ch.total.red, 5);
  t.host({ cmd: 'final' });
  assert.strictEqual(t.room.phase, 'final');
  assert.strictEqual(t.state(t.ids.blue[0]).final.champion, 'red');
});

test('persistence drops a running round and restores the rest', () => {
  const t = setup({ red: 2, blue: 2 });
  t.startGame('demo'); t.startRound();
  t.act(t.ids.red[0], { type: 'tap' });
  const json = JSON.parse(JSON.stringify(t.room.toJSON()));
  assert.strictEqual(json.phase, 'intro');
  assert.strictEqual(json.events.filter(e => e.type === 'tap').length, 0);
  const r2 = Room.fromJSON(json, {});
  assert.strictEqual(r2.phase, 'intro');
  assert.strictEqual(Object.keys(r2.players).length, 4);
  assert.strictEqual(r2.current.game, 'demo');
  t.finishRound();
  const r3 = Room.fromJSON(JSON.parse(JSON.stringify(t.room.toJSON())), {});
  assert.strictEqual(r3.segments.length, 1);
  assert.strictEqual(r3.phase, 'gameover');
});

test('DSI counter logs events outside the championship', () => {
  const t = setup({ red: 2, blue: 2 });
  t.host({ cmd: 'dsi' });
  t.host({ cmd: 'dsiStart' });
  t.host({ cmd: 'dsiPoint', team: 'red', delta: 1 });
  t.host({ cmd: 'dsiPoint', team: 'blue', delta: -1 });
  assert.deepStrictEqual(t.room.dsiState().points, { red: 1, blue: -1 });
  t.advance(61000);
  assert.ok(t.room.dsi.turn.over);
  assert.strictEqual(scoring.championship(t.room).total.red, 0);
});

test('replaying a round removes its MVP stats and gives it a new seed', () => {
  const t = setup({ red: 2, blue: 2 });
  t.startGame('demo'); t.startRound();
  const seed = t.room.current.seg.seed;
  for (let i = 0; i < 3; i++) t.act(t.ids.red[0], { type: 'tap' });
  t.finishRound();
  assert.strictEqual(t.room.stats[t.ids.red[0]].demo.taps, 3);
  t.host({ cmd: 'replayRound' });
  assert.ok(!t.room.stats[t.ids.red[0]]);
  t.startRound();
  assert.notStrictEqual(t.room.current.seg.seed, seed);
  t.act(t.ids.red[0], { type: 'tap' });
  t.finishRound();
  assert.strictEqual(t.room.stats[t.ids.red[0]].demo.taps, 1);
});

test('undo in Don\'t Say It never undoes an undo', () => {
  const t = setup({ red: 1, blue: 1 });
  t.host({ cmd: 'dsi' });
  t.host({ cmd: 'dsiPoint', team: 'red', delta: 1 }); t.host({ cmd: 'dsiPoint', team: 'red', delta: 1 });
  t.host({ cmd: 'dsiUndo' }); t.host({ cmd: 'dsiUndo' }); t.host({ cmd: 'dsiUndo' });
  assert.strictEqual(t.room.dsiState().points.red, 0);
});

test('a player moved mid-round keeps the round\'s team and seat until it ends; host events survive a game replay', () => {
  const t = setup({ red: 3, blue: 3 });
  t.startGame('demo'); t.startRound();
  const p = t.ids.red[0];
  t.host({ cmd: 'move', pid: p, team: 'blue' });
  assert.strictEqual(t.state(p).me.team, 'red');
  assert.strictEqual(t.state(p).me.seat, 1);
  t.finishRound();
  assert.strictEqual(t.state(p).me.team, 'blue');
  t.host({ cmd: 'toReady' }); t.host({ cmd: 'game', game: 'demo' });
  assert.ok(t.events.some(e => e.type === 'host_move'));
});

test('handover: two requests both wait; a phone that blinked can collect its answer; cancel', () => {
  const t = setup({ red: 2, blue: 1 });
  const target = t.room.players[t.ids.red[0]];
  t.room.join(target.name, 'q1'); t.room.join(target.name, 'q2'); t.room.join(target.name, 'q3');
  assert.strictEqual(t.room.handovers.length, 3);
  assert.ok(t.room.pendingStatus('q1').pending);
  t.room.cancelHandover('q3');
  assert.ok(t.room.pendingStatus('q3').error);
  t.host({ cmd: 'handover', id: 'q1', yes: true });
  assert.strictEqual(t.room.pendingStatus('q1').creds.playerId, target.id);
  assert.strictEqual(t.room.pendingStatus('q1').creds.token, target.token);
  t.host({ cmd: 'handover', id: 'q2', yes: false });
  assert.notStrictEqual(t.room.pendingStatus('q2').creds.playerId, target.id);
  const r2 = require('../../server/room').Room.fromJSON(JSON.parse(JSON.stringify(t.room.toJSON())), {});
  assert.strictEqual(r2.pendingStatus('q1').creds.playerId, target.id);
});

console.log(`core: ${n} tests passed`);
