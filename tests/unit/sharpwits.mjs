import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Sharp Wits (public/js/sharpwits.js) outside the browser: the seeded puzzles, the replay of both
// runs (who wins, and when it's decided), and its rows in the table stats.
const S = load(['rps.js', 'hues.js', 'sharpwits.js', 'stats.js'],
  ['swState', 'swSetup', 'swSpot', 'swCopy', 'swInks', 'swHunt', 'swLine', 'SW_GAMES', 'SW_LOOKALIKES', 'SW_FLIPS', 'swCopyLen', 'tableStats'],
  { matchMedia: () => ({ matches: false }), GAMES: { sw: {} } });
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };

const HOST_STARTS = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } };
const match = (g, extra = {}) => ({ id: 'm1', game: 'sw', seed: 'seed-1', rps: HOST_STARTS, sw: { by: 'host', g }, laps: {}, ...extra });
// add a seat's laps in order: numbers are progress steps at that ms, objects are taken as they are
function laps(m, seat, ...entries) {
  const letter = seat[0];
  let i = Object.keys(m.laps).filter((k) => k[0] === letter).length, step = Object.values(m.laps).filter((e, k) => Object.keys(m.laps)[k][0] === letter && e.n).length;
  for (const e of entries) m.laps[letter + String(i++).padStart(3, '0')] = typeof e === 'number' ? { n: ++step, ms: e, x: 0 } : e;
  return m;
}
const steps = (count, every = 1000) => Array.from({ length: count }, (_, i) => (i + 1) * every);
const win = (m) => S.swState(m).winner;

test('setup: only the RPS winner, only the four games', () => {
  assert.deepEqual({ ...S.swSetup(match('hunt')) }, { by: 'host', g: 'hunt', to: 25 });
  assert.equal(S.swSetup(match('hunt', { sw: { by: 'guest', g: 'hunt' } })), null, 'the loser can’t pick');
  assert.equal(S.swSetup(match('chess')), null);
  assert.equal(S.swSetup(match('spot', { rps: {} })), null, 'nobody has won RPS yet');
  assert.deepEqual(Object.keys(S.SW_GAMES), ['spot', 'copy', 'ink', 'hunt']);
  assert.equal(S.swState(match('spot', { sw: null })).winner, null);
});

test('Odd One Out: same pictures on both phones, more emoji each time, two changes in the last four', () => {
  const m = match('spot');
  assert.deepEqual(S.swSpot(m, 3), S.swSpot({ ...m }, 3), 'the seed decides it');
  assert.notDeepEqual(S.swSpot(m, 3), S.swSpot({ ...m, seed: 'other' }, 3));
  for (let seed = 0; seed < 30; seed++) for (let i = 0; i < 10; i++) {
    const p = S.swSpot({ seed: 's' + seed }, i);
    assert.equal(p.count, 7 + i); assert.equal(p.items.length, p.count);
    assert.equal(p.diffs.length, i >= 6 ? 2 : 1);
    assert.notEqual(p.diffs[0].at, p.diffs[1]?.at);
    for (const it of p.items) {
      assert.ok(it.x >= 10 && it.x <= 140 && it.y >= 10 && it.y <= 90, 'inside the picture');
      assert.ok(S.SW_LOOKALIKES[it.g].includes(it.e));
    }
    for (let a = 0; a < p.items.length; a++) for (let b = a + 1; b < p.items.length; b++) assert.ok(Math.hypot(p.items[a].x - p.items[b].x, p.items[a].y - p.items[b].y) >= 12, 'no two on top of each other');
    for (const d of p.diffs) {
      const it = p.items[d.at];
      assert.ok(d.panel === 0 || d.panel === 1);
      const kinds = ['e', 'flip', 's', 'r'].filter((k) => d[k] !== undefined);
      assert.equal(kinds.length, 1, 'one change each');
      if (d.e) { assert.notEqual(d.e, it.e); assert.ok(S.SW_LOOKALIKES[it.g].includes(d.e), 'swapped for a look-alike'); }
      if (d.flip) assert.ok(S.SW_FLIPS.has(it.e), 'only things that face a way are mirrored');
      if (d.s) assert.ok(Math.abs(d.s - it.s) > 0.25);
      if (d.r !== undefined) assert.equal(Math.abs(d.r - it.r), 80);
    }
  }
  const kinds = new Set();
  for (let seed = 0; seed < 60; seed++) for (const d of S.swSpot({ seed: 'k' + seed }, 0).diffs) kinds.add(['e', 'flip', 's', 'r'].find((k) => d[k] !== undefined));
  assert.deepEqual([...kinds].sort(), ['e', 'flip', 'r', 's'], 'all four kinds of change turn up');
});

