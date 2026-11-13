'use strict';
// Shout It Out: buttons, instructions, scoring, timers, the 2:00 twist, offline phones, tiny teams,
// turn-based mode, normalised results, and a soak test with perfect and random players.
const { setup, assert } = require('../harness');
const shout = require('../../server/games/shout');
const { rng } = require('../../server/rng');

let n = 0; const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAILED:', name); throw e; } };

// start Shout It Out and skip the practice round unless asked
function begin(opts = {}, { practice = false, mode } = {}) {
  const t = setup(opts);
  if (mode) t.host({ cmd: 'option', shoutMode: mode });
  t.startGame('shout');
  if (!practice) { t.startRound(); t.finishRound(); }
  t.startRound();
  return t;
}
const S = t => t.inst()._state;
const buttonsOf = (t, pid) => t.view(pid).buttons;
function holderOf(t, team, buttonId) { return S(t)[team].owner[buttonId]; }

function checkInvariants(t) {
  for (const team in S(t)) {
    const st = S(t)[team];
    const labels = new Set();
    for (const pid of st.ids) for (const b of st.buttons[pid]) {
      const l = shout.COLOURS[b.n.c].name + ' ' + shout.OBJECTS[b.n.o];
      assert.ok(!labels.has(l), 'button names unique in a team: ' + l);
      labels.add(l);
      assert.strictEqual(st.buttons[pid].length, 4);
    }
    const targets = new Set();
    for (const ip in st.instr) {
      const ins = st.instr[ip];
      assert.notStrictEqual(ins.holder, ip, 'never your own button');
      assert.ok(!targets.has(ins.button), 'no two instructions name the same button');
      targets.add(ins.button);
      assert.ok(t.room.players[ins.holder].online, 'targets are on online phones');
    }
  }
}

// what an instructor's instruction is, and who must press
function pending(t, pid) {
  const team = t.ctx().teamOf(pid);
  const ins = S(t)[team].instr[pid];
  return ins ? { ...ins, team } : null;
}

test('round list: practice + 2 rounds; turn-based splits each round by team', () => {
  assert.deepStrictEqual(shout.rounds({}).map(r => [r.n, !!r.practice, r.ms, r.teams]), [[0, true, 30000, undefined], [1, false, 180000, undefined], [2, false, 180000, undefined]]);
  const tb = shout.rounds({ mode: 'turn' });
  assert.deepStrictEqual(tb.map(r => [r.n, (r.teams || []).join()]), [[0, ''], [1, 'red'], [1, 'blue'], [2, 'red'], [2, 'blue']]);
});

test('every online player starts with one instruction; buttons unique; never own button', () => {
  const t = begin({ red: 15, blue: 15 });
  for (const pid of t.all()) {
    assert.strictEqual(buttonsOf(t, pid).length, 4);
    assert.ok(t.view(pid).instr, 'has an instruction');
    assert.ok(/^[A-Z]+ [A-Z]+$/.test(t.view(pid).instr.text));
  }
  // 60 different buttons per team
  const all = t.ids.red.flatMap(pid => buttonsOf(t, pid).map(b => b.label));
  assert.strictEqual(new Set(all).size, 60);
  checkInvariants(t);
});

test('both teams get the same button names (same seed)', () => {
  const t = begin({ red: 5, blue: 5 });
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(buttonsOf(t, t.ids.red[i]).map(b => b.label), buttonsOf(t, t.ids.blue[i]).map(b => b.label));
});

test('success: 10 + speed bonus, credited to shouter and holder; new instruction after 1 s', () => {
  const t = begin({ red: 4, blue: 4 });
  const me = t.ids.red[0];
  const ins = pending(t, me);
  t.advance(1000); // 1 s of 12 used → ceil(5 × 11/12) = 5
  t.clearFx();
  t.act(ins.holder, { type: 'press', button: ins.button });
  const e = t.room.events[t.room.events.length - 1];
  assert.strictEqual(e.type, 'instruction_done');
  assert.strictEqual(e.points, 15);
  assert.deepStrictEqual(e.playerIds, [me, ins.holder]);
  assert.ok(t.fx(me).some(f => f.data.kind === 'good'), 'instructor flashes green');
  assert.ok(t.fx(ins.holder).some(f => f.data.type === 'tileGood' && f.data.button === ins.button), 'holder tile flashes green');
  assert.strictEqual(t.view(me).instr, null);
  assert.strictEqual(t.view(t.ids.red[2]).hits, 1, 'team hits counter');
  t.advance(750);
  assert.strictEqual(t.view(me).instr, null, 'still waiting');
  t.advance(500);
  assert.ok(t.view(me).instr, 'new instruction after 1 s');
  // slow press: bonus 1
  const ins2 = pending(t, me);
  t.advance(11500);
  t.act(ins2.holder, { type: 'press', button: ins2.button });
  assert.strictEqual(t.room.events[t.room.events.length - 1].points, 11);
});

