// Sharp Wits on two phones against the emulators: the RPS winner picks the game, then four races.
//   Number Hunt: a wrong tap holds you up; a reload keeps your progress and your clock; once A has
//     finished, B's phone concedes when its own clock passes A's time.
//   Copycat: the dots play, you tap them back; B clears more levels than A, who taps a wrong dot.
//   Odd One Out: both panels, one and then two changes, a wrong tap; A finishes all ten.
//   True Colours: A gives up after five cards; B wins as soon as B is ahead.
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
  assert.equal(await a.locator('.sw-opt').count(), 4);
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

  // ---- the stats ----
  await b.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click();
  await a.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click().catch(() => {});
  await a.locator('.stats-btn').waitFor();
  await a.locator('.stats-btn').click();
  const sec = a.locator('.stats-sec').filter({ has: a.locator('h3', { hasText: /^Sharp Wits$/ }) });
  await sec.waitFor({ timeout: 8000 });
  const text = await sec.innerText();
  for (const row of ['Fastest Number Hunt', 'Copycat: furthest level', 'Fastest Odd One Out', 'Wrong taps']) assert.ok(text.includes(row), row);
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
