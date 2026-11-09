'use strict';
// ================= Sharp Wits: a box of quick brain games =================
// The rock, paper, scissors winner picks one of eight races for the match: match.sw = {by, g}.
//   spot  Odd One Out: two panels of scattered emoji, one above the other; tap what changed. Ten
//         puzzles, the last four with two changes. (Emoji are this game's pieces: the one place
//         outside chat reactions where the shelf shows them.)
//   copy  Copycat: dots scattered on paper light up in order; tap them back. Level 1 is three
//         dots, each level one more, to ten at level 8. One wrong tap and you're out.
//   ink   True Colours: a colour word painted in another colour; tap the paint, not the word. 20 cards.
//   hunt  Number Hunt: 1 to 25 shuffled on a grid; tap them in order.
//   shade Odd Shade: a grid of painted squares, one a shade off; the grid grows and the difference
//         shrinks over 15 rounds.
//   pairs Pairs: sixteen cards face down; turn two at a time to find the eight pairs.
//   way   Which Way: five arrows in a row; tap the way the middle one points, whatever the others do. 20.
//   flash Flashback: squares on a 5×5 grid light up for a moment; tap the ones that lit. Like
//         Copycat: three at level 1, ten at level 8, one wrong tap and you're out.
// Every puzzle comes from match.seed, so both phones see the same ones; nothing about them is stored.
//
// Fair timing, as in Quickfire: each phone runs its own clock from its own "Go" (and only while the
// page is showing), so lag costs nobody and no clocks need to agree. In the level games (Copycat,
// Flashback) the clock only runs while you're tapping, never while you watch. Progress is an append-only log per seat: match.laps.hNNN /
// gNNN = {n, ms, x} (reached n at ms on that phone's clock, x wrong taps so far) or {end, ms, x} with
// end 'up' (gave up), 'out' (the other had already finished faster) or 'fail' (a level game's wrong
// tap). In Pairs each step also names the pair found (k), so a reload can turn the found pairs back up.
// A run ends there or at the last puzzle. Further is better; for the same progress, sooner is.
// swState(m) replays it: the result is decided as soon as both runs are over, or one is over and the
// other's progress already beats it. Each phone writes only its own keys, so no transactions.

const SW_GAMES = {
  spot: { name: 'Odd One Out', to: 10, line: 'Spot what changed. Ten pictures', unit: 'spotted' },
  copy: { name: 'Copycat', to: 8, line: 'Tap the dots back. Eight levels', unit: 'levels' },
  ink: { name: 'True Colours', to: 20, line: 'Tap the paint, not the word. 20 cards', unit: 'cards' },
  hunt: { name: 'Number Hunt', to: 25, line: 'Tap 1 to 25 in order', unit: 'numbers' },
  shade: { name: 'Odd Shade', to: 15, line: 'One square is a shade off. 15 grids', unit: 'grids' },
  pairs: { name: 'Pairs', to: 8, line: 'Turn two cards, find the pairs', unit: 'pairs', keyed: true },
  way: { name: 'Which Way', to: 20, line: 'Which way the middle arrow points. 20', unit: 'arrows' },
  flash: { name: 'Flashback', to: 8, line: 'Tap the squares that lit. Eight levels', unit: 'levels', levels: true },
};
SW_GAMES.copy.levels = true;
const SW_ORDER = ['spot', 'copy', 'ink', 'hunt', 'shade', 'pairs', 'way', 'flash'];
const SW_LOCK = { spot: 1000, ink: 900, hunt: 600, shade: 900, pairs: 800, way: 800 }; // a wrong tap holds you up this long (ms)
const SW_MAX_MS = 36e5;

// ---------- the puzzles, all from the seed ----------
const swRng = (m, ...parts) => hueRng([m.seed || m.id || '', 'sw', ...parts].join(':'));
const swRound = (v, d = 10) => Math.round(v * d) / d;
// n points in a w×h box, at least d apart and pad from the edges (d shrinks if they won't fit)
function swScatter(rnd, n, w, hgt, d, pad) {
  for (let dd = d; ; dd *= 0.92) {
    const pts = [];
    for (let tries = 0; pts.length < n && tries < 3000; tries++) {
      const p = { x: pad + rnd() * (w - 2 * pad), y: pad + rnd() * (hgt - 2 * pad) };
      if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= dd)) pts.push(p);
    }
    if (pts.length === n) return pts;
  }
}

// Odd One Out. Look-alikes, so a swap is a real puzzle; single code points only (no variation
// selectors or joiners), all old enough to draw on both phones.
const SW_LOOKALIKES = [
  ['😀', '😃', '😄', '😁'], ['🙂', '🙃'], ['😐', '😑'], ['😮', '😯'], ['😛', '😜', '😝'], ['😺', '😸', '😹'],
  ['🍎', '🍅', '🍒'], ['🍋', '🍌'], ['🍊', '🍑'], ['🍇', '🍆'], ['🍓', '🌶'], ['🍄', '🌰'],
  ['🐶', '🐱', '🐻'], ['🐭', '🐹'], ['🐯', '🦁'], ['🐮', '🐷'], ['🐔', '🐤'], ['🐟', '🐠'], ['🐝', '🐞'], ['🐢', '🐊'], ['🐌', '🐛'],
  ['⭐', '🌟'], ['🌸', '🌺', '🌼'], ['🌲', '🌳'], ['🌕', '🌖'], ['🌞', '🌝'],
  ['⚽', '🏀', '🏐'], ['🎈', '🎀'], ['📗', '📘', '📙', '📕'], ['💙', '💜'], ['💚', '💛'],
  ['🚗', '🚙'], ['🚌', '🚎'], ['⌚', '⏰'], ['🔒', '🔓'], ['🔈', '🔉', '🔊'], ['🕐', '🕑', '🕒'],
];
// the ones that face a way, so a mirror image is a change you can see
const SW_FLIPS = new Set(['🐟', '🐠', '🐢', '🐊', '🐌', '🐛', '🐔', '🐤', '🚗', '🚙', '🚌', '🚎', '🍌', '🌶', '🎈', '🔈', '🔉', '🔊', '😜']);
// Puzzle i (0-based): 7 + i emoji in a 150×100 box, the same in both panels except the changes,
// each in one panel: another look-alike, mirrored, turned, or a different size.
function swSpot(m, i) {
  const rnd = swRng(m, 'spot', i), count = 7 + i;
  const items = swScatter(rnd, count, 150, 100, 19, 10).map((p) => {
    const g = Math.floor(rnd() * SW_LOOKALIKES.length), group = SW_LOOKALIKES[g];
    return { e: group[Math.floor(rnd() * group.length)], g, x: swRound(p.x), y: swRound(p.y), r: Math.round((rnd() - 0.5) * 36), s: swRound(0.88 + rnd() * 0.24, 100) };
  });
  const diffs = [];
  while (diffs.length < (i >= 6 ? 2 : 1)) {
    const at = Math.floor(rnd() * count);
    if (diffs.some((d) => d.at === at)) continue;
    const it = items[at], panel = rnd() < 0.5 ? 0 : 1, roll = rnd();
    let change;
    if (roll < 0.22 && SW_FLIPS.has(it.e)) change = { flip: true };
    else if (roll < 0.36) change = { s: swRound(it.s * (rnd() < 0.5 ? 1.5 : 0.6), 100) };
    else if (roll < 0.46) change = { r: it.r + (rnd() < 0.5 ? -80 : 80) };
    else { const others = SW_LOOKALIKES[it.g].filter((e) => e !== it.e); change = { e: others[Math.floor(rnd() * others.length)] }; }
    diffs.push({ at, panel, ...change });
  }
  return { count, items, diffs };
}

