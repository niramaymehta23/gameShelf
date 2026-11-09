import assert from 'node:assert/strict';
import { load } from './load.mjs';
// Otto at Word Wheel (the bottom of public/js/wordwheel.js): the words he picks, his pace on each
// level, the wheel he spins, and that he stops once the race is won. Run with a seeded rng and a
// pretend clock, so it's the same every time.
const extra = {
  matchMedia: () => ({ matches: false }),
  G: { code: 'ABCD', table: { results: {} } },
  Pref: { get: () => null, set: () => {} },
  botBetween: (rng, lo, hi) => lo + (hi - lo) * rng(),
};
const W = load(['rps.js', 'hues.js', 'wheels.js', 'wordwheel.js'], ['wwState', 'wwBotWord', 'wwBotGap', 'wwBot', 'wwPick', 'WW_WHEELS', 'WW_BOT_GAP', 'WW_TO'], extra);
let n = 0;
const test = async (title, fn) => { await fn(); console.log('  ok ' + title); n++; };

function rng(seed) {
  let a = 0x9e3779b9 ^ seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const GUEST_STARTS = { r1: { host: 'rock', guest: 'paper' }, r2: { host: 'rock', guest: 'paper' } };
const HOST_STARTS = { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } };
const finds = (list) => Object.fromEntries(list.map(([by, w], i) => ['f' + String(i).padStart(3, '0'), { by, w }]));
const game = (wheel, list = [], rps = GUEST_STARTS) => ({ id: 'x', game: 'ww', rps, ww: { by: rps === GUEST_STARTS ? 'guest' : 'host', n: wheel }, finds: finds(list) });

// A pretend ctx: timers run on a pretend clock, and tx applies the patch to the document at once.
function fakeCtx(doc, { level = 'hard', seed = 1, seat = 'guest', phase = 'ww' } = {}) {
  let t = 0; const timers = [];
  const ctx = {
    seat, opp: seat === 'host' ? 'guest' : 'host', level, hard: level === 'hard', rng: rng(seed),
    now: () => t, ready: () => true, phase: () => phase, m: () => doc.m,
    later(ms, fn) { const x = { at: t + ms, fn }; timers.push(x); return x; },
    clear(x) { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); },
    plan(key, ms, fn) { ctx.later(ms, () => fn(doc.m)); },
    claims: [], chosen: null,
    async tx(fn) {
      const patch = fn(doc.m); if (!patch) return false;
      for (const k in patch) { const f = k.split('.')[1]; doc.m = { ...doc.m, finds: { ...doc.m.finds, [f]: patch[k] } }; ctx.claims.push({ at: t, ...patch[k] }); }
      return true;
    },
    choose(field, value) { ctx.chosen = { field, value }; doc.m = { ...doc.m, [field]: value }; return Promise.resolve(true); },
  };
  // run the pretend clock forward, firing timers (and letting promises settle) as it goes
  ctx.run = async (until) => {
    while (true) {
      timers.sort((a, b) => a.at - b.at);
      const x = timers[0];
      if (!x || x.at > until) { t = until; return; }
      timers.shift(); t = x.at; x.fn();
      await Promise.resolve(); await Promise.resolve();
    }
  };
  return ctx;
}

await test('every word Otto picks is on the wheel, and never one he already has', () => {
  for (let wheel = 0; wheel < W.WW_WHEELS.length; wheel += 7) {
    for (const level of ['easy', 'hard']) {
      const r = rng(wheel * 10 + (level === 'hard' ? 1 : 0));
      let st = W.wwState(game(wheel));
      const mine = [];
      for (let i = 0; i < 12; i++) {
        const w = W.wwBotWord(st, 'guest', level, r);
        assert.ok(st.wheel.set.has(w), `${w} on wheel ${wheel}`);
        assert.ok(!mine.includes(w), `${w} found twice`);
        if (level === 'easy') assert.ok(w.length <= 6 || !st.wheel.words.slice(0, Math.max(10, Math.ceil(st.wheel.words.length * 0.4))).some((x) => x.length <= 6 && !mine.includes(x)));
        mine.push(w);
        st.found.guest = new Set(mine);
      }
    }
  }
});

