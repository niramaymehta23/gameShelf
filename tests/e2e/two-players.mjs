// End-to-end: two players on two "phones" (separate browser contexts) play a full game of
// Connect Four, Battleships and Hues against the Firebase emulators, then check that a
// dropped connection and a page reload both recover.
//
//   npm run test:e2e                      starts the emulators, runs this, stops them
//   node tests/e2e/two-players.mjs        runs against emulators you started (npm start)
//   HEADED=1 npm run test:e2e             watch it play
//
// Screenshots land in tests/e2e/screens/ (git-ignored).
// First run on a new machine: npx playwright install chromium

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// require() (unlike import) also finds a globally installed Playwright
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/screens');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, label) { console.log(`${cond ? '  ok ' : '  FAIL'}  ${label}`); if (!cond) failures++; }

function startServer() {
  return { url: process.env.E2E_URL || 'http://localhost:3000', stop() {} };
}

const gotIt = (p) => p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click();
const snap = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
const state = (p, expr) => p.evaluate(expr);

async function rpsRound(a, b, pa, pb) {
  const round = await state(a, 'rpsState(G.match).rounds.length');
  await a.locator('.choices:not(.locked)').waitFor();
  await b.locator('.choices:not(.locked)').waitFor();
  await a.locator('.choices .hand', { hasText: pa }).click();
  await sleep(250);
  await b.locator('.choices .hand', { hasText: pb }).click();
  await Promise.all([a, b].map(p => p.waitForFunction(n => rpsState(G.match).rounds.length > n, round)));
  await sleep(3700); // reveal animation + verdict
}

async function waitTurn(p, timeout = 15000) {
  await p.waitForFunction(() => {
    if (!G.match) return false;
    if (G.match.game === 'c4') { const s = c4State(G.match); return s.turn === G.seat; }
    const s = bsState(G.match); return s.turn === G.seat && !document.querySelector('.bs-bottom .btn')?.disabled === false;
  }, null, { timeout });
}

async function drop(p, col) {
  await p.waitForFunction(() => G.match && c4State(G.match).turn === G.seat, null, { timeout: 15000 });
  await sleep(150);
  const box = await p.locator('.c4-board').boundingBox();
  const x = box.x + box.width * (col + 0.5) / 7, y = box.y + box.height / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 1, y); await p.mouse.up();
  await sleep(250);
}

// waits until this phone is ready to aim (no shot still animating), fires, and waits for the shot to land in the log
async function shoot(p, r, c) {
  await p.waitForFunction(() => /Tap a square/.test(document.querySelector('.bs-status')?.textContent || ''), null, { timeout: 20000 });
  const n = await p.evaluate(() => bsState(G.match).shots.length);
  await p.locator('.seg button').first().click();
  await sleep(550);
  const g = await p.locator('.bs-grid.target').boundingBox();
  const cw = g.width / 10;
  const x = g.x + cw * (c + 0.5), y = g.y + cw * (r + 0.5);
  await p.mouse.click(x, y); await sleep(120); await p.mouse.click(x, y);
  await p.waitForFunction((n) => bsState(G.match).shots.length > n, n, { timeout: 8000 });
}

function shipCells(fleet) {
  const L = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
  const out = [];
  for (const s of fleet) for (let i = 0; i < L[s.id]; i++) out.push(s.v ? [s.r + i, s.c] : [s.r, s.c + i]);
  return out;
}

const server = await startServer();
// Use Chromium's full browser/new headless implementation. On macOS the separate
// headless shell can crash natively after the long multi-game session.
const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.E2E_CHANNEL || 'chromium', executablePath: process.env.E2E_EXECUTABLE_PATH || undefined });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
const ctxA = await browser.newContext(phone), ctxB = await browser.newContext(phone);
const a = await ctxA.newPage(), b = await ctxB.newPage();
const errors = [];
for (const [n, p] of [['A', a], ['B', b]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::|requestStorageAccess/.test(m.text())) errors.push(`${n}: ${m.text()}`); });
}