// Copycat: seven dots in a 100×100 box and one sequence of ten (never the same dot three times
// running). Level L shows the first L + 2.
const SW_DOTS = 7;
const swCopyLen = (level) => level + 2;
function swCopy(m) {
  const rnd = swRng(m, 'copy');
  const dots = swScatter(rnd, SW_DOTS, 100, 100, 27, 12).map((p) => ({ x: swRound(p.x), y: swRound(p.y) }));
  const seq = [];
  while (seq.length < swCopyLen(SW_GAMES.copy.to)) {
    const d = Math.floor(rnd() * SW_DOTS);
    if (seq.length >= 2 && seq[seq.length - 1] === d && seq[seq.length - 2] === d) continue;
    seq.push(d);
  }
  return { dots, seq };
}

// True Colours: the four paints, twenty cards (a quarter where word and paint agree, never the
// same card twice running) and the order of the four buttons for this match.
const SW_INKS = [
  { k: 'red', name: 'RED', c: '#c4482f' }, { k: 'blue', name: 'BLUE', c: '#2f68ad' },
  { k: 'yellow', name: 'YELLOW', c: '#d9a21b' }, { k: 'green', name: 'GREEN', c: '#4d8c5a' },
];
function swInks(m) {
  const rnd = swRng(m, 'ink'), cards = [];
  while (cards.length < SW_GAMES.ink.to) {
    const word = Math.floor(rnd() * 4), ink = rnd() < 0.25 ? word : (word + 1 + Math.floor(rnd() * 3)) % 4;
    const last = cards[cards.length - 1];
    if (last && last.word === word && last.ink === ink) continue;
    cards.push({ word, ink });
  }
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { cards, order };
}

// Number Hunt: 1–25 shuffled onto a 5×5 grid, each a little turned and sized differently.
function swHunt(m) {
  const rnd = swRng(m, 'hunt'), ns = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = ns.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ns[i], ns[j]] = [ns[j], ns[i]]; }
  return ns.map((n) => ({ n, r: Math.round((rnd() - 0.5) * 14), s: swRound(0.82 + rnd() * 0.36, 100) }));
}

// Odd Shade: round i is a size×size grid of one painted colour with one square lighter or darker,
// by fewer lightness points each round (16 down to about 5).
const SW_SHADE_SIZES = [3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6];
const SW_SHADE_HUES = [8, 22, 38, 95, 140, 175, 205, 225, 265, 330];
function swShade(m, i) {
  const rnd = swRng(m, 'shade', i), size = SW_SHADE_SIZES[i];
  const hue = SW_SHADE_HUES[Math.floor(rnd() * SW_SHADE_HUES.length)] + Math.round((rnd() - 0.5) * 10);
  const sat = 36 + Math.round(rnd() * 22), light = 46 + Math.round(rnd() * 14), delta = swRound(16 - i * 0.8);
  const odd = Math.floor(rnd() * size * size), dl = rnd() < 0.5 ? delta : -delta;
  return { size, odd, delta, base: `hsl(${hue} ${sat}% ${light}%)`, shade: `hsl(${hue} ${sat}% ${swRound(light + dl)}%)` };
}

