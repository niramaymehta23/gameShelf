// Hues on two phones, set up from fixture match documents: the shelf and help sheets at a short
// screen, table history, the RPS winner choosing the rules, shared shuffles, the inline colour
// picker, Official-style penalties, the two-second call-out lockout, Hues resets and a final
// penalty pickup. Scenarios are found by replaying real seeded games outside the browser.
//   run by npm run test:e2e (or: node tests/e2e/hues-bugs.mjs with npm start running)
import assert from 'node:assert/strict';
import { twoPhones, URL, snap as shot, until as wait, setUpTable } from './lib.mjs';
import { load } from '../unit/load.mjs';

const E = load(['hues.js'], ['hueInitial', 'hueApply', 'hueFits', 'huState', 'HUE_DECK'], { rpsState: () => ({ starter: 'host' }) });
const D = E.HUE_DECK;
const { browser, a, b, errors } = await twoPhones();
const snap = (p, name) => shot(p, name, 450);
const state = (p) => p.evaluate(() => huState(G.match));
const sheet = (p, name) => p.locator('#sheet').getByRole('button', { name, exact: true }).click();
const until = (p, predicate, arg) => wait(p, predicate, arg, 12000);
const ready = (p) => until(p, () => document.querySelector('.hu')?.dataset.ready === '1');
const callBtn = (p, name) => p.locator('.hu-call', { hasText: name });

// Puts a Hues match with these plays on the table (RPS already won by the host, intro and
// how-to already seen) and waits until both phones show it.
async function fixture(seed, plays = {}, rules = 'custom') {
  const id = 'hubug' + Date.now().toString(36);
  await Promise.all([a, b].map((p) => p.evaluate((id) => { Pref.set('intro:' + id, '1'); Pref.set('howto:' + id, '1'); }, id)));
  await a.evaluate(async ({ id, seed, plays, rules }) => {
    await Net.doc(matchPath(id)).set({
      id, game: 'hu', seed, hueVersion: 2, hueRules: rules, created: Date.now(), joined: { host: true, guest: true },
      rps: { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } }, plays,
    });
    await Net.doc('tables/' + G.code).update({ current: id });
  }, { id, seed, plays, rules });
  await Promise.all([a, b].map((p) => until(p, (id) => G.match?.id === id && !!document.querySelector(G.match.hueRules ? '.hu-hand' : '.hu-rules-card'), id)));
  await a.waitForTimeout(250);
}
// runs fn and waits until both phones have one more play in the log
async function command(p, fn) {
  const count = await p.evaluate(() => Object.keys(G.match.plays || {}).length);
  await fn();
  await Promise.all([a, b].map((q) => until(q, (n) => Object.keys(G.match.plays || {}).length > n, count)));
}
async function tapCard(p, id) { await p.locator('.hu-hand .hcard[data-id="' + id + '"]').tap({ position: { x: 12, y: 18 } }); }
async function dragToPile(p, id) {
  const card = await p.locator('.hu-hand .hcard[data-id="' + id + '"]').boundingBox(), pile = await p.locator('.hu-pile').boundingBox();
  await p.mouse.move(card.x + 12, card.y + 18); await p.mouse.down();
  for (let j = 1; j <= 8; j++) await p.mouse.move(card.x + 12 + (pile.x + 20 - card.x - 12) * j / 8, card.y + 18 + (pile.y + 30 - card.y - 18) * j / 8);
  await p.mouse.up();
}
const scrollerSize = (p) => p.locator('#sheet .sheet-content').evaluate((e) => ({ h: e.clientHeight, full: e.scrollHeight }));

// Plays seeded games (any card that fits, coloured before wild) until predicate(state) finds a
// moment; returns the seed and the plays that lead to it.
function findScenario(predicate) {
  for (let i = 0; i < 100; i++) {
    const seed = 'bugs' + i, plays = {};
    let s = E.hueInitial({ id: 'test', seed, hueVersion: 2, hueRules: 'custom' });
    for (let j = 0; j < 350 && !s.winner; j++) {
      const found = predicate(s);
      if (found) return { seed, plays: JSON.parse(JSON.stringify(plays)), s, found };
      const hand = s.hands[s.turn], fits = hand.filter((id) => E.hueFits(s, D[id])).sort((x, y) => Number(D[x].c < 0) - Number(D[y].c < 0));
      let mv;
      if (s.drawn != null) mv = fits.length ? { k: 'play', ids: [s.drawn], col: j % 4 } : { k: 'keep' };
      else if (fits.length) mv = { k: 'play', ids: [fits[0]], col: j % 4 };
      else mv = { k: s.paid ? 'pass' : 'draw' };
      const key = 'p' + String(j).padStart(5, '0');
      plays[key] = { by: s.turn, ...mv };
      s = E.hueApply(s, plays[key], key);
    }
  }
  throw Error('No real shuffled scenario found');
}

