import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto's Connect Four: c4BotMove(m, seat, level, rng) on built match documents.
const R = load(['rps.js', 'connect4.js'], ['c4State', 'c4BotMove', 'c4Line']);
const RPS = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'rock', guest: 'scissors' } }; // host starts (red)
const doc = (cols) => ({ rps: RPS, moves: Object.fromEntries(cols.map((c, i) => ['m' + String(i).padStart(3, '0'), c])) });
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// not Otto's turn: no move
assert.equal(R.c4BotMove(doc([]), 'guest', 'hard'), null);

// Hard takes a win: guest has three in column 6 (host plays 0,1,0,1 elsewhere), guest to move
let m = doc([0, 6, 1, 6, 0, 6, 1]);
assert.equal(R.c4State(m).turn, 'guest');
assert.equal(R.c4BotMove(m, 'guest', 'hard', rng(1)), 6);
// Hard blocks: host threatens three along the bottom (0,1,2), guest to move
m = doc([0, 6, 1, 6, 2]);
assert.equal(R.c4BotMove(m, 'guest', 'hard', rng(2)), 3);
// Hard avoids a move that lets the other side win straight on top of it (and sees a double threat coming)
m = doc([3, 3, 2, 2]); // host to move: 2,3 at the bottom; host plays 1 or 4 for an open three
const hm = R.c4BotMove(m, 'host', 'hard', rng(3));
assert.ok([1, 4].includes(hm), 'hard builds the open three, got ' + hm);

// Easy: always a legal column, wins most of the time it can, sometimes misses
let wins = 0;
for (let s = 0; s < 200; s++) {
  const c = R.c4BotMove(doc([0, 6, 1, 6, 0, 6, 1]), 'guest', 'easy', rng(100 + s));
  assert.ok(c >= 0 && c < 7);
  if (c === 6) wins++;
}
assert.ok(wins > 150 && wins < 200, 'easy takes most wins, not all: ' + wins);

// a full column is never chosen, at either level
const fullCol = doc([3, 3, 3, 3, 3, 3]);
for (let s = 0; s < 50; s++) for (const lv of ['easy', 'hard']) assert.notEqual(R.c4BotMove(fullCol, 'host', lv, rng(s)), 3);

// Hard beats Easy over a few games, and every game is legal to the end
let hardWins = 0, easyWins = 0;
for (let g = 0; g < 10; g++) {
  const r = rng(900 + g), cols = [];
  const hardSeat = g % 2 ? 'host' : 'guest';
  for (;;) {
    const st = R.c4State(doc(cols));
    if (st.winner || st.draw) { if (st.winner === hardSeat) hardWins++; else if (st.winner) easyWins++; break; }
    const c = R.c4BotMove(doc(cols), st.turn, st.turn === hardSeat ? 'hard' : 'easy', r);
    assert.ok(!st.grid[0][c]);
    cols.push(c);
  }
}
assert.ok(hardWins >= 8, `hard should beat easy: ${hardWins}-${easyWins}`);
console.log(`bot-c4: ok (hard beat easy ${hardWins}-${easyWins})`);