// Pairs: eight painted symbols (art/sw-sym-0…7.png), each twice, shuffled onto a 4×4 table. Each has
// its own shape and its own colour, so it's memory, not eyesight.
const SW_SYMBOLS = ['red circle', 'navy square', 'yellow triangle', 'green star', 'lavender heart', 'orange diamond', 'blue moon', 'plum cross']; // art/sw-sym-N.png
function swPairs(m) {
  const rnd = swRng(m, 'pairs'), deck = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

// Which Way: twenty rows of five arrows. The middle one points left or right; the others point the
// same way (about two in five), the other way (most of the rest) or are plain bars. Each row sits a
// little off centre, so your eye has to find it.
function swWays(m) {
  const rnd = swRng(m, 'way'), out = [];
  while (out.length < SW_GAMES.way.to) {
    const r = rnd(), row = { dir: rnd() < 0.5 ? 'l' : 'r', flank: r < 0.4 ? 'same' : r < 0.85 ? 'other' : 'none', dx: Math.round((rnd() - 0.5) * 24), dy: Math.round((rnd() - 0.5) * 50) };
    const last = out[out.length - 1];
    if (last && last.dir === row.dir && last.flank === row.flank && Math.abs(last.dy - row.dy) < 12) continue;
    out.push(row);
  }
  return out;
}

// Flashback: for each of the eight levels, level + 2 different squares of a 5×5 grid.
function swFlash(m) {
  const rnd = swRng(m, 'flash'), levels = [];
  for (let level = 1; level <= SW_GAMES.flash.to; level++) {
    const all = Array.from({ length: 25 }, (_, i) => i);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    levels.push(all.slice(0, swCopyLen(level)).sort((a, b) => a - b));
  }
  return levels;
}

// ---------- the replay ----------
function swSetup(m) {
  const s = m && m.sw;
  if (!s || s.by !== rpsState(m).starter || !SW_GAMES[s.g]) return null;
  return { by: s.by, g: s.g, to: SW_GAMES[s.g].to };
}
// One seat's run from its own keys (letter 'h' or 'g'), in key order. Entries that don't follow on
// (a step skipped, time going backwards, anything after the end) are ignored.
function swRun(setup, laps, letter) {
  const run = { n: 0, ms: 0, t: 0, x: 0, end: null }, game = SW_GAMES[setup.g], keys = game.keyed ? [] : null;
  for (const key of sortedKeys(laps)) {
    if (key.length !== 4 || key[0] !== letter) continue;
    const e = laps[key];
    if (run.end || !e || typeof e !== 'object' || typeof e.ms !== 'number' || !(e.ms >= run.t) || e.ms > SW_MAX_MS) continue;
    if (e.end !== undefined) {
      if (!(e.end === 'up' || e.end === 'out' || (e.end === 'fail' && game.levels))) continue;
      run.end = e.end;
    } else if (e.n === run.n + 1) {
      if (keys) { if (!Number.isInteger(e.k) || e.k < 0 || e.k >= setup.to || keys.includes(e.k)) continue; keys.push(e.k); }
      run.n = e.n; run.ms = e.ms;
    } else continue;
    run.t = e.ms;
    if (Number.isInteger(e.x) && e.x > run.x && e.x < 1e4) run.x = e.x;
    if (run.n >= setup.to) run.end = 'all';
  }
  if (keys) run.keys = keys;
  return run;
}
// further wins; at the same progress, whoever got there sooner on their own clock
const swBeats = (a, b) => a.n > b.n || (a.n === b.n && a.ms < b.ms);
function swState(m) {
  const setup = swSetup(m);
  const st = { setup, run: null, winner: null };
  if (!setup) return st;
  const hr = swRun(setup, m.laps, 'h'), gr = swRun(setup, m.laps, 'g');
  st.run = { host: hr, guest: gr };
  if (hr.end && gr.end) st.winner = swBeats(hr, gr) ? 'host' : swBeats(gr, hr) ? 'guest' : 'draw';
  else if (hr.end && swBeats(gr, hr)) st.winner = 'guest';
  else if (gr.end && swBeats(hr, gr)) st.winner = 'host';
  return st;
}

// ---------- words about a run ----------
const swSecs = (ms) => (ms / 1000).toFixed(2) + ' s';
function swLine(setup, r) {
  const to = setup.to;
  if (SW_GAMES[setup.g].levels) {
    if (r.end === 'all') return `all ${to} levels, ${swSecs(r.ms)} tapping`;
    const at = `level ${r.n + 1}`, cleared = r.n ? ` (${r.n} cleared, ${swSecs(r.ms)})` : '';
    return (r.end === 'fail' ? `out on ${at}` : r.end === 'up' ? `gave up on ${at}` : r.end === 'out' ? `on ${at} when time ran out` : `on ${at}`) + cleared;
  }
  if (r.end === 'all') return `all ${to} in ${swSecs(r.ms)}`;
  return `${r.n} of ${to}` + (r.end === 'up' ? ', then gave up' : r.end === 'out' ? ' when time ran out' : ' so far');
}

// ---------- the RPS winner picks the game ----------
function makeSWSetup(box) {
  let m, busy = false, pick = 'spot';
  const root = h('div', { class: 'qf-setup-wrap sw-setup-wrap' });
  box.append(root);
  async function start() {
    if (busy || rpsState(m).starter !== G.seat) return;
    busy = true; draw(); Sound.pick();
    await chooseOnce(m, 'sw', { by: G.seat, g: pick }, 'The game has already been picked.', 'Couldn’t pick the game. Try again.');
    busy = false; if (root.isConnected) draw();
  }
  function draw() {
    if (!m) return;
    const mine = rpsState(m).starter === G.seat, P = partnerName();
    const card = h('div', { class: 'paper qf-setup sw-setup' }, h('div', { class: 'tape sage' }),
      h('span', { class: 'eyebrow' }, 'Before you race'),
      h('h1', { class: 'display h2' }, 'Pick a game'));
    if (!mine) {
      card.append(h('p', { class: 'hand-note' }, `${P} won rock, paper, scissors and is picking the game.`),
        h('div', { class: 'pulse-dots', style: 'justify-content:center;width:100%' }, h('i'), h('i'), h('i')));
      root.replaceChildren(card); return;
    }
    card.append(h('p', { class: 'hand-note' }, 'You won rock, paper, scissors, so you choose. You both play it at the same time.'),
      h('div', { class: 'qf-opts two sw-opts' }, ...SW_ORDER.map((k) => h('button', {
        class: 'qf-opt sw-opt' + (pick === k ? ' on' : ''), 'aria-pressed': String(pick === k), 'data-opt': k,
        onclick: () => { Sound.tap(); pick = k; draw(); },
      }, h('b', null, SW_GAMES[k].name), h('small', null, SW_GAMES[k].line)))),
      h('button', { class: 'btn btn-primary qf-go', disabled: busy, onclick: start }, `Play ${SW_GAMES[pick].name}`));
    root.replaceChildren(card);
  }
  return { update(nm) { m = nm; draw(); }, relayout() {}, destroy() { root.remove(); } };
}

// ---------- the race ----------
function makeSW(box) {
  const seat = G.seat, opp = other(seat), P = partnerName(), me = seat[0];
  let m = null, st = null, setup = null, id = null, dead = false, finished = false;
  let board = null, started = false, counting = false, n = 0, myEnd = null, misses = 0, lockUntil = 0, next = 0;
  let acc = 0, since = null, wantClock = false; // the clock: ms run so far, and since when (performance.now) it's running
  let flash = '', flashTimer = null, tick = null, said = '', lockText = '';
  let lv = false; // a level game (Copycat, Flashback): the clock runs only while tapping
  const queue = {};
  let flushing = false, flushTimer = null;

  const mine = h('b', null, '0'), theirs = h('b', null, '0'), mid = h('div', { class: 'sb-mid' });
  const sb = h('div', { class: 'scoreboard paper sw-sb' },
    h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, 'You'), mine), mid,
    h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, P), theirs));
  const clockEl = h('small', { class: 'sw-clock' });
  const status = h('div', { class: 'status-line sw-status', 'aria-live': 'polite' });
  const stage = h('div', { class: 'sw-stage' });
  const cover = h('div', { class: 'sw-cover', hidden: true });
  const giveUp = h('button', { class: 'btn btn-ghost sw-giveup', onclick: askGiveUp }, h('i', { html: ICON.flag }), 'Give up');
  const actions = h('div', { class: 'sw-actions' }, giveUp);
  const endArea = h('div', { class: 'end-area' });
  const root = h('div', { class: 'sw' }, sb, status, h('div', { class: 'sw-table' }, stage, cover), actions, endArea);
  box.append(root);

  // ---- the clock ----
  const clockKey = () => 'sw-clock:' + id;
  const clockNow = () => acc + (since != null ? performance.now() - since : 0);
  const visible = () => document.visibilityState === 'visible';
  function clockOn() { wantClock = true; if (since == null && visible() && !dead) since = performance.now(); }
  function clockOff() { wantClock = false; if (since != null) { acc = clockNow(); since = null; } saveClock(); }
  const saveClock = () => { if (id && !finished) Pref.set(clockKey(), String(Math.round(clockNow()))); };
  const onVisible = () => {
    if (dead) return;
    if (!visible()) { if (since != null) { acc = clockNow(); since = null; saveClock(); } return; }
    if (wantClock && since == null) since = performance.now();
    if (started) board?.resume?.();
    else maybeStart();
    paint();
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---- writing my laps: batched, each phone only its own keys ----
  function lap(entry) {
    queue[me + pad3(next++)] = { ...entry, ms: swRound(entry.ms), x: misses };
    // anything that could settle the race goes at once; plain progress is gathered up for a moment
    const v = view();
    schedule(entry.end || n >= setup.to || v.winner ? 0 : 400);
  }
  function schedule(ms) {
    if (flushTimer) { if (ms) return; clearTimeout(flushTimer); }
    flushTimer = setTimeout(flush, ms);
  }
  async function flush() {
    flushTimer = null;
    if (flushing) return;
    const keys = Object.keys(queue);
    if (!keys.length) return;
    const batch = {};
    for (const k of keys) { batch[k] = queue[k]; delete queue[k]; }
    flushing = true;
    try { await Net.doc(matchPath(id)).update({ laps: batch }); }
    catch (e) {
      Object.assign(queue, batch);
      if (!dead) note(e && e.code === 'unavailable' ? 'Can’t reach the table. Still trying…' : 'Couldn’t save. Trying again…');
      setTimeout(() => schedule(0), 1500);
    } finally {
      flushing = false;
      if (Object.keys(queue).length && !flushTimer) schedule(400);
    }
  }
  // the replay with my not-yet-sent laps in, for this phone's own view of the race
  const view = () => swState({ ...m, laps: { ...(m.laps || {}), ...queue } });

  // ---- what the boards call ----
  const canPlay = () => started && !counting && !myEnd && !finished && !dead && !(st && st.winner) && performance.now() >= lockUntil;
  const c = {
    get m() { return m; },
    canPlay, dead: () => dead,
    say(text) { said = text; paint(); },
    inputOn() { clockOn(); },
    step(k) {
      if (!canPlay()) return;
      const ms = clockNow();
      n++;
      if (lv) clockOff();
      if (n >= setup.to) { myEnd = 'all'; clockOff(); }
      lap(k === undefined ? { n, ms } : { n, ms, k });
      Sound.ding(); vibrate(8);
      if (myEnd) { board.freeze(); showMine(); } else board.show(n);
      paint();
    },
    miss(text = 'Not that one! Wait a moment') {
      if (!canPlay()) return;
      misses++; lockText = text; lockUntil = performance.now() + (SW_LOCK[setup.g] || 800);
      Sound.lose(); vibrate(20);
      root.classList.add('locked');
      setTimeout(() => { root.classList.remove('locked'); paint(); }, SW_LOCK[setup.g] || 800);
      paint();
    },
    fail() {
      if (!canPlay()) return;
      const ms = clockNow();
      clockOff(); misses++; myEnd = 'fail';
      lap({ end: 'fail', ms });
      Sound.lose(); vibrate([20, 40, 20]);
      board.freeze(); setTimeout(() => { if (!dead) showMine(); }, 1300);
      paint();
    },
  };
  function note(text, ms = 1800) { flash = text; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = ''; paint(); }, ms); paint(); }

  function askGiveUp() {
    if (!started || counting || myEnd || finished) return;
    Sound.tap();
    openSheet({ title: 'Give up?', body: `Your run stops here, ${progressWords(n)}. ${P} keeps going and needs to beat that.`, actions: [
      { label: 'Give up', kind: 'ink', onClick: () => {
        if (myEnd || finished || dead) return;
        const ms = clockNow(); clockOff(); myEnd = 'up';
        lap({ end: 'up', ms }); board.freeze(); showMine(); paint();
      } },
      { label: 'Keep going', kind: 'ghost' },
    ] });
  }
  const progressWords = (k) => (lv ? (k ? `with ${k} ${k === 1 ? 'level' : 'levels'} cleared` : 'on level 1') : `at ${k} of ${setup.to}`);

  // ---- starting: wait for both, then 3, 2, 1 on this phone; the board stays covered till Go ----
  function maybeStart() {
    if (started || counting || dead || myEnd || !m || !joinedBy(m, opp) || !visible()) return;
    counting = true;
    cover.hidden = false;
    const beats = ['3', '2', '1'];
    let i = 0;
    const beat = () => {
      if (dead) return;
      if (i < beats.length) {
        cover.replaceChildren(h('div', { class: 'sw-count paper' }, h('div', { class: 'tape' }), h('span', { class: 'eyebrow' }, SW_GAMES[setup.g].name), h('b', { class: 'script' }, beats[i])));
        Sound.tap(); i++; setTimeout(beat, 650); return;
      }
      counting = false; started = true; cover.hidden = true; cover.replaceChildren();
      Sound.pick();
      if (!lv) clockOn();
      board.show(n);
      paint();
    };
    beat();
  }
  // my run is over: cover my board with how it went, and how the other is getting on
  function showMine() {
    if (finished || dead) return;
    const r = { n, ms: lastMs(), end: myEnd };
    cover.hidden = false;
    cover.replaceChildren(h('div', { class: 'sw-done paper' }, h('div', { class: 'tape sage' }),
      h('span', { class: 'eyebrow' }, myEnd === 'all' ? 'Finished' : myEnd === 'fail' ? 'Out' : 'Stopped'),
      h('b', { class: 'display' }, myEnd === 'all' && !lv ? swSecs(r.ms) : cap(swLine(setup, r))),
      h('p', { class: 'script' }, `Waiting for ${P}…`)));
  }
  function lastMs() { const v = view(); return v.run ? v.run[seat].ms : 0; }

  // ---- drawing ----
  function paint() {
    if (dead || !st || !setup) return;
    const v = view(), them = v.run[opp];
    mine.textContent = lv ? (myEnd === 'all' ? 'All 8' : `Lv ${myEnd ? n : n + 1}`) : `${n}/${setup.to}`;
    theirs.textContent = lv ? (them.end === 'all' ? 'All 8' : `Lv ${them.end ? them.n : them.n + 1}`) : `${them.n}/${setup.to}`;
    theirs.classList.toggle('over', !!them.end);
    if (!mid.firstChild) mid.append(SW_GAMES[setup.g].name, clockEl);
    clockEl.textContent = started || myEnd ? swSecs(clockNow()).replace(/(\.\d)\d/, '$1') : lv ? 'tapping time' : 'ready';
    giveUp.disabled = !started || !!myEnd || finished || counting;
    actions.hidden = finished;
    root.classList.toggle('racing', started && !myEnd && !finished);
    let text = flash;
    if (!text) {
      if (finished) text = st.winner === seat ? 'You win!' : st.winner === 'draw' ? 'A dead heat!' : `${P} wins`;
      else if (!joinedBy(m, opp)) text = `Waiting for ${P} to join…`;
      else if (counting) text = 'Ready…';
      else if (myEnd) text = them.end ? 'Working it out…' : `${P} is still going`;
      else if (performance.now() < lockUntil) text = lockText;
      else text = said;
    }
    status.textContent = text;
  }

  // ---- the end ----
  function finish() {
    if (finished) return;
    finished = true;
    clockOff(); clearInterval(tick); board?.freeze(); Pref.del(clockKey());
    recordResult(m, st.winner);
    endArea.replaceChildren(endBar(m));
    const r = st.run, won = st.winner === seat, draw = st.winner === 'draw';
    cover.hidden = false;
    cover.replaceChildren(h('div', { class: 'sw-done paper' }, h('div', { class: 'tape' }),
      h('span', { class: 'eyebrow' }, SW_GAMES[setup.g].name),
      h('b', { class: 'display' }, won ? 'You win!' : draw ? 'Dead heat' : `${P} wins`),
      h('p', { class: 'script' }, `You: ${swLine(setup, r[seat])}`), h('p', { class: 'script' }, `${P}: ${swLine(setup, r[opp])}`)));
    paint();
    endSheetSoon(m, () => dead, 900, {
      title: won ? 'Sharp! You win' : draw ? 'A dead heat' : `${P} wins`,
      body: `${SW_GAMES[setup.g].name}. You: ${swLine(setup, r[seat])}. ${P}: ${swLine(setup, r[opp])}.`, good: won,
    });
  }

  // runs ten times a second: the clock, and conceding once the other has finished faster
  function run() {
    if (dead || finished || !st) return;
    if (started && !myEnd) {
      saveClock();
      const them = view().run[opp];
      if (them.end === 'all' && clockNow() >= them.ms) {
        const ms = clockNow(); clockOff(); myEnd = 'out';
        lap({ end: 'out', ms }); board.freeze(); showMine();
      }
    }
    clockEl.textContent = started || myEnd ? swSecs(clockNow()).replace(/(\.\d)\d/, '$1') : clockEl.textContent;
  }

  let lastThem = null;
  return {
    update(nm) {
      m = nm;
      if (!setup) {
        setup = swSetup(m); if (!setup) return;
        id = m.id;
        const r = swState(m).run[seat];
        n = r.n; myEnd = r.end; misses = r.x;
        next = Object.keys(m.laps || {}).filter((k) => k[0] === me).length;
        // Copycat starts the level again after a reload, so only cleared levels' time counts;
        // the others carry on the clock (it's saved as it runs)
        lv = !!SW_GAMES[setup.g].levels;
        acc = lv ? r.ms : Math.max(+Pref.get(clockKey()) || 0, r.t);
        c.found = r.keys || []; // Pairs: the pairs this phone has already found
        board = { spot: swSpotBoard, copy: swCopyBoard, ink: swInkBoard, hunt: swHuntBoard, shade: swShadeBoard, pairs: swPairsBoard, way: swWayBoard, flash: swFlashBoard }[setup.g](c);
        stage.replaceChildren(board.el);
        root.classList.add('sw-game-' + setup.g);
        tick = setInterval(run, 100);
      }
      st = view();
      const them = st.run[opp];
      if (lastThem && !lastThem.end && them.end && !st.winner && !finished) {
        Sound.pop();
        matchToast(id, them.end === 'all' ? `${P} finished: ${lv ? 'all 8 levels' : swSecs(them.ms)}. Beat that!` : `${P} ${them.end === 'fail' ? 'is out' : 'stopped'}: ${swLine(setup, them)}`, 3200);
      }
      lastThem = them;
      if (myEnd && !finished && cover.hidden) showMine();
      if (st.winner) {
        if (!myEnd && since != null) clockOff();
        finish();
        return;
      }
      maybeStart();
      paint();
    },
    isOver() { return !!(st && st.winner); },
    relayout() {}, // CSS lays it out; rebuilding would restart the clock and the countdown
    destroy() {
      if (since != null) clockOff();
      dead = true; clearInterval(tick); clearTimeout(flashTimer);
      document.removeEventListener('visibilitychange', onVisible);
      board?.destroy?.();
      if (Object.keys(queue).length) { clearTimeout(flushTimer); flush(); }
    },
  };
}

