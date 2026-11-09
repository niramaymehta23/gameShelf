// End-to-end: one phone sets up a practice table with Otto, the bot, and plays each game on the
// shelf against him. Otto runs on that same phone (bot.js) and writes his moves into the same logs.
//   node tests/e2e/bot.mjs           against emulators you started (npm start)
//   HEADED=1 node tests/e2e/bot.mjs  watch it play
import { twoPhones, URL, sleep, snap, state, until, rpsSettled, junk } from './lib.mjs';

let failures = 0;
function check(cond, label) { console.log(`${cond ? '  ok ' : '  FAIL'}  ${label}`); if (!cond) failures++; }
const gotIt = (p) => p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click();
const sheetBtn = (p, name) => p.locator('#sheet').getByRole('button', { name, exact: true }).click();
const endCard = (p, timeout = 20000) => p.locator('#sheet .panel', { hasText: 'Rematch' }).waitFor({ timeout });

// Opens a game from the shelf at a level, reads past the how-to card, and plays RPS against Otto
// (always Rock: Otto throws at random) until someone has won it. Returns whether you won.
async function open(p, game, level, name) {
  await p.locator('.gbox.' + game).click();
  await sheetBtn(p, 'Play ' + level);
  await p.locator('.howto-card').waitFor({ timeout: 8000 });
  await gotIt(p);
  await p.locator('.choices').waitFor();
  check(await state(p, 'G.match.joined.guest === true && G.match.bot') === level.toLowerCase(), `${name}: Otto is in from the start, at ${level}`);
  for (let i = 0; i < 30 && !(await state(p, '!!rpsState(G.match).starter')); i++) {
    const n = await state(p, 'rpsState(G.match).rounds.length');
    await p.locator('.choices:not(.locked)').waitFor({ timeout: 10000 });
    await p.locator('.choices .hand', { hasText: 'Rock' }).click();
    await until(p, (n) => rpsState(G.match).rounds.length > n, n, 10000);
    await rpsSettled(p);
  }
  const won = await state(p, 'rpsState(G.match).starter === G.seat');
  // the "who goes first" card goes by itself, or with its button
  const go = p.locator('.starter-card .btn');
  if (await go.isVisible().catch(() => false)) await go.click().catch(() => {});
  await until(p, () => G.phase && !['howto', 'rps'].includes(G.phase), null, 10000);
  return won;
}
async function backToShelf(p) {
  await sleep(500); // a sheet that's closing doesn't count
  if (await p.locator('#sheet .panel', { hasText: 'Rematch' }).isVisible().catch(() => false)) await sheetBtn(p, 'Back to the shelf');
  else {
    await p.locator('#bar [aria-label="Back to the shelf"]').click();
    if (await p.locator('#sheet .panel', { hasText: 'Leave this game?' }).waitFor({ timeout: 1500 }).then(() => true, () => false)) await sheetBtn(p, 'Quit the game');
  }
  await p.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(300);
}

