// Sharp Wits on two phones against the emulators: the RPS winner picks the game, then four races.
//   Number Hunt: a wrong tap holds you up; a reload keeps your progress and your clock; once A has
//     finished, B's phone concedes when its own clock passes A's time.
//   Copycat: the dots play, you tap them back; B clears more levels than A, who taps a wrong dot.
//   Odd One Out: both panels, one and then two changes, a wrong tap; A finishes all ten.
//   True Colours: A gives up after five cards; B wins as soon as B is ahead.
//   Then, from ready-made matches (RPS already played): Odd Shade with a wrong tap; Pairs with a
//   mismatch and a reload that keeps the found pairs up; Which Way raced by both; Flashback, where
//   B clears more levels than A.
// Then the stats sheet has a Sharp Wits section. Screens at 390×844 and 320×640.
//   run by npm run test:e2e (or: node tests/e2e/sharpwits.mjs with npm start running)
import assert from 'node:assert/strict';
import { twoPhones, URL, sleep, snap as shot, until, setUpTable, rpsRound, junk } from './lib.mjs';
const { browser, a, b, errors } = await twoPhones();
const snap = (p, name) => shot(p, name, 300);
const ok = (msg) => console.log('  ok ' + msg);
const sw = (p) => p.evaluate(() => { const s = swState(G.match); return { g: s.setup && s.setup.g, winner: s.winner, host: s.run && { ...s.run.host }, guest: s.run && { ...s.run.guest } }; });
const racing = (p) => until(p, () => !!document.querySelector('.sw.racing'), undefined, 10000);
const status = (p) => p.locator('.sw-status').innerText();
const fits = (p) => p.evaluate(() => { const el = document.querySelector('#stage > .screen:not(.leaving)'); return el.scrollHeight - el.clientHeight <= 2 && document.documentElement.scrollWidth <= innerWidth + 1; });
// both phones in, the how-to and RPS played (pa/pb: each phone's two throws), the setup card up
async function openGame(first, second, [pa, pb]) {
  await second.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click(); }
  await rpsRound(a, b, pa[0], pb[0]); await rpsRound(a, b, pa[1], pb[1]);
  await Promise.all([a, b].map((p) => p.locator('.sw-setup').waitFor({ timeout: 10000 })));
}
async function pick(p, game, label) {
  await p.locator(`.sw-opt[data-opt="${game}"]`).click();
  await p.getByRole('button', { name: 'Play ' + label }).click();
  await Promise.all([a, b].map(racing));
}
const endSheets = () => Promise.all([a, b].map((p) => p.locator('#sheet .panel').waitFor({ timeout: 10000 })));
async function rematch(p) {
  await p.locator('#sheet').getByRole('button', { name: 'Rematch' }).click();
}
async function atSmallPhone(p, name) {
  await p.setViewportSize({ width: 320, height: 640 }); await sleep(400);
  assert.ok(await fits(p), name + ' fits at 320×640');
  await snap(p, name + '-320x640');
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  assert.ok(await fits(p), name + ' fits at 390×844');
}
// a match with RPS already won by A and the game picked, opened on both phones
let fixtures = 0;
async function direct(g) {
  for (const p of [a, b]) await p.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click({ timeout: 3000 }).catch(() => {});
  const id = 'swx' + Date.now().toString(36) + fixtures++;
  for (const p of [a, b]) await p.evaluate((id) => { Pref.set('intro:' + id, '1'); Pref.set('howto:' + id, '1'); }, id);
  await a.evaluate(async ({ id, g }) => {
    await Net.doc(matchPath(id)).set({ id, game: 'sw', seed: 'e2e-' + id, by: 'host', created: Date.now(), joined: { host: true, guest: true },
      rps: { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } }, sw: { by: 'host', g }, laps: {} });
    await Net.doc(tablePath()).update({ current: id });
  }, { id, g });
  await Promise.all([a, b].map(racing));
  return id;
}
// tap Number Hunt numbers in order
async function hunt(p, from, to) { for (let k = from; k <= to; k++) await p.locator(`.sw-cell[data-n="${k}"]`).click(); }