// A grid laid on a taped sheet of paper (Number Hunt, Odd Shade, Flashback)
const swSheet = (grid, tape = '') => h('div', { class: 'sw-sheet paper' }, h('div', { class: 'tape ' + tape }), grid);

// ---------- Odd One Out: two panels, one above the other ----------
function swSpotBoard(c) {
  const panels = [0, 1].map((p) => h('div', { class: 'sw-panel p' + p, 'data-panel': p, role: 'group', 'aria-label': p ? 'Bottom picture' : 'Top picture' }));
  const el = h('div', { class: 'sw-spot' }, ...panels);
  let puz = null, found = new Set(), frozen = false;
  function ring(k, cls = 'sw-ring') {
    const it = puz.items[k];
    for (const panel of panels) panel.append(h('i', { class: cls, style: `left:${it.x / 1.5}%;top:${it.y}%` }));
  }
  function show(i) {
    puz = swSpot(c.m, i); found = new Set();
    panels.forEach((panel, p) => panel.replaceChildren(...puz.items.map((it, k) => {
      const d = puz.diffs.find((x) => x.at === k && x.panel === p) || {};
      const r = d.r != null ? d.r : it.r, s = d.s || it.s;
      return h('span', { class: 'sw-e', 'data-i': k, 'aria-hidden': 'true', style: `left:${it.x / 1.5}%;top:${it.y}%;--r:${r}deg;--s:${s};--f:${d.flip ? -1 : 1}` }, d.e || it.e);
    })));
    for (const panel of panels) panel.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180 });
    c.say(puz.diffs.length > 1 ? 'Two things changed. Find both' : 'One thing changed. Tap it');
  }
  function down(e) {
    const panel = e.currentTarget;
    if (frozen || !puz || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 150, y = ((e.clientY - rect.top) / rect.height) * 100;
    let best = -1, bd = Infinity;
    puz.items.forEach((it, k) => { const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = k; } });
    if (bd > 15) return; // a tap on empty paper doesn't count either way
    if (found.has(best)) return;
    if (puz.diffs.some((d) => d.at === best)) {
      found.add(best); ring(best);
      if (found.size === puz.diffs.length) c.step();
      else { Sound.pop(); c.say('One more to find'); }
    } else {
      const it = puz.items[best];
      const cross = h('i', { class: 'sw-cross', style: `left:${it.x / 1.5}%;top:${it.y}%` });
      panel.append(cross); setTimeout(() => cross.remove(), 900);
      c.miss();
    }
  }
  for (const panel of panels) panel.addEventListener('pointerdown', down);
  return {
    el, show,
    freeze() { frozen = true; if (puz) puz.diffs.forEach((d) => { if (!found.has(d.at)) ring(d.at, 'sw-ring missed'); }); },
  };
}

