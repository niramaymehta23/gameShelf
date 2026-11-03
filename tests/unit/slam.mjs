import assert from 'node:assert/strict';
import { load } from './load.mjs';
const S = load(['rps.js', 'hues.js', 'words.js', 'quickfire.js', 'slam.js', 'stats.js'], ['slState', 'slOptions', 'slError', 'SL_CARDS', 'tableStats', 'slFreshWord', 'slCanAct'], { GAMES: { sl: {} } });
const rps = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } };
const game = (seed = 'slam-test') => ({ seed, rps, plays: {} });
const add = (m, e) => { m.plays['p' + String(Object.keys(m.plays).length).padStart(5, '0')] = e; };
const plain = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
function test(name, f) { f(); n++; console.log('  ok ' + name); }

test('same seed deals the same word and ten unique cards per player, after RPS', () => {
  const m = game(), before = JSON.stringify(m), s = S.slState(m);
  assert.equal(s.turn, 'host'); assert.equal(s.word.length, 4);
  assert.equal(s.hands.host.length, 10); assert.equal(s.hands.guest.length, 10);
  assert.equal(new Set([...s.hands.host, ...s.hands.guest]).size, 20);
  assert.deepEqual(plain(s), plain(S.slState(m))); assert.equal(JSON.stringify(m), before);
  assert.equal(S.slState({ ...m, rps: {} }).turn, null);
  assert.notDeepEqual(plain(s.hands), plain(S.slState(game('other')).hands));
});

test('legal substitutions spend one owned card, switch turns and leave old state immutable', () => {
  const m = game(), s = S.slState(m), e = S.slOptions(s, s.turn)[0];
  assert.ok(e); assert.equal(S.slError(s, e), ''); add(m, e);
  const t = S.slState(m); assert.equal(t.hands.host.length, 9); assert.equal(s.hands.host.length, 10);
  assert.equal(t.turn, 'guest'); assert.equal(t.log.length, 1); assert.notEqual(t.word, s.word);
  assert.equal([...t.word].filter((c, i) => c !== s.word[i]).length, 1);
});

test('out of turn, unowned, unchanged, non-word and malformed cards are refused', () => {
  const s = S.slState(game()), e = S.slOptions(s, s.turn)[0];
  assert.ok(S.slError(s, { ...e, by: 'guest' }));
  assert.ok(S.slError(s, { ...e, id: s.hands.guest[0] }));
  for (const bad of [null, {}, { ...e, pos: -1 }, { ...e, pos: 4 }, { ...e, letter: 'AA' }, { ...e, letter: '?' }, { ...e, id: 999 }]) assert.ok(S.slError(s, bad));
  assert.ok(S.slError(s, { ...e, letter: s.word[e.pos] }));
  let bad;
  for (const id of s.hands.host) for (const letter of S.SL_CARDS[id]) for (let pos = 0; pos < 4; pos++) {
    const x = { k: 'play', by: 'host', id, letter, pos }; if (S.slError(s, x).includes('isn’t a word')) bad = x;
  }
  assert.ok(bad);
  assert.ok(S.slError(s, { by: 'host', k: 'pass' }).includes('can still play'));
});

test('both card sides and blank letters can be played', () => {
  const base = S.slState(game());
  for (const [face, pos, letter, word] of [['AE', 3, 'E', 'CATS'], ['*', 0, 'B', 'CATS']]) {
    const id = S.SL_CARDS.findIndex((c) => c === face);
    assert.ok(id >= 0);
    const s = { ...base, word, hands: { host: [id], guest: base.hands.guest } };
    assert.equal(S.slError(s, { k: 'play', by: 'host', id, pos, letter }), '');
  }
});

test('complete seeded games cover empty hands, blocked wins, draws and pass resets', () => {
  const reasons = new Set(); let reset = false;
  for (let seed = 0; seed < 100; seed++) {
    const m = game(String(seed)); let prev;
    for (let i = 0; i < 25; i++) {
      const s = S.slState(m);
      if (prev?.passes === 1 && s.log.at(-1)?.k === 'play') { assert.equal(s.passes, 0); reset = true; }
      if (s.winner) break;
      const e = S.slOptions(s, s.turn)[0] || { k: 'pass', by: s.turn }; prev = s; add(m, e);
    }
    const end = S.slState(m); assert.ok(end.winner); reasons.add(end.reason === 'empty' ? 'empty' : end.winner === 'draw' ? 'draw' : 'blocked');
    if (end.reason === 'empty') assert.equal(end.hands[end.winner].length, 0);
    else {
      assert.equal(end.passes, 2); assert.equal(S.slOptions(end, 'host').length, 0); assert.equal(S.slOptions(end, 'guest').length, 0);
      if (end.winner === 'draw') assert.equal(end.hands.host.length, end.hands.guest.length);
      else assert.ok(end.hands[end.winner].length < end.hands[end.winner === 'host' ? 'guest' : 'host'].length);
    }
    const stats = S.tableStats({ results: { g: { g: 'sl', w: end.winner } } }, [{ ...m, id: 'g', game: 'sl' }]);
    assert.equal(stats.played.sl, 1); assert.equal(stats.sl.host.cards + stats.sl.guest.cards, end.log.filter((e) => e.k === 'play').length);
    assert.equal(stats.sl.host.passes + stats.sl.guest.passes, end.log.filter((e) => e.k === 'pass').length);
    assert.equal(stats.sl.host.blanks + stats.sl.guest.blanks, end.log.filter((e) => e.k === 'play' && S.SL_CARDS[e.id] === '*').length);
    assert.equal(stats.sl.host.wins + stats.sl.guest.wins, end.winner === 'draw' ? 0 : 1);
  }
  assert.deepEqual([...reasons].sort(), ['blocked', 'draw', 'empty']); assert.ok(reset, 'a play after a pass resets the blocked counter');
});

