// Quickfire on two phones against the emulators: setup by the RPS winner, Words with the keyboard
// kept up between rounds, fair timing when one phone sees the puzzle late, a refused word, giving
// up, letters no word fits, a whole game to 5, then Sums with the keypad and a wrong answer.
//   run by npm run test:e2e (or: node tests/e2e/quickfire.mjs with npm start running)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
fs.mkdirSync('tests/e2e/screens', { recursive: true });
const URL = process.env.E2E_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.E2E_CHANNEL || 'chromium', executablePath: process.env.E2E_EXECUTABLE_PATH || undefined });
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 };
const ca = await browser.newContext(phone), cb = await browser.newContext(phone);
const a = await ca.newPage(), b = await cb.newPage(), errors = [];
for (const [n, p] of [['A', a], ['B', b]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::|requestStorageAccess/.test(m.text())) errors.push(`${n}: ${m.text()}`); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = async (p, name) => { await p.waitForTimeout(350); await p.screenshot({ path: `tests/e2e/screens/${name}.png` }); };
const ok = (msg) => console.log('  ok ' + msg);
const until = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout });
const qs = (p) => p.evaluate(() => { const s = qfState(G.match); return { score: s.score, winner: s.winner, cur: s.cur && { key: s.cur.key, phase: s.cur.phase, type: s.cur.type }, rounds: s.rounds.map((r) => ({ key: r.key, phase: r.phase, w: r.w, why: r.why })) }; });
const inputFocused = (p) => p.evaluate(() => document.activeElement === document.querySelector('.qf-input'));
const roundKey = async (p) => (await qs(p)).cur.key;
// wait until both phones show this round in the given phase (results take ~2.7 s to clear)
const phase = (key, ph) => Promise.all([a, b].map((p) => until(p, ([k, f]) => { const s = qfState(G.match); return s.cur && s.cur.key === k && s.cur.phase === f && document.querySelector('.qf-result')?.hidden !== false; }, [key, ph])));
const nextRound = async (after) => { await Promise.all([a, b].map((p) => until(p, (k) => { const s = qfState(G.match); return s.cur && s.cur.key > k && s.cur.phase === 'pick' && document.querySelector('.qf-result')?.hidden; }, after))); return roundKey(a); };
const setHidden = (p, hidden) => p.evaluate((x) => { Object.defineProperty(document, 'visibilityState', { value: x ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
async function letter(p, ch) { await p.keyboard.type(ch); await p.keyboard.press('Enter'); }
async function rps(pa, pb) {
  const n = await a.evaluate(() => rpsState(G.match).rounds.length);
  await a.locator('.choices:not(.locked)').waitFor(); await b.locator('.choices:not(.locked)').waitFor();
  await a.locator('.choices .hand', { hasText: pa }).click(); await sleep(200);
  await b.locator('.choices .hand', { hasText: pb }).click();
  await Promise.all([a, b].map((p) => until(p, (k) => rpsState(G.match).rounds.length > k, n)));
  await sleep(3600);
}
async function openQuickfire(first) {
  if (first) { await a.locator('.gbox.qf').click(); await a.locator('#sheet').getByRole('button', { name: 'Play Quickfire' }).click(); }
  await b.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click(); }
  await rps('Rock', 'Scissors'); await rps('Paper', 'Rock');
  await Promise.all([a, b].map((p) => p.locator('.qf-setup').waitFor({ timeout: 10000 })));
}

try {
  await Promise.all([a, b].map((p) => p.goto(URL)));
  await a.fill('#nameInput', 'Niramay'); await a.getByRole('button', { name: 'Set up a table', exact: true }).click();
  await a.locator('.code-card .tile').first().waitFor();
  const code = await a.evaluate(() => G.code);
  await b.fill('#nameInput', 'Saharsh'); await b.getByRole('button', { name: 'Join with a code', exact: true }).click(); await b.fill('#codeInput', code);
  await a.locator('.gbox.qf').waitFor(); await b.locator('.gbox.qf').waitFor();
  assert.equal(await a.locator('.cubby .gbox').count(), 4);
  await snap(a, 'qf-01-shelf');
  ok('Quickfire is the fourth game on the shelf');

  // ---- setup: only the RPS winner chooses ----
  await openQuickfire(true);
  assert.ok((await b.locator('.qf-setup').innerText()).includes('Niramay won rock, paper, scissors'));
  assert.equal(await b.locator('.qf-opt').count(), 0, 'the loser has nothing to choose');
  await a.locator('[data-opt="mode:words"]').click(); await a.locator('[data-opt="len:5"]').click(); await a.locator('[data-opt="side:start"]').click();
  assert.equal(await a.locator('[data-opt^="op:"]').count(), 0, 'Words only: no sum to choose');
  await snap(a, 'qf-02-setup');
  await a.getByRole('button', { name: 'Start the race' }).click();
  await Promise.all([a, b].map((p) => p.locator('.qf-card').waitFor()));
  const setup = await a.evaluate(() => qfSetup(G.match));
  assert.deepEqual({ mode: setup.mode, len: setup.len, side: setup.side, to: setup.to }, { mode: 'words', len: 5, side: 'start', to: 5 });
  ok('the RPS winner set Words, 5 letters, first letter; the other phone only watched');

  // ---- round 1: pick secretly, then race; the keyboard input stays focused throughout ----
  let key = await roundKey(a);
  assert.ok(await inputFocused(a) && await inputFocused(b), 'the letter field has the keyboard');
  assert.ok((await a.locator('.qf-status').innerText()).includes('first letter') && (await b.locator('.qf-status').innerText()).includes('last letter'));
  await letter(a, 'S');
  await until(b, () => document.querySelector('.qf-rack .tile.back')?.textContent === '✓');
  assert.equal(await b.evaluate(() => document.querySelector('.qf-rack').textContent.includes('S')), false, 'B can’t see A’s letter yet');
  await snap(b, 'qf-03-pick');
  await letter(b, 'T');
  await phase(key, 'race');
  assert.ok(await inputFocused(a) && await inputFocused(b), 'still focused when the puzzle appears: no keyboard delay');
  assert.equal(await a.evaluate(() => [...document.querySelectorAll('.qf-rack .tile')].map((t) => t.textContent).join('')), 'ST');
  await sleep(500);
  await a.keyboard.type('MAR');
  await Promise.all([a, b].map((p) => until(p, (k) => qfState(G.match).rounds.some((r) => r.key === k && r.w === 'host'), key)));
  await until(a, () => !document.querySelector('.qf-result').hidden);
  assert.ok((await a.locator('.qf-result').innerText()).includes('You got it first'));
  assert.ok((await b.locator('.qf-result').innerText()).includes('Niramay got it first'));
  assert.ok((await b.locator('.qf-rack').innerText()).replace(/\s/g, '').includes('SMART'));
  await snap(b, 'qf-04-result');
  ok('SMART auto-sends on the last middle letter; B’s phone conceded and both agree');

  // ---- round 2: B's phone sees the puzzle late; it still wins on its own clock ----
  key = await nextRound(key);
  assert.ok(await inputFocused(a) && await inputFocused(b), 'keyboard still up for the next pick');
  await letter(a, 'S');
  await setHidden(b, true);
  await letter(b, 'T');
  await until(a, (k) => qfState(G.match).cur?.key === k && qfState(G.match).cur.phase === 'race', key);
  await sleep(1500);
  await a.keyboard.type('TAR'); // START, after 1.5 s on A's clock
  await until(b, (k) => !!G.match.ans?.[k + 'h'], key);
  await sleep(400);
  assert.equal((await qs(b)).cur.phase, 'race', 'B hasn’t seen the puzzle yet, so the round is still open');
  await setHidden(b, false);
  await b.keyboard.type('HIR'); // SHIRT, a few hundred ms after B's puzzle appeared
  await Promise.all([a, b].map((p) => until(p, (k) => qfState(G.match).rounds.some((r) => r.key === k && r.phase === 'done'), key)));
  const r2 = await a.evaluate((k) => { const r = qfState(G.match).rounds.find((x) => x.key === k); return { w: r.w, h: r.ans.host.ms, g: r.ans.guest.ms }; }, key);
  assert.equal(r2.w, 'guest'); assert.ok(r2.g < r2.h, `guest ${r2.g} ms < host ${r2.h} ms`);
  ok(`late phone wins fairly: B answered later in real time but in ${r2.g} ms on its own clock, vs A's ${r2.h} ms`);

  // ---- round 3: a made-up word is refused; giving up lets the other take their time ----
  key = await nextRound(key);
  await letter(a, 'S'); await letter(b, 'T');
  await phase(key, 'race');
  await a.keyboard.type('MIR');
  await until(a, () => /SMIRT isn’t in our dictionary/.test(document.querySelector('.qf-status').textContent));
  assert.equal(await a.evaluate((k) => !!G.match.ans?.[k + 'h'], key), false, 'a wrong word is never sent');
  await snap(a, 'qf-05-not-a-word');
  for (let i = 0; i < 3; i++) await a.keyboard.press('Backspace');
  await a.locator('.qf-actions').getByRole('button', { name: 'Give up' }).click();
  assert.ok(await inputFocused(a), 'tapping Give up doesn’t take the keyboard away');
  await until(b, () => /gave up/.test(document.querySelector('.qf-status').textContent));
  await sleep(600);
  await b.keyboard.type('AIN'); // SAINT
  await Promise.all([a, b].map((p) => until(p, (k) => qfState(G.match).rounds.some((r) => r.key === k && r.w === 'guest'), key)));
  ok('SMIRT refused on the phone; after A gave up, B still took the round');

  // ---- round 4: Q to X has no everyday word: dealt again, nobody scores ----
  key = await nextRound(key);
  await letter(a, 'Q'); await letter(b, 'X');
  await until(a, () => /No everyday word fits/.test(document.querySelector('.qf-result').textContent));
  await snap(a, 'qf-06-nofit');
  assert.deepEqual((await qs(a)).score, { host: 1, guest: 2 });
  ok('Q…X dealt again without a point');

  // ---- play on to 5 ----
  for (let i = 0; i < 4; i++) {
    key = await nextRound(key);
    await letter(a, 'S'); await letter(b, 'T');
    await phase(key, 'race');
    if (i === 0) { // the keyboard takes half the screen: tiles, clock and status must stay in view
      await a.setViewportSize({ width: 390, height: 470 }); await a.keyboard.type('M');
      const vis = await a.evaluate(() => ['.qf-rack', '.qf-clock', '.qf-status'].every((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
      assert.ok(vis, 'puzzle, clock and status above the keyboard'); await snap(a, 'qf-10-keyboard-470');
      await a.setViewportSize({ width: 390, height: 844 }); await a.keyboard.type('AR');
    } else await a.keyboard.type(i % 2 ? 'TAR' : 'MAR');
    await Promise.all([a, b].map((p) => until(p, (k) => qfState(G.match).rounds.some((r) => r.key === k && r.w === 'host'), key)));
  }
  await Promise.all([a, b].map((p) => until(p, () => qfState(G.match).winner === 'host')));
  await a.locator('#sheet .panel').waitFor({ timeout: 8000 }); await b.locator('#sheet .panel').waitFor({ timeout: 8000 });
  assert.ok((await a.locator('#sheet').innerText()).includes('You win, 5–2'));
  assert.ok((await b.locator('#sheet').innerText()).includes('Niramay wins, 5–2'));
  await snap(b, 'qf-07-end');
  ok('first to 5: both phones agree, 5–2');

  // ---- a rematch of Sums: keypad picks, bigger minus smaller, a wrong answer ----
  await a.locator('#sheet').getByRole('button', { name: 'Rematch' }).click();
  await openQuickfire(false);
  await a.locator('[data-opt="mode:sums"]').click(); await a.locator('[data-opt="op:sub"]').click();
  await a.getByRole('button', { name: 'Start the race' }).click();
  await Promise.all([a, b].map((p) => p.locator('.qf-pad:not([hidden])').waitFor()));
  assert.ok(!(await inputFocused(a)), 'no text keyboard for Sums');
  key = await roundKey(a);
  const tap = async (p, keys) => { for (const k of keys) await p.locator(`.qf-key[data-key="${k}"]`).tap(); };
  await tap(a, ['2', '4', 'ok']);
  await tap(b, ['1', '0', '1', 'ok']);
  await until(b, () => /from 1 to 100/.test(document.querySelector('.qf-status').textContent));
  await tap(b, ['6', '7', 'ok']);
  await phase(key, 'race');
  assert.equal((await a.locator('.qf-sum').innerText()).replace(/\s/g, ''), '67−24=?');
  await snap(a, 'qf-08-sum');
  await tap(b, ['4', '4', 'ok']);
  await until(b, () => /Not 44/.test(document.querySelector('.qf-status').textContent));
  await snap(b, 'qf-09-wrong');
  await sleep(1000);
  await tap(b, ['4', '3', 'ok']);
  await Promise.all([a, b].map((p) => until(p, (k) => qfState(G.match).rounds.some((r) => r.key === k && r.w === 'guest'), key)));
  ok('Sums: 101 refused, 67 − 24, a wrong 44 locks the keypad, then 43 wins');

  // ---- quitting mid-game ----
  await a.locator('#bar [aria-label="Back to the shelf"]').click();
  await a.locator('#sheet').getByRole('button', { name: 'Quit without saving' }).click();
  await b.locator('#sheet').getByRole('button', { name: 'Quit too' }).click().catch(() => {});
  await a.locator('.gbox.qf').waitFor();
  ok('quit back to the shelf');
  assert.deepEqual(errors, []);
  ok('no browser errors');
} catch (e) {
  await snap(a, 'qf-ERR-a').catch(() => {}); await snap(b, 'qf-ERR-b').catch(() => {});
  console.error(await a.evaluate(() => G.match && JSON.stringify({ picks: G.match.picks, ans: G.match.ans })).catch(() => ''));
  console.error(errors);
  throw e;
} finally { await browser.close(); }
