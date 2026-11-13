'use strict';
// Maths Chain: generator rules, equal chains, L and checkers, seat rotation, wrong/lock/hint, offline
// pass-on, skip seat, scoring (first / second / unfinished) and the early end.
const { setup, assert } = require('../harness');
const maths = require('../../server/games/maths');
const { rng } = require('../../server/rng');

let n = 0; const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAILED:', name); throw e; } };

const dbg = t => t.inst()._debug;
const cur = (t, team) => { const T = dbg(t).T[team]; return T.owner[T.pos]; };
const expectedFor = (t, team) => {
  const T = dbg(t).T[team];
  let e = T.pos; while (e + 1 < dbg(t).L && T.owner[e + 1] === T.owner[T.pos]) e++;
  return dbg(t).chain.values[e + 1];
};
const solveStep = (t, team) => { const p = cur(t, team); t.act(p, { type: 'answer', value: String(expectedFor(t, team)) }); return p; };

test('generator: whole numbers in range, only allowed steps, per round', () => {
  const allowed = {
    1: s => (['+', '-'].includes(s.op) && s.n >= 1 && s.n <= 12) || (s.op === '*' && s.n >= 2 && s.n <= 6) || (s.op === '/' && [2, 5].includes(s.n)),
    2: s => (['+', '-'].includes(s.op) && s.n >= 1 && s.n <= 25) || (s.op === '*' && s.n >= 2 && s.n <= 9) || (s.op === '/' && s.n >= 2 && s.n <= 10) || ['double', 'half'].includes(s.op),
    3: s => allowed[2](s) || ['digits', 'square'].includes(s.op),
  };
  const caps = { 1: 100, 2: 200, 3: 200 };
  const starts = { 1: [2, 10], 2: [10, 30], 3: [20, 50] };
  const seen = new Set();
  for (let seed = 0; seed < 400; seed++) {
    for (const round of [1, 2, 3]) {
      const c = maths.generateChain(rng('s' + seed, 'chain'), round, 12);
      assert.ok(c.start >= starts[round][0] && c.start <= starts[round][1]);
      assert.strictEqual(c.steps.length, 12);
      let v = c.start;
      c.steps.forEach((s, i) => {
        assert.ok(allowed[round](s), `round ${round} step not allowed: ${JSON.stringify(s)}`);
        v = maths.applyStep(v, s);
        assert.ok(Number.isInteger(v) && v >= 1 && v <= caps[round], `bad value ${v}`);
        assert.strictEqual(c.values[i + 1], v);
        assert.deepStrictEqual(maths.parseStep(s.text).op, s.op);
        seen.add(round + s.op);
      });
    }
  }
  for (const k of ['1+', '1-', '1*', '1/', '2double', '2half', '3digits', '3square']) assert.ok(seen.has(k), 'never generated ' + k);
  // same seed → same chain
  assert.deepStrictEqual(maths.generateChain(rng('x', 'chain'), 2, 8), maths.generateChain(rng('x', 'chain'), 2, 8));
});

test('L = smaller online team, extras are checkers, both teams same chain', () => {
  const t = setup({ red: 5, blue: 3 });
  t.startGame('maths'); t.startRound();
  const d = dbg(t);
  assert.strictEqual(d.L, 3);
  assert.strictEqual(d.T.red.players.length, 3);
  assert.strictEqual(d.T.red.checkers.length, 2);
  assert.strictEqual(d.T.blue.checkers.length, 0);
  const checker = d.T.red.checkers[0];
  assert.strictEqual(t.view(checker).status, 'checker');
  const first = d.T.red.players[0];
  const v = t.view(first);
  assert.strictEqual(v.status, 'turn');
  assert.strictEqual(v.start, d.chain.start);
  assert.strictEqual(t.view(d.T.blue.players[0]).start, d.chain.start);
  assert.strictEqual(t.view(d.T.red.players[1]).status, 'waiting');
  assert.strictEqual(t.view(d.T.red.players[1]).listen.name, t.room.players[first].name);
  // the second player does not see the incoming number
  solveStep(t, 'red');
  const v2 = t.view(d.T.red.players[1]);
  assert.strictEqual(v2.status, 'turn');
  assert.strictEqual(v2.start, null);
  assert.strictEqual(v2.incoming, null);
  assert.strictEqual(t.view(first).status, 'done');
  assert.strictEqual(t.view(first).answer, d.chain.values[1]);
  assert.strictEqual(t.view(checker).sofar.length, 1);
});