// ---------- Copycat: dots scattered on paper ----------
const SW_NOTES = [392, 440, 523, 587, 659, 784, 880];
function swCopyBoard(c) {
  const { dots, seq } = swCopy(c.m);
  const els = dots.map((d, k) => h('button', { class: 'sw-dot', 'data-i': k, 'aria-label': 'Dot ' + (k + 1), style: `left:${d.x}%;top:${d.y}%;--tilt:${(k * 47) % 40 - 20}deg` }, h('i', { class: 'wash' }), h('i', { class: 'ring' })));
  const pad = h('div', { class: 'sw-dots paper' }, ...els);
  const el = h('div', { class: 'sw-copy' }, pad);
  let level = 0, pos = 0, input = false, token = 0, frozen = false;
  function light(k, cls, ms) {
    const d = els[k];
    d.classList.remove('lit', 'tap', 'wrong', 'hint'); void d.offsetWidth; d.classList.add(cls);
    clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove(cls), ms);
  }
  async function show(cleared) {
    level = cleared + 1; pos = 0; input = false;
    const mine = ++token, len = swCopyLen(level);
    pad.classList.add('watching');
    c.say(`Level ${level}: watch the ${len} dots`);
    await sleep(800);
    for (const k of seq.slice(0, len)) {
      if (mine !== token || c.dead() || frozen) return;
      light(k, 'lit', 470); Sound.tone(SW_NOTES[k], 0.3, { type: 'triangle', vol: 0.09 });
      await sleep(470 + 190);
    }
    if (mine !== token || c.dead() || frozen) return;
    pad.classList.remove('watching');
    input = true; c.inputOn();
    c.say(`Your turn: ${len} taps`);
  }
  pad.addEventListener('pointerdown', (e) => {
    const d = e.target.closest('.sw-dot');
    if (!d || !input || frozen || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    const k = +d.dataset.i, len = swCopyLen(level);
    if (k === seq[pos]) {
      pos++; light(k, 'tap', 260); Sound.tone(SW_NOTES[k], 0.22, { type: 'triangle', vol: 0.1 });
      if (pos === len) { input = false; c.step(); }
      else c.say(`Your turn: ${len - pos} more`);
    } else {
      input = false; light(k, 'wrong', 1200); setTimeout(() => light(seq[pos], 'hint', 1100), 150);
      c.say(`That was level ${level}`);
      c.fail();
    }
  });
  return {
    el,
    show(cleared) { show(cleared); },
    // the page was hidden while the dots played: play them again
    resume() { if (!input && !frozen && level) show(level - 1); },
    freeze() { frozen = true; input = false; token++; pad.classList.remove('watching'); },
    destroy() { token++; },
  };
}