test('invalid log events cannot alter play; finished games ignore later entries', () => {
  const m = game(), start = S.slState(m);
  add(m, { k: 'play', by: 'guest', id: 999, pos: 0, letter: 'Z' }); add(m, null);
  assert.deepEqual(plain(S.slState(m).hands), plain(start.hands));
  let passes = 0;
  for (let i = 0; i < 100; i++) {
    const s = S.slState(m); if (s.winner) break;
    const opts = S.slOptions(s, s.turn), e = opts[0] || { by: s.turn, k: 'pass' };
    if (e.k === 'pass') passes++;
    add(m, e);
  }
  const end = S.slState(m); assert.ok(end.winner, 'finite full game');
  const before = plain(end); add(m, { k: 'pass', by: end.turn }); assert.deepEqual(plain(S.slState(m)), before);
  if (end.reason === 'empty') assert.equal(end.hands[end.winner].length, 0);
  else assert.equal(end.reason, 'blocked');
  assert.equal(end.log.filter((e) => e.k === 'pass').length, passes);
});


// Version 2: one RPS opening play, then both players race and blocked words refresh.
test('race opens with RPS, then either player can make consecutive plays', () => {
  const m = { ...game('race'), slamVersion: 2 };
  let s = S.slState(m); assert.equal(s.race, true); assert.equal(s.opening, true);
  assert.equal(S.slCanAct(s, 'host'), true); assert.equal(S.slCanAct(s, 'guest'), false);
  assert.ok(S.slOptions(s, 'host').length, 'starter always has a legal opener');
  add(m, S.slOptions(s, 'host')[0]); s = S.slState(m);
  assert.equal(s.opening, false); assert.equal(S.slCanAct(s, 'host'), true); assert.equal(S.slCanAct(s, 'guest'), true);
  const again = S.slOptions(s, 'host')[0]; assert.ok(again); assert.equal(S.slError(s, again), '');
  add(m, again); assert.equal(S.slState(m).hands.host.length, 8);
});

test('replacement words permit play for every card in the deck, including blanks', () => {
  for (let id = 0; id < S.SL_CARDS.length; id++) {
    const st = { word: 'CATS', hands: { host: [id], guest: [id] } };
    const w = S.slFreshWord(st, 'rescue:' + id);
    assert.notEqual(w, st.word); assert.equal(w.length, 4);
    assert.ok(S.slOptions({ ...st, word: w }, 'host').length, S.SL_CARDS[id]);
    assert.equal(w, S.slFreshWord(st, 'rescue:' + id), 'both phones choose identically');
  }
});

test('races never end on passes: two different blocked players refresh and keep all cards', () => {
  let refreshes = 0;
  for (let seed = 0; seed < 100; seed++) {
    const m = { ...game('race:' + seed), slamVersion: 2 };
    for (let i = 0; i < 80; i++) {
      const s = S.slState(m); if (s.winner) break;
      const eligible = s.opening ? [s.starter] : ['host', 'guest'];
      const plays = eligible.flatMap((by) => S.slOptions(s, by));
      if (plays.length) {
        add(m, plays[(seed + i) % plays.length]);
        const next = S.slState(m); assert.deepEqual(plain(next.passed), { host: false, guest: false });
      } else {
        assert.equal(s.opening, false);
        add(m, { k: 'pass', by: 'host' });
        const half = S.slState(m); assert.equal(half.passed.host, true);
        assert.ok(S.slError(half, { k: 'pass', by: 'host' }), 'same player cannot pass twice');
        const hands = plain(half.hands);
        add(m, { k: 'pass', by: 'guest' });
        const next = S.slState(m); refreshes++;
        assert.equal(next.winner, null); assert.notEqual(next.word, s.word);
        assert.deepEqual(plain(next.hands), hands); assert.equal(next.refreshes, s.refreshes + 1);
        assert.ok(S.slOptions(next, 'host').length + S.slOptions(next, 'guest').length);
      }
    }
    const end = S.slState(m); assert.ok(end.winner); assert.notEqual(end.winner, 'draw');
    assert.equal(end.reason, 'empty'); assert.equal(end.hands[end.winner].length, 0);
    const before = plain(end); add(m, { k: 'pass', by: end.winner }); assert.deepEqual(plain(S.slState(m)), before);
  }
  assert.ok(refreshes > 0, 'exercise real blocked positions');
});

test('a changed word clears a single player’s stuck declaration', () => {
  let exercised = false;
  for (let seed = 0; seed < 30 && !exercised; seed++) {
    const m = { ...game('single-pass:' + seed), slamVersion: 2 };
    for (let i = 0; i < 25; i++) {
      const s = S.slState(m); if (s.winner) break;
      const h = S.slOptions(s, 'host'), g = S.slOptions(s, 'guest');
      if (!s.opening && !h.length && g.length) {
        add(m, { k: 'pass', by: 'host' }); assert.equal(S.slState(m).passed.host, true);
        add(m, g[0]); assert.deepEqual(plain(S.slState(m).passed), { host: false, guest: false });
        exercised = true; break;
      }
      const e = h[0] || g[0]; if (!e) break; add(m, e);
    }
  }
  assert.ok(exercised);
});

console.log(`${n} Word Slam tests passed.`);
