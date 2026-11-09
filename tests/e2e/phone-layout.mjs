// All main app screens stay within the phone viewport; bounded shelves, help and history
// retain their own content scrolling. Real game screens render from emulator fixture matches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { twoPhones, URL, sleep, snap, until } from './lib.mjs';
const { browser, a, b, errors } = await twoPhones();
const sizes = [[360, 640], [360, 780], [390, 844], [402, 874]];
const reports = [];
const matchIds = [];
let ownedCode = null;
const docScreens = new Set(['shelf', 'connect-four', 'ships-battle', 'hues', 'quickfire-sums', 'word-wheel', 'word-slam']);
if (process.env.DOC_SHOTS === '1') fs.mkdirSync('docs/screenshots', { recursive: true });
async function inspect(name, page = a) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await sleep(450);
    const r = await page.evaluate(() => {
      const el = document.querySelector('#stage > .screen:not(.leaving)');
      const outside = [...el.querySelectorAll('button:not([hidden]), input:not([type=hidden])')].filter((e) => {
        const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return false;
        // Controls intentionally within a bounded content scroller are reachable there.
        if (e.closest('.cubby, .sheet-content, .table-history-list, .hu-hand')) return false;
        return r.bottom > innerHeight + 2 || r.top < 0 || r.left < -2 || r.right > innerWidth + 2;
      }).map((e) => e.className || e.id);
      return { scroll: el.scrollHeight - el.clientHeight, horizontal: document.documentElement.scrollWidth - innerWidth, outside };
    });
    reports.push({ name, width, height, ...r });
    if (process.env.LAYOUT_REPORT !== '1') assert.ok(r.scroll <= 2 && r.horizontal <= 1 && !r.outside.length, JSON.stringify(reports.at(-1)));
    await snap(a, `phone-${name}-${width}x${height}`);
    if (process.env.DOC_SHOTS === '1' && width === 390 && height === 844 && docScreens.has(name)) await page.screenshot({ path: `docs/screenshots/${name}.png`, scale: 'css' });
  }
}
let seq = 0;
async function fixture(game, patch, selector) {
  const id = 'phone' + Date.now().toString(36) + seq++; matchIds.push(id);
  await Promise.all([a, b].map((p) => p.evaluate((id) => {
    Pref.set('intro:' + id, '1'); Pref.set('howto:' + id, '1'); Pref.set('ww-spun:' + id, '1');
  }, id)));
  await a.evaluate(async ({ id, game, patch }) => {
    await Net.doc(matchPath(id)).set({ id, game, seed: 'phone-layout', by: 'host', created: Date.now(),
      joined: { host: true, guest: true }, rps: { r1: { host: 'rock', guest: 'scissors' }, r2: { host: 'paper', guest: 'rock' } },
      moves: {}, shots: {}, plays: {}, fleets: {}, ...patch });
    await Net.doc(tablePath()).update({ current: id });
  }, { id, game, patch });
  await until(a, ({ id, selector }) => G.match?.id === id && !!document.querySelector(selector), { id, selector });
  await sleep(550);
}
try {
  await Promise.all([a, b].map((p) => p.goto(URL)));
  await inspect('landing');
  await a.fill('#nameInput', 'Niramay'); await a.getByRole('button', { name: 'Set up a table', exact: true }).click();
  await a.locator('.code-card').waitFor(); await inspect('waiting');
  const code = await a.evaluate(() => G.code); ownedCode = code;
  await b.fill('#nameInput', 'Saharsh'); await b.getByRole('button', { name: 'Join with a code', exact: true }).click(); await inspect('join', b); await b.fill('#codeInput', code);
  await Promise.all([a, b].map((p) => p.locator('.gbox').first().waitFor())); await sleep(2700); await inspect('shelf');
  await fixture('c4', { rps: {} }, '.rps'); await inspect('rock-paper-scissors');
  await fixture('c4', { moves: { m000: 3, m001: 4, m002: 2, m003: 3 } }, '.c4-board'); await inspect('connect-four');
  await fixture('bs', {}, '.dock'); await inspect('ships-placement');
  const fleet = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'].map((id, r) => ({ id, r, c: 0, v: false }));
  await a.evaluate(async (fleet) => { await Net.doc(matchPath(G.match.id)).update({ fleets: { host: fleet, guest: fleet } }); }, fleet);
  await a.locator('.bs-grid.target').waitFor(); await sleep(200);
  assert.equal(await a.locator('#toast .toast', { hasText: 'Both fleets are hidden' }).count(), 1, 'announce the actual placement-to-battle transition once');
  await sleep(2700); await inspect('ships-battle');
  assert.equal(await a.locator('#toast .toast', { hasText: 'Both fleets are hidden' }).count(), 0, 'resizing does not replay the announcement');
  const oldMatch = await a.evaluate(() => { matchToast(G.match.id, 'Both fleets are hidden. Battle stations!', 10000); return G.match.id; });
  await fixture('hu', { hueVersion: 2, hueRules: 'custom' }, '.hu-hand');
  assert.equal(await a.locator('#toast [data-match]').count(), 0, 'old game feedback is removed when opening Hues');
  assert.equal(await a.evaluate((id) => matchToast(id, 'Late Battleships animation') === null, oldMatch), true, 'late feedback cannot appear in another game');
  await inspect('hues');
  await fixture('qf', { qf: { by: 'host', mode: 'words', len: 4, side: 'start' } }, '.qf'); await inspect('quickfire-pick');
  await fixture('qf', { qf: { by: 'host', mode: 'sums', op: 'add' }, picks: { r001: { host: 100, guest: 100 } } }, '.qf-pad'); await inspect('quickfire-sums');
  await fixture('ww', { ww: { by: 'host', n: 0 } }, '.ww-wheel'); await inspect('word-wheel');
  await fixture('sl', { slamVersion: 2 }, '.sl-hand'); await inspect('word-slam');
  await fixture('sw', {}, '.sw-setup'); await inspect('sharp-wits-setup');
  for (const [g, sel] of [['spot', '.sw-panel'], ['copy', '.sw-dot'], ['ink', '.sw-ink-btn'], ['hunt', '.sw-cell'], ['shade', '.sw-shade-grid'], ['pairs', '.sw-card'], ['way', '.sw-way-btn'], ['flash', '.sw-tile']]) {
    await fixture('sw', { sw: { by: 'host', g } }, sel); await sleep(2200); await inspect('sharp-wits-' + g);
  }
  await a.evaluate(() => { closeTable(); route(); }); await a.locator('#nameInput').waitFor(); await inspect('landing-history');
  console.log(JSON.stringify(reports, null, 2));
  assert.deepEqual(errors, []); console.log(process.env.LAYOUT_REPORT === '1' ? '  layout report complete' : '  ok main screens fit compact, Samsung-sized and iPhone-sized viewports; game notices stay with their match');
} finally {
  // Delete only the temporary table and fixture IDs created by this run, including live smoke tests.
  if (ownedCode) await a.evaluate(async ({ code, ids }) => {
    const ref = FB.fs.doc('tables/' + code), snap = await ref.get();
    if (!snap.exists || snap.data().host.dev !== G.dev) return;
    for (const id of ids) await FB.fs.doc(`tables/${code}/matches/${id}`).delete();
    await ref.delete();
  }, { code: ownedCode, ids: matchIds }).catch((e) => console.warn('Layout fixture cleanup:', e.message));
  await browser.close();
}
