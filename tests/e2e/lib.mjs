// Shared by the end-to-end tests: two "phones" (separate browser contexts at 390×844) against the
// emulators (npm start) or E2E_URL, screenshots in tests/e2e/screens/, and the steps every test repeats.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// require() (unlike import) also finds a globally installed Playwright
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/screens');
export const URL = process.env.E2E_URL || 'http://localhost:3000';
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two phones, with every page error and console error collected in `errors` (fonts and blocked
// network requests aside). Uses Chromium's full browser/new headless implementation: on macOS the
// separate headless shell can crash natively after a long multi-game session.
export async function twoPhones() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.E2E_CHANNEL || 'chromium', executablePath: process.env.E2E_EXECUTABLE_PATH || undefined });
  const a = await (await browser.newContext(PHONE)).newPage(), b = await (await browser.newContext(PHONE)).newPage();
  const errors = [];
  for (const [n, p] of [['A', a], ['B', b]]) {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::|requestStorageAccess/.test(m.text())) errors.push(`${n}: ${m.text()}`); });
  }
  return { browser, a, b, errors };
}

// a screenshot, after `wait` ms so animations can finish; with CAPTURE=<dir> the page's DOM is saved
// there too, for tests/visual/compare.mjs
export async function snap(p, name, wait = 0) {
  if (wait) await p.waitForTimeout(wait);
  await p.screenshot({ path: path.join(SHOTS, name + '.png') });
  if (process.env.CAPTURE) fs.writeFileSync(path.join(process.env.CAPTURE, name + '.html'), await p.evaluate(() => document.documentElement.outerHTML));
}
export const until = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout });
export const state = (p, expr) => p.evaluate(expr);

// A sets up a table, B joins it with the code; both end up at the shelf. Returns the code.
export async function setUpTable(a, b, names = ['Niramay', 'Saharsh']) {
  await a.fill('#nameInput', names[0]);
  await a.getByRole('button', { name: 'Set up a table', exact: true }).click();
  await a.locator('.code-card .tile').first().waitFor();
  const code = await a.evaluate(() => G.code);
  await b.fill('#nameInput', names[1]);
  await b.getByRole('button', { name: 'Join with a code', exact: true }).click();
  await b.fill('#codeInput', code);
  await a.locator('.gbox').first().waitFor({ timeout: 8000 });
  await b.locator('.gbox').first().waitFor({ timeout: 8000 });
  return code;
}

// Until this phone has finished showing the last RPS round: the verdict is gone and either the
// choices are open again, the starter card is up, or the game has moved on.
export const rpsSettled = (p) => until(p, () => !document.querySelector('.verdict')?.children.length
  && (!document.querySelector('.rps') || !!document.querySelector('.starter-card') || !!document.querySelector('.choices:not(.locked)')));

// One round of rock, paper, scissors: A picks, then B, then both phones play the reveal.
export async function rpsRound(a, b, pa, pb) {
  const round = await state(a, 'rpsState(G.match).rounds.length');
  await a.locator('.choices:not(.locked)').waitFor();
  await b.locator('.choices:not(.locked)').waitFor();
  await a.locator('.choices .hand', { hasText: pa }).click();
  await sleep(250);
  await b.locator('.choices .hand', { hasText: pb }).click();
  await Promise.all([a, b].map((p) => until(p, (n) => rpsState(G.match).rounds.length > n, round)));
  await Promise.all([a, b].map(rpsSettled));
}