test('timeout: red flash, replaced, no points', () => {
  const t = begin({ red: 3, blue: 3 });
  const me = t.ids.blue[1];
  const ins = pending(t, me);
  t.clearFx();
  const before = t.room.events.length;
  t.advance(12000 + 600);
  assert.ok(t.fx(me).some(f => f.data.type === 'timeout'));
  assert.strictEqual(t.room.events.filter(e => e.type !== 'wrong_press').length, before);
  t.advance(1000);
  const ins2 = pending(t, me);
  assert.ok(ins2 && ins2.id !== ins.id, 'replaced');
});

test('wrong press costs 2; pressing someone else\'s button id is ignored', () => {
  const t = begin({ red: 3, blue: 3 });
  const p = t.ids.red[0];
  const asked = new Set(Object.values(S(t).red.instr).map(i => i.button));
  const free = buttonsOf(t, p).find(b => !asked.has(b.id));
  t.clearFx();
  t.act(p, { type: 'press', button: free.id });
  const e = t.room.events[t.room.events.length - 1];
  assert.strictEqual(e.type, 'wrong_press'); assert.strictEqual(e.points, -2); assert.deepStrictEqual(e.playerIds, [p]);
  assert.ok(t.fx(p).some(f => f.data.kind === 'bad'));
  const n0 = t.room.events.length;
  const otherBtn = buttonsOf(t, t.ids.red[1])[0];
  t.act(p, { type: 'press', button: otherBtn.id });
  assert.strictEqual(t.room.events.length, n0);
});

test('timer levels 12/9/7 s and the 2:00 rename', () => {
  const t = begin({ red: 4, blue: 4 });
  assert.strictEqual(pending(t, t.ids.red[0]).timer, 12000);
  assert.strictEqual(shout.timerFor(59999), 12000);
  assert.strictEqual(shout.timerFor(60000), 9000);
  assert.strictEqual(shout.timerFor(119999), 9000);
  assert.strictEqual(shout.timerFor(120000), 7000);
  t.advance(61000 + 13000); // anything issued after 1:00 is 9 s
  const timers = t.ids.red.map(pid => pending(t, pid)).filter(Boolean).map(i => i.timer);
  assert.ok(timers.every(x => x === 9000), 'timers after 1:13: ' + timers);
  const oldNames = buttonsOf(t, t.ids.red[0]).map(b => b.label);
  const oldIds = t.ids.red.map(pid => pending(t, pid)).map(i => i && i.id);
  t.clearFx();
  t.advance(120000 - 74000 + 250);
  assert.ok(t.view(t.ids.red[0]).renamedAt, 'renamed');
  const newNames = buttonsOf(t, t.ids.red[0]).map(b => b.label);
  assert.ok(newNames.every(l => !oldNames.includes(l)), 'all new names');
  assert.ok(t.fx(t.ids.red[0]).some(f => f.data.type === 'controls'));
  for (const pid of t.ids.red) { const i = pending(t, pid); assert.ok(i, 'reissued'); assert.strictEqual(i.timer, 7000); assert.ok(!oldIds.includes(i.id)); }
  assert.deepStrictEqual(buttonsOf(t, t.ids.blue[0]).map(b => b.label), newNames, 'blue renamed the same');
  checkInvariants(t);
});

test('practice round: 12 s timers, never renames, scores nothing', () => {
  const t = begin({ red: 3, blue: 3 }, { practice: true });
  assert.ok(t.ctx().practice);
  const ins = pending(t, t.ids.red[0]);
  t.act(ins.holder, { type: 'press', button: ins.button });
  t.finishRound();
  const r = t.lastResult();
  assert.ok(r.practice); assert.deepStrictEqual(r.score, { red: 0, blue: 0 });
  assert.ok(!t.room.stats[ins.holder], 'no MVP stats from practice');
});

test('holder offline: their buttons leave the pool, instructions naming them are swapped, no penalty', () => {
  const t = begin({ red: 5, blue: 5 });
  const gone = t.ids.red[2];
  const before = t.room.events.length;
  t.offline(gone);
  checkInvariants(t);
  for (const ip in S(t).red.instr) assert.notStrictEqual(S(t).red.instr[ip].holder, gone);
  assert.ok(!S(t).red.instr[gone], 'their own instruction cancelled');
  assert.strictEqual(t.room.events.slice(before).filter(e => e.points < 0).length, 0);
  // everyone else still has one (well inside the timer, nobody timed out here except by chance: just check presence after a beat)
  t.advance(2000);
  for (const pid of t.ids.red) if (pid !== gone) assert.ok(pending(t, pid) || S(t).red.nextAt[pid] > t.room.now(), 'online player has an instruction (or is between two)');
  t.online(gone);
  t.advance(300);
  assert.ok(pending(t, gone), 'back: new instruction');
  checkInvariants(t);
});

