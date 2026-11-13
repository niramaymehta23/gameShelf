// Browser end-to-end: a host page and four phone pages (390×844) in Chromium, against the real server
// running in this process. Plays the core flow (join, switch, lock, seats, a round, reconnect, pause,
// Don't Say It, final) and then each game through its real screens. Screenshots → tests/screens/e2e/.
//
//   node tests/e2e.mjs            HEADED=1 node tests/e2e.mjs        ONLY=core|pairhunt|shout|maths
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
process.env.NO_SAVE = '1';
const { start, rooms } = require('../server/index.js');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(DIR, 'screens', process.env.PHONE ? 'e2e-' + process.env.PHONE : 'e2e');
mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = k => !ONLY || ONLY.includes(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const assert = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); };

const { server } = await start(0);
const URL = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ headless: !process.env.HEADED });
const pageErrors = [];
const [PW, PH] = (process.env.PHONE || '390x844').split('x').map(Number); // PHONE=320x640 for a small phone
async function newPage(url, size = { width: PW, height: PH }, reuse = null) {
  const ctx = reuse || await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`${url}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) pageErrors.push(`${url}: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  await page.goto(URL + url);
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const text = page => page.locator('#app').innerText();
async function waitText(page, re, ms = 15000) {
  if (!re.flags.includes('i')) re = new RegExp(re.source, re.flags + 'i'); // kickers are upper-cased by CSS
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await text(page).catch(() => ''); if (re.test(t)) return t; await sleep(100); }
  throw new Error(`waited for ${re} on ${page.url()}; screen says: ${(await text(page).catch(() => '')).slice(0, 300)}`);
}
const room = () => rooms.get(CODE);
const until = async (fn, ms = 15000, what = '') => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(80); } throw new Error('timed out: ' + what); };

// ---------- host creates the session ----------
const host = await newPage('/host?as=h', { width: 430, height: 900 });
await host.getByRole('button', { name: 'New Session' }).click();
await host.waitForSelector('.bigcode');
const CODE = (await host.locator('.bigcode').innerText()).trim();
await until(() => host.locator('.lobby-code img').evaluate(i => i.complete && i.naturalWidth > 0), 5000, 'QR image');
log('room', CODE);

