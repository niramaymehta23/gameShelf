import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
// Golden replay test: builds a few hundred match documents with seeded play (valid moves, junk and
// out-of-turn ones mixed in) and checks that rpsState, c4State, bsState, huState and qfState still
// return exactly what they did when tests/unit/replay-golden.json was written.
//   node tests/unit/replay.mjs           compare against the golden file
//   node tests/unit/replay.mjs --write   rewrite it (only when a replay change is intended)
const GOLDEN = 'tests/unit/replay-golden.json';
const ctx = vm.createContext({
  clone: (x) => JSON.parse(JSON.stringify(x)), sortedKeys: (o) => Object.keys(o || {}).sort(),
  other: (s) => (s === 'host' ? 'guest' : 'host'), pad3: (n) => String(n).padStart(3, '0'),
  matchMedia: () => ({ matches: false }),
});
for (const f of ['rps.js', 'connect4.js', 'battleships.js', 'hues.js', 'words.js', 'quickfire.js']) vm.runInContext(fs.readFileSync('public/js/' + f, 'utf8'), ctx);
vm.runInContext('globalThis.R={rpsState,c4State,bsState,huState,qfState,hueApply,hueFits,HUE_DECK,FLEET,qfFits}', ctx);
const R = ctx.R;

// the test's own generator, so the documents never depend on the code under test
function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const HANDS = ['rock', 'paper', 'scissors'];
const SEATS = ['host', 'guest'];
// stable JSON: Sets become sorted arrays
const stable = (v) => JSON.stringify(v, (k, x) => (x instanceof Set ? [...x].sort((p, q) => p - q) : x));
const hash = (v) => crypto.createHash('sha256').update(stable(v)).digest('hex').slice(0, 16);

function rpsLog(r, { done = true } = {}) {
  const rps = {}; const wins = { host: 0, guest: 0 };
  for (let k = 1; k <= 12; k++) {
    if (!done && r() < 0.25) { if (r() < 0.5) rps['r' + k] = { [pick(r, SEATS)]: pick(r, HANDS) }; break; }
    const h = pick(r, HANDS), g = pick(r, HANDS);
    rps['r' + k] = { host: h, guest: g };
    if (h !== g) { const w = { rock: 'scissors', scissors: 'paper', paper: 'rock' }[h] === g ? 'host' : 'guest'; if (++wins[w] >= 2) break; }
  }
  return rps;
}

const cases = {};
const out = (name, value) => { cases[name] = hash(value); };

// rock, paper, scissors
for (let i = 0; i < 40; i++) {
  const r = rng(100 + i);
  const m = { id: 'rps' + i, rps: rpsLog(r, { done: r() < 0.6 }) };
  if (i % 7 === 0) m.rps.r99 = { host: 'rock', guest: 'paper' };
  out('rps' + i, R.rpsState(m));
}
out('rps-empty', R.rpsState({}));

// Connect Four: random columns, with junk and full columns mixed in
for (let i = 0; i < 40; i++) {
  const r = rng(200 + i);
  const m = { id: 'c4' + i, rps: rpsLog(r), moves: {} };
  const n = Math.floor(r() * 46);
  for (let k = 0; k < n; k++) m.moves['m' + String(k).padStart(3, '0')] = r() < 0.06 ? pick(r, [-1, 7, '3', null, 2.5]) : (i % 5 === 0 ? pick(r, [3, 3, 4]) : Math.floor(r() * 7));
  out('c4-' + i, R.c4State(m));
}

