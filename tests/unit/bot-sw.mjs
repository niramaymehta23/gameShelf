import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto in Sharp Wits (the bottom of public/js/sharpwits.js): his pre-played run for each of the eight
// games must be laps the replay accepts, in order, and Easy must be slower and slip more than Hard.
const S = load(['rps.js', 'hues.js', 'sharpwits.js'],
  ['swState', 'swBotRun', 'swBotClock', 'swPairs', 'SW_GAMES', 'SW_ORDER', 'SW_LOCK'],
  { matchMedia: () => ({ matches: false }) });
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };
function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Otto (guest) lost RPS to the host, who picked game g
const match = (g, seed) => ({ id: 'm' + seed, game: 'sw', seed: 'seed-' + seed, rps: { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } }, sw: { by: 'host', g }, laps: {} });
const asLaps = (run) => Object.fromEntries(run.laps.map(({ at, ...e }, i) => ['g' + String(i).padStart(3, '0'), e]));

test('every game: his laps follow on, and the replay takes every one of them', () => {
  for (const g of S.SW_ORDER) for (const level of ['easy', 'hard']) for (let seed = 0; seed < 40; seed++) {
    const m = match(g, seed), run = S.swBotRun(m, g, level, rng(seed * 7 + level.length));
    const game = S.SW_GAMES[g], to = game.to;
    assert.ok(run.laps.length >= 1, `${g} ${level}: at least one lap`);
    let prevMs = 0, prevAt = 0, prevX = 0, step = 0;
    for (const [i, e] of run.laps.entries()) {
      assert.ok(e.ms >= prevMs && e.at >= prevAt, `${g}: time never goes back`);
      assert.ok(e.x >= prevX, `${g}: wrong taps only add up`);
      assert.ok(Math.abs(S.swBotClock(run.clock, e.at) - e.ms) < 0.11, `${g}: ms is his tapping clock at that moment`);
      if (e.end) { assert.equal(i, run.laps.length - 1, 'an end is the last lap'); assert.ok(e.end === 'fail' ? game.levels : e.end === 'up'); }
      else { assert.equal(e.n, ++step); if (game.keyed) assert.ok(Number.isInteger(e.k) && e.k >= 0 && e.k < to); else assert.equal(e.k, undefined); }
      prevMs = e.ms; prevAt = e.at; prevX = e.x;
    }
    m.laps = asLaps(run);
    const r = S.swState(m).run.guest;
    assert.equal(r.n, step, `${g} ${level} seed ${seed}: the replay counts every step`);
    assert.ok(r.end, 'his run ends');
    assert.equal(r.ms, run.laps.filter((e) => !e.end).pop()?.ms || 0);
    if (!game.levels) assert.equal(r.end, 'all', `${g}: the races without levels always get to the end`);
    if (game.keyed) assert.deepEqual([...r.keys].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
});

test('Pairs: every key he names is a pair he really turned up (two cards of that symbol)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const m = match('pairs', seed), deck = S.swPairs(m);
    for (const e of S.swBotRun(m, 'pairs', 'easy', rng(seed)).laps) if (!e.end) assert.equal(deck.filter((s) => s === e.k).length, 2);
  }
});

test('a wrong tap costs him the lock', () => {
  for (const g of ['ink', 'hunt', 'way', 'shade', 'spot']) {
    let slips = 0;
    for (let seed = 0; seed < 60; seed++) {
      const run = S.swBotRun(match(g, seed), g, 'easy', rng(seed));
      const last = run.laps[run.laps.length - 1];
      slips += last.x;
      assert.ok(last.ms >= last.x * S.SW_LOCK[g], `${g}: each slip holds him up for ${S.SW_LOCK[g]} ms`);
    }
    assert.ok(slips > 0, `${g}: Easy slips sometimes`);
  }
});

test('Easy is slower and slips more than Hard; Hard gets further in the level games', () => {
  for (const g of S.SW_ORDER) {
    const sum = { easy: { ms: 0, x: 0, n: 0 }, hard: { ms: 0, x: 0, n: 0 } };
    for (const level of ['easy', 'hard']) for (let seed = 0; seed < 80; seed++) {
      const run = S.swBotRun(match(g, seed), g, level, rng(seed * 13 + 1));
      const last = run.laps[run.laps.length - 1], done = run.laps.filter((e) => !e.end).pop();
      sum[level].x += last.x; sum[level].n += done ? done.n : 0; sum[level].ms += done ? done.ms / done.n : 0;
    }
    if (S.SW_GAMES[g].levels) assert.ok(sum.hard.n > sum.easy.n, `${g}: Hard clears more levels (${sum.hard.n} vs ${sum.easy.n})`);
    else {
      assert.ok(sum.easy.ms > sum.hard.ms * 1.15, `${g}: Easy is slower per step`);
      assert.ok(sum.easy.x >= sum.hard.x, `${g}: Easy slips at least as often (${sum.easy.x} vs ${sum.hard.x})`);
    }
  }
});

test('his pace is human: Hard Number Hunt takes 15–30 s, Easy True Colours 20–40 s', () => {
  for (let seed = 0; seed < 20; seed++) {
    const hunt = S.swBotRun(match('hunt', seed), 'hunt', 'hard', rng(seed)).laps.pop();
    assert.ok(hunt.ms > 15000 && hunt.ms < 30000, 'hunt ' + hunt.ms);
    const ink = S.swBotRun(match('ink', seed), 'ink', 'easy', rng(seed)).laps.pop();
    assert.ok(ink.ms > 20000 && ink.ms < 40000, 'ink ' + ink.ms);
  }
});

console.log(`bot-sw: ${n} tests passed`);