// ---------- True Colours: a painted word and four paper buttons ----------
function swInkBoard(c) {
  const { cards, order } = swInks(c.m);
  const word = h('div', { class: 'sw-word', 'aria-live': 'off' });
  const card = h('div', { class: 'sw-ink-card paper' }, h('div', { class: 'tape rose' }), word);
  let cur = 0, frozen = false;
  const tap = (k) => {
    if (frozen || !c.canPlay()) return;
    if (k === cards[cur].ink) c.step();
    else { shake(card, 8); c.miss(); }
  };
  const btns = order.map((k) => {
    const b = h('button', { class: 'sw-ink-btn', 'data-c': SW_INKS[k].k }, SW_INKS[k].name);
    b.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); tap(k); });
    b.addEventListener('click', (e) => { if (e.detail === 0) tap(k); }); // the keyboard
    return b;
  });
  const el = h('div', { class: 'sw-ink' }, card, h('div', { class: 'sw-ink-btns' }, ...btns));
  return {
    el,
    show(i) {
      cur = i;
      const cd = cards[i];
      word.textContent = SW_INKS[cd.word].name; word.style.setProperty('--paint', SW_INKS[cd.ink].c);
      word.dataset.ink = SW_INKS[cd.ink].k;
      word.animate([{ transform: 'scale(.7) rotate(-4deg)', opacity: 0.3 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
      c.say('Tap the colour of the paint');
    },
    freeze() { frozen = true; },
  };
}

// ---------- Number Hunt: 1 to 25 on a grid of tiles ----------
function swHuntBoard(c) {
  const cells = swHunt(c.m);
  let want = 1, frozen = false;
  const els = cells.map((it) => h('button', { class: 'sw-cell', 'data-n': it.n, style: `--r:${it.r}deg;--s:${it.s}` }, h('span', null, String(it.n))));
  const grid = h('div', { class: 'sw-grid' }, ...els);
  const el = h('div', { class: 'sw-hunt' }, swSheet(grid));
  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.sw-cell');
    if (!cell || frozen || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    if (+cell.dataset.n === want) c.step();
    else {
      cell.classList.remove('wrong'); void cell.offsetWidth; cell.classList.add('wrong');
      setTimeout(() => cell.classList.remove('wrong'), 600);
      c.miss();
    }
  });
  return {
    el,
    show(done) {
      want = done + 1;
      for (const x of els) x.classList.toggle('done', +x.dataset.n <= done);
      grid.classList.add('on');
      c.say(`Find ${want}`);
    },
    freeze() { frozen = true; },
  };
}

// ---------- Odd Shade: one square a shade off ----------
function swShadeBoard(c) {
  const grid = h('div', { class: 'sw-grid sw-shade-grid' });
  const el = h('div', { class: 'sw-hunt sw-shade' }, swSheet(grid, 'rose'));
  let puz = null, frozen = false;
  grid.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.sw-sq');
    if (!t || !puz || frozen || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    if (+t.dataset.i === puz.odd) c.step();
    else { shake(grid, 6); c.miss(); }
  });
  return {
    el,
    show(i) {
      puz = swShade(c.m, i);
      grid.style.setProperty('--n', puz.size);
      grid.replaceChildren(...Array.from({ length: puz.size * puz.size }, (_, k) => h('button', { class: 'sw-sq', 'data-i': k, 'aria-label': 'Square ' + (k + 1) }, h('i', { class: 'wash', style: `background-color:${k === puz.odd ? puz.shade : puz.base}` }))));
      grid.animate([{ opacity: 0.3, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
      c.say(i < 3 ? 'Tap the square that’s a different shade' : 'Find the odd shade');
    },
    freeze() { frozen = true; if (puz) grid.querySelector(`[data-i="${puz.odd}"]`)?.classList.add('odd'); },
  };
}

// ---------- Pairs: sixteen cards, face down ----------
function swPairsBoard(c) {
  const deck = swPairs(c.m), found = new Set(c.found);
  let open = [], frozen = false;
  const els = deck.map((sym, i) => h('button', { class: 'sw-card', 'data-i': i, 'aria-label': 'Card ' + (i + 1) },
    h('span', { class: 'back' }, h('img', { src: 'art/sw-back.png', alt: '' })), h('span', { class: 'face' }, h('img', { class: 'wc', src: `art/sw-sym-${sym}.png`, alt: '' }))));
  const grid = h('div', { class: 'sw-grid sw-pairs-grid' }, ...els);
  const el = h('div', { class: 'sw-hunt sw-pairs' }, grid);
  const turn = (i, up) => { els[i].classList.toggle('up', up); els[i].setAttribute('aria-label', up ? `Card ${i + 1}, ${SW_SYMBOLS[deck[i]]}` : 'Card ' + (i + 1)); };
  grid.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.sw-card');
    if (!card || frozen || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    const i = +card.dataset.i;
    if (found.has(deck[i]) || open.includes(i)) return;
    open.push(i); turn(i, true); Sound.tap();
    if (open.length < 2) return;
    const [a, b] = open; open = [];
    if (deck[a] === deck[b]) { found.add(deck[a]); c.step(deck[a]); return; }
    c.miss('No match');
    setTimeout(() => { if (!frozen) { turn(a, false); turn(b, false); } }, SW_LOCK.pairs - 60);
  });
  return {
    el,
    show(n) {
      els.forEach((x, i) => { x.classList.toggle('found', found.has(deck[i])); if (found.has(deck[i])) turn(i, true); });
      grid.classList.add('on');
      c.say(n ? `${8 - n} ${8 - n === 1 ? 'pair' : 'pairs'} to go` : 'Turn two cards. Find the pairs');
    },
    freeze() { frozen = true; },
  };
}

// ---------- Which Way: the middle arrow ----------
function swWayBoard(c) {
  const rows = swWays(c.m);
  let cur = 0, frozen = false;
  const row = h('div', { class: 'sw-arrows', role: 'img' });
  const card = h('div', { class: 'sw-way-card paper' }, h('div', { class: 'tape sage' }), row);
  const tap = (d) => {
    if (frozen || !c.canPlay()) return;
    if (d === rows[cur].dir) c.step();
    else { shake(card, 8); c.miss(); }
  };
  const btns = [['l', 'Left'], ['r', 'Right']].map(([d, name]) => {
    const b = h('button', { class: 'sw-way-btn ' + d, 'data-d': d, 'aria-label': name }, h('i', { class: 'sw-arr' + (d === 'l' ? ' l' : '') }));
    b.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.preventDefault(); tap(d); });
    b.addEventListener('click', (e) => { if (e.detail === 0) tap(d); });
    return b;
  });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') tap('l'); else if (e.key === 'ArrowRight') tap('r'); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  const el = h('div', { class: 'sw-way' }, card, h('div', { class: 'sw-way-btns' }, ...btns));
  return {
    el,
    show(i) {
      cur = i;
      const r = rows[i], flip = (d) => (d === 'l' ? ' l' : '');
      const side = r.flank === 'none' ? null : r.flank === 'same' ? r.dir : r.dir === 'l' ? 'r' : 'l';
      row.replaceChildren(...[0, 1, 2, 3, 4].map((k) => k === 2 ? h('i', { class: 'sw-arr mid' + flip(r.dir), 'data-dir': r.dir })
        : h('i', { class: side ? 'sw-arr' + flip(side) : 'sw-arr bar' })));
      row.style.translate = `${r.dx}% ${r.dy}%`;
      row.setAttribute('aria-label', `The middle arrow points ${r.dir === 'l' ? 'left' : 'right'}`);
      row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      c.say('Which way does the middle arrow point?');
    },
    freeze() { frozen = true; },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}

// ---------- Flashback: the squares that lit ----------
function swFlashBoard(c) {
  const levels = swFlash(c.m);
  const els = Array.from({ length: 25 }, (_, k) => h('button', { class: 'sw-tile', 'data-i': k, 'aria-label': 'Square ' + (k + 1) }, h('i', { class: 'wash' })));
  const grid = h('div', { class: 'sw-grid sw-flash-grid' }, ...els);
  const sheet = swSheet(grid, 'sage');
  const el = h('div', { class: 'sw-hunt sw-flash' }, sheet);
  let level = 0, want = [], got = new Set(), input = false, token = 0, frozen = false;
  const clear = () => els.forEach((x) => x.classList.remove('lit', 'tap', 'wrong', 'hint'));
  async function show(cleared) {
    level = cleared + 1; want = levels[level - 1]; got = new Set(); input = false;
    const mine = ++token;
    clear(); sheet.classList.add('watching');
    c.say(`Level ${level}: remember ${want.length} squares`);
    await sleep(700);
    if (mine !== token || c.dead() || frozen) return;
    want.forEach((k) => els[k].classList.add('lit')); Sound.tone(660, 0.25, { type: 'triangle', vol: 0.08 });
    await sleep(900 + 140 * want.length);
    if (mine !== token || c.dead() || frozen) return;
    clear(); sheet.classList.remove('watching');
    input = true; c.inputOn();
    c.say(`Your turn: ${want.length} squares`);
  }
  grid.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.sw-tile');
    if (!t || !input || frozen || !c.canPlay() || e.button > 0) return;
    e.preventDefault();
    const k = +t.dataset.i;
    if (got.has(k)) return;
    if (want.includes(k)) {
      got.add(k); t.classList.add('tap'); Sound.tone(520 + got.size * 40, 0.15, { type: 'triangle', vol: 0.09 });
      if (got.size === want.length) { input = false; c.step(); }
      else c.say(`Your turn: ${want.length - got.size} more`);
    } else {
      input = false; t.classList.add('wrong');
      want.forEach((w) => { if (!got.has(w)) els[w].classList.add('hint'); });
      c.say(`That was level ${level}`);
      c.fail();
    }
  });
  return {
    el,
    show(cleared) { show(cleared); },
    resume() { if (!input && !frozen && level) show(level - 1); },
    freeze() { frozen = true; input = false; token++; sheet.classList.remove('watching'); },
    destroy() { token++; },
  };
}

