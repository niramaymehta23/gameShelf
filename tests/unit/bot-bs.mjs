import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto's Battleships: bsBotShot(m, seat, level, rng) never repeats a square, finishes off hit ships,
// and Hard sinks a fleet in far fewer shots than Easy.
const R = load(['rps.js', 'battleships.js'], ['bsState', 'bsBotShot', 'randomFleet', 'FLEET', 'shipCells'], { matchMedia: () => ({ matches: false }) });
const RPS = { r1: { host: 'paper', guest: 'rock' }, r2: { host: 'paper', guest: 'rock' } }; // host fires first
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Otto (host here) shoots a fleet nobody fires back at: the guest's shots are all misses into a corner it never uses
function sinkAll(level, seed) {
  const r = rng(seed);
  const m = { rps: RPS, fleets: { host: R.randomFleet(), guest: R.randomFleet() }, shots: {} };
  let n = 0, mine = 0;
  const guestMiss = []; for (let i = 0; i < 100; i++) guestMiss.push({ r: Math.floor(i / 10), c: i % 10 });
  const hostCells = new Set(m.fleets.host.flatMap((s) => R.shipCells(s).map(([a, b]) => a * 10 + b)));
  const gm = guestMiss.filter((p) => !hostCells.has(p.r * 10 + p.c));
  for (let guard = 0; guard < 400; guard++) {
    const st = R.bsState(m);
    if (st.winner) break;
    let shot;
    if (st.turn === 'host') {
      shot = R.bsBotShot(m, 'host', level, r);
      assert.ok(shot && !st.shotBy.host.has(shot.r * 10 + shot.c), 'a fresh square');
      mine++;
    } else shot = gm.shift();
    m.shots['s' + String(n++).padStart(3, '0')] = shot;
  }
  assert.equal(R.bsState(m).winner, 'host');
  return mine;
}
assert.equal(R.bsBotShot({ rps: RPS, fleets: { host: R.randomFleet(), guest: R.randomFleet() }, shots: {} }, 'guest', 'hard'), null, 'not his turn');
let easy = 0, hard = 0;
for (let s = 0; s < 12; s++) { easy += sinkAll('easy', 10 + s); hard += sinkAll('hard', 10 + s); }
easy /= 12; hard /= 12;
assert.ok(hard < 62, 'hard sinks a fleet in about 45–60 shots: ' + hard);
assert.ok(hard + 10 < easy, `hard (${hard}) well ahead of easy (${easy})`);

// after a hit on an unsunk ship, Hard's next shot is next to it
const fleets = { host: R.randomFleet(), guest: [{ id: 'carrier', v: false, r: 4, c: 2 }, { id: 'battleship', v: true, r: 0, c: 9 }, { id: 'cruiser', v: false, r: 9, c: 0 }, { id: 'submarine', v: false, r: 7, c: 5 }, { id: 'destroyer', v: true, r: 0, c: 0 }] };
const m = { rps: RPS, fleets, shots: { s000: { r: 4, c: 4 } } };
const next = R.bsBotShot(m, 'host', 'hard', rng(5));
assert.equal(Math.abs(next.r - 4) + Math.abs(next.c - 4), 1, 'follows up the hit: ' + JSON.stringify(next));
console.log(`bot-bs: ok (shots to sink a fleet: hard ${hard.toFixed(1)}, easy ${easy.toFixed(1)})`);