test('L is capped at 12 and seats rotate per round (checkers rotate)', () => {
  const t = setup({ red: 14, blue: 13 });
  t.startGame('maths'); t.startRound();
  assert.strictEqual(dbg(t).L, 12);
  const seatOf = id => t.room.players[id].seat;
  assert.strictEqual(seatOf(dbg(t).T.red.players[0]), 1);
  const checkers1 = dbg(t).T.red.checkers.map(seatOf);
  t.finishRound();
  t.host({ cmd: 'start' }); t.advance(3000);
  assert.strictEqual(seatOf(dbg(t).T.red.players[0]), 4);
  const checkers2 = dbg(t).T.red.checkers.map(seatOf);
  t.finishRound();
  t.host({ cmd: 'start' }); t.advance(3000);
  assert.strictEqual(seatOf(dbg(t).T.red.players[0]), 8);
  const checkers3 = dbg(t).T.red.checkers.map(seatOf);
  assert.deepStrictEqual(checkers1, [13, 14]);
  assert.deepStrictEqual(checkers2, [2, 3]);
  assert.deepStrictEqual(checkers3, [6, 7]);
});

test('wrong answer locks 3 s; hint after 3 wrong adds 10 s and shows the number', () => {
  const t = setup({ red: 3, blue: 3 });
  t.startGame('maths'); t.startRound();
  solveStep(t, 'red');
  const p = cur(t, 'red');
  const right = expectedFor(t, 'red');
  t.act(p, { type: 'answer', value: right + 1 });
  assert.strictEqual(t.view(p).wrong, 1);
  assert.ok(t.view(p).lockUntil > 0);
  t.act(p, { type: 'answer', value: right }); // locked: ignored
  assert.strictEqual(cur(t, 'red'), p);
  assert.ok(t.fx(p).some(f => f.data.kind === 'bad'));
  t.advance(3100);
  t.act(p, { type: 'answer', value: right + 2 }); t.advance(3100);
  assert.strictEqual(t.view(p).hintAvailable, false);
  t.act(p, { type: 'hint' });
  assert.strictEqual(t.view(p).incoming, null);
  t.act(p, { type: 'answer', value: right + 3 }); t.advance(3100);
  assert.strictEqual(t.view(p).hintAvailable, true);
  t.act(p, { type: 'hint' });
  assert.strictEqual(t.view(p).incoming, dbg(t).chain.values[1]);
  assert.strictEqual(dbg(t).T.red.penalty, 10000);
  t.act(p, { type: 'answer', value: right });
  assert.notStrictEqual(cur(t, 'red'), p);
  assert.ok(t.room.events.some(e => e.type === 'hint_used'));
});

test('offline current player: step passes to the next seat after 15 s', () => {
  const t = setup({ red: 4, blue: 4 });
  t.startGame('maths'); t.startRound();
  const [a, b, c] = dbg(t).T.red.players;
  solveStep(t, 'red'); // a done; b's turn
  t.offline(b); // 10.5 s to be marked offline
  assert.strictEqual(cur(t, 'red'), b);
  t.advance(15000);
  assert.strictEqual(cur(t, 'red'), c);
  const v = t.view(c);
  assert.strictEqual(v.status, 'turn');
  assert.strictEqual(v.steps.length, 2);
  assert.strictEqual(v.steps[0].from, t.room.players[b].name);
  t.act(c, { type: 'answer', value: dbg(t).chain.values[2] }); // only b's step: wrong
  assert.strictEqual(cur(t, 'red'), c);
  t.advance(3100);
  t.act(c, { type: 'answer', value: dbg(t).chain.values[3] });
  assert.strictEqual(dbg(t).T.red.pos, 3);
});

test('host skip seat passes at once; last step wraps to the first player', () => {
  const t = setup({ red: 3, blue: 3 });
  t.startGame('maths'); t.startRound();
  const [a, b, c] = dbg(t).T.blue.players;
  solveStep(t, 'blue'); solveStep(t, 'blue');
  assert.strictEqual(cur(t, 'blue'), c);
  const hv = t.inst().hostView();
  assert.ok(hv.buttons.some(x => x.cmd.skip === 'blue'));
  t.host({ cmd: 'gameCmd', data: { skip: 'blue' } });
  assert.strictEqual(cur(t, 'blue'), a);
  solveStep(t, 'blue');
  assert.ok(dbg(t).T.blue.doneAt != null);
});