// ---------------- Otto (bot.js) ----------------
// Otto plays his run ahead of time: swBotRun() works out every lap he'll make (how long each step
// takes him, the wrong taps that hold him up for SW_LOCK, the level he goes out on in Copycat and
// Flashback), then swBot() writes each lap when his own clock gets there. Hard is quick and makes few
// mistakes; Easy is slower and slips more. His clock starts with your 3-2-1 and runs only while you
// can see the race, like yours.
const SW_COUNTDOWN = 3 * 650; // the 3, 2, 1 on the phone before Go
const swBetween = (rng, lo, hi) => lo + (hi - lo) * rng();
// What he takes per step, [lo, hi] ms for Easy and Hard, and how likely a wrong tap is.
const SW_BOT_PACE = {
  spot: { easy: [2200, 4200], hard: [1300, 2400], per: { easy: 200, hard: 140 }, miss: { easy: 0.25, hard: 0.1 } },
  ink: { easy: [950, 1600], hard: [700, 1050], miss: { easy: 0.12, hard: 0.04 } },
  hunt: { easy: [950, 1900], hard: [650, 1150], miss: { easy: 0.06, hard: 0.02 } },
  shade: { easy: [1400, 2400], hard: [900, 1500], per: { easy: 150, hard: 100 }, miss: { easy: 0.08, hard: 0.03 }, harder: { easy: 0.04, hard: 0.02 } },
  pairs: { easy: [600, 1000], hard: [430, 680], remember: { easy: 0.55, hard: 0.95 } },
  way: { easy: [850, 1300], hard: [580, 880], miss: { easy: 0.1, hard: 0.03 } },
  copy: { easy: [480, 800], hard: [330, 500], first: { easy: [600, 1000], hard: [350, 600] } },
  flash: { easy: [520, 880], hard: [380, 580], first: { easy: [600, 1000], hard: [350, 600] } },
};
// the chance of going out on a level game's level L (len = L + 2 to remember)
function swBotFailP(g, level, len) {
  const hard = level === 'hard', base = g === 'flash' ? 1 : 0;
  return hard ? Math.max(0.02, (len - 6 + base) * 0.12) : Math.min(0.9, 0.04 + (len - 3 + base) * 0.1);
}
// Otto's whole run, as the laps he'll write: {n, ms, x, k?} or {end:'fail', ms, x}, each with `at`,
// when it happens on his own race clock from Go (ms of tapping and, in the level games, watching).
// clock is the stretches of `at` when his tapping clock runs (all of it but the watching).
function swBotRun(m, g, level = 'hard', rng = Math.random) {
  const pace = SW_BOT_PACE[g], lv = pace[level] ? level : 'hard', hard = lv === 'hard';
  const [lo, hi] = pace[lv], to = SW_GAMES[g].to, lock = SW_LOCK[g] || 800;
  const laps = [], clock = [];
  let at = 0, ms = 0, x = 0;
  const push = (e) => laps.push({ ...e, ms: swRound(ms), x, at });
  const spend = (t) => { at += t; ms += t; };
  const wrong = () => { spend(swBetween(rng, lo, hi) * 0.6); x++; spend(lock); };
  if (SW_GAMES[g].levels) {
    for (let L = 1; L <= to; L++) {
      const len = swCopyLen(L);
      at += g === 'copy' ? 800 + len * 660 : 700 + 900 + 140 * len; // watching: the clock is stopped
      const from = at;
      spend(swBetween(rng, ...pace.first[lv]));
      const out = rng() < swBotFailP(g, lv, len) ? Math.floor(rng() * len) : -1;
      for (let i = 0; i < len; i++) {
        if (i) spend(swBetween(rng, lo, hi));
        if (i === out) { x++; clock.push([from, at]); push({ end: 'fail' }); return { laps, clock }; }
      }
      clock.push([from, at]);
      push({ n: L });
    }
    return { laps, clock };
  }
  clock.push([0, Infinity]);
  if (g === 'pairs') {
    // he turns two cards at a time, remembering (or not) what he has seen
    const deck = swPairs(m), seen = new Map(), found = new Set(), gone = new Set();
    const flip = () => spend(swBetween(rng, lo, hi));
    const know = (i) => { if (rng() < pace.remember[lv]) seen.set(i, deck[i]); };
    const known = (sym, not) => [...seen].find(([i, s]) => s === sym && i !== not && !gone.has(i));
    const fresh = () => { const left = deck.map((_, i) => i).filter((i) => !gone.has(i) && !seen.has(i)); return left.length ? left[Math.floor(rng() * left.length)] : deck.findIndex((_, i) => !gone.has(i)); };
    for (let guard = 0; found.size < to && guard < 200; guard++) {
      let a, b;
      const pair = [...seen].find(([i, s]) => !gone.has(i) && known(s, i));
      if (pair) { a = pair[0]; b = known(pair[1], a)[0]; flip(); flip(); }
      else {
        a = fresh(); flip(); know(a);
        const mate = known(deck[a], a);
        b = mate ? mate[0] : (() => { const left = deck.map((_, i) => i).filter((i) => i !== a && !gone.has(i) && !seen.has(i)); return left.length ? left[Math.floor(rng() * left.length)] : deck.findIndex((s, i) => i !== a && !gone.has(i)); })();
        flip(); know(b);
      }
      if (deck[a] === deck[b]) { found.add(deck[a]); gone.add(a); gone.add(b); seen.delete(a); seen.delete(b); push({ n: found.size, k: deck[a] }); }
      else { x++; spend(lock); }
    }
    if (found.size < to) push({ end: 'up' }); // never happens, but a run must end
    return { laps, clock };
  }
  for (let i = 0; i < to; i++) {
    let t = swBetween(rng, lo, hi), miss = pace.miss[lv];
    if (g === 'spot') { t += (7 + i) * pace.per[lv] * (i >= 6 ? 1.5 : 1); miss += i * 0.02; }
    if (g === 'shade') { t += i * pace.per[lv]; miss += i * pace.harder[lv]; }
    while (rng() < miss) { wrong(); miss /= 2; }
    spend(t);
    push({ n: i + 1 });
  }
  return { laps, clock };
}
// his tapping clock at race time `at` (only the stretches where it runs)
const swBotClock = (clock, at) => clock.reduce((s, [a, b]) => s + Math.max(0, Math.min(at, b) - a), 0);