// Battleships: seeded fleets, random shots with repeats and junk
function fleet(r) {
  const ships = [];
  const cells = (s, len) => Array.from({ length: len }, (_, j) => (s.v ? [s.r + j, s.c] : [s.r, s.c + j]));
  for (const f of R.FLEET) {
    for (;;) {
      const v = r() < 0.5, s = { id: f.id, v, r: Math.floor(r() * (10 - (v ? f.len : 1) + 1)), c: Math.floor(r() * (10 - (v ? 1 : f.len) + 1)) };
      const taken = new Set(ships.flatMap((o) => cells(o, R.FLEET.find((x) => x.id === o.id).len)).map(([a, b]) => a * 10 + b));
      if (cells(s, f.len).every(([a, b]) => !taken.has(a * 10 + b))) { ships.push(s); break; }
    }
  }
  return ships;
}
for (let i = 0; i < 40; i++) {
  const r = rng(300 + i);
  const m = { id: 'bs' + i, rps: rpsLog(r), fleets: { host: fleet(r), guest: i % 9 === 0 ? null : fleet(r) }, shots: {} };
  const n = Math.floor(r() * 180);
  for (let k = 0; k < n; k++) m.shots['s' + String(k).padStart(3, '0')] = r() < 0.04 ? pick(r, [null, { r: 10, c: 0 }, { r: '1', c: 2 }]) : { r: Math.floor(r() * 10), c: Math.floor(r() * 10) };
  out('bs-' + i, R.bsState(m));
}

// Hues: plays chosen from the replayed state, plus junk, wrong seats and stray calls
function hueMove(r, s, by) {
  const D = R.HUE_DECK, hand = s.hands[by];
  const fits = hand.filter((id) => R.hueFits(s, D[id]));
  if (r() < 0.08) return pick(r, [{ k: 'hues' }, { k: 'callout' }, { k: 'pass' }, { k: 'keep' }, { k: 'play', ids: [pick(r, hand) ?? 0], col: 1 }, { k: 'nonsense' }]);
  if (s.drawn != null) return r() < 0.7 ? { k: 'play', ids: [s.drawn], col: Math.floor(r() * 4) } : { k: 'keep' };
  if (fits.length && !(s.paid && r() < 0.2)) {
    const first = pick(r, fits), c = D[first];
    const ids = [first, ...(c.k === 'n' && r() < 0.6 ? hand.filter((id) => id !== first && D[id].k === 'n' && D[id].v === c.v) : [])];
    return { k: 'play', ids, col: Math.floor(r() * 4) };
  }
  return { k: s.paid ? 'pass' : 'draw' };
}
// version 1: four-digit keys plus the seat, as saved games have them
for (let i = 0; i < 24; i++) {
  const r = rng(400 + i);
  const m = { id: 'hu1-' + i, seed: 's' + i, rps: rpsLog(r), plays: {} };
  for (let j = 0; j < 260; j++) {
    const s = R.huState(m);
    if (s.winner || !s.starter) break;
    let by = s.turn;
    if (r() < 0.05) by = R.huState(m).turn === 'host' ? 'guest' : 'host';
    let mv = hueMove(r, s, by);
    if (r() < 0.12) { by = pick(r, SEATS); mv = { k: pick(r, ['hues', 'callout']) }; }
    if (mv.k === 'play' && r() < 0.3) { mv = { ...mv, id: mv.ids[0] }; delete mv.ids; }
    m.plays['p' + String(j).padStart(4, '0') + by[0]] = { by, ...mv };
  }
  const full = R.huState(m);
  out('hu1-' + i, full);
  out('hu1-' + i + '-limits', Array.from({ length: full.log.length + 1 }, (_, n) => hash(R.huState(m, n))));
}
// version 2: five-digit keys, Custom and Official-style, with notices, call-outs, shuffles and timestamps
for (let i = 0; i < 24; i++) {
  const r = rng(500 + i);
  const rules = i % 2 ? 'official' : 'custom';
  const m = { id: 'hu2-' + i, seed: 's' + i, hueVersion: 2, hueRules: i % 11 === 5 ? null : rules, rps: rpsLog(r), plays: {} };
  let t = 1000;
  for (let j = 0; j < 260; j++) {
    const s = R.huState(m);
    if (s.winner || !s.starter) break;
    const key = 'p' + String(j).padStart(5, '0');
    t += Math.floor(r() * 3000);
    let cmd;
    const opp = s.turn === 'host' ? 'guest' : 'host';
    const x = r();
    if (x < 0.06) cmd = { by: pick(r, SEATS), k: 'shuffle' };
    else if (x < 0.12) cmd = { by: pick(r, SEATS), k: 'hues' };
    else if (x < 0.2 && s.owes[opp]) cmd = { by: s.turn, k: 'notice', one: s.oneKey[opp] };
    else if (x < 0.4 && s.owes[opp]) { cmd = { by: s.turn, k: 'callout', one: r() < 0.8 ? s.oneKey[opp] : 'p99999' }; if (r() < 0.7) t += 2100; }
    else cmd = { by: r() < 0.04 ? opp : s.turn, ...hueMove(r, s, s.turn) };
    if (cmd.k === 'play' && r() < 0.03) delete cmd.col;
    const at = r() < 0.5 ? t : { seconds: Math.floor(t / 1000), nanoseconds: (t % 1000) * 1e6 };
    m.plays[key] = { ...cmd, at };
  }
  const full = R.huState(m);
  out('hu2-' + i, full);
  out('hu2-' + i + '-limits', Array.from({ length: full.log.length + 1 }, (_, n) => hash(R.huState(m, n))));
}