try {
  await Promise.all([a, b].map((p) => p.goto(URL)));
  const code = await setUpTable(a, b);
  await a.waitForTimeout(2700);

  // A phone shows three readable games per row; the fourth starts the next row, with the fifth.
  const games = await a.locator('.cubby .gbox').evaluateAll((nodes) => nodes.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, b: r.bottom }; }));
  assert.equal(games.length, 5);
  assert.ok(Math.abs(games[0].b - games[2].b) < 4);
  assert.ok(games[3].y > games[0].y + 80);
  assert.ok(Math.abs(games[3].b - games[4].b) < 4);
  assert.ok(games.every((g) => g.w >= 90));
  await snap(a, 'shelf-01-phone');
  console.log('  ok three readable games per phone row');

  // Both shelf rules and in-game ? share a bounded content scroller with pinned decisions.
  await a.setViewportSize({ width: 390, height: 568 });
  await a.locator('.gbox.hu').click(); await a.locator('#sheet .sheet-content').waitFor(); await a.waitForTimeout(450);
  let dims = await scrollerSize(a);
  assert.ok(dims.full > dims.h);
  const panel = await a.locator('#sheet .panel').boundingBox();
  assert.ok(panel.y >= 0 && panel.y + panel.height <= 569);
  const area = await a.locator('#sheet .sheet-content').boundingBox();
  await a.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await a.mouse.wheel(0, 800); await a.waitForTimeout(150);
  assert.ok(await a.locator('#sheet .sheet-content').evaluate((e) => e.scrollTop) > 0);
  assert.ok(await a.locator('#sheet').getByRole('button', { name: 'Play Hues', exact: true }).isVisible());
  await snap(a, 'bugs-01-shelf-rules-scroll');
  await sheet(a, 'Put it back');

  // Device history remains after leaving/reloading, with partner names and safe rejoin.
  await a.getByRole('button', { name: 'Leave the table', exact: true }).click(); await sheet(a, 'Leave the table');
  await a.locator('.table-history').waitFor();
  assert.ok((await a.locator('.table-history').innerText()).includes('Saharsh'));
  await a.reload(); await a.locator('.table-history').waitFor(); await a.locator('.table-history').scrollIntoViewIfNeeded();
  await snap(a, 'bugs-02-table-history');
  await a.getByRole('button', { name: 'Rejoin table ' + code, exact: true }).click();
  await a.locator('.gbox.hu').waitFor();
  assert.equal(await a.evaluate(() => G.code), code);
  await a.setViewportSize({ width: 390, height: 844 });

  // RPS winner alone chooses; mode cannot be changed by guest or reload.
  await fixture('mode-choice', {}, null);
  assert.ok(await b.locator('[data-rules=custom]').isDisabled());
  await snap(a, 'bugs-03-hues-mode');
  await a.locator('[data-rules=official]').click(); await a.locator('.hu-hand .hcard').first().waitFor();
  assert.equal((await state(b)).rules, 'official');
  assert.equal(await a.locator('.hu-shuffle:visible').count(), 0);
  await b.reload(); await b.locator('.hu').waitFor();
  assert.equal((await state(b)).rules, 'official');
  await a.locator('#bar [aria-label="How to play"]').click(); await a.setViewportSize({ width: 390, height: 568 });
  dims = await scrollerSize(a);
  assert.ok(dims.full > dims.h);
  await snap(a, 'bugs-04-help-scroll');
  await sheet(a, 'Got it'); await a.setViewportSize({ width: 390, height: 844 });
  console.log('  ok scrollable shelf/help rules, local table history and RPS-winner rules choice');

  // Find a real initial wild, shuffle twice, and open its picker by touch double tap.
  let wildSeed, wild;
  for (let i = 0; i < 100; i++) {
    const s = E.hueInitial({ seed: 'wild' + i, hueRules: 'custom' });
    wild = s.hands.host.find((id) => D[id].c < 0);
    if (wild != null) { wildSeed = 'wild' + i; break; }
  }
  await fixture(wildSeed);
  const original = await state(a);
  await command(a, () => a.locator('.hu-shuffle').click()); await ready(a);
  await command(a, () => a.locator('.hu-shuffle').click()); await ready(a);
  assert.ok(await a.locator('.hu-shuffle').isDisabled());
  const shuffled = await state(b);
  assert.equal(shuffled.shuffles.host, 2);
  assert.equal(JSON.stringify(shuffled.hands), JSON.stringify(original.hands));
  assert.notEqual(JSON.stringify(shuffled.pile), JSON.stringify(original.pile));
  await b.locator('.hu-shuffle:not([disabled])').waitFor({ timeout: 6000 }).catch(() => {});
  assert.ok(await b.locator('.hu-shuffle').isEnabled(), 'waiting player can reshuffle between moves (once their shuffle animation ends)');
  await command(b, () => b.locator('.hu-shuffle').click()); await ready(a);

  await tapCard(a, wild); await tapCard(a, wild);
  await a.locator('.hu-colour-picker').waitFor({ state: 'visible' }); await a.waitForTimeout(350);
  assert.ok(await a.locator('.hu-colour-picker').isVisible());
  assert.equal(await a.locator('#sheet:not([hidden])').count(), 0);
  const hb = await a.locator('.hu-hand').boundingBox();
  assert.ok(hb.y < 844 && hb.y + hb.height <= 845, 'hand stays in view');
  await snap(a, 'bugs-05-inline-colour-touch');
  await a.locator('.hu-colour-cancel').click();
  assert.ok(await a.locator('.hu-colour-picker').isHidden());
  assert.ok(await a.locator('.hu-act').isEnabled(), 'cancelling restores normal controls');

  await dragToPile(a, wild);
  await a.locator('.hu-colour-picker').waitFor({ state: 'visible' });
  await snap(a, 'bugs-05-inline-colour-drag');
  await a.locator('.hu-colour-cancel').click();

  await tapCard(a, wild); await tapCard(a, wild);
  await command(a, () => a.locator('.hu-colour-picker').getByRole('button', { name: 'Orange', exact: true }).tap());
  await ready(b);
  await command(b, () => b.locator('.hu-shuffle').click());
  assert.equal((await state(a)).shuffles.guest, 2);
  assert.equal(JSON.stringify((await state(a)).pile), JSON.stringify((await state(b)).pile));
  console.log('  ok twice-per-player shared shuffle, double-tap colour picker stability and visible hand');

  // Official-style penalties really skip on two synchronized phones.
  let officialSeed, penCard;
  for (let i = 0; i < 200; i++) {
    const seed = 'official' + i, s = E.hueInitial({ seed, hueRules: 'official' });
    penCard = s.hands.host.find((id) => D[id].k === 'p2' && E.hueFits(s, D[id]));
    if (penCard != null) { officialSeed = seed; break; }
  }
  await fixture(officialSeed, {}, 'official');
  await tapCard(a, penCard); await tapCard(a, penCard);
  await until(b, () => huState(G.match).penalty === 2);
  const priorHand = (await state(b)).hands.guest.length;
  await command(b, () => b.locator('.hu-act').click());
  assert.equal((await state(a)).turn, 'host');
  assert.equal((await state(b)).hands.guest.length, priorHand + 2);
  assert.equal((await state(b)).paid, false);
  console.log('  ok official-style penalty pickup skips the recipient’s turn');

  // Receiving player's screen starts a two-second disabled-button lockout.
  const episode = findScenario((s) => ['host', 'guest'].find((seat) => s.hands[seat].length === 1 && s.owes[seat] && s.turn !== seat && !s.penalty));
  const victimSeat = episode.found, victim = victimSeat === 'host' ? a : b, caller = victim === a ? b : a;
  await fixture(episode.seed, episode.plays);
  await until(caller, () => !!huState(G.match).callWindow);
  assert.equal(await victim.locator('.hu-catch-countdown:visible').count(), 0);
  assert.equal(await caller.locator('.hu-catch-countdown:visible').count(), 1);
  assert.ok(await callBtn(caller, 'Call out').isDisabled());
  assert.equal((await state(victim)).hands[victimSeat].length, 1);
  await snap(caller, 'bugs-06-callout-timer');
  await command(victim, () => callBtn(victim, 'Hues!').click());
  assert.equal((await state(caller)).callWindow, null);
  await victim.waitForTimeout(2100);
  assert.equal((await state(victim)).hands[victimSeat].length, 1);
  assert.ok(await callBtn(caller, 'Call out').isDisabled());
  // Expiry unlocks the button; it never punishes automatically. A late Hues is still safe.
  await fixture(episode.seed, episode.plays);
  await until(caller, () => !!huState(G.match).callWindow);
  await caller.waitForTimeout(2200);
  assert.equal((await state(victim)).hands[victimSeat].length, 1);
  assert.ok(await callBtn(caller, 'Call out').isEnabled());
  await command(victim, () => callBtn(victim, 'Hues!').click());
  assert.ok(await callBtn(caller, 'Call out').isDisabled());
  // A deliberate call after unlocking pays once, immediately.
  await fixture(episode.seed, episode.plays);
  await until(caller, () => !!huState(G.match).callWindow);
  await callBtn(caller, 'Call out').click();
  await until(victim, (seat) => huState(G.match).hands[seat].length === 3, victimSeat);
  assert.equal((await state(a)).log.filter((x) => x.k === 'callout').length, 1);
  assert.ok(await callBtn(caller, 'Call out').isDisabled());
  assert.ok(await callBtn(victim, 'Hues!').isDisabled());
  console.log('  ok receiver-started two-second lockout, no automatic penalty, early/late Hues and one deliberate catch');

  // Drawing from a declared one-card hand resets Hues, including draw-and-play back to one.
  const drawCase = findScenario((s) => {
    const by = s.turn;
    if (s.hands[by].length !== 1 || s.penalty || s.drawn != null || s.paid) return null;
    const next = s.pile.at(-1);
    if (D[next]?.k !== 'n') return null;
    const after = E.hueApply(s, { by, k: 'draw' }, 'probe');
    return after.drawn === next ? { by, card: next } : null;
  });
  const { by: drawSeat, card: drawnCard } = drawCase.found;
  await fixture(drawCase.seed, drawCase.plays);
  const drawer = drawSeat === 'host' ? a : b;
  await command(drawer, () => callBtn(drawer, 'Hues!').click());
  assert.equal((await state(drawer)).said[drawSeat], true);
  await command(drawer, () => drawer.locator('.hu-act').click());
  await until(drawer, (seat) => huState(G.match).hands[seat].length === 2, drawSeat);
  assert.equal((await state(drawer)).said[drawSeat], false);
  assert.ok(await callBtn(drawer, 'Hues!').isDisabled());
  await ready(drawer);
  await tapCard(drawer, drawnCard); await tapCard(drawer, drawnCard);
  await until(drawer, (seat) => huState(G.match).hands[seat].length === 1, drawSeat);
  assert.equal((await state(drawer)).said[drawSeat], false);
  assert.ok(await callBtn(drawer, 'Hues!').isEnabled());
  await command(drawer, () => callBtn(drawer, 'Hues!').click());
  assert.equal((await state(drawer)).said[drawSeat], true);
  console.log('  ok draw resets Hues; drawn-card play back to one requires a new declaration');

  // A last draw card is settled by pickup, not by a new card from that pickup.
  const ending = findScenario((s) => {
    if (s.penalty) return null;
    const by = s.turn, hand = s.hands[by];
    if (hand.length !== 1 || !['p2', 'p4'].includes(D[hand[0]].k) || !E.hueFits(s, D[hand[0]])) return null;
    const next = E.hueApply(s, { by, k: 'play', ids: [hand[0]], col: 0 }, 'ending');
    if (next.hands[next.turn].some((id) => E.hueFits(next, D[id]))) return null;
    return { by, card: hand[0] };
  });
  const finalKey = 'p' + String(Object.keys(ending.plays).length).padStart(5, '0');
  ending.plays[finalKey] = { by: ending.found.by, k: 'play', ids: [ending.found.card], col: 0 };
  await fixture(ending.seed, ending.plays);
  const loser = ending.found.by === 'host' ? b : a;
  await command(loser, () => loser.locator('.hu-act').click());
  await until(a, () => !!huState(G.match).winner);
  assert.equal((await state(a)).winner, ending.found.by);
  assert.equal((await state(b)).winner, ending.found.by);
  await snap(loser, 'bugs-07-final-penalty');
  assert.deepEqual(errors, []);
  console.log('  ok final draw-penalty pickup ends immediately on both phones; no browser errors');
} catch (e) {
  await snap(a, 'bugs-ERR-a').catch(() => {}); await snap(b, 'bugs-ERR-b').catch(() => {});
  console.error(await a.evaluate(() => ({ screen: cur.name, game: G.match?.game, hue: G.match?.game === 'hu' ? huState(G.match) : null })));
  console.error(errors);
  throw e;
} finally { await browser.close(); }
