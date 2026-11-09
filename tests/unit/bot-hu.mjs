import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto's Hues choices (the pure functions at the bottom of hues.js): every command he picks must pass
// hueApply, he stacks and picks up penalties properly, names sensible colours, calls Hues, and catches you.
const E = load(['rps.js', 'hues.js'],
  ['huState', 'hueInitial', 'hueApply', 'hueFitsAll', 'hueCanSay', 'hueNeedsNotice', 'HUE_DECK', 'HUE_CALLOUT_MS',
    'huBotTurn', 'huBotColour', 'huBotHuesPlan', 'huBotCatches', 'huBotCatch']);
const D = E.HUE_DECK;
let n = 0, seq = 0;
// the sandbox's arrays aren't this realm's, so compare as JSON
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const test = (title, fn) => { fn(); console.log('  ok ' + title); n++; };
function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const other = (s) => (s === 'host' ? 'guest' : 'host');
const ids = (kind, colour) => D.filter((c) => c.k === kind && (colour === undefined || c.c === colour)).map((c) => c.id);
const num = (colour, value, copy = 0) => D.filter((c) => c.k === 'n' && c.c === colour && c.v === value)[copy].id;
// a match document with RPS already won by `starter`
const match = (seed, rules = 'custom', starter = 'guest') => ({
  id: 'bot' + seed, game: 'hu', seed: 'seed' + seed, hueVersion: 2, hueRules: rules, plays: {},
  rps: starter === 'guest' ? { r1: { host: 'rock', guest: 'paper' }, r2: { host: 'rock', guest: 'paper' } } : { r1: { host: 'paper', guest: 'rock' }, r2: { host: 'paper', guest: 'rock' } },
});
function fixture({ host, guest, colour = 0, top = num(0, 5), rules = 'custom', turn = 'guest' }) {
  const s = E.huState(match(1, rules, turn));
  s.hands = { host: host.slice(), guest: guest.slice() }; s.discard = [top]; s.colour = colour; s.turn = turn;
  s.pile = D.map((c) => c.id).filter((id) => ![...host, ...guest, top].includes(id));
  return s;
}
const apply = (s, cmd, by = s.turn, at = 10000) => E.hueApply(s, { by, at, ...cmd }, 'p' + String(++seq).padStart(5, '0'));
const R = rng(7);