function swBot(ctx) {
  const me = ctx.seat[0];
  let plan = null, i = 0, next = 0, raceAt = -SW_COUNTDOWN, last = null, tick = null, done = false, start = 0;
  const queue = {};
  let flushing = false;
  async function flush() {
    const keys = Object.keys(queue);
    if (flushing || !keys.length) return;
    const batch = {};
    for (const k of keys) { batch[k] = queue[k]; delete queue[k]; }
    flushing = true;
    const ok = await ctx.write({ laps: batch });
    flushing = false;
    if (!ok && ctx.live()) Object.assign(queue, batch); // try again on the next tick
  }
  const send = (e) => { queue[me + pad3(next++)] = { ...e, ms: swRound(e.ms) }; };
  // ten times a second while you're on the race: his clock runs, his laps go when it gets there
  function step() {
    tick = null;
    const m = ctx.m();
    if (!m || done) return;
    const now = performance.now();
    if (ctx.ready() && ctx.phase() === 'sw') raceAt += last == null ? 0 : Math.min(now - last, 250);
    last = ctx.ready() && ctx.phase() === 'sw' ? now : null;
    const st = swState({ ...m, laps: { ...(m.laps || {}), ...queue } });
    if (st.winner) {
      // decided: send whatever is still waiting, then he's done
      if (!Object.keys(queue).length && !flushing) { done = true; return; }
      flush(); tick = ctx.later(300, step); return;
    }
    const mine = st.run[ctx.seat], them = st.run[ctx.opp];
    if (!mine.end) {
      while (i < plan.laps.length && plan.laps[i].at <= raceAt) { const { at, ...e } = plan.laps[i++]; send(e); }
      // you finished everything: once his clock passes your time, he's out of time
      const clockMs = start + swBotClock(plan.clock, raceAt);
      const after = swState({ ...m, laps: { ...(m.laps || {}), ...queue } }).run[ctx.seat];
      if (!after.end && them.end === 'all' && clockMs >= them.ms) send({ end: 'out', ms: Math.max(clockMs, after.t), x: after.x });
    }
    flush();
    tick = ctx.later(100, step);
  }
  return {
    update(m) {
      const setup = swSetup(m);
      if (!setup) {
        if (rpsState(m).starter === ctx.seat && !m.sw) {
          ctx.plan('pick', botBetween(ctx.rng, 1500, 3000), () => ctx.choose('sw', { by: ctx.seat, g: botChoice(ctx.rng, SW_ORDER) }));
        }
        return;
      }
      if (!plan) {
        plan = swBotRun(m, setup.g, ctx.level, ctx.rng);
        // back after a reload: carry on from the laps already written
        const r = swState(m).run[ctx.seat];
        next = Object.keys(m.laps || {}).filter((k) => k[0] === me).length;
        if (r.end) { done = true; return; }
        if (r.n) {
          const at = (plan.laps.find((e) => e.n === r.n) || { at: 0 }).at;
          plan.laps = plan.laps.filter((e) => e.at > at && (e.n == null || e.n > r.n));
          if (setup.g === 'pairs') { const have = new Set(r.keys); plan.laps = plan.laps.filter((e) => e.end || !have.has(e.k)); plan.laps.forEach((e, j) => { e.n = r.n + j + 1; }); }
          start = r.t - swBotClock(plan.clock, at);
          plan.laps.forEach((e) => { e.ms = Math.max(r.t, e.ms - swBotClock(plan.clock, at) + r.t); });
          raceAt = at;
        }
      }
      if (!done && tick == null) tick = ctx.later(100, step);
    },
    stop() { done = true; },
  };
}
