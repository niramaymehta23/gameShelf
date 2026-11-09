import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto at Word Slam (slBotPlay, slBotDelay in slam.js): legal plays only, the right side of a card,
// blanks as a letter that makes a word, Stuck only when nothing goes, and a pace per level.
const S = load(['rps.js', 'hues.js', 'words.js', 'quickfire.js', 'slam.js'], ['slState', 'slOptions', 'slError', 'slWord', 'SL_CARDS', 'slBotPlay', 'slBotDelay', 'slIsCommon', 'qfLegal']);
function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rps = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } }; // host starts
const add = (m, e) => { m.plays['p' + String(Object.keys(m.plays).length).padStart(5, '0')] = e; };
let n = 0;
function test(name, f) { f(); n++; console.log('  ok ' + name); }

test('every play Otto picks is legal, over whole games at both levels (race and turn-based)', () => {
  let plays = 0, passes = 0, flips = 0, blanks = 0, refreshes = 0;
  for (const level of ['easy', 'hard']) for (const v of [2, 1]) for (let seed = 0; seed < 60; seed++) {
    const r = rng(seed * 7 + (level === 'hard' ? 1 : 0) + v * 1000);
    const m = { seed: `bot:${v}:${level}:${seed}`, rps, plays: {}, slamVersion: v === 2 ? 2 : undefined };
    for (let i = 0; i < 120; i++) {
      const st = S.slState(m); if (st.winner) break;
      // both seats are Otto here; in a race, whoever's turn comes up in the shuffle goes
      const order = r() < 0.5 ? ['host', 'guest'] : ['guest', 'host'];
      const by = order.find((s) => S.slBotPlay(st, s, level, r));
      assert.ok(by, 'someone can always act');
      const e = S.slBotPlay(st, by, level, r);
      assert.equal(S.slError(st, e), '', JSON.stringify(e));
      if (e.k === 'pass') { passes++; assert.equal(S.slOptions(st, by).length, 0, 'Stuck only when nothing goes'); }
      else {
        plays++;
        const card = S.SL_CARDS[e.id];
        if (card === '*') { blanks++; assert.ok(S.qfLegal(S.slWord(st.word, e.pos, e.letter))); }
        else if (e.letter === card[1]) flips++;
        assert.ok(st.hands[by].includes(e.id));
      }
      add(m, e);
      if (S.slState(m).refreshes > st.refreshes) refreshes++;
    }
    assert.ok(S.slState(m).winner, 'a game between two Ottos finishes');
  }
  assert.ok(plays > 1000 && passes > 0 && flips > 50 && blanks > 0 && refreshes > 0, JSON.stringify({ plays, passes, flips, blanks, refreshes }));
});

test('he uses the other side of a card when only that side makes a word', () => {
  const m = { seed: 'flip', rps, plays: {}, slamVersion: 2 };
  const base = S.slState(m);
  const id = S.SL_CARDS.indexOf('AE');
  // a word where only the card's second letter (E) makes a word
  for (const word of ['BELL', 'TENT', 'MATE', 'LATE', 'HAND']) {
    const st = { ...base, word, opening: false, hands: { host: [id], guest: base.hands.guest } };
    const sides = new Set(S.slOptions(st, 'host').map((e) => e.letter));
    if (sides.size !== 1 || !sides.has('E')) continue;
    for (const level of ['easy', 'hard']) {
      const e = S.slBotPlay(st, 'host', level, rng(1));
      assert.equal(e.letter, 'E'); assert.equal(S.slError(st, e), '');
    }
    return;
  }
  // fall back: search the deck for a card/word pair that needs its second side
  for (let cid = 0; cid < S.SL_CARDS.length; cid++) {
    const card = S.SL_CARDS[cid]; if (card === '*') continue;
    for (const word of ['CATS', 'GAME', 'SAND', 'COAT', 'COLD', 'BOAT', 'BAKE', 'RICE']) {
      const st = { ...base, word, opening: false, hands: { host: [cid], guest: base.hands.guest } };
      const opts = S.slOptions(st, 'host');
      if (opts.length && opts.every((e) => e.letter === card[1])) {
        assert.equal(S.slBotPlay(st, 'host', 'hard', rng(2)).letter, card[1]);
        assert.equal(S.slBotPlay(st, 'host', 'easy', rng(3)).letter, card[1]);
        return;
      }
    }
  }
  assert.fail('no flip-side case found');
});