// ---------- four phones join ----------
const names = ['Ravi', 'Meet', 'Priya', 'Asha'];
const teams = ['red', 'red', 'blue', 'blue'];
const phones = [];
for (let i = 0; i < 4; i++) {
  const p = await newPage(`/?r=${CODE}&as=${i + 1}`);
  await p.fill('input.text-in', names[i]);
  // Meet picks Blue first, then switches to Red
  await p.getByRole('button', { name: i === 1 ? 'Blue' : teams[i] === 'red' ? 'Red' : 'Blue', exact: true }).click();
  await waitText(p, /Waiting for host/);
  phones.push(p);
}
await phones[1].getByRole('button', { name: 'Switch to Red' }).click();
await until(async () => (await phones[1].evaluate(() => document.body.dataset.team)) === 'red', 5000, 'Meet on red');
await shot(phones[0], '01-waiting-red');
await shot(host, '00-host-lobby');
await waitText(host, /Red 2 · Blue 2/);
await host.getByRole('button', { name: 'Lock Teams' }).click();
await waitText(phones[0], /#\s*1/);
await waitText(phones[1], /#\s*2/);
assert(!(await text(phones[0])).includes('Switch to'), 'no switching after lock');
await shot(phones[2], '02-waiting-seat-blue');
log('joined, switched, locked');

// a late joiner lands in the queue and is assigned by the host
const late = await newPage(`/?r=${CODE}&as=9`);
await late.fill('input.text-in', 'Kiran');
await late.getByRole('button', { name: 'Join', exact: true }).click();
await waitText(late, /Waiting for host/);
await waitText(host, /Waiting for a team/);
await host.locator('.hsec', { hasText: 'Waiting for a team' }).getByRole('button', { name: 'Blue', exact: true }).click();
await waitText(late, /Blue[\s\S]*#\s*3/);
log('late joiner assigned');

const cmd = c => host.evaluate(c => window.cmd(c), c);
const hostClick = async name => { await host.getByRole('button', { name, exact: false }).first().click(); };
const allPhones = () => [...phones, late];

// ---------- core flow with the demo game ----------
if (want('core')) {
  await cmd({ cmd: 'game', game: 'demo' });
  await waitText(phones[0], /Tap Race/);
  await hostClick('Start Round 1');
  await waitText(phones[0], /^[\s\S]*\b[123]\b/);
  await shot(phones[0], '03-countdown');
  await waitText(phones[0], /TAP!/, 6000);
  for (let i = 0; i < 3; i++) { await phones[0].getByRole('button', { name: 'TAP!' }).click(); await sleep(250); }
  await waitText(phones[1], /\b3\b/);
  // reconnect: Ravi's tab closes and reopens mid-round
  const ctx0 = phones[0].context(); await phones[0].close();
  phones[0] = await newPage(`/?as=1`, null, ctx0);
  await waitText(phones[0], /TAP!/);
  assert((await text(phones[0])).includes('Ravi'), 'same player after reopening');
  // pause
  await hostClick('Pause');
  await phones[2].waitForSelector('.paused');
  await shot(phones[2], '04-paused');
  await hostClick('Resume');
  await phones[2].waitForSelector('.paused', { state: 'detached' });
  await hostClick('End round early');
  await waitText(phones[0], /Time!|is over|Waiting for host/);
  await waitText(host, /Tap Race: final/);
  await shot(host, '05-host-gameover');
  log('core round ok');
}

// ---------- the games ----------
const pid = p => p.evaluate(() => P.state && P.state.me && P.state.me.id);
const inst = () => room().current && room().current.seg && room().current.seg.inst;

async function startGame(id, label) {
  await cmd({ cmd: 'toReady' }).catch(() => {});
  await cmd({ cmd: 'game', game: id });
  await waitText(phones[0], new RegExp(label));
  await shot(phones[0], `${id}-0-intro`);
}
async function startRound() {
  await cmd({ cmd: 'start' });
  await until(() => room().phase === 'live', 8000, 'live');
  await sleep(400);
}
async function endRound() {
  await cmd({ cmd: 'endRound' });
  await until(() => ['results', 'gameover'].includes(room().phase), 8000, 'results');
}

if (want('pairhunt') && require('../server/room.js').GAMES.pairhunt) {
  const { playPairHunt } = await import('./e2e-games.mjs');
  await startGame('pairhunt', 'Pair Hunt');
  await startRound();
  const n = await playPairHunt({ phones: allPhones(), room, sleep, until, shot });
  await endRound();
  const seg = room().segments[room().segments.length - 1];
  assert(seg.raw.red >= 20 && seg.raw.blue >= 30, 'pair hunt scored: ' + JSON.stringify(seg.raw));
  log(`pair hunt: ${n} confirmations`, JSON.stringify(seg.score));
  await shot(phones[0], 'pairhunt-9-between');
  await shot(host, 'pairhunt-9-host-results');
  log('pair hunt ok');
}
if (want('shout') && require('../server/room.js').GAMES.shout) {
  const { playShout } = await import('./e2e-games.mjs');
  await startGame('shout', 'Shout It Out');
  await startRound(); // practice
  await playShout({ phones: allPhones(), room, sleep, until, shot: (p, n) => shot(p, n + '-practice'), hits: 3 });
  await endRound();
  await waitText(phones[0], /Practice over/);
  await startRound(); // round 1
  await playShout({ phones: allPhones(), room, sleep, until, shot });
  await endRound();
  await shot(phones[0], 'shout-9-between');
  await shot(host, 'shout-9-host-results');
  const seg = room().segments[room().segments.length - 1];
  assert(seg.score.red !== 0 || seg.score.blue !== 0, 'shout round 1 scored');
  log('shout ok', JSON.stringify(seg.score));
}
if (want('maths') && require('../server/room.js').GAMES.maths) {
  const { playMaths } = await import('./e2e-games.mjs');
  await startGame('maths', 'Maths Chain');
  await startRound();
  await playMaths({ phones: allPhones(), room, sleep, until, shot });
  await until(() => ['results', 'gameover', 'time'].includes(room().phase), 20000, 'maths round end');
  await until(() => ['results', 'gameover'].includes(room().phase), 8000, 'maths results');
  await shot(phones[0], 'maths-9-between');
  await shot(host, 'maths-9-host-results');
  const mseg = room().segments[room().segments.length - 1];
  assert(mseg.raw.red === 100 && mseg.raw.blue >= 40, 'maths: red first, blue second: ' + JSON.stringify(mseg.raw));
  log('maths ok', JSON.stringify(mseg.raw));
}

// ---------- Don't Say It, audit, final ----------
await cmd({ cmd: 'toReady' });
await hostClick('Open');
await waitText(phones[0], /Don't Say It/);
await hostClick("Start Red's 60 s");
await host.locator('.dsi-team.red').getByRole('button', { name: '+1' }).click();
await host.locator('.dsi-team.blue').getByRole('button', { name: '−1' }).click();
await waitText(phones[2], /Red 1[\s\S]*Blue -1/);
await shot(host, '06-host-dsi');
await shot(phones[0], '07-phone-dsi');
await host.getByRole('button', { name: 'Audit' }).click();
await host.waitForSelector('.sheet .events li');
await shot(host, '08-host-audit');
await host.getByRole('button', { name: 'Close' }).last().click();
await hostClick('Show final');
for (const p of allPhones()) await waitText(p, /The champion is/);
await shot(phones[0], '09-final-red');
await shot(phones[2], '09-final-blue');
await shot(host, '10-host-final');
log('dsi, audit and final ok');

// every screen must be free of "undefined", "null" and "NaN"
for (const p of [host, ...allPhones()]) { const t = await text(p); assert(!/\bundefined\b|\bNaN\b|\bnull\b/.test(t), 'junk on screen: ' + t.slice(0, 200)); }
await browser.close();
const bad = pageErrors.filter(e => !/net::ERR|Failed to load resource/.test(e));
if (bad.length) { console.error('PAGE ERRORS:\n' + bad.join('\n')); process.exit(1); }
console.log('e2e passed; screenshots in tests/screens/e2e/');
process.exit(0);
