// Word Wheel on two phones against the emulators: the RPS winner spins, both phones get the same
// wheel, words are made by swiping across the letters (real pointer moves, routed round the rim so
// they don't brush other letters), sliding back takes a letter off, short words, words without the
// middle letter, non-words and the partner's words are refused without being written, the keyboard
// types too, and the first to five wins on both phones with the result recorded.
//   run by npm run test:e2e (or: node tests/e2e/wordwheel.mjs with npm start running)
import assert from 'node:assert/strict';
import { twoPhones, URL, sleep, snap as shot, until, setUpTable, rpsRound, junk } from './lib.mjs';
const { browser, a, b, errors } = await twoPhones();
const snap = (p, name) => shot(p, name, 350);
const ok = (msg) => console.log('  ok ' + msg);
const finds = (p) => p.evaluate(() => Object.keys(G.match.finds || {}).length);
const status = (p) => p.locator('.ww-status').innerText();
const wheelOf = (p) => p.evaluate(() => { const w = wwState(G.match).wheel; return { c: w.c, o: w.o, words: [...w.words] }; });
const lettersOn = (p) => p.evaluate(() => [...document.querySelectorAll('.ww-l')].map((el) => el.textContent).sort().join(''));

// Swipes `word` across the wheel: down on its first letter, then to each next one by going out to the
// rim, round it, and back in (to the middle, in along a spoke), so the finger never crosses a letter it
// doesn't mean. `back` slides onto these letters and back off first (to check undoing).
async function swipe(p, word, { back = '', hold = false } = {}) {
  const g = await p.evaluate((w) => {
    const els = [...document.querySelectorAll('.ww-l')], r = document.querySelector('.ww-wheel').getBoundingClientRect(), used = new Set();
    const at = (ch) => { const i = [8, 0, 1, 2, 3, 4, 5, 6, 7].find((k) => els[k].textContent === ch && !used.has(k)); used.add(i); const e = els[i].getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2]; };
    return { pts: [...w].map(at), cx: r.x + r.width / 2, cy: r.y + r.height / 2, S: r.width };
  }, word + back);
  const { cx, cy, S } = g, rim = S * 0.45;
  const polar = ([x, y]) => [Math.hypot(x - cx, y - cy), Math.atan2(y - cy, x - cx)];
  const xy = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  const go = ([x, y]) => p.mouse.move(x, y, { steps: 3 });
  async function round(from, to) { // along the rim from one angle to another, the short way
    let d = to - from; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(d) / 0.15));
    for (let k = 1; k <= n; k++) await go(xy(rim, from + (d * k) / n));
  }
  const spoke = (ang) => Math.round((ang + Math.PI / 2) / (Math.PI / 4)) * (Math.PI / 4) - Math.PI / 2;
  async function hop(from, to) {
    const [r0, a0] = polar(from), [r1, a1] = polar(to);
    const out = r0 < 5 ? spoke(a1) : a0, inn = r1 < 5 ? spoke(a0) : a1;
    await go(xy(rim, out)); await round(out, inn); await go(r1 < 5 ? [cx, cy] : to);
  }
  const pts = g.pts.slice(0, word.length), extra = g.pts.slice(word.length);
  await go(pts[0]); await p.mouse.down();
  for (let k = 1; k < pts.length; k++) await hop(pts[k - 1], pts[k]);
  if (extra.length) { await hop(pts[pts.length - 1], extra[0]); await hop(extra[0], pts[pts.length - 1]); }
  if (!hold) await p.mouse.up();
}
// a word from the wheel nobody has found yet, not in `skip`
const fresh = async (p, skip = []) => { const w = await wheelOf(p); const f = await p.evaluate(() => [...wwState(G.match).found.keys()]); return w.words.find((x) => !f.includes(x) && !skip.includes(x)); };
async function claim(p, word) {
  const n = await p.evaluate(() => Object.keys(G.match.finds || {}).length);
  await swipe(p, word);
  await Promise.all([a, b].map((q) => until(q, ([k, w]) => Object.keys(G.match.finds || {}).length > k && wwState(G.match).found.has(w), [n, word])));
}