test('a blank becomes a letter that makes a word; Hard keeps blanks back while another card goes', () => {
  const base = S.slState({ seed: 'blank', rps, plays: {}, slamVersion: 2 });
  const blank = S.SL_CARDS.indexOf('*'), ae = S.SL_CARDS.indexOf('AE');
  const only = { ...base, word: 'CATS', opening: false, hands: { host: [blank], guest: base.hands.guest } };
  for (let s = 0; s < 20; s++) {
    const e = S.slBotPlay(only, 'host', s % 2 ? 'hard' : 'easy', rng(s));
    assert.equal(e.id, blank); assert.match(e.letter, /^[A-Z]$/); assert.ok(S.qfLegal(S.slWord('CATS', e.pos, e.letter))); assert.equal(S.slError(only, e), '');
  }
  const both = { ...only, word: 'GAME', hands: { host: [blank, ae], guest: base.hands.guest } };
  assert.ok(S.slOptions(both, 'host').some((e) => e.id === ae));
  for (let s = 0; s < 20; s++) assert.equal(S.slBotPlay(both, 'host', 'hard', rng(s)).id, ae);
});

test('Stuck only when no side of any card makes a word, once per word, and never out of turn', () => {
  let stuck = 0;
  for (let seed = 0; seed < 80; seed++) {
    const r = rng(seed);
    const m = { seed: 'stuck:' + seed, rps, plays: {}, slamVersion: 2 };
    for (let i = 0; i < 60; i++) {
      const st = S.slState(m); if (st.winner) break;
      const h = S.slBotPlay(st, 'host', 'hard', r), g = S.slBotPlay(st, 'guest', 'easy', r);
      if (st.opening) assert.equal(g, null, 'the RPS winner opens');
      for (const [by, e] of [['host', h], ['guest', g]]) {
        if (e?.k === 'pass') { stuck++; assert.equal(S.slOptions(st, by).length, 0); assert.equal(st.passed[by], false); }
        if (!e && !st.opening) assert.ok(st.passed[by] && !S.slOptions(st, by).length);
      }
      add(m, h || g);
    }
  }
  assert.ok(stuck > 0);
  const end = { ...S.slState({ seed: 'x', rps, plays: {}, slamVersion: 2 }), winner: 'host' };
  assert.equal(S.slBotPlay(end, 'guest', 'hard'), null, 'nothing after the game is won');
});

test('Easy prefers everyday words when he has one', () => {
  let saw = 0;
  for (let seed = 0; seed < 40; seed++) {
    const st = { ...S.slState({ seed: 'common:' + seed, rps, plays: {}, slamVersion: 2 }), opening: false };
    const opts = S.slOptions(st, 'guest');
    if (!opts.some((e) => S.slIsCommon(S.slWord(st.word, e.pos, e.letter)))) continue;
    for (let s = 0; s < 5; s++) { const e = S.slBotPlay(st, 'guest', 'easy', rng(seed * 10 + s)); assert.ok(S.slIsCommon(S.slWord(st.word, e.pos, e.letter))); saw++; }
  }
  assert.ok(saw > 20);
});

test('pace: Easy about a card every 6–12 s, Hard every 3–6 s; extra time on a fresh word; a short pause before Stuck', () => {
  const lo = () => 0, hi = () => 0.999999;
  assert.equal(S.slBotDelay('easy', lo), 6000); assert.ok(S.slBotDelay('easy', hi) < 12000 && S.slBotDelay('easy', hi) > 11900);
  assert.equal(S.slBotDelay('hard', lo), 3000); assert.ok(S.slBotDelay('hard', hi) < 6000 && S.slBotDelay('hard', hi) > 5900);
  for (const level of ['easy', 'hard']) {
    assert.ok(S.slBotDelay(level, lo, { fresh: true }) >= S.slBotDelay(level, lo) + 700);
    const s = S.slBotDelay(level, hi, { stuck: true }); assert.ok(s >= 1800 && s <= 5500);
  }
  assert.ok(S.slBotDelay('easy', lo, { obscure: true }) >= 10000, 'Easy takes a long time over an obscure word');
  assert.equal(S.slBotDelay('hard', lo, { obscure: true }), 3000);
  const r = rng(9), xs = Array.from({ length: 500 }, () => S.slBotDelay('hard', r));
  assert.ok(xs.every((x) => x >= 3000 && x < 6000));
});

console.log(`${n} Word Slam bot tests passed.`);