test('Copycat: seven dots apart from each other, ten in the sequence, never three the same', () => {
  for (let seed = 0; seed < 100; seed++) {
    const { dots, seq } = S.swCopy({ seed: 'c' + seed });
    assert.equal(dots.length, 7); assert.equal(seq.length, S.swCopyLen(8)); assert.equal(S.swCopyLen(1), 3);
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) assert.ok(Math.hypot(dots[a].x - dots[b].x, dots[a].y - dots[b].y) >= 20, 'dots don’t touch');
    assert.ok(dots.every((d) => d.x >= 12 && d.x <= 88 && d.y >= 12 && d.y <= 88));
    assert.ok(seq.every((k) => Number.isInteger(k) && k >= 0 && k < 7));
    for (let i = 2; i < seq.length; i++) assert.ok(!(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]));
  }
  assert.deepEqual(S.swCopy({ seed: 'x' }), S.swCopy({ seed: 'x' }));
});

test('True Colours: twenty cards, mostly at odds with their word, never the same card twice running', () => {
  let same = 0, total = 0;
  for (let seed = 0; seed < 100; seed++) {
    const { cards, order } = S.swInks({ seed: 'i' + seed });
    assert.equal(cards.length, 20);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
    cards.forEach((c, i) => {
      assert.ok(c.word >= 0 && c.word < 4 && c.ink >= 0 && c.ink < 4);
      if (i) assert.ok(!(c.word === cards[i - 1].word && c.ink === cards[i - 1].ink));
      same += c.word === c.ink; total++;
    });
  }
  assert.ok(same / total > 0.15 && same / total < 0.35, `about a quarter agree (${same / total})`);
});