// Quickfire: every mode, right, wrong, out, pass and dead-heat answers
const LETTERS = 'ABCDEFGHIJKLMNOPRSTW';
for (let i = 0; i < 36; i++) {
  const r = rng(600 + i);
  const mode = pick(r, ['mix', 'words', 'sums']);
  const bad = i % 9 === 4; // a few setups the replay must refuse
  const qf = { by: bad && i % 2 ? 'guest' : 'host', mode, len: bad ? 7 : pick(r, [4, 5, 6]), side: pick(r, ['start', 'end']), op: bad ? 'div' : pick(r, ['add', 'sub', 'mul']) };
  const m = { id: 'qf' + i, seed: 'q' + i, rps: { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'rock', guest: 'scissors' } }, qf, picks: {}, ans: {} };
  for (let k = 1; k <= 40; k++) {
    const st = R.qfState(m);
    if (st.winner || !st.setup || !st.cur) break;
    const key = st.cur.key;
    const type = st.cur.type;
    const val = () => (type === 'w' ? pick(r, LETTERS) : (qf.op === 'mul' ? Math.floor(r() * 31) : 1 + Math.floor(r() * 100)));
    m.picks[key] = { host: val(), guest: r() < 0.03 ? 'x' : val() };
    const st2 = R.qfState(m), cur = st2.cur;
    if (!cur || cur.key !== key || cur.phase !== 'race') continue;
    for (const [s, c] of [['host', 'h'], ['guest', 'g']]) {
      const y = r(), ms = Math.round(r() * 20000 * 10) / 10;
      let a;
      if (y < 0.45) a = cur.type === 'w' ? { w: cur.fits[Math.floor(r() * cur.fits.length)], ms } : { n: cur.answer, ms };
      else if (y < 0.55) a = cur.type === 'w' ? { w: cur.first + 'ZZZZ'.slice(0, cur.len - 2) + cur.last, ms } : { n: cur.answer + 1, ms };
      else if (y < 0.7) a = { out: true, ms };
      else if (y < 0.85) a = { pass: true, ms };
      else if (y < 0.9) a = { n: cur.answer, ms: -1 };
      else continue;
      m.ans[key + c] = a;
    }
    if (i % 6 === 0 && m.ans[key + 'h'] && m.ans[key + 'g']) m.ans[key + 'g'].ms = m.ans[key + 'h'].ms;
    // settle a round left open, except now and then the last one
    if (R.qfState(m).cur?.key === key && r() < 0.9) for (const c of ['h', 'g']) if (!m.ans[key + c] || r() < 0.5) m.ans[key + c] = { pass: true, ms: 60000 };
  }
  out('qf' + i, R.qfState(m));
}
out('qf-nosetup', R.qfState({ id: 'x', seed: 'x', rps: {} }));

if (process.argv.includes('--write')) {
  fs.writeFileSync(GOLDEN, JSON.stringify(cases, null, 1) + '\n');
  console.log(`  wrote ${Object.keys(cases).length} golden replay results`);
} else {
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const bad = Object.keys({ ...want, ...cases }).filter((k) => want[k] !== cases[k]);
  assert.deepEqual(bad, [], 'replay results changed for: ' + bad.join(', '));
  console.log(`  ok ${Object.keys(cases).length} replay results identical to the golden file`);
}
