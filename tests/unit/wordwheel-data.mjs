import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { load } from './load.mjs';
// The Word Wheel wheels (public/js/wheels.js, built by tools/make_wheels.py) checked against the puzzle's
// rules: four or more letters, the centre letter in every word, each wheel letter used at most once,
// no plurals, at least one nine-letter word. Completeness is checked against QF_WORDS, which comes from
// the same ENABLE list: every 4–6-letter word that fits a wheel must be in its list.
const D = load(['words.js', 'wheels.js'], ['QF_WORDS', 'WW_WHEELS']);
let n = 0;
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };

const count = (w) => { const c = {}; for (const ch of w) c[ch] = (c[ch] || 0) + 1; return c; };
const fits = (w, letters) => { const have = count(letters); return [...w].every((ch) => (have[ch] = (have[ch] || 0) - 1) >= 0); };
const qf = new Set();
for (const len of [4, 5, 6]) { const s = D.QF_WORDS[len]; for (let i = 0; i < s.length; i += len) qf.add(s.slice(i, i + len)); }
const wheels = D.WW_WHEELS.map((x) => ({ ...x, letters: x.c + x.o, list: x.words.split(' '), nines: x.nine.split(' ') }));

test('there are 100 wheels of nine capital letters', () => {
  assert.equal(wheels.length, 100);
  for (const x of wheels) { assert.match(x.c, /^[A-Z]$/); assert.match(x.o, /^[A-Z]{8}$/); }
});

test('no two wheels have the same letters', () => {
  const seen = new Set(wheels.map((x) => [...x.letters].sort().join('')));
  assert.equal(seen.size, wheels.length);
});

test('every listed word keeps the rules', () => {
  for (const x of wheels) {
    assert.equal(new Set(x.list).size, x.list.length, `${x.letters}: a word is listed twice`);
    for (const w of x.list) {
      assert.match(w, /^[A-Z]{4,9}$/, `${x.letters}: ${w}`);
      assert.ok(w.includes(x.c), `${x.letters}: ${w} has no ${x.c}`);
      assert.ok(fits(w, x.letters), `${x.letters}: ${w} needs letters the wheel hasn't got`);
      // a plural's singular is a word too: the simple -s ones are caught here
      if (w.endsWith('S') && !w.endsWith('SS')) assert.ok(!qf.has(w.slice(0, -1)) && !x.list.includes(w.slice(0, -1)), `${x.letters}: ${w} is a plural`);
    }
  }
});

test('plurals of short words are out too (CANS, BEDS, WIGS: their singulars are too short to list)', () => {
  const all = new Set(wheels.flatMap((x) => x.list));
  for (const w of ['CANS', 'BEDS', 'WIGS', 'BIDS', 'ACES', 'RIBS', 'BEES', 'CONS', 'CATS', 'DOGS', 'TOES']) assert.ok(!all.has(w), w);
});

test('each wheel has a nine-letter word that uses every letter, and 20 to 80 words', () => {
  for (const x of wheels) {
    assert.ok(x.nines.length >= 1);
    for (const w of x.nines) { assert.equal(w.length, 9); assert.ok(fits(w, x.letters)); assert.ok(x.list.includes(w)); }
    assert.deepEqual(x.nines.sort(), x.list.filter((w) => w.length === 9).sort());
    assert.ok(x.list.length >= 20 && x.list.length <= 80, `${x.letters}: ${x.list.length} words`);
  }
});

test('every 4–6-letter word that fits a wheel is in its list (apart from plurals)', () => {
  for (const x of wheels) {
    const listed = new Set(x.list);
    for (const w of qf) if (w.includes(x.c) && fits(w, x.letters) && !w.endsWith('S')) assert.ok(listed.has(w), `${x.letters}: ${w} is missing`);
  }
});

// A match stores its wheel as an index (match.ww.n), so rebuilding or reordering the wheels would
// change saved and finished games. Rebuild only on purpose (then update this, and only add wheels).
test('the wheels are the ones saved games were played on', () => {
  const print = crypto.createHash('sha256').update(D.WW_WHEELS.map((x) => x.c + x.o + ':' + x.words).join('|')).digest('hex').slice(0, 16);
  assert.equal(print, '7e2c34cb0f46f9a1');
});

console.log(`wordwheel-data: ${n} passed`);