try {
  await Promise.all([a, b].map((p) => p.goto(URL)));
  await setUpTable(a, b);
  assert.equal(await a.locator('.cubby .gbox').count(), 7);
  await a.locator('.gbox.sw').scrollIntoViewIfNeeded();
  await snap(a, 'sw-01-shelf');
  ok('Sharp Wits is the seventh game on the shelf');

  // ---- game 1: A wins RPS and picks Number Hunt ----
  await a.locator('.gbox.sw').click(); await a.locator('#sheet').getByRole('button', { name: 'Play Sharp Wits' }).click();
  await openGame(a, b, [['Rock', 'Paper'], ['Scissors', 'Rock']]);
  assert.ok((await b.locator('.sw-setup').innerText()).includes('Niramay won rock, paper, scissors'));
  assert.equal(await b.locator('.sw-opt').count(), 0, 'the loser has nothing to pick');
  assert.equal(await a.locator('.sw-opt').count(), 8);
  await snap(a, 'sw-02-setup');
  await atSmallPhone(a, 'sw-02-setup');
  await pick(a, 'hunt', 'Number Hunt');
  assert.equal((await sw(b)).g, 'hunt');
  assert.ok((await status(a)).includes('Find 1'));
  ok('the RPS winner picked Number Hunt; both phones counted down and started');

  await hunt(b, 1, 2);
  await b.locator('.sw-cell[data-n="9"]').click();
  assert.ok((await status(b)).includes('Not that one'));
  await b.locator('.sw-cell[data-n="3"]').click(); // held up: doesn't count
  await sleep(150);
  assert.equal(await b.evaluate(() => document.querySelectorAll('.sw-cell.done').length), 2, 'a wrong tap holds you up');
  await snap(b, 'sw-03-hunt-wrong');
  await sleep(700);
  await hunt(b, 3, 4);
  await until(b, () => swState(G.match).run.guest.n === 4);
  const before = await b.evaluate(() => +Pref.get('sw-clock:' + G.matchId));
  await b.reload();
  await racing(b);
  assert.equal(await b.evaluate(() => document.querySelectorAll('.sw-cell.done').length), 4, 'progress kept through a reload');
  assert.ok((await status(b)).includes('Find 5'));
  assert.ok(await b.evaluate((t) => +Pref.get('sw-clock:' + G.matchId) >= t, before), 'and the clock carried on, not from zero');
  assert.equal((await sw(b)).guest.x, 1, 'the wrong tap is in the log');
  ok('a wrong tap held B up; a reload kept B’s numbers and clock');

  await hunt(a, 1, 12);
  await snap(a, 'sw-04-hunt');
  await atSmallPhone(a, 'sw-04-hunt');
  await hunt(a, 13, 25);
  await until(a, () => swState(G.match).run.host.end === 'all');
  await endSheets();
  const s1 = await sw(a);
  assert.equal(s1.winner, 'host'); assert.equal(s1.guest.end, 'out', 'B’s phone conceded when its clock passed A’s time');
  assert.ok(s1.guest.t >= s1.host.ms);
  assert.ok((await a.locator('#sheet').innerText()).includes('Sharp! You win'));
  assert.ok((await b.locator('#sheet').innerText()).includes('Niramay wins'));
  assert.ok((await b.locator('#sheet').innerText()).includes('all 25 in'));
  await until(a, () => Object.values(G.table.results || {}).some((r) => r.g === 'sw' && r.w === 'host'));
  await snap(b, 'sw-05-hunt-end');
  for (const p of [a, b]) assert.equal(await junk(p), null);
  ok('A tapped all 25; B conceded on its own clock; both phones agree and it is recorded');

  // ---- game 2: B wins RPS and picks Copycat ----
  await rematch(a);
  await openGame(a, b, [['Rock', 'Scissors'], ['Paper', 'Rock']]);
  await pick(b, 'copy', 'Copycat');
  const seq = await a.evaluate(() => swCopy(G.match).seq);
  assert.deepEqual(seq, await b.evaluate(() => swCopy(G.match).seq), 'the same dots and sequence on both phones');
  await until(a, () => !!document.querySelector('.sw-dot.lit'));
  await snap(a, 'sw-06-copy-watch');
  async function level(p, len, wrongAt = -1) {
    await until(p, (l) => document.querySelector('.sw-status').textContent.includes(`Your turn: ${l} taps`), len, 20000);
    for (let i = 0; i < len; i++) {
      const k = i === wrongAt ? (seq[i] + 1) % 7 : seq[i];
      await p.locator(`.sw-dot[data-i="${k}"]`).click();
      if (i === wrongAt) return;
    }
  }
  const tappedA = await a.evaluate(() => swCopy(G.match).dots.length);
  assert.equal(tappedA, 7);
  await Promise.all([(async () => { await level(b, 3); await level(b, 4); await level(b, 5); })(), (async () => { await level(a, 3); await snap(a, 'sw-07-copy-turn'); await level(a, 4); })()]);
  await atSmallPhone(a, 'sw-07-copy');
  await level(a, 5, 2); // A taps a wrong dot on level 3
  await until(a, () => swState(G.match).run.host.end === 'fail');
  await snap(a, 'sw-08-copy-out');
  await endSheets();
  const s2 = await sw(b);
  assert.equal(s2.winner, 'guest'); assert.equal(s2.host.n, 2); assert.ok(s2.guest.n >= 3);
  assert.ok((await a.locator('#sheet').innerText()).includes('out on level 3 (2 cleared'));
  ok('Copycat: B cleared three levels, A went out on level 3, so B wins');

  // ---- game 3: A picks Odd One Out and spots all ten ----
  await rematch(b);
  // b opened it this time, so a joins
  await a.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click(); }
  await rpsRound(a, b, 'Paper', 'Rock'); await rpsRound(a, b, 'Paper', 'Rock');
  await Promise.all([a, b].map((p) => p.locator('.sw-setup').waitFor({ timeout: 10000 })));
  await pick(a, 'spot', 'Odd One Out');
  for (let i = 0; i < 10; i++) {
    await until(a, (n) => document.querySelectorAll('.sw-panel.p0 .sw-e').length === 7 + n && !document.querySelector('.sw-ring'), i);
    const diffs = await a.evaluate((n) => swSpot(G.match, n).diffs, i);
    if (i === 0) {
      const wrong = await a.evaluate(() => { const p = swSpot(G.match, 0); return p.items.findIndex((_, k) => !p.diffs.some((d) => d.at === k)); });
      await a.locator(`.sw-panel.p1 .sw-e[data-i="${wrong}"]`).click({ force: true });
      assert.ok((await status(a)).includes('Not that one'));
      await a.locator('.sw-cross').waitFor();
      await snap(a, 'sw-09-spot-wrong');
      await sleep(1100);
    }
    for (const [j, d] of diffs.entries()) {
      await a.locator(`.sw-panel.p${d.panel} .sw-e[data-i="${d.at}"]`).click({ force: true });
      if (i === 7 && j === 0) { assert.ok((await status(a)).includes('One more')); await snap(a, 'sw-10-spot-two'); await atSmallPhone(a, 'sw-10-spot'); }
    }
  }
  await endSheets();
  const s3 = await sw(a);
  assert.equal(s3.winner, 'host'); assert.equal(s3.host.n, 10); assert.equal(s3.host.x, 1); assert.equal(s3.guest.end, 'out');
  await snap(a, 'sw-11-spot-end');
  for (const p of [a, b]) assert.equal(await junk(p), null);
  ok('Odd One Out: ten pictures, two changes in the later ones, a wrong tap counted; A wins');

  // ---- game 4: True Colours; A gives up after five, B wins once ahead ----
  await rematch(a);
  await openGame(a, b, [['Rock', 'Rock'], ['Paper', 'Paper']]);
  await pick(b, 'ink', 'True Colours');
  const cards = await a.evaluate(() => swInks(G.match).cards.map((c) => SW_INKS[c.ink].k));
  const ink = async (p, i) => { await until(p, ([n, k]) => document.querySelector('.sw-word').dataset.ink === k && swState({ ...G.match }).run && document.querySelector('.sw-sb .sb-side b').textContent.startsWith(n + '/'), [i, cards[i]]); await p.locator(`.sw-ink-btn[data-c="${cards[i]}"]`).click(); };
  for (let i = 0; i < 5; i++) await ink(a, i);
  await snap(a, 'sw-12-ink');
  await atSmallPhone(a, 'sw-12-ink');
  await a.locator('.sw-giveup').click();
  await a.locator('#sheet').getByRole('button', { name: 'Keep going' }).click();
  await sleep(200);
  assert.equal((await sw(a)).host.end, null, 'Keep going keeps going');
  await a.locator('.sw-giveup').click();
  await a.locator('#sheet').getByRole('button', { name: 'Give up', exact: true }).click();
  await until(b, () => swState(G.match).run.host.end === 'up');
  await b.locator(`.sw-ink-btn:not([data-c="${cards[0]}"])`).first().click();
  for (let i = 0; i < 6; i++) { if (i === 0) await sleep(1000); await ink(b, i); }
  await endSheets();
  const s4 = await sw(b);
  assert.equal(s4.winner, 'guest'); assert.equal(s4.host.n, 5); assert.equal(s4.guest.x, 1);
  assert.ok((await b.locator('#sheet').innerText()).includes('5 of 20, then gave up'));
  await snap(b, 'sw-13-ink-end');
  ok('True Colours: A gave up at five; B won as soon as B passed it');

  // ---- Odd Shade: A plays all fifteen with one wrong tap ----
  await b.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click().catch(() => {});
  await direct('shade');
  for (let i = 0; i < 15; i++) {
    await until(a, (n) => document.querySelector('.sw-sb .sb-side b').textContent === n + '/15' && document.querySelectorAll('.sw-sq').length === swShade(G.match, n).size ** 2, i);
    const odd = await a.evaluate((n) => swShade(G.match, n).odd, i);
    if (i === 9) {
      await a.locator(`.sw-sq[data-i="${odd === 0 ? 1 : 0}"]`).click();
      assert.ok((await status(a)).includes('Not that one'));
      await snap(a, 'sw-15-shade'); await atSmallPhone(a, 'sw-15-shade');
      await sleep(950);
    }
    await a.locator(`.sw-sq[data-i="${odd}"]`).click();
  }
  await endSheets();
  const s5 = await sw(b);
  assert.equal(s5.winner, 'host'); assert.equal(s5.host.n, 15); assert.equal(s5.host.x, 1);
  ok('Odd Shade: fifteen grids up to 6×6, a wrong tap held A up, A wins');

  // ---- Pairs: a mismatch turns back; a reload keeps the found pairs up ----
  await direct('pairs');
  const deck = await a.evaluate(() => swPairs(G.match));
  const at = (k) => deck.flatMap((x, i) => (x === k ? [i] : []));
  const card = (i) => a.locator(`.sw-card[data-i="${i}"]`).click();
  await card(at(0)[0]); await card(at(1)[0]);
  assert.ok((await status(a)).includes('No match'));
  await snap(a, 'sw-16-pairs-miss');
  await until(a, () => !document.querySelector('.sw-card.up'));
  await sleep(150);
  for (const k of [0, 1, 2]) { await card(at(k)[0]); await card(at(k)[1]); }
  await until(a, () => swState(G.match).run.host.n === 3);
  await a.reload(); await racing(a);
  assert.equal(await a.locator('.sw-card.found.up').count(), 6, 'the three pairs found are still up after a reload');
  assert.ok((await status(a)).includes('5 pairs to go'));
  await snap(a, 'sw-17-pairs'); await atSmallPhone(a, 'sw-17-pairs');
  for (const k of [3, 4, 5, 6, 7]) { await card(at(k)[0]); await card(at(k)[1]); }
  await endSheets();
  const s6 = await sw(b);
  assert.equal(s6.winner, 'host'); assert.equal(s6.host.n, 8); assert.equal(s6.host.x, 1);
  ok('Pairs: a mismatch turned back, found pairs survived a reload, A found all eight');

  // ---- Which Way: both race all twenty ----
  await direct('way');
  const rows = await a.evaluate(() => swWays(G.match).map((r) => r.dir));
  const way = async (p, i, wrong = false) => {
    await until(p, ([n, d]) => document.querySelector('.sw-arrows .mid')?.dataset.dir === d && document.querySelector('.sw-sb .sb-side b').textContent === n + '/20', [i, rows[i]]);
    await p.locator(`.sw-way-btn[data-d="${wrong ? (rows[i] === 'l' ? 'r' : 'l') : rows[i]}"]`).click();
  };
  await way(b, 0, true); await sleep(850);
  await snap(b, 'sw-18-way'); await atSmallPhone(b, 'sw-18-way');
  await Promise.all([(async () => { for (let i = 0; i < 20; i++) await way(a, i); })(), (async () => { for (let i = 0; i < 20; i++) await way(b, i).catch(() => {}); })()]);
  await endSheets();
  const s7 = await sw(a);
  assert.ok(s7.winner === 'host' || s7.winner === 'guest');
  const w7 = s7[s7.winner], l7 = s7[s7.winner === 'host' ? 'guest' : 'host'];
  assert.ok(w7.n === 20 && (l7.n < 20 || l7.ms > w7.ms), 'the quicker full run wins');
  assert.equal(s7.guest.x, 1);
  ok(`Which Way: both raced twenty rows; ${s7.winner} was quicker on their own clock`);

  // ---- Flashback: A out on level 3, B clears three ----
  await direct('flash');
  const levels = await a.evaluate(() => swFlash(G.match));
  async function squares(p, level, wrong = false) {
    const want = levels[level - 1];
    await until(p, (l) => document.querySelector('.sw-status').textContent.includes(`Your turn: ${l} squares`), want.length, 20000);
    if (wrong) { const no = [...Array(25).keys()].find((k) => !want.includes(k)); await p.locator(`.sw-tile[data-i="${want[0]}"]`).click(); await p.locator(`.sw-tile[data-i="${no}"]`).click(); return; }
    for (const k of want) await p.locator(`.sw-tile[data-i="${k}"]`).click();
  }
  await until(a, () => !!document.querySelector('.sw-tile.lit'));
  await snap(a, 'sw-19-flash-watch');
  await Promise.all([(async () => { for (const l of [1, 2, 3]) await squares(b, l); })(), (async () => { await squares(a, 1); await squares(a, 2); })()]);
  await atSmallPhone(a, 'sw-19-flash');
  await squares(a, 3, true);
  await until(a, () => swState(G.match).run.host.end === 'fail');
  await snap(a, 'sw-20-flash-out');
  await endSheets();
  const s8 = await sw(a);
  assert.equal(s8.winner, 'guest'); assert.equal(s8.host.n, 2); assert.ok(s8.guest.n >= 3);
  for (const p of [a, b]) assert.equal(await junk(p), null);
  ok('Flashback: A tapped a square that never lit on level 3; B cleared three, so B wins');
  // these weren't opened from the shelf, so put the table back there
  for (const p of [a, b]) await p.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click().catch(() => {});

  // ---- the stats ----
  await a.locator('.stats-btn').waitFor();
  await a.locator('.stats-btn').click();
  const sec = a.locator('.stats-sec').filter({ has: a.locator('h3', { hasText: /^Sharp Wits$/ }) });
  await sec.waitFor({ timeout: 8000 });
  const text = await sec.innerText();
  for (const row of ['Fastest Number Hunt', 'Copycat: furthest level', 'Fastest Odd One Out', 'Fastest Odd Shade', 'Fastest Pairs', 'Fastest Which Way', 'Flashback: furthest level', 'Wrong taps']) assert.ok(text.includes(row), row);
  await sec.scrollIntoViewIfNeeded();
  await snap(a, 'sw-14-stats');
  ok('the stats sheet has a Sharp Wits section');
  assert.deepEqual(errors, []);
  ok('no browser errors');
} catch (e) {
  await snap(a, 'sw-ERR-a').catch(() => {}); await snap(b, 'sw-ERR-b').catch(() => {});
  console.error(await a.evaluate(() => G.match && JSON.stringify({ sw: G.match.sw, laps: G.match.laps })).catch(() => ''));
  console.error(errors);
  throw e;
} finally { await browser.close(); }