test('whole games, Otto against Otto: every command is legal and every game ends (both levels, both rule sets)', () => {
  let games = 0, moves = 0;
  for (const rules of ['custom', 'official']) for (const [hostLv, guestLv] of [['hard', 'hard'], ['easy', 'easy'], ['hard', 'easy']]) for (let g = 0; g < 40; g++) {
    const r = rng(g * 31 + rules.length), lv = { host: hostLv, guest: guestLv };
    let s = E.huState(match(g, rules, g % 2 ? 'host' : 'guest')), now = 1000, guard = 0;
    while (!s.winner && guard++ < 3000) {
      now += 500;
      // whoever owes a call says it (or not), the player to move catches if they can, then plays
      for (const seat of ['host', 'guest']) if (E.hueCanSay(s, seat) && E.huBotHuesPlan(lv[seat], r) === 'now') s = apply(s, { k: 'hues' }, seat, now);
      const me = s.turn, c = E.huBotCatch(s, me, now);
      if (c && c.k === 'notice' && E.huBotCatches(lv[me], r)) { s = apply(s, c, me, now); now += E.HUE_CALLOUT_MS; s = apply(s, E.huBotCatch(s, me, now), me, now); continue; }
      const cmd = E.huBotTurn(s, me, lv[me], r);
      assert.ok(cmd, 'a move on his turn');
      s = apply(s, cmd, me, now); moves++;
    }
    assert.ok(s.winner, `game ${rules} ${hostLv}/${guestLv} #${g} finished`);
    games++;
  }
  console.log(`       ${games} games, ${moves} turns`);
});
test('Hard beats Easy more often than not', () => {
  let hard = 0;
  for (let g = 0; g < 200; g++) {
    const r = rng(1000 + g), lv = g % 2 ? { host: 'hard', guest: 'easy' } : { host: 'easy', guest: 'hard' };
    let s = E.huState(match(500 + g, 'custom', g % 4 < 2 ? 'host' : 'guest')), now = 0;
    while (!s.winner) {
      now += 500;
      for (const seat of ['host', 'guest']) if (E.hueCanSay(s, seat) && E.huBotHuesPlan(lv[seat], r) === 'now') s = apply(s, { k: 'hues' }, seat, now);
      const me = s.turn, c = E.huBotCatch(s, me, now);
      if (c && c.k === 'notice' && E.huBotCatches(lv[me], r)) { s = apply(s, c, me, now); now += 2000; s = apply(s, E.huBotCatch(s, me, now), me, now); continue; }
      s = apply(s, E.huBotTurn(s, me, lv[me], r), me, now);
    }
    if (lv[s.winner] === 'hard') hard++;
  }
  console.log(`       Hard won ${hard} of 200`);
  assert.ok(hard > 110);
});
test('stacks a +2 on a +2 (keeping the Flood unless you’re nearly out), Floods when that is all he has, picks up when he can’t', () => {
  const p2 = ids('p2', 1)[0], p4 = ids('p4')[0], top = ids('p2', 0)[0], five = [num(0, 1), num(0, 2), num(0, 3), num(1, 6), num(1, 7)];
  let s = fixture({ host: five, guest: [p2, p4, num(2, 3)], top, colour: 0 }); s.penalty = 2;
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'play', ids: [p2] });
  s = fixture({ host: [num(0, 1)], guest: [p2, p4, num(2, 3)], top, colour: 0 }); s.penalty = 2;
  same(E.huBotTurn(s, 'guest', 'hard', R).ids, [p4], 'you’re on one card: make it +6');
  s = fixture({ host: [num(0, 1)], guest: [p4, num(2, 3)], top, colour: 0 }); s.penalty = 2;
  const flood = E.huBotTurn(s, 'guest', 'hard', R);
  assert.equal(flood.k, 'play'); same(flood.ids, [p4]); assert.equal(flood.col, 2, 'names the colour he still holds');
  assert.equal(apply(s, flood).penalty, 6);
  s = fixture({ host: [num(0, 1)], guest: [num(2, 3), num(1, 4)], top, colour: 0 }); s.penalty = 2;
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'draw' });
  assert.equal(apply(s, { k: 'draw' }).hands.guest.length, 4);
});
test('Official-style: always picks up a penalty; one card at a time', () => {
  let s = fixture({ host: [num(0, 1)], guest: [ids('p2', 0)[0], ids('p4')[0]], top: ids('p2', 0)[1], rules: 'official' }); s.penalty = 2;
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'draw' });
  s = fixture({ host: [num(0, 1)], guest: [num(0, 5, 1), num(1, 5), num(2, 5)], rules: 'official' });
  for (let i = 0; i < 20; i++) assert.equal(E.huBotTurn(s, 'guest', i % 2 ? 'easy' : 'hard', R).ids.length, 1);
});
test('Custom: same-number cards go down together, his longest colour last', () => {
  const s = fixture({ host: [num(0, 1)], guest: [num(0, 5, 1), num(1, 5), num(2, 5), num(2, 7), num(2, 8)], colour: 0 });
  const cmd = E.huBotTurn(s, 'guest', 'hard', R);
  assert.equal(cmd.ids.length, 3); assert.equal(D[cmd.ids.at(-1)].c, 2);
  assert.equal(apply(s, cmd).colour, 2);
});
test('after picking up: plays if he can, else passes; a drawn card that fits gets played', () => {
  let s = fixture({ host: [num(0, 1)], guest: [num(3, 9), num(1, 4)], colour: 0 }); s.paid = true;
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'pass' });
  s = fixture({ host: [num(0, 1)], guest: [num(0, 9), num(1, 4)], colour: 0 }); s.paid = true;
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'play', ids: [num(0, 9)] });
  s = fixture({ host: [num(0, 1)], guest: [num(0, 9), num(1, 4)], colour: 0 }); s.drawn = num(0, 9);
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'play', ids: [num(0, 9)] });
  s = fixture({ host: [num(0, 1)], guest: [num(3, 9), num(1, 4)], colour: 0 });
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'draw' });
  assert.equal(E.huBotTurn(s, 'host', 'hard', R), null, 'not his turn');
});
test('Hard keeps a Blend for when nothing else fits, and trades only into a smaller hand', () => {
  const blend = ids('blend')[0], trade = ids('trade')[0];
  let s = fixture({ host: [num(0, 1)], guest: [blend, num(0, 2), num(3, 3)], colour: 0 });
  same(E.huBotTurn(s, 'guest', 'hard', R).ids, [num(0, 2)]);
  s = fixture({ host: [num(0, 1)], guest: [blend, num(3, 3), num(3, 4)], colour: 0 });
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'play', ids: [blend], col: 3 });
  s = fixture({ host: [num(0, 1)], guest: [trade, num(3, 3), num(3, 4), num(2, 6)], colour: 0 });
  const t = E.huBotTurn(s, 'guest', 'hard', R);
  same(t.ids, [trade]); assert.ok(t.col !== 3, 'names a colour the hand he gives away is short of');
  s = fixture({ host: [num(0, 1), num(1, 1), num(1, 2), num(2, 2), num(2, 3)], guest: [trade, num(3, 3), num(3, 4)], colour: 0 });
  same(E.huBotTurn(s, 'guest', 'hard', R), { k: 'draw' }, 'no trade into five cards');
});
test('Easy plays any legal card, never an illegal one', () => {
  for (let i = 0; i < 300; i++) {
    const r = rng(i), s = E.huState(match(i));
    const cmd = E.huBotTurn(s, 'guest', 'easy', r);
    apply(s, cmd);
  }
});
test('Hues: Hard always calls it; Easy forgets about a third of the time, sometimes remembering late', () => {
  for (let i = 0; i < 200; i++) assert.equal(E.huBotHuesPlan('hard', R), 'now');
  const c = { now: 0, late: 0, never: 0 };
  for (let i = 0; i < 4000; i++) c[E.huBotHuesPlan('easy', R)]++;
  const forgot = (c.late + c.never) / 4000;
  assert.ok(forgot > 0.3 && forgot < 0.4, String(forgot)); assert.ok(c.late > 0 && c.never > 0);
  // and the call itself is legal on one card
  const s = fixture({ host: [num(0, 1), num(1, 1)], guest: [num(0, 2), num(3, 4)], colour: 0 });
  const after = apply(s, E.huBotTurn(s, 'guest', 'hard', R));
  assert.ok(E.hueCanSay(after, 'guest'));
  assert.ok(apply(after, { k: 'hues' }, 'guest').said.guest);
});
test('catches you on one card without Hues: notice, then call out once the two seconds are up', () => {
  // you (host) play down to one card without calling; it's Otto's turn
  let s = fixture({ host: [num(0, 1), num(0, 2)], guest: [num(2, 7), num(3, 8)], colour: 0, turn: 'host' });
  s = apply(s, { k: 'play', ids: [num(0, 1)] }, 'host');
  assert.equal(s.turn, 'guest'); assert.ok(s.owes.host);
  const notice = E.huBotCatch(s, 'guest', 20000);
  same(notice, { k: 'notice', one: s.oneKey.host });
  s = apply(s, notice, 'guest', 20000);
  assert.equal(E.huBotCatch(s, 'guest', 21000).k, 'wait', 'locked for two seconds');
  const call = E.huBotCatch(s, 'guest', 22000);
  assert.equal(call.k, 'callout');
  s = apply(s, call, 'guest', 22000);
  assert.equal(s.hands.host.length, 3);
  assert.equal(E.huBotCatch(s, 'guest', 23000), null);
  // nothing to catch once you've called it
  let t = fixture({ host: [num(0, 1), num(0, 2)], guest: [num(2, 7)], colour: 0, turn: 'host' });
  t = apply(t, { k: 'play', ids: [num(0, 1)] }, 'host'); t = apply(t, { k: 'hues' }, 'host');
  assert.equal(E.huBotCatch(t, 'guest', 30000), null);
  // Hard always tries, Easy about half the time
  for (let i = 0; i < 100; i++) assert.ok(E.huBotCatches('hard', R));
  let yes = 0; for (let i = 0; i < 4000; i++) if (E.huBotCatches('easy', R)) yes++;
  assert.ok(yes > 1800 && yes < 2200, String(yes));
});
test('colour for a wild: Hard names his longest colour; with no coloured cards left, any colour', () => {
  const blend = ids('blend')[0];
  const s = fixture({ host: [num(0, 1)], guest: [blend, num(1, 2), num(1, 3), num(2, 4)] });
  for (let i = 0; i < 20; i++) assert.equal(E.huBotColour(s, 'guest', [blend], 'hard', R), 1);
  const lone = fixture({ host: [num(0, 1)], guest: [blend] });
  const seen = new Set(); for (let i = 0; i < 200; i++) seen.add(E.huBotColour(lone, 'guest', [blend], 'hard', R));
  assert.equal(seen.size, 4);
});
console.log(`${n} Otto Hues tests passed`);