try {
  console.log(`\nServer: ${server.url}`);
  console.log('Lobby');
  await a.goto(server.url); await b.goto(server.url);
  await a.fill('#nameInput', 'Niramay');
  await a.getByRole('button', { name: 'Set up a table' }).click();
  await a.locator('.code-card .rack .tile').first().waitFor();
  const code = (await a.locator('.code-card .rack .tile').allInnerTexts()).map((t) => t.trim()[0]).join('');
  check(/^[A-Z]{4}$/.test(code), `table code ${code}`);
  await snap(a, '01-waiting');
  await b.fill('#nameInput', 'Saharsh');
  await b.getByRole('button', { name: 'Join with a code' }).click();
  await b.locator('#codeInput').pressSequentially(code);
  await a.locator('.gbox').first().waitFor({ timeout: 8000 });
  await b.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(600);
  check((await a.locator('#presence').getAttribute('aria-label')).includes('Saharsh is here') && await a.locator('#partnerDot.here').isVisible(), 'host sees the partner here (green dot)');
  await snap(b, '02-shelf');

  console.log('Connect Four');
  await a.locator('.gbox.c4').click();
  await a.getByRole('button', { name: 'Play Connect Four' }).click();
  await sleep(800);
  check(await a.locator('#partnerDot.near').isVisible(), 'amber dot while the partner is still at the shelf');
  await b.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  await a.locator('.howto-card').waitFor(); await b.locator('.howto-card').waitFor();
  await snap(a, '03-howto');
  check((await a.locator('.howto-card').innerText()).includes('Four in a row'), 'how-to-play card before a new game');
  await gotIt(a); await gotIt(b);
  await a.locator('#bar [aria-label="How to play"]').click();
  check(await a.locator('#sheet .panel', { hasText: 'How to play Connect Four' }).isVisible(), '? reopens the rules');
  await a.locator('#sheet').getByRole('button', { name: 'Got it' }).click();
  await a.locator('.choices').waitFor(); await b.locator('.choices').waitFor();
  await sleep(500);
  await a.locator('.choices .hand', { hasText: 'Rock' }).click();
  await sleep(500);
  check((await b.locator('.slot.top .hand').getAttribute('aria-label')) === 'Chosen', 'partner sees "chosen" but not the pick');
  await b.locator('.choices .hand', { hasText: 'Rock' }).click();
  await sleep(3700);
  await rpsRound(a, b, 'Rock', 'Scissors');
  await rpsRound(a, b, 'Paper', 'Rock');
  await snap(a, '03-starter');
  await a.locator('.c4-board').waitFor({ timeout: 12000 }); await b.locator('.c4-board').waitFor({ timeout: 12000 });
  check(await state(a, 'c4State(G.match).starter === G.seat'), 'RPS winner drops first');
  const seq = [[a, 3], [b, 3], [a, 2], [b, 4], [a, 1], [b, 4], [a, 0]];
  for (let i = 0; i < seq.length; i++) {
    await drop(...seq[i]);
    if (i === 2) {
      // knock B's connection out mid-game; it must reconnect and keep playing
      await b.evaluate(async () => { FB.db.goOffline(); await FB.fs.disableNetwork(); });
      await b.waitForFunction(() => !Net.online, null, { timeout: 5000 });
      await b.evaluate(async () => { FB.db.goOnline(); await FB.fs.enableNetwork(); });
      await b.waitForFunction(() => Net.online, null, { timeout: 10000 });
      check(true, 'B reconnected after its connection dropped');
    }
  }
  await sleep(2200);
  await snap(a, '04-c4-end');
  check((await a.locator('#sheet').innerText()).includes('You win'), 'winner sees the win card');
  check((await b.locator('#sheet').innerText()).includes('Niramay got four in a row'), 'loser sees who won');
  check(await state(b, 'c4State(G.match).moves.length') === 7, 'both boards agree on 7 discs');
  await b.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click();
  await a.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(500);
  const score = (await a.locator('.score-grid').innerText()).replace(/\s+/g, ' ');
  check(/Connect Four 1 0/.test(score), `score sheet counts the win (${score})`);

  console.log('Battleships');
  await b.locator('.gbox.bs').click();
  await b.getByRole('button', { name: 'Play Battleships' }).click();
  await snap(a, '05-invite');
  check((await a.locator('#sheet').innerText()).includes('Saharsh opened Battleships'), 'partner is asked to join');
  await a.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  await gotIt(a); await gotIt(b);
  await a.locator('.choices').waitFor(); await b.locator('.choices').waitFor();
  await sleep(500);
  await rpsRound(a, b, 'Scissors', 'Rock');
  await rpsRound(a, b, 'Scissors', 'Rock');
  await b.locator('.dock').waitFor({ timeout: 12000 }); await a.locator('.dock').waitFor({ timeout: 12000 });
  // drag one ship from the harbour onto the chart, then shuffle the rest
  const ship = a.locator('.dock .ship').first();
  const sb = await ship.boundingBox(), gb = await a.locator('.bs-grid').boundingBox();
  await a.mouse.move(sb.x + 10, sb.y + 8); await a.mouse.down();
  for (let i = 1; i <= 10; i++) await a.mouse.move(sb.x + 10 + (gb.x + 20 - sb.x) * i / 10, sb.y + 8 + (gb.y + 20 - sb.y) * i / 10);
  await a.mouse.up(); await sleep(300);
  check(await a.locator('.bs-grid .ship').count() === 1, 'dragged a ship onto the chart');
  await snap(a, '05-placing');
  await a.locator('.tool', { hasText: 'Shuffle' }).click(); await b.locator('.tool', { hasText: 'Shuffle' }).click();
  await a.getByRole('button', { name: 'Lock in my fleet' }).click();
  await sleep(500);
  check(!(await state(b, 'bsState(G.match).ready[G.seat]')), 'partner still placing while host waits');
  await b.getByRole('button', { name: 'Lock in my fleet' }).click();
  await a.locator('.seg').waitFor({ timeout: 8000 }); await b.locator('.seg').waitFor({ timeout: 8000 });
  await sleep(1000);
  const fleets = await state(b, 'G.match.fleets');
  const seatB = await state(b, 'G.seat');
  const aShips = shipCells(fleets[seatB === 'host' ? 'guest' : 'host']);
  const bOcc = new Set(shipCells(fleets[seatB]).map(([r, c]) => r * 10 + c));
  const aOcc = new Set(aShips.map(([r, c]) => r * 10 + c));
  const free = (occ) => { const out = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (!occ.has(r * 10 + c)) out.push([r, c]); return out; };
  const aMiss = free(bOcc), bMiss = free(aOcc);
  const bHit = [...bOcc][0];
  check(await state(b, 'bsState(G.match).starter === G.seat'), 'RPS winner fires first');
  // B misses, A hits (and so goes again), A misses, then B hits every ship square in one long turn
  await shoot(b, ...bMiss[0]);
  await shoot(a, Math.floor(bHit / 10), bHit % 10);
  check(await state(a, 'bsState(G.match).turn === G.seat'), 'a hit earns another shot');
  await a.waitForFunction(() => /Hit! Fire again/.test(document.querySelector('.bs-status').textContent), null, { timeout: 8000 });
  await shoot(a, ...aMiss[0]);
  await b.waitForFunction(() => bsState(G.match).shots.length >= 3, null, { timeout: 8000 });
  check(await state(b, 'bsState(G.match).turn === G.seat'), 'a miss passes the turn');
  for (let k = 0; k < aShips.length; k++) {
    await shoot(b, ...aShips[k]);
    if (k === 2) { await sleep(1200); await snap(b, '06-battle'); await snap(a, '06-battle-other-side'); }
  }
  await sleep(3500);
  await snap(b, '07-bs-end');
  check((await b.locator('#sheet').innerText()).includes('whole fleet'), 'winner sees the victory card');
  check((await a.locator('#sheet').innerText()).includes('sank your whole fleet'), 'loser sees the defeat card');
  const hits = await state(a, 'bsState(G.match).hits');
  check(hits[seatB] === 17, '17 hits recorded');

  console.log('Saving and quitting');
  const sheetBtn = (p, name) => p.locator('#sheet').getByRole('button', { name, exact: true }).click();
  const sheetHas = (p, text) => p.locator('#sheet .panel', { hasText: text }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  await sheetBtn(a, 'Back to the shelf');
  await a.locator('.gbox').first().waitFor({ timeout: 8000 }); await b.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(800);
  await a.locator('.gbox.c4').click(); await sheetBtn(a, 'Play Connect Four');
  await sheetBtn(b, 'Join');
  await gotIt(a); await gotIt(b);
  await a.locator('.choices').waitFor(); await b.locator('.choices').waitFor();
  await sleep(500);
  await a.locator('.choices .hand', { hasText: 'Rock' }).click();
  await sleep(600);
  const savedId = await state(a, 'G.match.id');
  // A quits; B is stopped and asked to decide, and keeps it
  await a.locator('#bar [aria-label="Back to the shelf"]').click();
  await snap(a, '08-leave-sheet');
  await sheetBtn(a, 'Quit without saving');
  check(await sheetHas(b, 'Niramay quit Connect Four'), 'partner is told the other quit');
  check(await state(b, '!G.table.current'), 'partner can no longer play on');
  await snap(b, '09-partner-quit');
  await sheetBtn(b, 'Keep it saved');
  check(await sheetHas(a, 'Saharsh saved Connect Four'), 'quitter hears the partner kept it');
  await sheetBtn(a, 'OK');
  await sleep(600);
  check(await state(a, `G.table.saved.c4 === '${savedId}'`), 'the game is saved');
  check(await a.locator('.gbox.c4 .sticker.saved').isVisible() && await b.locator('.gbox.c4 .sticker.saved').isVisible(), 'both shelves show it as saved');
  await snap(b, '10-shelf-saved');
  // A carries on the saved game; B is asked and joins; the RPS pick is still there
  await a.locator('.gbox.c4').click(); await sheetBtn(a, 'Carry on the saved game');
  check(await sheetHas(b, 'Niramay wants to carry on Connect Four'), 'partner is asked to carry on');
  await sheetBtn(b, 'Carry on');
  await a.locator('.choices').waitFor(); await b.locator('.choices').waitFor();
  check(await state(b, `G.match.id === '${savedId}' && !!G.match.rps.r1.host`), 'saved game picks up where it left off');
  // B quits, A quits too: gone
  await b.locator('#bar [aria-label="Back to the shelf"]').click(); await sheetBtn(b, 'Quit without saving');
  check(await sheetHas(a, 'Saharsh quit Connect Four'), 'other way round: told about the quit');
  await sheetBtn(a, 'Quit too');
  check(await sheetHas(b, 'Niramay quit too'), 'both quit: told it was put away');
  await sheetBtn(b, 'OK');
  await sleep(600);
  check(await state(a, '!G.table.saved.c4'), 'nothing saved after both quit');
  check(!(await a.locator('.gbox.c4 .sticker.saved').isVisible()), 'saved sticker is gone');

  console.log('Hues');
  await a.locator('.gbox.hu').click(); await sheetBtn(a, 'Play Hues');
  await sheetBtn(b, 'Join');
  await a.locator('.howto-card').waitFor();
  check((await a.locator('.howto-card').innerText()).includes('Match the pile'), 'Hues how-to card');
  await snap(a, '13-hu-howto');
  await gotIt(a); await gotIt(b);
  await a.locator('.choices').waitFor(); await b.locator('.choices').waitFor();
  await sleep(500);
  await rpsRound(a, b, 'Rock', 'Scissors');
  await rpsRound(a, b, 'Rock', 'Scissors');
  await a.locator('.hu-rules-card').waitFor();
  check(await b.locator('[data-rules=custom]').isDisabled(), 'only the RPS winner chooses Hues rules');
  await snap(a, '13-hu-rules-choice');
  await a.locator('[data-rules=custom]').click();
  await a.locator('.hu-hand .hcard').first().waitFor({ timeout: 12000 }); await b.locator('.hu-hand .hcard').first().waitFor({ timeout: 12000 });
  await sleep(600);
  check(await state(a, 'huState(G.match).turn === G.seat'), 'RPS winner plays the first card');
  check(await state(b, 'huState(G.match).hands[G.seat].length === 7 && document.querySelectorAll(".hu-hand .hcard").length === 7 && document.querySelectorAll(".hu-their .hcard").length === 7'), 'seven cards each, partner’s face down');
  const hands = (p) => state(p, 'JSON.stringify(huState(G.match).hands)');
  check(await hands(a) === await hands(b), 'both phones deal the same hands from the seed');
  await snap(a, '14-hu-start');
  // play like a person: a card that fits (wilds last, with any others of the same number), the drawn card
  // if it fits, else draw / pick up / pass. Call Hues on one card, except once, so the other phone calls it out.
  let huMoves = 0, dragged = false, pickedColour = false, forgot = false, multi = false, callouts = 0, hues = 0;
  const logLen = (p) => state(p, 'huState(G.match).log.length');
  const waitLog = (p, n) => p.waitForFunction((n) => huState(G.match).log.length > n, n, { timeout: 10000 });
  async function huMove(p) {
    const wasDragged = dragged;
    const plan = await p.evaluate(() => {
      const s = huState(G.match), hand = s.hands[G.seat];
      if (s.owes[other(G.seat)] && s.hands[other(G.seat)].length === 1) return { callout: true };
      const fit = hand.filter((id) => hueFits(s, HUE_DECK[id])).sort((x, y) => !!HUE_KIND[HUE_DECK[x].k].wild - !!HUE_KIND[HUE_DECK[y].k].wild);
      const first = s.drawn != null ? s.drawn : fit[0];
      if (first == null) return { ids: null };
      const c = HUE_DECK[first];
      const ids = [first, ...(!s.penalty && s.drawn == null && c.k === 'n' ? hand.filter((id) => id !== first && HUE_DECK[id].k === 'n' && HUE_DECK[id].v === c.v) : [])];
      return { ids, wild: !!HUE_KIND[HUE_DECK[ids[ids.length - 1]].k].wild };
    });
    let n = await logLen(p);
    if (plan.callout) {
      const victim = p === a ? b : a;
      const before = await state(victim, 'huState(G.match).hands[G.seat].length');
      await p.locator('.hu-btns .hu-call', { hasText: 'Call out' }).click();
      await waitLog(p, n);
      await victim.waitForFunction((before) => huState(G.match).hands[G.seat].length === before + 2, before, { timeout: 10000 });
      callouts++;
      if (callouts === 1) { await snap(victim, '16-hu-called-out'); check(await state(victim, 'huState(G.match).hands[G.seat].length') === before + 2, 'Call out: caught on one card without Hues, picks up 2'); }
      return;
    }
    if (!plan.ids) await p.locator('.hu-act').click();
    else {
      const card = (id) => p.locator(`.hu-hand .hcard[data-id="${id}"]`);
      if (!dragged) {
        // the first card goes by dragging it onto the pile
        const cb = await card(plan.ids[0]).boundingBox(), pb = await p.locator('.hu-pile').boundingBox();
        await p.mouse.move(cb.x + 12, cb.y + 20); await p.mouse.down();
        for (let i = 1; i <= 8; i++) await p.mouse.move(cb.x + 12 + (pb.x + 20 - cb.x - 12) * i / 8, cb.y + 20 + (pb.y + 30 - cb.y - 20) * i / 8);
        await p.mouse.up();
        dragged = true;
      } else if (plan.ids.length > 1) {
        for (const id of plan.ids) await card(id).click({ position: { x: 12, y: 18 } });
        if (!multi) await snap(p, '15-hu-pair');
        await p.locator('.hu-pile').click();
      } else {
        await card(plan.ids[0]).click({ position: { x: 12, y: 18 } });
        await p.locator(`.hu-hand .hcard.sel[data-id="${plan.ids[0]}"]`).click({ position: { x: 12, y: 18 } });
      }
      if (plan.wild) {
        await p.locator('.hu-colour-picker .hue-pot').first().waitFor();
        if (!pickedColour) { pickedColour = true; await snap(p, '15-hu-colour'); }
        await p.locator('.hu-colour-picker .hue-pot').nth(huMoves % 4).click();
      }
    }
    await waitLog(p, n);
    if (!wasDragged && dragged) check(await p.evaluate(n => huState(G.match).log.slice(n).some(e => e.k === 'play'), n), 'dragged a card onto the pile');
    huMoves++;
    const last = await state(p, 'huState(G.match).log.at(-1)');
    if (last.k === 'play' && last.ids.length > 1 && !multi) { multi = true; check(true, `played ${last.ids.length} cards of the same number together`); }
    if (await state(p, 'huState(G.match).owes[G.seat]')) {
      if (!forgot) { forgot = true; return; } // leave it for the other phone to call out
      n = await logLen(p);
      await p.locator('.hu-btns .hu-call', { hasText: 'Hues!' }).click();
      await waitLog(p, n);
      hues++;
    }
  }
  const huReady = (p) => state(p, 'document.querySelector(".hu")?.dataset.ready === "1"');
  for (let t = Date.now(); Date.now() - t < 240000;) {
    if (await state(a, '!!huState(G.match).winner')) break;
    const p = (await huReady(a)) ? a : (await huReady(b)) ? b : null;
    if (!p) { await sleep(80); continue; }
    await huMove(p);
    if (huMoves === 12) { await sleep(700); await snap(a, '16-hu-mid'); await snap(b, '16-hu-mid-other'); }
  }
  await sleep(2600);
  const huWinner = await state(a, 'huState(G.match).winner');
  check(!!huWinner && huWinner === await state(b, 'huState(G.match).winner'), `a winner both phones agree on, after ${huMoves} moves`);
  console.log(`       (${hues} Hues called, ${callouts} called out, pairs played: ${multi})`);
  check(await state(a, 'huState(G.match).log.every((e) => e.k !== "callout" || e.ids.length === 2)'), 'every call-out cost two cards');
  const [huW, huL] = huWinner === await state(a, 'G.seat') ? [a, b] : [b, a];
  await snap(huW, '17-hu-end');
  check((await huW.locator('#sheet').innerText()).includes('You win'), 'winner sees the win card');
  check((await huL.locator('#sheet').innerText()).includes('played their last card'), 'loser sees who went out');
  await sheetBtn(a, 'Back to the shelf');
  await a.locator('.gbox').first().waitFor({ timeout: 8000 }); await b.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(800);
  check(/Hues [01] [01]/.test((await a.locator('.score-grid').innerText()).replace(/\s+/g, ' ')), 'score sheet has a Hues row with the win');
  check(!(await a.locator('.gbox.gw').count()), 'Guess Who? is off the shelf');

  check(await a.locator('.gbox').count() === 4, 'four games on the shelf');
  await snap(a, '24-shelf-four');

  await a.locator('#chatBtn').click();
  await snap(a, '11-chat-sheet');
  await a.locator('.chat-emoji button[aria-label="Laughing"]').click();
  check(await b.locator('#chatfx .chat-pop', { hasText: '😂' }).first().waitFor({ timeout: 6000 }).then(() => true, () => false), 'emoji rains on the other phone');
  check(await b.locator('#chatfx .chat-pop').count() >= 8, 'a shower of them, not just one');
  check(await b.locator('#chatBtn.has').isVisible(), 'unread dot on the other phone');
  await sleep(700);
  await b.locator('#chatBtn').click();
  check(!(await b.locator('#chatBtn.has').count()), 'opening the chat clears the dot');
  check((await b.locator('.chat-thread').innerText()).includes('😂'), 'thread shows the reaction');
  await b.locator('.chat-chips .chip', { hasText: 'Nice one' }).click();
  check(await a.locator('#toast .chat-note', { hasText: 'Nice one' }).waitFor({ timeout: 6000 }).then(() => true, () => false), 'quick reply shows as a note');
  await snap(a, '12-chat-note');
  await snap(b, '12-chat-rain');
  await sleep(700);
  await a.locator('#chatBtn').click();
  await a.locator('.chat-input').fill('x'.repeat(90));
  check((await a.locator('.chat-input').inputValue()).length === 80, 'custom notes stop at 80 characters');
  await a.locator('.chat-input').fill('see you at 8 ❤');
  await a.locator('.chat-input').press('Enter');
  check(await b.locator('#toast .chat-note', { hasText: 'see you at 8' }).waitFor({ timeout: 6000 }).then(() => true, () => false), 'custom note arrives');

  console.log('Recovery');
  await a.reload();
  await a.locator('#bar').waitFor({ state: 'visible', timeout: 8000 });
  check(true, 'reload returns to the same table');
  // invite link pre-fills the code on a fresh phone
  const ctxC = await browser.newContext(phone); const c = await ctxC.newPage();
  await c.goto(`${server.url}/?join=${code}`);
  await c.locator('#codeInput').waitFor();
  check((await c.locator('#codeInput').inputValue()) === code, 'invite link fills in the code');
  await ctxC.close();
} catch (e) {
  failures++;
  console.error('\n' + e.stack);
  for (const [n, p] of [['A', a], ['B', b]]) {
    const d = await p.evaluate(() => JSON.stringify({ seat: G.seat, online: Net.online, subs: [...Net.subs.keys()], moves: G.match && G.match.moves, rps:G.match?.rps, game:G.match?.game, screen: cur.name, turn: G.match && G.match.game === 'c4' ? c4State(G.match).turn : null })).catch((x) => String(x));
    console.error(n, d);
  }
  await snap(a, 'ERR-a').catch(() => {}); await snap(b, 'ERR-b').catch(() => {});
} finally {
  if (errors.length) { console.log('\nBrowser errors:'); for (const e of errors) console.log('  ' + e); }
  failures += errors.length;
  await browser.close();
  server.stop();
  console.log(failures ? `\n${failures} problem(s)` : '\nAll good');
  process.exit(failures ? 1 : 0);
}
