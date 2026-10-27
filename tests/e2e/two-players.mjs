// End-to-end: two players on two "phones" (separate browser contexts) play a full game of
// Connect Four and a full game of Battleships against the Firebase emulators, then check that a
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

const snap = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
const state = (p, expr) => p.evaluate(expr);

async function rpsRound(a, b, pa, pb) {
  await a.locator('.choices .hand', { hasText: pa }).click();
  await sleep(250);
  await b.locator('.choices .hand', { hasText: pb }).click();
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

async function shoot(p, r, c) {
  await p.locator('.bs-bottom .btn', { hasText: 'Pick a square' }).waitFor({ timeout: 20000 });
  await p.locator('.seg button').first().click();
  await sleep(550);
  const g = await p.locator('.bs-grid.target').boundingBox();
  const cw = g.width / 10;
  const x = g.x + cw * (c + 0.5), y = g.y + cw * (r + 0.5);
  await p.mouse.click(x, y); await sleep(120); await p.mouse.click(x, y);
  await sleep(250);
}

function shipCells(fleet) {
  const L = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
  const out = [];
  for (const s of fleet) for (let i = 0; i < L[s.id]; i++) out.push(s.v ? [s.r + i, s.c] : [s.r, s.c + i]);
  return out;
}

const server = await startServer();
const browser = await chromium.launch({ headless: !process.env.HEADED });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
const ctxA = await browser.newContext(phone), ctxB = await browser.newContext(phone);
const a = await ctxA.newPage(), b = await ctxB.newPage();
const errors = [];
for (const [n, p] of [['A', a], ['B', b]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::/.test(m.text())) errors.push(`${n}: ${m.text()}`); });
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
  await b.fill('#nameInput', 'Priya');
  await b.getByRole('button', { name: 'Join with a code' }).click();
  await b.locator('#codeInput').pressSequentially(code);
  await a.locator('.gbox').first().waitFor({ timeout: 8000 });
  await b.locator('.gbox').first().waitFor({ timeout: 8000 });
  await sleep(600);
  check((await a.locator('#partnerName').innerText()).includes('Priya is here'), 'host sees the partner online');
  await snap(b, '02-shelf');

  console.log('Connect Four');
  await a.locator('.gbox.c4').click();
  await a.getByRole('button', { name: 'Play Connect Four' }).click();
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
      check(true, 'B reconnected after its socket dropped');
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
  const aMiss = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (!bOcc.has(r * 10 + c)) aMiss.push([r, c]);
  check(await state(b, 'bsState(G.match).starter === G.seat'), 'RPS winner fires first');
  for (let k = 0; k < aShips.length; k++) {
    await shoot(b, ...aShips[k]);
    if (k === 2) { await sleep(1200); await snap(b, '06-battle'); await snap(a, '06-battle-other-side'); }
    if (k === aShips.length - 1) break;
    await shoot(a, ...aMiss[k]);
  }
  await sleep(3500);
  await snap(b, '07-bs-end');
  check((await b.locator('#sheet').innerText()).includes('whole fleet'), 'winner sees the victory card');
  check((await a.locator('#sheet').innerText()).includes('sank your whole fleet'), 'loser sees the defeat card');
  const hits = await state(a, 'bsState(G.match).hits');
  check(hits[seatB] === 17, '17 hits recorded');

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
    const d = await p.evaluate(() => JSON.stringify({ seat: G.seat, online: Net.online, subs: [...Net.subs.keys()], moves: G.match && G.match.moves, screen: cur.name, turn: G.match && G.match.game === 'c4' ? c4State(G.match).turn : null })).catch((x) => String(x));
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