test('tiny teams: 1, 2 and 3 players never crash; 1 player waits', () => {
  for (const size of [1, 2, 3]) {
    const t = begin({ red: size, blue: 1 });
    t.advance(30000);
    assert.ok(t.view(t.ids.blue[0]).waiting, 'alone: waiting');
    assert.strictEqual(t.view(t.ids.blue[0]).instr, null);
    if (size >= 2) assert.ok(t.ids.red.every(pid => pending(t, pid) || t.view(pid).instr === null));
    checkInvariants(t);
    t.finishRound();
    assert.strictEqual(t.room.phase === 'results' || t.room.phase === 'gameover', true);
  }
  const t2 = begin({ red: 2, blue: 2 });
  t2.offline(t2.ids.red[1]);
  assert.ok(t2.view(t2.ids.red[0]).waiting, 'partner offline: waiting');
  t2.online(t2.ids.red[1]);
  t2.advance(300);
  assert.ok(pending(t2, t2.ids.red[0]), 'partner back: instruction again');
});

test('turn-based: Red then Blue, same seed and names; the other team watches', () => {
  const t = begin({ red: 4, blue: 4 }, { mode: 'turn' });
  assert.deepStrictEqual(t.room.current.seg.teams, ['red']);
  const redNames = buttonsOf(t, t.ids.red[0]).map(b => b.label);
  const st = t.state(t.ids.blue[0]);
  assert.strictEqual(st.playing, false); assert.strictEqual(st.watching, 'red');
  assert.strictEqual(st.view, undefined);
  const seed1 = t.room.current.seg.seed;
  t.finishRound();
  t.startRound();
  assert.deepStrictEqual(t.room.current.seg.teams, ['blue']);
  assert.strictEqual(t.room.current.seg.seed, seed1);
  assert.deepStrictEqual(buttonsOf(t, t.ids.blue[0]).map(b => b.label), redNames);
  t.finishRound();
  const segs = t.room.segments.filter(s => !s.practice);
  assert.deepStrictEqual(segs.map(s => s.segId), ['shout-1-red', 'shout-1-blue']);
});

test('normalised result: raw × 10 ÷ team size; lines and stats', () => {
  const t = begin({ red: 6, blue: 4 });
  for (let k = 0; k < 3; k++) for (const team of ['red', 'blue']) {
    const ins = pending(t, t.ids[team][0]);
    t.act(ins.holder, { type: 'press', button: ins.button });
    t.advance(1100);
  }
  t.finishRound();
  const r = t.lastResult();
  assert.strictEqual(r.score.red, Math.round(r.raw.red * 10 / 6));
  assert.strictEqual(r.score.blue, Math.round(r.raw.blue * 10 / 4));
  assert.ok(/^Red hit \d+ instructions?$/.test(r.lines.red));
  assert.ok(r.stats.red.hits >= 3);
  const holderStats = Object.values(t.room.stats).map(s => s.shout && s.shout.pressed).filter(Boolean);
  assert.ok(holderStats.reduce((a, b) => a + b, 0) >= 6, 'pressed tracked for MVPs');
});

test('soak: full round with perfect and random players, invariants hold, scores add up', () => {
  const t = begin({ red: 15, blue: 12 });
  const r = rng('soak');
  let checks = 0;
  for (let step = 0; step < 180000 / 250 && t.room.phase === 'live'; step++) {
    // perfect players on red press what's asked after a human-ish delay; blue mostly random
    for (const team of ['red', 'blue']) {
      for (const ip in S(t)[team].instr) {
        const ins = S(t)[team].instr[ip];
        const age = t.room.now() - ins.issuedAt;
        if (team === 'red' && age > 1500 + r.int(0, 2500)) t.act(ins.holder, { type: 'press', button: ins.button });
      }
    }
    for (const pid of t.ids.blue) { const v = t.view(pid); const a = shout.bot(v, r); if (a) t.act(pid, a); }
    if (step % 97 === 0) { const p = r.pick(t.ids.red); t.silent.add(p); }
    if (step % 97 === 60) { for (const p of [...t.silent]) t.online(p); }
    if (step % 10 === 0) { checkInvariants(t); checks++; }
    t.advance(250);
  }
  for (const p of [...t.silent]) t.online(p);
  t.finishRound();
  const res = t.lastResult();
  const sum = team => t.room.events.filter(e => e.segId === res.segId && e.team === team).reduce((s, e) => s + e.points, 0);
  assert.strictEqual(res.raw.red, sum('red'));
  assert.strictEqual(res.raw.blue, sum('blue'));
  assert.ok(res.stats.red.hits > 50, 'perfect red hits a lot: ' + res.stats.red.hits);
  assert.ok(res.stats.blue.wrong > 0);
  assert.ok(checks > 50);
  // round 2 then the game is over
  t.startRound(); t.finishRound();
  assert.strictEqual(t.room.phase, 'gameover');
});

console.log(`shout: ${n} tests passed`);
