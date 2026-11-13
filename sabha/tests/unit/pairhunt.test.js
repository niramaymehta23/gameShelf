'use strict';
// Pair Hunt: symbols, groups, codes, scoring, lockouts, the free pool, offline handling, round 2.
const { setup, assert } = require('../harness');
const PH = require('../../server/games/pairhunt');
const { rng } = require('../../server/rng');

let n = 0; const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAILED:', name); throw e; } };

const S = t => t.inst()._state;
const groupOf = (t, pid) => { const st = S(t); const p = st.P[pid]; return p.gid != null ? st.T[p.team].groups.get(p.gid) : null; };
const partnerCode = (t, pid) => { const g = groupOf(t, pid); const o = g.members.find(x => x !== pid); return S(t).P[o].code; };
const groups = (t, team) => [...S(t).T[team].groups.values()];
const symKey = s => s.colour + ' ' + s.shape;

function live(opts = {}, round = 1) {
  const t = setup(opts);
  t.startGame('pairhunt');
  t.startRound();
  if (round === 2) { t.finishRound(); t.startRound(); }
  return t;
}

test('first pairing: everyone online in a group, trio when odd, unique symbols, codes', () => {
  const t = live({ red: 7, blue: 6 });
  const r = groups(t, 'red'), b = groups(t, 'blue');
  assert.deepStrictEqual(r.map(g => g.members.length).sort(), [2, 2, 3]);
  assert.deepStrictEqual(b.map(g => g.members.length).sort(), [2, 2, 2]);
  for (const gs of [r, b]) {
    assert.strictEqual(new Set(gs.map(g => symKey(g.symbol))).size, gs.length);
    const codes = gs.flatMap(g => g.members.map(id => S(t).P[id].code));
    assert.strictEqual(new Set(codes).size, codes.length, 'codes unique in a team');
    for (const c of codes) assert.match(c, /^[1-9][0-9]$/);
  }
  const v = t.view(t.ids.red[0]);
  assert.strictEqual(v.status, 'hunt');
  assert.ok(v.symbol.name === v.symbol.name.toUpperCase() && v.symbol.name.includes(' '));
  assert.ok(v.code);
});

test('confirm a pair: 10 + 5 within 15 s; points to the team; pool and re-pair', () => {
  const t = live({ red: 4, blue: 4 });
  const a = t.ids.red[0];
  const g = groupOf(t, a);
  const b = g.members.find(x => x !== a);
  t.advance(5000);
  t.act(a, { type: 'code', code: partnerCode(t, a) });
  const e = t.room.events.filter(x => x.type === 'pair_confirmed');
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].points, 15);
  assert.deepStrictEqual(e[0].playerIds.sort(), [a, b].sort());
  assert.strictEqual(t.view(a).status, 'matched');
  assert.strictEqual(t.view(t.ids.red[3]).teamPairs, 1);
  // a and b were just partners; the other pair is hunting → they wait
  t.advance(3000);
  assert.strictEqual(t.view(a).status, 'waiting');
  assert.strictEqual(groupOf(t, a), null);
  // other pair confirms after 20 s: +2 bonus, then everyone re-pairs with someone new
  const c = t.ids.red.find(x => x !== a && x !== b);
  t.advance(12000);
  t.act(c, { type: 'code', code: partnerCode(t, c) });
  assert.strictEqual(t.room.events.filter(x => x.type === 'pair_confirmed')[1].points, 12);
  t.advance(2000);
  const ga = groupOf(t, a);
  assert.ok(ga, 'a has a new partner');
  assert.ok(!ga.members.includes(b), 'never the just-previous partner');
  // after 30 s, no bonus
  t.advance(31000);
  t.act(a, { type: 'code', code: partnerCode(t, a) });
  assert.strictEqual(t.room.events.filter(x => x.type === 'pair_confirmed')[2].points, 10);
});