try {
  await Promise.all([a, b].map((p) => p.goto(URL)));
  await setUpTable(a, b);
  assert.equal(await a.locator('.cubby .gbox').count(), 5);
  await snap(a, 'ww-01-shelf');
  ok('Word Wheel is the fifth game on the shelf');

  // ---- open it, RPS, the winner spins ----
  await a.locator('.gbox.ww').click(); await a.locator('#sheet').getByRole('button', { name: 'Play Word Wheel' }).click();
  await b.locator('#sheet').getByRole('button', { name: 'Join' }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it' }).click(); }
  await rpsRound(a, b, 'Rock', 'Scissors'); await rpsRound(a, b, 'Paper', 'Rock');
  await Promise.all([a, b].map((p) => p.locator('.ww-spin').waitFor({ timeout: 10000 })));
  assert.equal(await b.getByRole('button', { name: 'Spin the wheel' }).count(), 0, 'only the RPS winner spins');
  await snap(a, 'ww-02-spin');
  await a.getByRole('button', { name: 'Spin the wheel' }).click();
  await Promise.all([a, b].map((p) => until(p, () => document.querySelector('.ww-wheel') && !/Spinning/.test(document.querySelector('.ww-status').textContent))));
  assert.equal(await lettersOn(a), await lettersOn(b), 'the same nine letters on both phones');
  const wheel = await wheelOf(a);
  assert.equal(await lettersOn(a), [...wheel.c + wheel.o].sort().join(''));
  ok(`A spun wheel ${await a.evaluate(() => G.match.ww.n)}: ${wheel.c} in the middle of ${wheel.o}, ${wheel.words.length} words`);

  // ---- refusals: nothing is written ----
  await swipe(a, wheel.c + wheel.o.slice(0, 2));
  assert.equal(await status(a), 'Four letters or more');
  const noMiddle = [...wheel.o].filter((ch) => ch !== wheel.c).slice(0, 4).join('');
  await swipe(a, noMiddle);
  assert.equal(await status(a), `Every word needs the middle ${wheel.c}`);
  let junkWord = null;
  for (let i = 0; i < 8 && !junkWord; i++) { const w = wheel.c + wheel.o.slice(i) + wheel.o.slice(0, i); for (const n of [4, 5]) if (!wheel.words.includes(w.slice(0, n)) && !/[^S]S$/.test(w.slice(0, n))) { junkWord = w.slice(0, n); break; } }
  await swipe(a, junkWord);
  assert.equal(await status(a), `${junkWord} isn’t a word here`);
  assert.equal(await a.locator('.ww-word .tile.wrong').count(), junkWord.length, 'the refused word stays on the tiles while the note is up');
  await snap(a, 'ww-03-refused');
  assert.equal(await finds(a), 0);
  ok('short, no-middle and non-words are refused and never written');

  // ---- a word by swiping, sliding back over one letter first ----
  const w1 = await fresh(a);
  await swipe(a, w1, { back: [...wheel.c + wheel.o].find((ch) => !w1.includes(ch)) || '', hold: true });
  assert.equal(await a.locator('.ww-word .tile').allInnerTexts().then((t) => t.join('')), w1, 'sliding back took the extra letter off');
  assert.ok((await a.evaluate(() => document.querySelector('.ww-trail polyline').getAttribute('points').split(' ').length)) > w1.length, 'the trail runs on to the finger');
  await snap(a, 'ww-04-swiping');
  await a.mouse.up();
  await Promise.all([a, b].map((q) => until(q, (w) => wwState(G.match).found.get(w) === 'host', w1)));
  await until(b, (w) => document.querySelectorAll('.ww-col')[1].textContent.includes(w), w1);
  assert.equal(await a.locator('.ww-sb .sb-side').first().locator('b').innerText(), '1');
  assert.ok((await status(b)).includes(`Niramay found ${w1}`));
  ok(`A swiped ${w1}: it scores on both phones`);

  // ---- B can't take A's word; B types one on the keyboard ----
  await swipe(b, w1);
  assert.equal(await status(b), `Niramay already found ${w1}`);
  assert.equal(await finds(b), 1);
  const w2 = await fresh(b);
  await b.keyboard.type(w2.toLowerCase()); await b.keyboard.press('Enter');
  await Promise.all([a, b].map((q) => until(q, (w) => wwState(G.match).found.get(w) === 'guest', w2)));
  await snap(b, 'ww-05-found');
  // a small phone: the wheel still fits, with letters at least 44 px across
  await b.setViewportSize({ width: 320, height: 640 });
  await sleep(300);
  const small = await b.evaluate(() => { const w = document.querySelector('.ww-wheel').getBoundingClientRect(), l = document.querySelector('.ww-l').getBoundingClientRect(), f = document.querySelector('.ww-found').getBoundingClientRect(); return { w: w.width, l: l.width, foundTop: f.top, wide: document.documentElement.scrollWidth }; });
  assert.ok(small.l >= 44 && small.wide <= 320 && small.foundTop < 640 - 60, JSON.stringify(small));
  await snap(b, 'ww-05-small');
  await b.setViewportSize({ width: 390, height: 844 });
  ok(`B was refused ${w1} and typed ${w2}`);

  // ---- save, carry on: nobody can play until both are back ----
  const sheetBtn = (p, name) => p.locator('#sheet').getByRole('button', { name, exact: true }).click();
  await a.locator('#bar [aria-label="Back to the shelf"]').click(); await sheetBtn(a, 'Save and quit');
  await b.locator('#sheet .panel', { hasText: 'Niramay saved Word Wheel' }).waitFor({ timeout: 8000 }); await sheetBtn(b, 'OK');
  await a.locator('.gbox.ww .sticker.saved').waitFor({ state: 'visible', timeout: 8000 });
  await a.locator('.gbox.ww').click(); await sheetBtn(a, 'Carry on the saved game');
  await b.locator('#sheet .panel', { hasText: 'Niramay wants to carry on Word Wheel' }).waitFor({ timeout: 8000 });
  await a.locator('.ww-wheel').waitFor();
  assert.equal(await status(a), 'Waiting for Saharsh to join…');
  await swipe(a, await fresh(a));
  await sleep(600);
  assert.equal(await finds(a), 2, 'nothing is written before the partner is back');
  await sheetBtn(b, 'Carry on');
  await Promise.all([a, b].map((p) => until(p, () => /middle/.test(document.querySelector('.ww-status')?.textContent || ''))));
  assert.equal(await b.locator('.ww-col').nth(1).locator('li').count(), 1, 'the saved finds are back');
  ok('a saved game carries on, and can’t be played until both are back');

  // ---- A races to five ----
  for (let k = 0; k < 4; k++) await claim(a, await fresh(a));
  await a.locator('#sheet .panel').waitFor({ timeout: 8000 }); await b.locator('#sheet .panel').waitFor({ timeout: 8000 });
  assert.ok((await a.locator('#sheet').innerText()).includes('You win, 5–1!'));
  assert.ok((await b.locator('#sheet').innerText()).includes('Niramay wins, 5–1'));
  assert.ok((await a.locator('#sheet').innerText()).includes('nine-letter word was'));
  await until(a, () => G.table.results[G.matchId] && G.table.results[G.matchId].w === 'host');
  await snap(b, 'ww-06-end');
  await a.locator('#sheet').getByRole('button', { name: 'Back to the shelf' }).click();
  await snap(a, 'ww-07-over');
  for (const p of [a, b]) assert.equal(await junk(p), null);
  ok('first to five wins on both phones, and the result is recorded');
  assert.deepEqual(errors, []);
  ok('no browser errors');
} catch (e) {
  await snap(a, 'ww-ERR-a').catch(() => {}); await snap(b, 'ww-ERR-b').catch(() => {});
  console.error(await a.evaluate(() => G.match && JSON.stringify({ ww: G.match.ww, finds: G.match.finds })).catch(() => ''));
  console.error(errors);
  throw e;
} finally { await browser.close(); }
