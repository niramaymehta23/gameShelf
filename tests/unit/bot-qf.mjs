import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto's Quickfire (the bottom of public/js/quickfire.js): his setup, secret picks, answers and timing.
const Q = load(['hues.js', 'words.js', 'quickfire.js'],
  ['qfState', 'qfSetup', 'qfLegal', 'qfFits', 'qfBotSetup', 'qfBotPick', 'qfBotPlan', 'qfBotMove', 'QF_LIMIT'],
  { rpsState: (m) => ({ starter: m.starter || 'host' }) });
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };
function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const match = (qf, extra = {}) => ({ id: 't', seed: 'seed', starter: 'guest', qf: { by: 'guest', ...qf }, picks: {}, ans: {}, ...extra });

test('setup: always a complete one the replay accepts; Easy keeps words short', () => {
  for (const level of ['easy', 'hard']) {
    const r = rng(level === 'easy' ? 1 : 2), modes = new Set();
    for (let i = 0; i < 300; i++) {
      const s = Q.qfBotSetup(level, r);
      modes.add(s.mode);
      assert.ok(Q.qfSetup(match(s)), JSON.stringify(s));
      if (level === 'easy' && s.len != null) assert.ok(s.len <= 5);
    }
    assert.equal(modes.size, 3);
  }
});
test('picks: a capital letter for his end of the word, a number in range for sums', () => {
  const r = rng(3);
  for (const op of ['add', 'sub', 'mul']) {
    const setup = Q.qfSetup(match({ mode: 'sums', op }));
    for (let i = 0; i < 300; i++) {
      const v = Q.qfBotPick(setup, 's', 'guest', r);
      assert.ok(Number.isInteger(v) && v >= (op === 'mul' ? 0 : 1) && v <= (op === 'mul' ? 30 : 100), op + ' ' + v);
    }
  }
  const setup = Q.qfSetup(match({ mode: 'words', len: 5, side: 'start' }));
  for (let i = 0; i < 100; i++) {
    assert.match(Q.qfBotPick(setup, 'w', 'guest', r), /^[SCPBTMDRFHGLW]$/, 'the chooser takes the first letter');
    assert.match(Q.qfBotPick(setup, 'w', 'host', r), /^[ESTDYRNLKHP]$/, 'the other one takes the last');
  }
});
test('words: a legal everyday word with the right ends and length, at a believable time', () => {
  for (const level of ['easy', 'hard']) {
    const r = rng(level === 'easy' ? 4 : 5);
    for (const [len, a, z] of [[4, 'S', 'T'], [5, 'C', 'E'], [6, 'P', 'D'], [5, 'B', 'Y']]) {
      const m = match({ mode: 'words', len, side: 'start' });
      m.picks.r001 = { guest: a, host: z };
      const round = Q.qfState(m).cur;
      assert.equal(round.phase, 'race');
      for (let i = 0; i < 100; i++) {
        const p = Q.qfBotPlan(round, level, r);
        assert.ok(p.ms < Q.QF_LIMIT.w);
        if (p.a.pass) { assert.ok(level === 'easy' || !round.fits.length); continue; }
        assert.equal(p.a.w.length, len);
        assert.ok(p.a.w[0] === a && p.a.w[len - 1] === z && Q.qfLegal(p.a.w), p.a.w);
        assert.ok(Q.qfFits(len, a, z).includes(p.a.w), 'an everyday word');
        if (level === 'hard') { assert.ok(p.ms >= 3000 && p.ms <= 13000, p.ms); assert.ok(Q.qfFits(len, a, z).indexOf(p.a.w) < 3, 'one of the commonest'); }
        else assert.ok(p.ms >= 6000 && p.ms <= 22000, p.ms);
      }
    }
  }
});
test('words: Easy sometimes gives up when hardly any word fits, Hard never', () => {
  // find a pair with one to four fits
  let round = null;
  for (const a of 'ABCDEFGHIJKLMNOPRSTUVWY') for (const z of 'ABDEFGHKLMNOPRSTWXY') {
    if (round) break;
    const f = Q.qfFits(5, a, z).length;
    if (f >= 1 && f < 5) { const mm = match({ mode: 'words', len: 5, side: 'start' }); mm.picks.r001 = { guest: a, host: z }; round = Q.qfState(mm).cur; }
  }
  assert.ok(round && round.phase === 'race');
  const passes = (level) => { const r = rng(9); let p = 0; for (let i = 0; i < 400; i++) if (Q.qfBotPlan(round, level, r).a.pass) p++; return p; };
  assert.equal(passes('hard'), 0);
  const e = passes('easy');
  assert.ok(e > 80 && e < 250, 'about 40%: ' + e);
});
test('sums: the right answer, quicker on Hard', () => {
  for (const op of ['add', 'sub', 'mul']) {
    const m = match({ mode: 'sums', op });
    m.picks.r001 = { guest: 27, host: 14 };
    const round = Q.qfState(m).cur;
    const hard = rng(6), easy = rng(7);
    for (let i = 0; i < 200; i++) {
      const h = Q.qfBotPlan(round, 'hard', hard), e = Q.qfBotPlan(round, 'easy', easy);
      assert.equal(h.a.n, round.answer);
      assert.ok(h.ms >= 1500 && h.ms <= 5500, 'hard ' + h.ms);
      if (e.a.pass) assert.ok(op === 'mul' && round.answer > 200);
      else { assert.equal(e.a.n, round.answer); assert.ok(e.ms >= 3000 && e.ms <= 11000, 'easy ' + e.ms); }
    }
  }
});
test('the race: waits for his time, answers, or concedes once your quicker answer is behind him', () => {
  const m = match({ mode: 'sums', op: 'add' });
  m.picks.r001 = { guest: 30, host: 12 };
  let round = Q.qfState(m).cur;
  const plan = { a: { n: 42 }, ms: 4000 };
  assert.equal(Q.qfBotMove(round, plan, 'guest', 3999), null, 'still thinking');
  assert.equal(JSON.stringify(Q.qfBotMove(round, plan, 'guest', 4100)), JSON.stringify({ a: { n: 42 }, ms: 4000 }), 'his own time, not the wall clock'); // (another realm: compare as JSON)
  m.ans.r001h = { n: 42, ms: 2500 };
  round = Q.qfState(m).cur;
  assert.equal(Q.qfBotMove(round, plan, 'guest', 2400), null, 'not before his clock passes yours');
  const out = Q.qfBotMove(round, plan, 'guest', 2600);
  assert.ok(out.a.out && out.ms >= 2500);
  m.ans.r001g = { ...out.a, ms: out.ms };
  const st = Q.qfState(m);
  assert.equal(st.rounds[0].w, 'host', 'you take the round');
  assert.equal(Q.qfBotMove(st.cur, plan, 'guest', 99999), null, 'next round is a pick, not a race');
  // you were slower: he answers at his time and takes it
  const m2 = match({ mode: 'sums', op: 'add' });
  m2.picks.r001 = { guest: 30, host: 12 };
  m2.ans.r001h = { n: 42, ms: 6000 };
  const mv = Q.qfBotMove(Q.qfState(m2).cur, plan, 'guest', 4000);
  m2.ans.r001g = { ...mv.a, ms: mv.ms };
  assert.equal(Q.qfState(m2).rounds[0].w, 'guest');
  // you gave up: he still answers at his own pace; his own pass counts as giving up
  const m3 = match({ mode: 'sums', op: 'add' });
  m3.picks.r001 = { guest: 30, host: 12 };
  m3.ans.r001h = { pass: true, ms: 1000 };
  assert.equal(Q.qfBotMove(Q.qfState(m3).cur, plan, 'guest', 1500), null);
  const p = Q.qfBotMove(Q.qfState(m3).cur, { a: { pass: true }, ms: 3000 }, 'guest', 3000);
  m3.ans.r001g = { ...p.a, ms: p.ms };
  assert.equal(Q.qfState(m3).rounds[0].w, null, 'both gave up: nobody scores');
  assert.equal(Q.qfBotMove(Q.qfState(m3).cur, plan, 'guest', 9999), null);
});
test('a whole game of Otto against Otto ends with a winner', () => {
  for (const level of ['easy', 'hard']) {
    const r = rng(level === 'easy' ? 11 : 12);
    const m = match(Q.qfBotSetup(level, r));
    let guard = 0;
    for (let st = Q.qfState(m); !st.winner && guard < 200; st = Q.qfState(m), guard++) {
      const c = st.cur, setup = st.setup;
      if (c.phase === 'pick') { m.picks[c.key] = { host: Q.qfBotPick(setup, c.type, 'host', r), guest: Q.qfBotPick(setup, c.type, 'guest', r) }; continue; }
      const ph = Q.qfBotPlan(c, level, r), pg = Q.qfBotPlan(c, level, r);
      // the quicker one answers first; the other then moves on his own clock
      const [first, fp, second, sp] = ph.ms <= pg.ms ? ['host', ph, 'guest', pg] : ['guest', pg, 'host', ph];
      const a = Q.qfBotMove(c, fp, first, fp.ms);
      m.ans[c.key + first[0]] = { ...a.a, ms: a.ms };
      const c2 = Q.qfState(m).cur;
      if (c2 && c2.key === c.key) { const b = Q.qfBotMove(c2, sp, second, sp.ms); m.ans[c.key + second[0]] = { ...b.a, ms: b.ms }; }
    }
    assert.ok(Q.qfState(m).winner, level);
  }
});
console.log(`bot-qf: ${n} passed`);
