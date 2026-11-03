import assert from 'node:assert/strict';
import { twoPhones, URL, sleep, snap, until, setUpTable, rpsRound, junk } from './lib.mjs';
const { browser, a, b, errors } = await twoPhones();
a.setDefaultTimeout(12000); b.setDefaultTimeout(12000);
// Firestore's real transaction retries can return HTTP 400 FAILED_PRECONDITION when
// this test deliberately races two commits. Whitelist only that response plus its
// matching browser resource warning; JavaScript errors and other HTTP errors still fail.
const retries = { A: { response: 0, console: 0 }, B: { response: 0, console: 0 } };
const commitURL = (url) => url.startsWith('http://localhost:8080/') && url.endsWith('/documents:commit');
for (const [name, p] of [['A', a], ['B', b]]) {
  p.on('response', async (r) => {
    if (r.status() !== 400 || !commitURL(r.url())) return;
    try { const body = await r.json(); if (body.error?.status === 'FAILED_PRECONDITION' && /stored version.*required base version/.test(body.error.message)) retries[name].response++; } catch (_) {}
  });
  p.on('console', (m) => { if (m.type() === 'error' && commitURL(m.location().url || '') && /status of 400/.test(m.text())) retries[name].console++; });
}

const state = (p) => p.evaluate(() => {
  const s = slState(G.match), eligible = s.opening ? [s.starter] : ['host', 'guest'];
  const available = Object.fromEntries(['host', 'guest'].map((by) => [by, slOptions(s, by)]));
  const actor = eligible.find((by) => available[by].length) || eligible.find((by) => !s.passed[by]);
  return { ...s, actor, available, options: available[actor], mine: G.seat };
});
const count = (p) => p.evaluate(() => Object.keys(G.match.plays || {}).length);
const agree = async () => assert.deepEqual(await a.evaluate(() => slState(G.match)), await b.evaluate(() => slState(G.match)));
async function started() {
  await rpsRound(a, b, 'Rock', 'Scissors'); await rpsRound(a, b, 'Paper', 'Rock');
  await Promise.all([a, b].map((p) => p.locator('.sl-hand').waitFor()));
}
async function face(p, e) {
  if (await p.locator(`[data-card="${e.id}"]`).getAttribute('aria-pressed') !== 'true') await p.locator(`[data-card="${e.id}"]`).tap();
  const shown = await p.locator(`[data-card="${e.id}"] b`).innerText();
  if (shown === '☆' || await p.evaluate((id) => SL_CARDS[id] === '*', e.id)) {
    await p.getByRole('button', { name: 'Choose letter', exact: true }).click();
    await p.locator('.sl-alphabet').getByRole('button', { name: e.letter, exact: true }).click();
    await p.locator('#sheet').waitFor({ state: 'hidden' });
  } else if (shown !== e.letter) await p.getByRole('button', { name: `Flip to ${e.letter}`, exact: true }).click();
}
async function move(p, e, drag = false) {
  const n = await count(p);
  if (e.k === 'pass') await p.locator('.sl-pass').click();
  else {
    await face(p, e);
    await sleep(180);
    if (drag) {
      const from = await p.locator(`[data-card="${e.id}"]`).boundingBox(), to = await p.locator('.sl-word button').nth(e.pos).boundingBox();
      let touch;
      if (drag === 'touch') {
        touch = await p.context().newCDPSession(p);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
        for (let i = 1; i <= 16; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + from.width / 2 + (to.x + to.width / 2 - from.x - from.width / 2) * i / 16, y: from.y + from.height / 2 + (to.y + to.height / 2 - from.y - from.height / 2) * i / 16 }] });
      } else {
        await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
        await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
      }
      if (await p.locator('.drop-target').count() !== 1) { await snap(p, 'sl-ERR-drop'); console.log('drag failure', { e, from, to, state: await state(p), status: await p.locator('.sl-status').innerText(), ghost: await p.locator('.sl-ghost').count() }); }
      assert.equal(await p.locator('.drop-target').count(), 1);
      if (touch) { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); } else await p.mouse.up();
    } else await p.locator('.sl-word button').nth(e.pos).tap();
  }
  await Promise.all([a, b].map((q) => until(q, (v) => Object.keys(G.match.plays || {}).length === v, n + 1)));
  await until(p, () => !/Putting your card/.test(document.querySelector('.sl-status').textContent));
  await agree();
}
try {
  await Promise.all([a, b].map((p) => p.goto(URL))); await setUpTable(a, b);
  assert.equal(await a.locator('.cubby .gbox').count(), 6);
  await a.locator('.gbox.sl').scrollIntoViewIfNeeded(); await snap(a, 'sl-01-shelf');
  await a.locator('.gbox.sl').click(); await a.getByRole('button', { name: 'Play Word Slam', exact: true }).click();
  await b.locator('#sheet').getByRole('button', { name: 'Join', exact: true }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it', exact: true }).click(); }
  await started(); await agree(); console.log('  ok RPS and deal');
  assert.equal(await a.locator('.sl-card').count(), 10); assert.equal(await b.locator('.sl-card').count(), 10);
  assert.equal((await state(a)).turn, 'host'); assert.ok(await b.locator('.sl-card').first().isDisabled());
  await snap(a, 'sl-02-hand');
  const first = (await state(a)).options[0]; assert.ok(first);
  // A real invalid placement leaves the hand and append-only log alone.
  const bad = await a.evaluate(() => {
    const s = slState(G.match);
    for (const id of s.hands.host) if (SL_CARDS[id] !== '*') for (const letter of SL_CARDS[id]) for (let pos = 0; pos < 4; pos++) {
      const e = { k: 'play', by: 'host', id, pos, letter }; if (slError(s, e).includes('isn’t a word')) return e;
    }
  });
  await face(a, bad); await a.locator('.sl-word button').nth(bad.pos).click();
  assert.match(await a.locator('.sl-status').innerText(), /isn’t a word/); assert.equal(await count(a), 0);
  // A real touch cancellation while dragging another card preserves the visible selection.
  const cdp = await a.context().newCDPSession(a);
  const alternate = (await state(a)).hands.host.find((id) => id !== bad.id);
  await sleep(180);
  const ar = await a.locator(`[data-card="${alternate}"]`).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ar.x + ar.width / 2, y: ar.y + ar.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 380 }] });
  assert.equal(await a.locator('.sl-ghost').count(), 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await a.locator('.sl-card.selected').getAttribute('data-card'), String(bad.id));
  assert.equal(await a.locator('.sl-ghost').count(), 0); assert.equal(await count(a), 0);
  await cdp.detach();
  // A drop outside the word never spends a card.
  const card = a.locator(`[data-card="${bad.id}"]`), r = await card.boundingBox();
  await a.mouse.move(r.x + 20, r.y + 20); await a.mouse.down(); await a.mouse.move(10, 100, { steps: 8 }); await a.mouse.up();
  assert.equal(await count(a), 0); assert.equal(await a.locator('.sl-ghost').count(), 0);
  await a.locator('.sl-pass').click(); assert.match(await a.locator('.sl-status').innerText(), /can still play/);
  // Reset selection then make a tap move and a drag move on alternate phones.
  // face() works from an unselected card.
  if (await a.locator(`[data-card="${first.id}"]`).getAttribute('aria-pressed') === 'true') await a.locator(`[data-card="${first.id}"]`).click();
  await move(a, first); assert.equal(await a.locator('.sl-card').count(), 9);
  let s = await state(b);
  assert.equal(s.opening, false); assert.ok(await a.locator('.sl-card').first().isEnabled()); assert.ok(await b.locator('.sl-card').first().isEnabled());
  const second = s.available.guest[0] || { k: 'pass', by: 'guest' };
  await move(b, second, second.k === 'play' ? 'touch' : false); await snap(b, 'sl-03-dragged');
  // The same player can immediately play again, with no opponent turn required.
  s = await state(a);
  if (s.available.host.length) await move(a, s.available.host[0]);
  // Hold both transaction starts so both drops refer to precisely the same revision.
  // Real Firestore transactions decide the collision; one card is spent, the other stays held.
  s = await state(a);
  if (s.available.host.length && s.available.guest.length) {
    const moves = [s.available.host[0], s.available.guest[0]], n = await count(a);
    await Promise.all([a, b].map((p, i) => face(p, moves[i])));
    for (const p of [a, b]) await p.evaluate(() => {
      window.slOriginalTx = FB.fs.runTransaction.bind(FB.fs);
      const gate = new Promise((resolve) => { window.slReleaseTx = resolve; });
      FB.fs.runTransaction = (fn) => gate.then(() => window.slOriginalTx(fn));
    });
    await Promise.all([a, b].map((p, i) => p.locator('.sl-word button').nth(moves[i].pos).tap()));
    await Promise.all([a, b].map((p) => p.evaluate(() => window.slReleaseTx())));
    await Promise.all([a, b].map((p) => until(p, () => !/Putting your card/.test(document.querySelector('.sl-status').textContent))));
    assert.equal(await count(a), n + 1); await agree();
    const latest = await state(a), spent = latest.log.at(-1).by;
    for (const e of moves) assert.equal(latest.hands[e.by].includes(e.id), e.by !== spent);
    for (const p of [a, b]) await p.evaluate(() => { FB.fs.runTransaction = window.slOriginalTx; });
    console.log('  ok simultaneous plays serialize; stale drop keeps its card');
  }
  // A failed offline transaction cannot remove a card; reconnect restores ordinary play.
  s = await state(a);
  const offlinePlayer = s.actor === 'host' ? a : b, offlineMove = s.options[0];
  if (offlineMove) {
    const n = await count(offlinePlayer);
    await offlinePlayer.context().setOffline(true); await face(offlinePlayer, offlineMove);
    await offlinePlayer.locator('.sl-word button').nth(offlineMove.pos).tap();
    await until(offlinePlayer, () => !/Putting your card/.test(document.querySelector('.sl-status').textContent), null, 22000);
    assert.equal(await count(offlinePlayer), n);
    await offlinePlayer.context().setOffline(false);
    await until(offlinePlayer, () => Net.online, null, 15000);
    await move(offlinePlayer, offlineMove);
  }
  // Reload replays the same cards and word, without dealing again.
  const before = await a.evaluate(() => slState(G.match)); await a.reload(); await a.locator('.sl-hand').waitFor();
  assert.deepEqual(await a.evaluate(() => slState(G.match)), before);
  // Save and carry on through the same shelf flow as every other game.
  await a.getByRole('button', { name: 'Back to the shelf', exact: true }).click();
  await a.getByRole('button', { name: 'Save and quit', exact: true }).click();
  await a.locator('.gbox.sl').waitFor();
  await b.locator('#sheet').getByRole('button', { name: 'OK' }).click();
  await a.locator('.gbox.sl').click(); await a.getByRole('button', { name: 'Carry on the saved game', exact: true }).click();
  await b.locator('#sheet').getByRole('button', { name: 'Carry on', exact: true }).click();
  await Promise.all([a, b].map((p) => p.locator('.sl-hand').waitFor())); await agree();
  assert.deepEqual(await a.evaluate(() => slState(G.match)), before);
  // Find a legal route from this actual shuffled deal to a genuine dead end, then play it
  // through the UI. Search choices vary; neither hands nor the current word are injected.
  const blockedPath = await a.evaluate(() => {
    for (let trial = 0; trial < 200; trial++) {
      const m = clone(G.match), path = [];
      for (let i = 0; i < 35; i++) {
        const s = slState(m); if (s.winner) break;
        const options = ['host', 'guest'].flatMap((by) => slOptions(s, by));
        if (!options.length && !s.opening) return path;
        const safe = options.filter((e) => s.hands[e.by].length > 1);
        if (!safe.length) break;
        const e = safe[(trial * 17 + i * 7) % safe.length]; path.push(e);
        m.plays['p' + String(Object.keys(m.plays).length).padStart(5, '0')] = e;
      }
    }
    return null;
  });
  assert.ok(blockedPath, 'a real blocked position is reachable from this deal');
  for (const e of blockedPath) await move(e.by === 'host' ? a : b, e);
  s = await state(a); assert.equal(s.available.host.length + s.available.guest.length, 0);
  const blocked = s, n = await count(a);
  // Both declarations may arrive at once. A second declaration can rebase across the first
  // declaration because its word is unchanged, but cannot rebase across somebody's play.
  await Promise.all([a, b].map((p) => p.locator('.sl-pass').tap()));
  await Promise.all([a, b].map((p) => until(p, (v) => slState(G.match).refreshes === v, blocked.refreshes + 1)));
  assert.equal(await count(a), n + 2); await agree();
  s = await state(a); assert.deepEqual(s.hands, blocked.hands); assert.notEqual(s.word, blocked.word);
  assert.equal(s.winner, null); assert.ok(s.available.host.length + s.available.guest.length);
  await sleep(350); await snap(a, 'sl-08-fresh-word'); console.log('  ok both blocked: checked fresh word, same remaining cards, race continues');
  // Complete the race through the UI. A pass cannot end it; the only winner empties a hand.
  for (let i = 0; i < 70; i++) {
    s = await state(a); if (s.winner) break;
    const p = s.actor === 'host' ? a : b, e = s.options[0] || { by: s.actor, k: 'pass' };
    await move(p, e, i % 2 === 0 && e.k === 'play');
  }
  s = await state(a); assert.ok(s.winner); await agree(); console.log('  ok full game', s.winner);
  await Promise.all([a, b].map((p) => until(p, () => !!G.table.results?.[G.match.id])));
  await a.locator('#sheet').getByRole('button', { name: 'Rematch', exact: true }).waitFor(); await snap(a, 'sl-04-end');
  console.log('  checking stats');
  const stats = await a.evaluate(async () => { const s = await loadTableStats(); return { played: s.played.sl, log: s.log[0], cards: s.sl.host.cards + s.sl.guest.cards }; });
  console.log('  ok stats replay');
  assert.equal(s.reason, 'empty'); assert.equal(s.hands[s.winner].length, 0); assert.match(stats.log.note, /fresh word/);
  assert.equal(stats.played, 1); assert.equal(stats.log.g, 'sl'); assert.equal(stats.cards, s.log.filter((e) => e.k === 'play').length);
  // Use the end sheet's actual Rematch action: RPS starts again and both get ten cards.
  await a.locator('#sheet').getByRole('button', { name: 'Rematch', exact: true }).click();
  await b.locator('#sheet').getByRole('button', { name: 'Join', exact: true }).click();
  for (const p of [a, b]) { await p.locator('.howto-card').waitFor(); await p.locator('.howto-card').getByRole('button', { name: 'Got it', exact: true }).click(); }
  await started(); assert.equal(await a.locator('.sl-card').count(), 10); assert.equal(await b.locator('.sl-card').count(), 10);
  for (const [width, height] of [[320, 640], [360, 640], [360, 780], [390, 844], [402, 874], [1280, 844]]) {
    await a.setViewportSize({ width, height }); await sleep(250);
    const fits = async () => a.evaluate(() => {
      const screen = document.querySelector('.screen.match'), game = document.querySelector('.sl-game').getBoundingClientRect();
      const targets = [...document.querySelectorAll('.sl-card, .sl-word button, .sl-pass:not([hidden]), .sl-flip')].map((e) => e.getBoundingClientRect());
      return { horizontal: document.documentElement.scrollWidth <= innerWidth, vertical: screen.scrollHeight <= screen.clientHeight + 1,
        visible: game.bottom <= innerHeight + 1, touch: targets.every((r) => r.width >= 44 && r.height >= 44) };
    });
    assert.deepEqual(await fits(), { horizontal: true, vertical: true, visible: true, touch: true }, `whole game and touch targets fit at ${width}x${height}`);
    await snap(a, `sl-neutral-size-${width}x${height}`);
    await a.locator('.sl-card').first().tap(); await sleep(180);
    assert.deepEqual(await fits(), { horizontal: true, vertical: true, visible: true, touch: true }, `selected card and flip control fit at ${width}x${height}`);
    if (width === 360 && height === 640) await snap(a, 'sl-neutral-selected');
    await a.locator('.sl-card.selected').tap();
  }
  await a.setViewportSize({ width: 390, height: 844 });
  await a.locator('#bar [aria-label="Back to the shelf"]').click();
  await a.getByRole('button', { name: 'Save and quit', exact: true }).click();
  await a.locator('.stats-btn').click(); await a.getByText('Cards played', { exact: true }).scrollIntoViewIfNeeded(); await snap(a, 'sl-05-stats');
  assert.equal(await junk(a), null); assert.equal(await junk(b), null);
  const expected = Object.fromEntries(Object.entries(retries).map(([p, n]) => [p, Math.min(n.response, n.console)]));
  const unexpected = errors.filter((e) => {
    const p = e[0];
    if (/^[AB]: Failed to load resource: the server responded with a status of 400 \(Bad Request\)$/.test(e) && expected[p] > 0) { expected[p]--; return false; }
    return true;
  });
  assert.deepEqual(unexpected, []);
  console.log('  ok Word Slam: RPS, ten-card hands, tap/drag, validation, save/reload/resume, finish and stats');
} catch (err) { await snap(a, 'sl-ERR-a'); await snap(b, 'sl-ERR-b'); throw err; } finally { await browser.close(); }
