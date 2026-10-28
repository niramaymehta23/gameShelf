// The screen stays awake while a game is open: the lock is taken when a game opens, asked for again
// after the phone comes back from being locked or switched away (the browser drops it), and let go
// on the way back to the shelf. navigator.wakeLock is faked, since headless Chromium won't grant one.
//   run by npm run test:e2e (or: node tests/e2e/wake-lock.mjs with npm start running)
import assert from 'node:assert/strict';
import { twoPhones, URL, until, setUpTable } from './lib.mjs';

const { browser, a, b, errors } = await twoPhones();
// a lock the "browser" drops when the page is hidden, as real ones are
const fakeWakeLock = () => {
  window.__locks = { requests: 0, held: 0 };
  const request = async () => {
    __locks.requests++; __locks.held++;
    const lock = new EventTarget();
    let on = true;
    lock.release = async () => { if (!on) return; on = false; __locks.held--; lock.dispatchEvent(new Event('release')); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lock.release(); });
    return lock;
  };
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
};
const setHidden = (p, hidden) => p.evaluate((x) => { Object.defineProperty(document, 'visibilityState', { value: x ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
const locks = (p) => p.evaluate(() => ({ ...window.__locks }));

try {
  await a.context().addInitScript(fakeWakeLock);
  await Promise.all([a, b].map((p) => p.goto(URL)));
  await setUpTable(a, b);
  assert.deepEqual(await locks(a), { requests: 0, held: 0 }, 'no lock at the shelf');

  await a.locator('.gbox.c4').click();
  await a.locator('#sheet').getByRole('button', { name: 'Play Connect Four' }).click();
  await a.locator('.howto-card').waitFor();
  await until(a, () => __locks.held === 1);
  console.log('  ok the screen is kept awake once a game opens');

  await setHidden(a, true);
  assert.equal((await locks(a)).held, 0, 'the browser dropped it while hidden');
  await setHidden(a, false);
  await until(a, () => __locks.held === 1 && __locks.requests === 2);
  console.log('  ok asked for again after coming back to the game');

  await a.locator('#bar [aria-label="Back to the shelf"]').click();
  await a.locator('.gbox').first().waitFor();
  await until(a, () => __locks.held === 0);
  await setHidden(a, true); await setHidden(a, false);
  await a.waitForTimeout(200);
  assert.deepEqual(await locks(a), { requests: 2, held: 0 }, 'not asked for at the shelf');
  console.log('  ok let go at the shelf, and not taken again there');
  assert.deepEqual(errors, []);
  console.log('  ok no browser errors');
} catch (e) {
  console.error(errors);
  throw e;
} finally { await browser.close(); }
