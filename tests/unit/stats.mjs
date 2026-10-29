import assert from 'node:assert/strict';
import { load } from './load.mjs';
// The table stats (public/js/stats.js) worked out from hand-made match documents, through the
// games' real replay functions.
const S = load(['rps.js', 'connect4.js', 'battleships.js', 'hues.js', 'words.js', 'quickfire.js', 'stats.js'],
  ['tableStats', 'huState', 'hueApply'],
  { matchMedia: () => ({ matches: false }), GAMES: { c4: {}, bs: {}, hu: {}, qf: {} } });
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };

const HOST_STARTS = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } };
const keys = (prefix, list, w = 3) => Object.fromEntries(list.map((v, i) => [prefix + String(i).padStart(w, '0'), v]));
// Connect Four: the host (red, first) stacks column 0; the guest wins with column 0 when it goes there
const c4 = (id, created, winner) => ({ id, game: 'c4', created, rps: HOST_STARTS,
  moves: keys('m', winner === 'host' ? [0, 1, 0, 1, 0, 1, 0] : [6, 0, 6, 0, 5, 0, 5, 0]) });
const table = (games) => ({ results: Object.fromEntries(games.map(([m, w]) => [m.id, { g: m.game, w }])) });
const stats = (games, extra = []) => S.tableStats(table(games), [...games.map(([m]) => m), ...extra]);

test('Connect Four: discs to win, wins going first, the log line', () => {
  const s = stats([[c4('a', 1, 'host'), 'host'], [c4('b', 2, 'guest'), 'guest']]);
  assert.equal(s.c4.host.wins, 1); assert.equal(s.c4.host.fewest, 4); assert.equal(s.c4.host.first, 1);
  assert.equal(s.c4.guest.fewest, 4); assert.equal(s.c4.guest.first, 0, 'the guest went second');
  assert.equal(s.log[0].id, 'b', 'newest first'); assert.equal(s.log[1].note, 'four in a row with 4 discs');
});

test('streaks: current run and best run per player; a draw ends a run', () => {
  const g = [['a', 'host'], ['b', 'host'], ['c', 'guest'], ['d', 'host']].map(([id, w], i) => [c4(id, i + 1, w), w]);
  let s = stats(g);
  assert.deepEqual({ ...s.streak }, { seat: 'host', n: 1 });
  assert.deepEqual({ ...s.best }, { host: 2, guest: 1 });
  assert.deepEqual({ ...s.wins }, { host: 3, guest: 1 }); assert.equal(s.games, 4);
  s = stats([...g, [{ ...c4('e', 9, 'host'), moves: {} }, 'draw']]);
  assert.deepEqual({ ...s.streak }, { seat: null, n: 0 }); assert.equal(s.draws, 1);
});

test('a saved game that finished last counts last, whenever it was opened', () => {
  const saved = c4('old', 1, 'host'), quick = c4('new', 2, 'guest');
  const s = S.tableStats({ results: { old: { g: 'c4', w: 'host', at: 50 }, new: { g: 'c4', w: 'guest', at: 20 } } }, [saved, quick]);
  assert.deepEqual({ ...s.streak }, { seat: 'host', n: 1 });
  assert.equal(s.log[0].id, 'old'); assert.equal(s.log[0].at, 50);
});

test('Battleships: accuracy, best game, fewest shots to win, longest run of hits', () => {
  const fleet = [['carrier', 0], ['battleship', 1], ['cruiser', 2], ['submarine', 3], ['destroyer', 4]].map(([id, r]) => ({ id, r, c: 0, v: false }));
  const lens = [5, 4, 3, 3, 2], ship = lens.flatMap((len, r) => Array.from({ length: len }, (_, c) => ({ r, c })));
  // host misses, guest misses, three times over; then the host hits all 17 squares in a row
  const shots = [];
  for (let i = 0; i < 3; i++) shots.push({ r: 9, c: 9 - i }, { r: 9, c: 9 - i });
  shots.push(...ship);
  const m = { id: 'bs1', game: 'bs', created: 1, rps: HOST_STARTS, fleets: { host: fleet, guest: fleet }, shots: keys('s', shots) };
  const s = stats([[m, 'host']]);
  assert.equal(s.bs.host.shots, 20); assert.equal(s.bs.host.hits, 17);
  assert.equal(Math.round((s.bs.host.hits / s.bs.host.shots) * 100), 85);
  assert.equal(s.bs.host.fewest, 20); assert.equal(s.bs.host.run, 17); assert.equal(s.bs.host.best, 0.85);
  assert.equal(s.bs.guest.shots, 3); assert.equal(s.bs.guest.hits, 0); assert.equal(s.bs.guest.fewest, null);
  assert.equal(s.log[0].note, '17 hits from 20 shots');
});