const { browser, a, errors } = await twoPhones();
const p = a;
p.setDefaultTimeout(12000);
// Otto and you both send transactions from this one phone (Hues, Word Wheel, Word Slam), so one can
// meet the other's commit: Firestore retries it after an HTTP 400 FAILED_PRECONDITION, which the
// browser logs as a resource error. Only those are let through, and only as many as there were.
let retried = 0;
p.on('response', async (r) => {
  if (r.status() !== 400 || !/\/documents:commit$/.test(r.url())) return;
  try { const body = await r.json(); if (body.error?.status === 'FAILED_PRECONDITION') retried++; } catch (_) {}
});
const realErrors = () => { let n = retried; return errors.filter((e) => !(/status of 400/.test(e) && n-- > 0)); };
try {
  console.log(`\nServer: ${URL}`);
  console.log('A table with Otto');
  await p.goto(URL);
  await p.fill('#nameInput', 'Niramay');
  await p.getByRole('button', { name: 'Play Otto, the bot' }).click();
  await p.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(400);
  check(await state(p, 'G.table.guest.bot === true && G.table.guest.name === "Otto" && G.seat === "host"'), 'Otto sits in the guest seat');
  check(await p.locator('#partnerDot.here').isVisible(), 'Otto shows as here (green dot)');
  check(await state(p, 'getComputedStyle(document.querySelector("#chatBtn")).visibility') === 'hidden', 'no chat button at Otto’s table');
  check((await p.locator('.shelf-note').innerText()).includes('Easy or Hard'), 'the shelf says how to play Otto');
  await snap(p, 'bot-01-shelf');
  await p.locator('.gbox.c4').click();
  await snap(p, 'bot-02-pick-level', 300);
  check(await p.locator('#sheet').getByRole('button', { name: 'Play Hard', exact: true }).isVisible(), 'the game sheet offers Easy and Hard');
  await sheetBtn(p, 'Put it back');
  await sleep(300);

  console.log('Connect Four (Hard)');
  await open(p, 'c4', 'Hard', 'Connect Four');
  await p.locator('.c4-board').waitFor({ timeout: 10000 });
  for (let guard = 0; guard < 30; guard++) {
    const st = await state(p, '(() => { const s = c4State(G.match); return { over: !!(s.winner || s.draw), mine: s.turn === G.seat, full: s.grid[0].map(Boolean) }; })()');
    if (st.over) break;
    if (!st.mine) { await until(p, () => { const s = c4State(G.match); return s.turn === G.seat || s.winner || s.draw; }, null, 15000); continue; }
    const col = [3, 2, 4, 1, 5, 0, 6].find((c) => !st.full[c]);
    const n = await state(p, 'c4State(G.match).moves.length');
    await sleep(200);
    const box = await p.locator('.c4-board').boundingBox();
    const x = box.x + box.width * (col + 0.5) / 7, y = box.y + box.height / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 1, y); await p.mouse.up();
    await until(p, (n) => c4State(G.match).moves.length > n, n, 8000);
    if (guard === 3) await snap(p, 'bot-03-c4', 400);
  }
  await endCard(p);
  check(await state(p, '(() => { const s = c4State(G.match); return !!(s.winner || s.draw); })()'), 'Connect Four plays to the end against Otto');
  check(await state(p, 'Object.keys(G.match.moves).length') > 6, 'Otto dropped discs in turn');
  check(await state(p, 'c4State(G.match).winner') !== 'host', 'Hard Otto beats the middle-column-only player');
  await snap(p, 'bot-04-c4-end', 400);
  // rematch keeps the level
  const firstId = await state(p, 'G.match.id');
  await sheetBtn(p, 'Rematch');
  await until(p, (id) => G.match && G.match.id !== id, firstId, 8000);
  check(await state(p, 'G.match.bot') === 'hard', 'a rematch keeps Hard');
  await p.locator('.howto-card, .choices').first().waitFor({ timeout: 8000 });
  await backToShelf(p);
  const score = (await p.locator('.score-grid').innerText()).replace(/\s+/g, ' ');
  check(/Connect Four 0 1|Connect Four 0 0/.test(score), `the score sheet is you against Otto (${score})`);

  console.log('Battleships (Easy)');
  await open(p, 'bs', 'Easy', 'Battleships');
  await p.locator('.dock').waitFor({ timeout: 10000 });
  await p.locator('.tool', { hasText: 'Shuffle' }).click();
  await p.getByRole('button', { name: 'Lock in my fleet' }).click();
  await p.locator('.seg').waitFor({ timeout: 15000 });
  check(await state(p, '!!G.match.fleets.guest && G.match.fleets.guest.length === 5'), 'Otto hid his fleet');
  const ottoFleet = await state(p, 'G.match.fleets.guest');
  const L = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
  const occ = new Set(); for (const s of ottoFleet) for (let i = 0; i < L[s.id]; i++) occ.add(s.v ? (s.r + i) * 10 + s.c : s.r * 10 + s.c + i);
  const misses = []; for (let k = 0; k < 100; k++) if (!occ.has(k)) misses.push(k);
  // you miss three times; Otto fires back each time
  for (let i = 0; i < 3; i++) {
    await p.waitForFunction(() => /Tap a square/.test(document.querySelector('.bs-status')?.textContent || ''), null, { timeout: 30000 });
    const n = await state(p, 'bsState(G.match).shots.length');
    await p.locator('.seg button').first().click();
    await sleep(700);
    const g = await p.locator('.bs-grid.target').boundingBox(), cw = g.width / 10;
    const k = misses[i * 7], x = g.x + cw * (k % 10 + 0.5), y = g.y + cw * (Math.floor(k / 10) + 0.5);
    await p.mouse.click(x, y); await sleep(120); await p.mouse.click(x, y);
    await until(p, (n) => bsState(G.match).shots.length > n, n, 8000);
    if (i === 1) {
      await until(p, () => !!(Live.partner()?.pres?.aim), null, 15000).catch(() => {});
      await snap(p, 'bot-05-bs-otto-aims');
    }
  }
  await until(p, () => bsState(G.match).shots.filter((s) => s.shooter === 'guest').length >= 3, null, 30000);
  check(true, 'Otto fired back after each miss');
  await backToShelf(p);
  check(await state(p, '!G.table.current && !(G.table.saved || {}).bs'), 'leaving a game with Otto quits it (nothing saved)');

  console.log('Hues (Hard)');
  if (await open(p, 'hu', 'Hard', 'Hues')) {
    await p.locator('[data-rules="custom"]').click();
  }
  await p.locator('.hu').waitFor({ timeout: 15000 });
  // you only ever draw, keep or pass, for a while; then you quit mid-game
  for (let guard = 0; guard < 40; guard++) {
    if (await state(p, '!!huState(G.match).winner')) break;
    if (await p.locator('.hu[data-ready="1"]').isVisible().catch(() => false)) {
      const pot = p.locator('.hue-pot').first();
      if (await pot.isVisible().catch(() => false)) await pot.click();
      else await p.locator('.hu-act').click().catch(() => {});
    }
    if (guard === 6) await snap(p, 'bot-06-hues');
    await sleep(700);
  }
  const ottoPlays = await state(p, 'Object.values(G.match.plays).filter((x) => x.by === "guest" && x.k === "play").length');
  check(ottoPlays >= 3, `Otto plays his cards (${ottoPlays} plays)`);
  check(await state(p, '(() => { const s = huState(G.match); return s.hands.host.length + s.hands.guest.length + s.pile.length + s.discard.length === HUE_DECK.length; })()'), 'every card accounted for');
  await backToShelf(p);

  console.log('Quickfire (Hard)');
  if (await open(p, 'qf', 'Hard', 'Quickfire')) {
    await p.locator('[data-opt="mode:sums"]').click(); await p.locator('[data-opt="op:add"]').click();
    await p.locator('.qf-go').click();
  }
  await p.locator('.qf-card').waitFor({ timeout: 15000 });
  const qs = () => state(p, '(() => { const s = qfState(G.match); const c = s.cur; return { winner: s.winner, cur: c && { key: c.key, phase: c.phase, type: c.type, mine: c.picks && c.picks.host != null, fits: c.fits ? c.fits.slice(0, 1) : null, answer: c.answer, ans: !!(c.ans && c.ans.host) } }; })()');
  const keys = async (s) => { for (const ch of s) await p.locator(`.qf-key[data-key="${ch}"]`).click(); };
  for (let guard = 0; guard < 80; guard++) {
    const s = await qs();
    if (s.winner) break;
    const c = s.cur;
    if (c && c.phase === 'pick' && !c.mine && await p.locator('.qf-result').isHidden().catch(() => true)) {
      if (c.type === 'w') { await p.keyboard.type('S'); await p.keyboard.press('Enter'); } else { await keys('7'); await keys(['ok']); }
    } else if (c && c.phase === 'race' && !c.ans) {
      await sleep(300);
      if (c.type === 'w') await p.keyboard.type(c.fits[0].slice(1, -1));
      else await keys(String(c.answer));
      if (guard < 4) await snap(p, 'bot-08-quickfire', 200);
    }
    await sleep(500);
  }
  await endCard(p, 30000);
  check(await state(p, 'qfState(G.match).winner') === 'host', 'the quick human beats Hard Otto at Quickfire');
  check(await state(p, 'Object.keys(G.match.ans).some((k) => k.endsWith("g"))'), 'Otto answered (or bowed out) on his own clock');
  check(await state(p, 'Object.values(G.match.picks).every((x) => x.guest != null)'), 'Otto picked in secret every round');
  await backToShelf(p);

  console.log('Word Wheel (Hard)');
  if (await open(p, 'ww', 'Hard', 'Word Wheel')) await p.locator('.qf-go').click();
  await p.locator('.ww-wheel, .ww').first().waitFor({ timeout: 15000 });
  await until(p, () => wwState(G.match).found?.guest?.size >= 1, null, 40000);
  check(true, 'Otto finds words on his own');
  await snap(p, 'bot-09-wordwheel', 300);
  for (let i = 0; i < 6 && !(await state(p, '!!wwState(G.match).winner')); i++) {
    const w = await state(p, '(() => { const s = wwState(G.match); const f = s.found[G.seat]; return [...s.wheel.words].find((x) => !f.has(x)); })()');
    const n = await state(p, 'wwState(G.match).found[G.seat].size');
    await p.keyboard.type(w.toLowerCase()); await p.keyboard.press('Enter');
    await until(p, (n) => wwState(G.match).found[G.seat].size > n || !!wwState(G.match).winner, n, 8000);
    await sleep(300);
  }
  await endCard(p);
  check(await state(p, 'wwState(G.match).winner') === 'host', 'five quick words beat Otto to the finish');
  await backToShelf(p);

  console.log('Word Slam (Easy)');
  await open(p, 'sl', 'Easy', 'Word Slam');
  await p.locator('.sl-hand').waitFor({ timeout: 15000 });
  let lastErr = null;
  for (let guard = 0, end = Date.now() + 180000; Date.now() < end; guard++) {
    const s = await state(p, '(() => { const s = slState(G.match); const mine = s.opening ? s.starter === G.seat : true; return { winner: s.winner, mine, options: slOptions(s, G.seat).slice(0, 1), passed: !!s.passed[G.seat] }; })()');
    if (s.winner) break;
    if (!s.mine) { await sleep(500); continue; }
    // once the race is on, give Otto the time to play a card of his own before racing ahead
    if (await state(p, '!slState(G.match).opening && !Object.values(G.match.plays || {}).some((x) => x.by === "guest")')) {
      await until(p, () => Object.values(G.match.plays || {}).some((x) => x.by === 'guest'), null, 20000);
      continue;
    }
    const n = await state(p, 'Object.keys(G.match.plays || {}).length');
    const e = s.options[0];
    try {
      if (!e) { if (!s.passed) await p.locator('.sl-pass').click(); else { await sleep(600); continue; } }
      else {
        if (await p.locator(`[data-card="${e.id}"]`).getAttribute('aria-pressed') !== 'true') await p.locator(`[data-card="${e.id}"]`).tap();
        const shown = await p.locator(`[data-card="${e.id}"] b`).innerText();
        if (shown === '☆' || await state(p, `SL_CARDS[${JSON.stringify(e.id)}] === '*'`)) {
          await p.getByRole('button', { name: 'Choose letter', exact: true }).click();
          await p.locator('.sl-alphabet').getByRole('button', { name: e.letter, exact: true }).click();
          await p.locator('#sheet').waitFor({ state: 'hidden' });
        } else if (shown !== e.letter) await p.getByRole('button', { name: `Flip to ${e.letter}`, exact: true }).click();
        await sleep(150);
        await p.locator('.sl-word button').nth(e.pos).tap();
      }
      await until(p, (n) => Object.keys(G.match.plays || {}).length > n, n, 5000);
    } catch (err) { lastErr = err.message.split('\n')[0]; await p.keyboard.press('Escape').catch(() => {}); await sleep(400); } // Otto changed the word under us: look again
    if (guard === 3) await snap(p, 'bot-10-slam', 200);
  }
  if (!(await state(p, '!!slState(G.match).winner'))) console.log('  slam stalled:', lastErr, JSON.stringify(await state(p, '(() => { const s = slState(G.match); return { word: s.word, hands: s.hands, passed: s.passed, mine: slOptions(s, G.seat).slice(0, 3) }; })()')));
  await endCard(p, 30000);
  check(!!(await state(p, 'slState(G.match).winner')), 'Word Slam plays to the end against Otto');
  check(await state(p, 'Object.values(G.match.plays).some((x) => x.by === "guest")'), 'Otto played cards in the race');
  await backToShelf(p);

  console.log('Sharp Wits (Hard)');
  if (await open(p, 'sw', 'Hard', 'Sharp Wits')) { await p.locator('[data-opt="hunt"]').click(); await p.locator('.qf-go').click(); }
  await p.locator('.sw-giveup').waitFor({ timeout: 15000 });
  await until(p, () => Object.keys(G.match.laps || {}).some((k) => k[0] === 'g'), null, 20000);
  check(true, 'Otto races on his own clock, writing his own laps');
  await snap(p, 'bot-11-sharpwits', 300);
  await p.locator('.sw-giveup').click();
  await sheetBtn(p, 'Give up');
  await endCard(p, 60000);
  check(await state(p, 'swState(G.match).winner') === 'guest', 'giving up hands Otto the race');
  await snap(p, 'bot-12-sharpwits-end', 400);
  await backToShelf(p);

  // the stats sheet works at Otto's table
  await p.locator('.stats-btn').click();
  await snap(p, 'bot-13-stats', 500);
  check((await p.locator('#sheet').innerText()).includes('Otto'), 'All the stats: you against Otto');
  await p.keyboard.press('Escape').catch(() => {});
  await p.locator('#sheet .scrim').click({ position: { x: 10, y: 10 } }).catch(() => {});

  const j = await junk(p);
  check(!j, `no undefined/null/NaN on the page${j ? ` (found ${j})` : ''}`);
} catch (e) {
  console.error(e);
  failures++;
  await snap(p, 'bot-zz-failure').catch(() => {});
  console.log('  state:', await p.evaluate(() => JSON.stringify({ screen: cur.name, phase: G.phase, current: G.table?.current, match: G.match?.id, game: G.match?.game,
    bot: Bot.ctl && { id: Bot.ctl.id, dead: Bot.ctl.dead, timers: Bot.ctl.timers.size, plans: [...Bot.ctl.plans.keys()], impl: !!Bot.ctl.impl }, pres: Bot.pres, vis: document.visibilityState,
    c4: G.match?.game === 'c4' ? (({ turn, moves, winner }) => ({ turn, n: moves.length, winner }))(c4State(G.match)) : null, moves: G.match?.moves })).catch((e) => e.message));
} finally {
  const errs = realErrors();
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await p.evaluate(async () => { const c = G.code; if (c) { closeTable(); try { await Net.doc('tables/' + c).delete(); } catch (e) {} } }).catch(() => {});
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll bot checks passed');
process.exit(failures ? 1 : 0);
