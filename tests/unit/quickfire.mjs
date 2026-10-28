import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// The Quickfire replay (public/js/quickfire.js) with the real dictionary, outside the browser.
const ctx = vm.createContext({
  clone: (x) => JSON.parse(JSON.stringify(x)), sortedKeys: (o) => Object.keys(o || {}).sort(),
  other: (s) => (s === 'host' ? 'guest' : 'host'), pad3: (n) => String(n).padStart(3, '0'),
  rpsState: (m) => ({ starter: m.starter || 'host' }),
});
for (const f of ['hues.js', 'words.js', 'quickfire.js']) vm.runInContext(fs.readFileSync('public/js/' + f, 'utf8'), ctx);
vm.runInContext('globalThis.Q={qfState,qfSetup,qfLegal,qfFits,qfRoundType}', ctx);
const Q = ctx.Q;
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };
const match = (qf, extra = {}) => ({ id: 't', seed: 'seed', starter: 'host', qf: { by: 'host', ...qf }, picks: {}, ans: {}, ...extra });
const key = (r) => 'r' + String(r).padStart(3, '0');
function pick(m, r, host, guest) { m.picks[key(r)] = { host, guest }; }
function answer(m, r, seat, a) { m.ans[key(r) + seat[0]] = a; }

test('dictionary: legal words, everyday fits, most common first', () => {
  for (const w of ['START', 'SMART', 'CATS', 'PLAYED', 'QUIZ', 'RHYTHM']) assert.ok(Q.qfLegal(w), w);
  for (const w of ['SMIRT', 'ABCD', 'start', 'STAR T']) assert.equal(Q.qfLegal(w), false, w);
  const st = Q.qfFits(5, 'S', 'T');
  assert.ok(st.includes('START') && st.includes('SMART'));
  assert.ok(st.every((w) => Q.qfLegal(w) && w[0] === 'S' && w[4] === 'T'));
  assert.ok(st.indexOf('START') < st.indexOf('SPLIT') || !st.includes('SPLIT'), 'common words come first');
  assert.equal(Q.qfFits(4, 'Q', 'X').length, 0);
});
test('setup: only the RPS winner, and only complete settings', () => {
  assert.ok(Q.qfSetup(match({ mode: 'words', len: 5, side: 'start' })));
  assert.equal(Q.qfSetup(match({ by: 'guest', mode: 'words', len: 5, side: 'start' })), null, 'the loser can’t set it up');
  assert.equal(Q.qfSetup(match({ mode: 'words', len: 7, side: 'start' })), null);
  assert.equal(Q.qfSetup(match({ mode: 'sums', op: 'div' })), null);
  assert.equal(Q.qfSetup(match({ mode: 'mix', len: 4, side: 'end' })), null, 'mixed needs a sum too');
  assert.equal(Q.qfSetup(match({ mode: 'mix', len: 4, side: 'end', op: 'mul' })).to, 10);
  assert.equal(Q.qfSetup(match({ mode: 'sums', op: 'sub' })).to, 5);
});
test('words: the chooser’s letter goes on their end; the quickest right word wins', () => {
  const m = match({ mode: 'words', len: 5, side: 'end' }); // host picks the last letter
  pick(m, 1, 'T', 'S');
  let st = Q.qfState(m);
  assert.equal(st.cur.phase, 'race'); assert.equal(st.cur.first, 'S'); assert.equal(st.cur.last, 'T');
  answer(m, 1, 'guest', { w: 'SMART', ms: 2400 });
  st = Q.qfState(m);
  assert.equal(st.cur.phase, 'race', 'not settled until the host’s phone has had 2.4 s too');
  answer(m, 1, 'host', { w: 'START', ms: 2100 });
  st = Q.qfState(m);
  assert.equal(st.rounds[0].w, 'host', 'host answered later in real time but sooner on their own clock');
  assert.equal(st.score.host, 1);
});
test('the slower phone concedes with out; a wrong word is no answer', () => {
  const m = match({ mode: 'words', len: 5, side: 'start' });
  pick(m, 1, 'S', 'T');
  answer(m, 1, 'host', { w: 'SMIRT', ms: 900 });
  answer(m, 1, 'guest', { w: 'SHIRT', ms: 3000 });
  assert.equal(Q.qfState(m).cur.phase, 'race', 'host’s made-up word doesn’t count, and host hasn’t conceded');
  answer(m, 1, 'host', { out: true, ms: 3050 });
  const st = Q.qfState(m);
  assert.equal(st.rounds[0].w, 'guest'); assert.equal(st.cur.r, 2);
});
test('giving up: the other may still win; both giving up scores nobody', () => {
  const m = match({ mode: 'words', len: 4, side: 'start' });
  pick(m, 1, 'Z', 'O');
  answer(m, 1, 'host', { pass: true, ms: 5000 });
  assert.equal(Q.qfState(m).cur.phase, 'race');
  answer(m, 1, 'guest', { w: 'ZERO', ms: 41000 });
  assert.equal(Q.qfState(m).rounds[0].w, 'guest');
  pick(m, 2, 'B', 'D');
  answer(m, 2, 'host', { pass: true, ms: 60000 }); answer(m, 2, 'guest', { pass: true, ms: 60000 });
  const st = Q.qfState(m);
  assert.equal(st.rounds[1].phase, 'done'); assert.equal(st.rounds[1].w, null); assert.deepEqual({ ...st.score }, { host: 0, guest: 1 });
});
test('a dead heat to the tenth of a millisecond scores nobody', () => {
  const m = match({ mode: 'sums', op: 'add' });
  pick(m, 1, 10, 20);
  answer(m, 1, 'host', { n: 30, ms: 1500.5 }); answer(m, 1, 'guest', { n: 30, ms: 1500.5 });
  const st = Q.qfState(m);
  assert.equal(st.rounds[0].w, null); assert.equal(st.score.host + st.score.guest, 0);
});
test('letters no everyday word fits are dealt again, and don’t count', () => {
  const m = match({ mode: 'words', len: 4, side: 'start' });
  pick(m, 1, 'Q', 'X');
  const st = Q.qfState(m);
  assert.equal(st.rounds[0].phase, 'void'); assert.equal(st.rounds[0].why, 'nofit'); assert.equal(st.cur.r, 2); assert.equal(st.cur.phase, 'pick');
});
test('sums: bigger minus smaller, ranges per sum, answers must be exact', () => {
  const m = match({ mode: 'sums', op: 'sub' });
  pick(m, 1, 24, 67);
  let st = Q.qfState(m);
  assert.equal(st.cur.x, 67); assert.equal(st.cur.y, 24); assert.equal(st.cur.answer, 43);
  answer(m, 1, 'guest', { n: -43, ms: 800 });
  assert.equal(Q.qfState(m).cur.phase, 'race');
  const mul = match({ mode: 'sums', op: 'mul' });
  pick(mul, 1, 31, 4);
  assert.equal(Q.qfState(mul).cur.phase, 'pick', '31 is out of range for multiplying');
  pick(mul, 1, 0, 30);
  st = Q.qfState(mul); assert.equal(st.cur.answer, 0); assert.equal(st.cur.x, 0, 'the chooser’s number comes first');
  const add = match({ mode: 'sums', op: 'add' });
  pick(add, 1, 0, 5);
  assert.equal(Q.qfState(add).cur.phase, 'pick', 'adding starts at 1');
});
test('first to 5 in a single race; first to 10 in Mixed, which deals both kinds from the seed', () => {
  const m = match({ mode: 'sums', op: 'mul' });
  for (let r = 1; r <= 7; r++) { pick(m, r, 3, 4); answer(m, r, 'host', { n: 12, ms: 1000 }); answer(m, r, 'guest', { out: true, ms: 1000 }); }
  let st = Q.qfState(m);
  assert.equal(st.winner, 'host'); assert.equal(st.rounds.length, 5, 'nothing counts after the winning round');
  const mix = match({ mode: 'mix', len: 5, side: 'start', op: 'add' });
  const kinds = Array.from({ length: 40 }, (_, i) => Q.qfRoundType(mix, Q.qfSetup(mix), i + 1));
  assert.ok(kinds.includes('w') && kinds.includes('s'));
  assert.deepEqual(kinds, Array.from({ length: 40 }, (_, i) => Q.qfRoundType({ ...mix }, Q.qfSetup(mix), i + 1)), 'both phones draw the same kinds');
  for (let r = 1; r <= 30; r++) {
    if (kinds[r - 1] === 'w') { pick(mix, r, 'S', 'T'); answer(mix, r, 'guest', { w: 'START', ms: 900 }); }
    else { pick(mix, r, 2, 3); answer(mix, r, 'guest', { n: 5, ms: 900 }); }
    answer(mix, r, 'host', { out: true, ms: 950 });
  }
  st = Q.qfState(mix);
  assert.equal(st.winner, 'guest'); assert.equal(st.score.guest, 10);
});
test('bad picks and broken answers are ignored by the replay', () => {
  const m = match({ mode: 'words', len: 6, side: 'start' });
  m.picks[key(1)] = { host: 'ST', guest: 'e' };
  assert.equal(Q.qfState(m).cur.phase, 'pick');
  pick(m, 1, 'P', 'D');
  answer(m, 1, 'host', { w: 'PLAYED', ms: -5 });
  answer(m, 1, 'guest', { w: 'PLAYED' });
  assert.equal(Q.qfState(m).cur.phase, 'race');
  answer(m, 1, 'guest', { w: 'PLAYED', ms: 4000 }); answer(m, 1, 'host', { out: true, ms: 4100 });
  assert.equal(Q.qfState(m).rounds[0].w, 'guest');
});
console.log(n + ' Quickfire rules tests passed.');
