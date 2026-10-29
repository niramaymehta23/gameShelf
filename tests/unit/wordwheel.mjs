import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Word Wheel's replay (public/js/wordwheel.js): which finds count, the score and the winner, from
// hand-made match documents; the refusals the phone gives before writing; and the wheel each table spins.
const W = load(['rps.js', 'hues.js', 'wheels.js', 'wordwheel.js'], ['wwState', 'wwSetup', 'wwRefusal', 'wwPick', 'wwClueWord', 'WW_WHEELS'], { matchMedia: () => ({ matches: false }) });
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };

const HOST_STARTS = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } };
const WHEEL = 3, words = W.WW_WHEELS[WHEEL].words.split(' ');
const finds = (list) => Object.fromEntries(list.map(([by, w], i) => ['f' + String(i).padStart(3, '0'), { by, w }]));
const game = (list, ww = { by: 'host', n: WHEEL }) => ({ id: 'x', game: 'ww', rps: HOST_STARTS, ww, finds: finds(list) });
const scored = (st) => [...st.finds.map((f) => f.by + ':' + f.w)];

test('finds count in key order, one point each', () => {
  const st = W.wwState(game([['host', words[0]], ['guest', words[1]], ['host', words[2]]]));
  assert.deepEqual({ ...st.score }, { host: 2, guest: 1 });
  assert.deepEqual(scored(st), ['host:' + words[0], 'guest:' + words[1], 'host:' + words[2]]);
  assert.equal(st.winner, null);
});

test('each player finds their own words: both can have the same one, but only once each', () => {
  const st = W.wwState(game([['guest', words[0]], ['host', words[0]], ['guest', words[0]], ['host', words[0]]]));
  assert.deepEqual({ ...st.score }, { host: 1, guest: 1 });
  assert.deepEqual(scored(st), ['guest:' + words[0], 'host:' + words[0]]);
  assert.ok(st.found.host.has(words[0]) && st.found.guest.has(words[0]));
});

test('words not on the wheel, junk and strangers are skipped', () => {
  const st = W.wwState(game([['host', 'ZZZZ'], ['host', words[0].toLowerCase()], ['nobody', words[1]], ['host', null], ['guest', 42], ['host', words[2]]]));
  assert.deepEqual(scored(st), ['host:' + words[2]]);
  const holes = W.wwState({ ...game([]), finds: { f000: null, f001: 'x', f002: { by: 'guest', w: words[4] } } });
  assert.deepEqual(scored(holes), ['guest:' + words[4]]);
});

test('the fifth word wins, and nothing after it counts', () => {
  const list = [0, 1, 2, 3].map((i) => ['guest', words[i]]);
  const st = W.wwState(game([...list, ['host', words[4]], ['guest', words[5]], ['host', words[6]], ['guest', words[7]]]));
  assert.equal(st.winner, 'guest');
  assert.deepEqual({ ...st.score }, { host: 1, guest: 5 });
  assert.equal(st.finds.length, 6);
});

test('giving up: the other player wins there and then, and nothing after counts', () => {
  const st = W.wwState({ ...game([['host', words[0]], ['host', words[1]], ['guest', words[2]]]), finds: { ...finds([['host', words[0]], ['host', words[1]], ['guest', words[2]]]), f003: { by: 'host', up: true }, f004: { by: 'guest', w: words[3] }, f005: { by: 'guest', up: true } } });
  assert.equal(st.winner, 'guest'); assert.equal(st.gaveUp, 'host');
  assert.deepEqual({ ...st.score }, { host: 2, guest: 1 });
  assert.equal(W.wwState(game([['guest', words[0]]])).gaveUp, null);
  const odd = W.wwState({ ...game([]), finds: { f000: { by: 'nobody', up: true }, f001: { by: 'host', up: 'yes' } } });
  assert.equal(odd.winner, null, 'a give-up from nobody, or not quite one, is skipped');
});

test('a hint is about the most everyday word of six letters or fewer that you haven’t found', () => {
  const st = W.wwState(game([['host', words[0]]]));
  const short = words.filter((w) => w.length <= 6);
  assert.equal(W.wwClueWord(st, 'guest'), short[0]);
  assert.equal(W.wwClueWord(st, 'host'), short.find((w) => w !== words[0]));
});