test('Hues: fewest cards played to win, from a game played to the end', () => {
  // a simple player: the first card that goes, else draw, keep or pass
  const m = { id: 'hu1', game: 'hu', created: 1, hueVersion: 2, hueRules: 'custom', seed: 'stats-seed', rps: HOST_STARTS, plays: {} };
  let k = 0;
  for (let i = 0; i < 4000; i++) {
    const s = S.huState(m);
    if (s.winner) break;
    const by = s.turn, tries = [...s.hands[by].map((id) => ({ by, k: 'play', ids: [id], col: 0 })), { by, k: 'draw' }, { by, k: 'keep' }, { by, k: 'pass' }];
    const key = 'p' + String(k).padStart(5, '0');
    const mv = tries.find((t) => { try { S.hueApply(s, { ...t, at: 0 }, key); return true; } catch (_) { return false; } });
    m.plays[key] = { ...mv, at: 0 }; k++;
  }
  const w = S.huState(m).winner;
  assert.ok(w, 'the game finished');
  const played = Object.values(m.plays).filter((p) => p.k === 'play' && p.by === w).reduce((t, p) => t + p.ids.length, 0);
  const s = stats([[m, w]]);
  assert.equal(s.hu[w].wins, 1); assert.equal(s.hu[w].fewest, played);
  assert.equal(s.log[0].note, `out of cards after playing ${played}`);
});

test('Quickfire: rounds, fastest word, average answer, giving up', () => {
  const picks = {}, ans = {};
  for (let r = 1; r <= 5; r++) {
    const key = 'r' + String(r).padStart(3, '0');
    picks[key] = { host: 'S', guest: 'T' };
    ans[key + 'h'] = { w: 'START', ms: r === 1 ? 1200 : 900 };
    ans[key + 'g'] = r === 1 ? { pass: true, ms: 300 } : { out: true, ms: 950 };
  }
  const m = { id: 'qf1', game: 'qf', created: 1, rps: HOST_STARTS, seed: 'x', qf: { by: 'host', mode: 'words', len: 5, side: 'start' }, picks, ans };
  const s = stats([[m, 'host']]);
  assert.equal(s.qf.host.wins, 1); assert.equal(s.qf.host.rounds, 5);
  assert.deepEqual({ ...s.qf.host.word }, { ms: 900, w: 'START' });
  assert.equal(s.qf.host.ms / s.qf.host.answers, 960);
  assert.equal(s.qf.guest.gaveUp, 1); assert.equal(s.qf.guest.word, null);
  assert.equal(s.log[0].note, '5–0 in Words');
});

test('rock, paper, scissors counts every game played; unfinished games count for nothing else', () => {
  const unfinished = { id: 'u', game: 'c4', created: 5, rps: { r1: { host: 'paper', guest: 'paper' }, r2: { host: 'rock' } }, moves: {} };
  const s = stats([[c4('a', 1, 'host'), 'host']], [unfinished]);
  assert.equal(s.games, 1);
  assert.deepEqual([s.rps.host.rock, s.rps.host.paper, s.rps.host.throws], [1, 2, 3], 'a half-played round isn’t a throw');
  assert.deepEqual({ ...s.rps.host.opener }, { rock: 1, paper: 1, scissors: 0 });
  assert.equal(s.rps.host.tosses, 1); assert.equal(s.rps.guest.tosses, 0);
});

test('games no longer on the shelf, and results without a document, are left out of the details', () => {
  const old = { id: 'ip', game: 'ip', created: 1, rps: HOST_STARTS };
  const s = S.tableStats({ results: { ip: { g: 'ip', w: 'host' }, gone: { g: 'c4', w: 'guest' } } }, [old]);
  assert.equal(s.games, 1, 'the IPOs game is gone; the Connect Four result still counts');
  assert.equal(s.wins.guest, 1); assert.equal(s.rps.host.throws, 0); assert.equal(s.log.length, 0);
  assert.equal(S.tableStats({}, []).games, 0);
});

console.log(`${n} stats tests passed.`);