test('Number Hunt: 1 to 25, each once', () => {
  const cells = S.swHunt({ seed: 'h' });
  assert.deepEqual([...cells.map((c) => c.n)].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.notDeepEqual(cells.map((c) => c.n), S.swHunt({ seed: 'h2' }).map((c) => c.n));
});

test('a race: both finish, the quicker on their own clock wins, whatever order the laps arrive in', () => {
  const m = match('hunt');
  laps(m, 'guest', ...steps(25, 900)); // guest: 22.5 s
  assert.equal(win(m), null, 'the host is still going and could be quicker');
  laps(m, 'host', ...steps(24, 900));
  assert.equal(win(m), null);
  laps(m, 'host', 22400); // 22.4 s on the host's own clock
  assert.equal(win(m), 'host');
  const st = S.swState(m);
  assert.equal(st.run.host.end, 'all'); assert.equal(st.run.host.ms, 22400); assert.equal(st.run.guest.ms, 22500);
  assert.equal(S.swLine(st.setup, st.run.host), 'all 25 in 22.40 s');
});

test('the slower phone concedes with out; dead heats and two blank runs are draws', () => {
  const m = match('spot');
  laps(m, 'host', ...steps(10, 3000));
  laps(m, 'guest', ...steps(7, 3000), { end: 'out', ms: 30000, x: 2 });
  assert.equal(win(m), 'host');
  assert.equal(S.swState(m).run.guest.x, 2);
  assert.equal(S.swLine(S.swState(m).setup, S.swState(m).run.guest), '7 of 10 when time ran out');
  const tie = match('ink');
  laps(tie, 'host', ...steps(20, 500)); laps(tie, 'guest', ...steps(20, 500));
  assert.equal(win(tie), 'draw');
  const blank = match('spot');
  laps(blank, 'host', { end: 'up', ms: 4000 }); laps(blank, 'guest', { end: 'up', ms: 9000 });
  assert.equal(win(blank), 'draw', 'neither spotted anything');
});

test('decided early: once one run is over, the other wins as soon as it is ahead', () => {
  const m = match('spot');
  laps(m, 'host', 2000, 5000, 9000, { end: 'up', ms: 12000 }); // 3 spotted by 9 s, then gave up
  laps(m, 'guest', 3000, 6000);
  assert.equal(win(m), null);
  laps(m, 'guest', 9500);
  assert.equal(win(m), null, 'three each, but the host got there sooner');
  laps(m, 'guest', 15000);
  assert.equal(win(m), 'guest', 'four beats three, however long it took');
  const quick = match('spot');
  laps(quick, 'host', 2000, 5000, 9000, { end: 'up', ms: 12000 });
  laps(quick, 'guest', 1000, 2000, 3000);
  assert.equal(win(quick), 'guest', 'level on progress and already quicker: nothing left to decide');
  const going = match('spot');
  laps(going, 'host', 2000, 5000);
  laps(going, 'guest', 1000, 2000, 3000);
  assert.equal(win(going), null, 'nobody is over yet');
});

test('Copycat: further wins; level for level, less time tapping; only Copycat can fail', () => {
  const seven = match('copy');
  laps(seven, 'host', ...steps(6, 4000), { end: 'fail', ms: 26000 });  // out on level 7
  laps(seven, 'guest', ...steps(5, 1000), { end: 'fail', ms: 5500 });  // out on level 6, much quicker
  assert.equal(win(seven), 'host', 'the 7 beats the 6');
  assert.equal(S.swLine(S.swState(seven).setup, S.swState(seven).run.host), 'out on level 7 (6 cleared, 24.00 s)');
  const both8 = match('copy');
  laps(both8, 'host', ...steps(8, 3000)); laps(both8, 'guest', ...steps(8, 2900));
  assert.equal(win(both8), 'guest', 'both cleared all eight: less time wins');
  assert.equal(S.swLine(S.swState(both8).setup, S.swState(both8).run.guest), 'all 8 levels, 23.20 s tapping');
  const same = match('copy');
  laps(same, 'host', ...steps(4, 3000), { end: 'fail', ms: 13000 });
  laps(same, 'guest', ...steps(4, 2500), { end: 'fail', ms: 15000 });
  assert.equal(win(same), 'guest', 'both out on level 5: the 10 s of tapping beats 12 s');
  const nope = match('hunt');
  laps(nope, 'host', 1000, { end: 'fail', ms: 2000 }, 3000);
  assert.equal(S.swState(nope).run.host.n, 2, 'fail means nothing outside Copycat');
  assert.equal(S.swState(nope).run.host.end, null);
});

test('junk in the log is skipped', () => {
  const m = match('ink');
  m.laps = {
    h000: { n: 1, ms: 1000 }, h001: { n: 3, ms: 2000 }, h002: { n: 2, ms: 500 }, h003: { n: 2, ms: 'soon' },
    h004: { n: 2, ms: 2100, x: 3 }, h005: { end: 'nap', ms: 2200 }, h1: { n: 3, ms: 2300 }, x000: { n: 3, ms: 2300 },
    h006: null, h007: { n: 3, ms: 9e9 }, h008: { end: 'up', ms: 2400, x: 1 }, h009: { n: 3, ms: 2500 },
    g000: { n: 1, ms: 800 },
  };
  const r = S.swState(m).run.host;
  assert.deepEqual({ ...r }, { n: 2, ms: 2100, t: 2400, x: 3, end: 'up' });
  assert.equal(S.swState(m).run.guest.n, 1, 'the guest’s keys are their own');
});

test('stats: wins, quickest full runs, Copycat’s furthest, wrong taps, the log line', () => {
  const a = match('hunt', { id: 'a', created: 1 });
  laps(a, 'host', ...steps(25, 1000)); laps(a, 'guest', ...steps(10, 1000), { end: 'out', ms: 25000, x: 4 });
  const b = match('hunt', { id: 'b', created: 2 });
  laps(b, 'host', ...steps(25, 1200)); laps(b, 'guest', ...steps(25, 900));
  const c = match('copy', { id: 'c', created: 3 });
  laps(c, 'host', ...steps(5, 2000), { end: 'fail', ms: 11000, x: 1 }); laps(c, 'guest', ...steps(3, 1000), { end: 'fail', ms: 4000, x: 1 });
  const results = { a: { g: 'sw', w: 'host', at: 1 }, b: { g: 'sw', w: 'guest', at: 2 }, c: { g: 'sw', w: 'host', at: 3 } };
  const s = S.tableStats({ results }, [a, b, c]);
  assert.equal(s.played.sw, 3);
  assert.equal(s.sw.host.wins, 2); assert.equal(s.sw.guest.wins, 1);
  assert.equal(s.sw.host.hunt, 25000, 'the quicker of the host’s two full runs');
  assert.equal(s.sw.guest.hunt, 22500, 'a run that ran out of time isn’t a full one');
  assert.deepEqual({ ...s.sw.host.copy }, { n: 5, ms: 10000 }); assert.equal(s.sw.guest.copy.n, 3);
  assert.equal(s.sw.guest.misses, 5);
  assert.equal(s.sw.host.spot, null);
  assert.equal(s.log[0].note, 'Copycat: out on level 6 (5 cleared, 10.00 s)');
  assert.equal(s.log[2].note, 'Number Hunt: all 25 in 25.00 s');
});

console.log(n + ' Sharp Wits tests passed.');