test('only the RPS winner can spin, and only a real wheel', () => {
  assert.equal(W.wwState(game([['host', words[0]]], { by: 'guest', n: WHEEL })).setup, null);
  for (const bad of [-1, 100, 2.5, '3', null]) assert.equal(W.wwSetup(game([], { by: 'host', n: bad })), null);
  assert.equal(W.wwSetup({ rps: {}, ww: { by: 'host', n: 1 } }), null, 'no RPS winner yet');
  const st = W.wwState(game([], { by: 'host', n: 99 }));
  assert.equal(st.wheel.n, 99); assert.ok(st.wheel.set.size >= 20);
});

test('refusals: too short, no middle letter, plural, not a word, already yours', () => {
  const st = W.wwState(game([['guest', words[0]]]));
  const x = st.wheel, noMid = [...x.o].filter((c) => c !== x.c).join('').slice(0, 4);
  assert.deepEqual({ ...W.wwRefusal(st, x.c + x.o.slice(0, 2), 'host') }, { k: 'short' });
  assert.deepEqual({ ...W.wwRefusal(st, noMid, 'host') }, { k: 'middle' });
  assert.deepEqual({ ...W.wwRefusal(st, words[0], 'guest') }, { k: 'found' });
  assert.equal(W.wwRefusal(st, words[0], 'host'), null, 'the partner having it doesn’t matter');
  assert.equal(W.wwRefusal(st, words[1], 'guest'), null);
  const fake = (x.c + x.o).slice(0, 5);
  if (!x.set.has(fake)) assert.equal(W.wwRefusal(st, fake, 'host').k, 'word');
  // a plural of a listed word: any wheel with an S and a word that takes one
  for (let i = 0; i < W.WW_WHEELS.length; i++) {
    const s2 = W.wwState(game([], { by: 'host', n: i })), y = s2.wheel;
    const w = y.words.find((v) => !v.endsWith('S') && v.length < 9 && [...(v + 'S')].every((ch, _, all) => all.filter((c) => c === ch).length <= [...(y.c + y.o)].filter((c) => c === ch).length));
    if (w && !y.set.has(w + 'S')) { assert.equal(W.wwRefusal(s2, w + 'S', 'host').k, 'plural'); return; }
  }
  assert.fail('no wheel to test a plural on');
});

test('a table spins every wheel once before any comes round again', () => {
  const all = new Set(Array.from({ length: 100 }, (_, i) => W.wwPick('ABCD', i)));
  assert.equal(all.size, 100);
  assert.equal(W.wwPick('ABCD', 100), W.wwPick('ABCD', 0));
  const seen = [0, 1, 2].map((i) => W.wwPick('ABCD', i));
  assert.equal(W.wwPick('ABCD', 0, seen), W.wwPick('ABCD', 3), 'wheels this phone has seen (quit games) are passed over');
  assert.notDeepEqual([0, 1, 2].map((i) => W.wwPick('ABCD', i)), [0, 1, 2].map((i) => W.wwPick('WXYZ', i)), 'tables have their own order');
});

test('table stats: wins, words found, the longest word and nine-letter words', () => {
  const S = load(['rps.js', 'hues.js', 'wheels.js', 'wordwheel.js', 'stats.js'], ['tableStats'], { matchMedia: () => ({ matches: false }), GAMES: { ww: {} } });
  const nine = words.find((w) => w.length === 9), short = words.filter((w) => w.length === 4);
  const m = game([['guest', nine], ['host', short[0]], ['guest', short[1]], ['guest', short[2]], ['guest', short[3]], ['guest', short[4]]]);
  const s = S.tableStats({ results: { x: { g: 'ww', w: 'guest', at: 1 } } }, [m]);
  assert.equal(s.played.ww, 1);
  assert.equal(s.ww.guest.wins, 1); assert.equal(s.ww.guest.words, 5); assert.equal(s.ww.host.words, 1);
  assert.equal(s.ww.guest.nines, 1); assert.equal(s.ww.guest.longest.w, nine); assert.equal(s.ww.host.longest.w, short[0]);
  assert.equal(s.log[0].note, `5–1, the wheel’s nine-letter word was ${W.WW_WHEELS[WHEEL].nine.split(' ')[0]}`);
  const gave = { ...game([['host', short[0]]]), id: 'y', finds: { f000: { by: 'host', w: short[0] }, f001: { by: 'guest', up: true } } };
  const s2 = S.tableStats({ results: { y: { g: 'ww', w: 'host', at: 1 } } }, [gave]);
  assert.equal(s2.ww.host.wins, 1);
  assert.ok(s2.log[0].note.startsWith('1–0 when the other gave up'), s2.log[0].note);
});

console.log(`wordwheel: ${n} passed`);