test('scoring: first 100, second by time (at least 40), early end when both finish', () => {
  const t = setup({ red: 3, blue: 3 });
  t.startGame('maths'); t.startRound();
  for (let i = 0; i < 3; i++) { t.advance(10000); solveStep(t, 'red'); }
  assert.strictEqual(t.view(dbg(t).T.blue.players[0]).otherDone.team, 'red');
  for (let i = 0; i < 3; i++) { t.advance(20000); solveStep(t, 'blue'); }
  t.advance(500);
  assert.strictEqual(t.room.phase, 'time');
  const r = t.lastResult();
  assert.strictEqual(r.raw.red, 100);
  const redT = r.tiebreak.red, blueT = r.tiebreak.blue;
  assert.strictEqual(r.raw.blue, Math.max(40, Math.round(100 * redT / blueT)));
  assert.strictEqual(r.score.red, 100); // no size normalisation
  assert.ok(/finished first/.test(r.lines.red));
  assert.ok(t.room.stats[dbg_first(t, r)]);
});
function dbg_first(t) { return Object.keys(t.room.stats).find(pid => t.room.stats[pid].maths && t.room.stats[pid].maths.fastestStep > 0); }

test('second place is never below 40; hints count in the time', () => {
  const t = setup({ red: 2, blue: 2 });
  t.startGame('maths'); t.startRound();
  solveStep(t, 'red'); solveStep(t, 'red');
  t.advance(200000);
  solveStep(t, 'blue'); solveStep(t, 'blue');
  t.advance(500);
  const r = t.lastResult();
  assert.strictEqual(r.raw.blue, 40);
});

test('unfinished by the cap: 30 × steps ÷ L', () => {
  const t = setup({ red: 4, blue: 4 });
  t.startGame('maths'); t.startRound();
  solveStep(t, 'red'); solveStep(t, 'red'); solveStep(t, 'red');
  solveStep(t, 'blue');
  t.finishRound();
  const r = t.lastResult();
  assert.strictEqual(r.raw.red, Math.round(30 * 3 / 4));
  assert.strictEqual(r.raw.blue, Math.round(30 * 1 / 4));
  assert.strictEqual(r.tiebreak.red, 240000);
  assert.strictEqual(r.endedBy, 'time');
});

test('tie in time: the team that finished first (server order) wins', () => {
  const t = setup({ red: 1, blue: 1 });
  t.startGame('maths'); t.startRound();
  const L = dbg(t).L;
  assert.strictEqual(L, 1);
  // both answer in the same game-clock ms
  const red = cur(t, 'red'), blue = cur(t, 'blue');
  t.room.action(blue, { actionId: 'x1', type: 'answer', value: expectedFor(t, 'blue') });
  t.room.action(red, { actionId: 'x2', type: 'answer', value: expectedFor(t, 'red') });
  t.advance(500);
  const r = t.lastResult();
  assert.strictEqual(r.raw.blue, 100);
  assert.strictEqual(r.raw.red, 99);
});

test('fastestStep MVP stat and bot actions', () => {
  const t = setup({ red: 3, blue: 3 });
  t.startGame('maths'); t.startRound();
  t.advance(2000); const p = solveStep(t, 'red');
  t.finishRound();
  assert.strictEqual(t.room.stats[p].maths.fastestStep, 2001);
  // bot: knows the start number, so it can answer; without it, guesses or hints
  t.host({ cmd: 'start' }); t.advance(3000);
  const r = rng('bot');
  let ok = 0;
  for (let i = 0; i < 40; i++) {
    const v = t.view(cur(t, 'red'));
    const a = maths.bot(v, r);
    assert.ok(a && ['answer', 'hint'].includes(a.type));
    if (a.type === 'answer' && v.start != null && Number(a.value) === expectedFor(t, 'red')) ok++;
  }
  assert.ok(ok > 20);
  assert.strictEqual(maths.bot({ status: 'waiting' }, r), null);
});

test('a team with nobody online does not break the round', () => {
  const t = setup({ red: 3, blue: 2 });
  for (const b of t.ids.blue) t.offline(b);
  t.startGame('maths'); t.startRound();
  assert.strictEqual(dbg(t).L, 3);
  for (let i = 0; i < 3; i++) solveStep(t, 'red');
  t.advance(500);
  assert.strictEqual(t.room.phase, 'time');
  const r = t.lastResult();
  assert.strictEqual(r.raw.red, 100);
  assert.strictEqual(r.raw.blue, 0);
});

console.log(`maths: ${n} tests passed`);