test('wrong codes: 3 s lock, 10 s after three in a row; own code is not a guess', () => {
  const t = live({ red: 2, blue: 2 });
  const a = t.ids.red[0];
  const good = partnerCode(t, a);
  const own = S(t).P[a].code;
  const bad = ['11', '12', '13', '14', '15'].find(c => c !== good && c !== own) ;
  const bads = ['11', '12', '13', '14', '15', '16'].filter(c => c !== good && c !== own);
  t.act(a, { type: 'code', code: own });
  assert.strictEqual(S(t).P[a].lockUntil, 0);
  t.act(a, { type: 'code', code: bads[0] });
  const l1 = S(t).P[a].lockUntil - t.room.now();
  assert.ok(l1 > 2900 && l1 <= 3000, 'locked for 3 s');
  t.act(a, { type: 'code', code: good }); // ignored while locked
  assert.strictEqual(t.room.events.length, 0);
  t.advance(3000);
  t.act(a, { type: 'code', code: bads[1] }); t.advance(3000);
  t.act(a, { type: 'code', code: bads[2] });
  const l3 = S(t).P[a].lockUntil - t.room.now();
  assert.ok(l3 > 9900 && l3 <= 10000, 'third wrong in a row: 10 s');
  assert.ok(t.fx(a).some(f => f.data.kind === 'bad'));
  t.advance(10000);
  t.act(a, { type: 'code', code: good });
  assert.strictEqual(t.room.events.filter(x => x.type === 'pair_confirmed').length, 1);
  assert.ok(bad);
});

test('trio: two of the three must type; 15 points + bonus', () => {
  const t = live({ red: 3, blue: 2 });
  const g = groups(t, 'red')[0];
  assert.strictEqual(g.members.length, 3);
  const [a, b, c] = g.members;
  t.act(a, { type: 'code', code: S(t).P[b].code });
  assert.strictEqual(t.room.events.length, 0);
  assert.strictEqual(t.view(a).typed, true);
  t.act(a, { type: 'code', code: S(t).P[c].code }); // the same person again doesn't count twice
  assert.strictEqual(t.room.events.length, 0);
  t.act(c, { type: 'code', code: S(t).P[a].code });
  const e = t.room.events.find(x => x.type === 'trio_confirmed');
  assert.ok(e); assert.strictEqual(e.points, 20);
  // a team of three, everyone free: they become a trio again rather than waiting forever
  t.advance(2000);
  assert.strictEqual(groups(t, 'red').length, 1);
  assert.strictEqual(groups(t, 'red')[0].members.length, 3);
});

test('a team of two re-pairs (nobody else to wait for)', () => {
  const t = live({ red: 2, blue: 2 });
  const a = t.ids.red[0];
  t.act(a, { type: 'code', code: partnerCode(t, a) });
  t.advance(2000);
  assert.ok(groupOf(t, a));
});

test('offline partner: pair breaks, partner gets a new symbol, comes back into the pool', () => {
  const t = live({ red: 4, blue: 2 });
  const a = t.ids.red[0];
  const b = groupOf(t, a).members.find(x => x !== a);
  const before = t.room.events.length;
  t.offline(b);
  assert.strictEqual(groupOf(t, b), null);
  assert.strictEqual(t.room.events.length, before, 'no points lost or added');
  // a was dropped into the pool; the other pair is hunting, a waits alone (only one free)
  assert.ok(['dropped', 'waiting'].includes(t.view(a).status));
  t.online(b);
  t.advance(500);
  const ga = groupOf(t, a);
  // a and b were never confirmed together, so they may pair again
  assert.ok(ga && ga.members.includes(b));
});

test('trio member drops: the other two carry on as a pair', () => {
  const t = live({ red: 3, blue: 2 });
  const g = groups(t, 'red')[0];
  const [a, b, c] = g.members;
  t.offline(c);
  const g2 = groupOf(t, a);
  assert.deepStrictEqual(g2.members.sort(), [a, b].sort());
  t.act(a, { type: 'code', code: S(t).P[b].code });
  assert.ok(t.room.events.find(x => x.type === 'pair_confirmed'));
});

test('round 2 uses look-alike families only, the same set for both teams', () => {
  const t = live({ red: 10, blue: 8 }, 2);
  const st = S(t);
  const allowed = st.allowed;
  assert.ok(allowed.length >= 7 && allowed.length < 48);
  const fam = (list, x) => list.find(f => f.includes(x));
  const cfs = new Set(allowed.map(s => fam(PH.COLOUR_FAMILIES, s.colour).join()));
  const sfs = new Set(allowed.map(s => fam(PH.SHAPE_FAMILIES, s.shape).join()));
  assert.strictEqual(allowed.length, [...cfs].reduce((s, f) => s + f.split(',').length, 0) * [...sfs].reduce((s, f) => s + f.split(',').length, 0));
  for (const team of ['red', 'blue']) for (const g of groups(t, team)) assert.ok(allowed.some(s => symKey(s) === symKey(g.symbol)));
  assert.ok(t.view(t.ids.red[0]).lookalike);
});