await test('Easy leans on everyday words; Hard reaches further down the list', () => {
  const rank = (level) => {
    const r = rng(level === 'hard' ? 7 : 8); let sum = 0, k = 0;
    for (let wheel = 0; wheel < W.WW_WHEELS.length; wheel++) {
      const st = W.wwState(game(wheel));
      for (let i = 0; i < 5; i++) { const w = W.wwBotWord(st, 'guest', level, r); sum += st.wheel.words.indexOf(w) / st.wheel.words.length; k++; }
    }
    return sum / k;
  };
  const easy = rank('easy'), hard = rank('hard');
  assert.ok(easy < 0.15, 'easy mean rank ' + easy);
  assert.ok(hard > easy, `hard ${hard} > easy ${easy}`);
});

await test('the pace stays in range for each level', () => {
  const r = rng(3);
  for (const level of ['easy', 'hard']) {
    const [lo, hi] = W.WW_BOT_GAP[level];
    for (let i = 0; i < 500; i++) { const g = W.wwBotGap(level, r); assert.ok(g >= lo && g <= hi); }
  }
  assert.ok(W.WW_BOT_GAP.hard[1] <= W.WW_BOT_GAP.easy[0] + 1, 'Hard is quicker than Easy');
});

await test('in a race, Otto claims words at his pace until he has five, then stops', async () => {
  for (const level of ['easy', 'hard']) {
    const doc = { m: game(11) };
    const ctx = fakeCtx(doc, { level, seed: level === 'hard' ? 4 : 5 });
    const bot = W.wwBot(ctx);
    bot.update(doc.m);
    await ctx.run(20 * 60 * 1000);
    const st = W.wwState(doc.m);
    assert.equal(st.winner, 'guest');
    assert.equal(ctx.claims.length, W.WW_TO);
    const [lo, hi] = W.WW_BOT_GAP[level];
    let prev = 0;
    for (const c of ctx.claims) { const gap = c.at - prev; assert.ok(gap >= lo && gap <= hi + 1000, `${level} gap ${gap}`); prev = c.at; }
    bot.stop();
  }
});

await test('Otto doesn’t start after the race is won, or claim while you’re not looking', async () => {
  const words = W.WW_WHEELS[2].words.split(' ');
  const done = { m: game(2, words.slice(0, 5).map((w) => ['host', w])) };
  const c1 = fakeCtx(done);
  W.wwBot(c1).update(done.m);
  await c1.run(10 * 60 * 1000);
  assert.equal(c1.claims.length, 0);
  const away = { m: game(2) };
  const c2 = fakeCtx(away, { phase: 'ww-spin' });
  W.wwBot(c2).update(away.m);
  await c2.run(10 * 60 * 1000);
  assert.equal(c2.claims.length, 0);
});

await test('Otto spins the wheel only when he won rock, paper, scissors', async () => {
  const mine = { m: { id: 'x', game: 'ww', rps: GUEST_STARTS, finds: {} } };
  const c1 = fakeCtx(mine);
  W.wwBot(c1).update(mine.m);
  await c1.run(5000);
  assert.deepEqual(JSON.parse(JSON.stringify(c1.chosen)), { field: 'ww', value: { by: 'guest', n: W.wwPick('ABCD', 0, []) } });
  const theirs = { m: { id: 'x', game: 'ww', rps: HOST_STARTS, finds: {} } };
  const c2 = fakeCtx(theirs);
  W.wwBot(c2).update(theirs.m);
  await c2.run(5000);
  assert.equal(c2.chosen, null);
});

console.log(`bot-ww: ${n} passed`);