test('both teams get the same symbol sequence when sizes match', () => {
  const t = live({ red: 6, blue: 6 });
  const syms = team => groups(t, team).map(g => symKey(g.symbol));
  assert.deepStrictEqual(syms('red'), syms('blue'));
});

test('normalised round score: raw × 10 ÷ team size', () => {
  const t = live({ red: 4, blue: 2 });
  for (const team of ['red', 'blue']) {
    const a = t.ids[team][0];
    t.act(a, { type: 'code', code: partnerCode(t, a) });
  }
  t.finishRound();
  const r = t.lastResult();
  assert.deepStrictEqual(r.raw, { red: 15, blue: 15 });
  assert.deepStrictEqual(r.score, { red: 38, blue: 75 });
  assert.match(r.lines.red, /^Red found 1 pair, fastest in \d+ seconds?$/);
  assert.strictEqual(r.stats.blue.pairs, 1);
  assert.strictEqual(t.room.stats[t.ids.red[0]].pairhunt.pairs, 1);
});

test('soak: 15 v 14 players finding partners at random for both rounds, with dropouts', () => {
  const t = setup({ red: 15, blue: 14 });
  const r = rng('soak');
  t.startGame('pairhunt');
  for (let round = 1; round <= 2; round++) {
    t.startRound();
    const lastPartner = {};
    let checks = 0;
    while (t.room.phase === 'live') {
      for (const pid of t.all()) {
        if (t.silent.has(pid)) continue;
        const g = groupOf(t, pid);
        if (!g) continue;
        const roll = r.next();
        if (roll < 0.04) t.act(pid, { type: 'code', code: S(t).P[g.members.find(x => x !== pid)].code });
        else if (roll < 0.06) t.act(pid, { type: 'code', code: String(r.int(10, 99)) });
      }
      // invariants: unique symbols & codes per team, nobody in two groups
      for (const team of ['red', 'blue']) {
        const gs = groups(t, team);
        assert.strictEqual(new Set(gs.map(g => symKey(g.symbol))).size, gs.length);
        const members = gs.flatMap(g => g.members);
        assert.strictEqual(new Set(members).size, members.length);
        const codes = members.map(id => S(t).P[id].code);
        assert.strictEqual(new Set(codes).size, codes.length);
        for (const g of gs) {
          if (g.members.length === 2 && !g._seen) {
            g._seen = true;
            const [x, y] = g.members;
            // never re-paired with the partner they just confirmed with (teams here are big)
            assert.ok(lastPartner[x] !== y || lastPartner[y] !== x, 'same partner twice in a row');
          }
        }
      }
      for (const e of t.room.events.filter(e => e.segId === t.room.current.seg.segId && e.type === 'pair_confirmed' && !e._n)) {
        e._n = true; const [x, y] = e.playerIds; lastPartner[x] = y; lastPartner[y] = x;
      }
      if (++checks === 40) t.silent.add(t.ids.red[3]);
      if (checks === 120) t.online(t.ids.red[3]);
      t.advance(500);
      checks++;
    }
    t.advance(3000);
  }
  const ph = t.room.segments.filter(s => s.game === 'pairhunt');
  assert.strictEqual(ph.length, 2);
  for (const s of ph) {
    assert.ok(s.stats.red.pairs > 20, 'lots of pairs found: ' + s.stats.red.pairs);
    const raw = t.room.events.filter(e => e.segId === s.segId && e.team === 'red').reduce((a, e) => a + e.points, 0);
    assert.strictEqual(s.raw.red, raw);
  }
  assert.strictEqual(t.room.phase, 'gameover');
});

test('bot gives plausible actions', () => {
  const r = rng('b');
  assert.strictEqual(PH.bot({ status: 'waiting' }, r), null);
  let got = null; for (let i = 0; i < 20 && !got; i++) got = PH.bot({ status: 'hunt' }, r);
  assert.strictEqual(got.type, 'code'); assert.match(got.code, /^\d\d$/);
});

console.log(`pairhunt: ${n} tests passed`);
