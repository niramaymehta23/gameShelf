'use strict';
// ================= Connect Four =================
const C4R = 6, C4C = 7;
function c4Line(g, r, c, who) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < C4R && cc >= 0 && cc < C4C && g[rr][cc] === who) { cells.push([rr, cc]); rr += dr * s; cc += dc * s; }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}
function c4State(m) {
  const starter = rpsState(m).starter;
  const grid = Array.from({ length: C4R }, () => Array(C4C).fill(null));
  const moves = []; let winner = null, line = null, turn = starter;
  for (const k of sortedKeys(m.moves)) {
    if (winner) break;
    const col = m.moves[k];
    if (typeof col !== 'number' || col < 0 || col >= C4C) continue;
    let row = -1;
    for (let r = C4R - 1; r >= 0; r--) if (!grid[r][col]) { row = r; break; }
    if (row < 0) continue;
    grid[row][col] = turn;
    moves.push({ who: turn, row, col });
    const l = c4Line(grid, row, col, turn);
    if (l) { winner = turn; line = l; }
    turn = other(turn);
  }
  const draw = !winner && moves.length === C4R * C4C;
  return { grid, moves, winner, line, draw, turn: (winner || draw) ? null : turn, starter };
}

function makeC4(box, ctx) {
  const toast = (text, ms) => matchToast(m?.id, text, ms);
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, st = null, cell = null, pad = 0, W = 0, H = 0;
  let rendered = -1, animating = false, pending = false, pendingN = -1, endShown = false, dead = false;
  let aiming = false, aimCol = null;
  const discMap = new Map();
  const colorOf = (who) => (who === st.starter ? 'red' : 'yellow');

  const miniMe = h('i', { class: 'mini' }), miniThem = h('i', { class: 'mini' });
  const chipMe = h('div', { class: 'turn-chip' }, miniMe, h('span', null, 'You'));
  const chipThem = h('div', { class: 'turn-chip' }, miniThem, h('span', null, P));
  const ghost = h('div', { class: 'disc ghost', hidden: true });
  const pGhost = h('div', { class: 'disc ghost partner', hidden: true });
  const aim = h('div', { class: 'c4-aim' }, pGhost, ghost);
  const discs = h('div', { class: 'c4-discs' });
  const board = h('div', { class: 'c4-board' }, h('div', { class: 'c4-back' }), discs, h('div', { class: 'c4-front' }), h('div', { class: 'c4-rims' }), h('div', { class: 'c4-edge' }));
  const feet = h('div', { class: 'c4-feet', 'aria-hidden': 'true' }, h('i'), h('i'));
  const wrap = h('div', { class: 'c4-wrap', role: 'application', 'aria-label': 'Connect Four board. Touch, slide to a column and let go to drop.' }, aim, board, feet);
  const status = h('div', { class: 'c4-status status-line', 'aria-live': 'polite' });
  const endArea = h('div', { class: 'end-area' });
  box.append(h('div', { class: 'c4' }, h('div', { class: 'turnbar' }, chipMe, chipThem), wrap, status, endArea));

  function layout() {
    const bw = box.clientWidth || 360, bh = box.clientHeight || 600;
    const availH = bh - 48 - 34 - 66 - 40;
    cell = Math.floor(Math.max(30, Math.min((bw - 4) / (C4C + 0.3), availH / (C4R + 1.45), 74)));
    pad = Math.round(cell * 0.16);
    W = C4C * cell + 2 * pad; H = C4R * cell + 2 * pad;
    aim.style.cssText = `width:${W}px;height:${cell}px`;
    board.style.cssText = `width:${W}px;height:${H}px`;
    feet.style.width = W + 'px';
    board.style.setProperty('--cell', cell + 'px');
    board.style.setProperty('--pad', pad + 'px');
    board.style.setProperty('--hole', (cell * 0.39).toFixed(1) + 'px');
    const d = cell * 0.82;
    for (const g of [ghost, pGhost]) { g.style.width = g.style.height = d + 'px'; g.style.top = (cell - d) / 2 + 'px'; }
  }
  function discEl(mv) {
    const d = cell * 0.82;
    const el = h('div', { class: 'disc ' + colorOf(mv.who) });
    el.style.cssText = `width:${d}px;height:${d}px;left:${pad + mv.col * cell + (cell - d) / 2}px;top:${pad + mv.row * cell + (cell - d) / 2}px`;
    discMap.set(mv.row + ',' + mv.col, el);
    return el;
  }
  function renderStatic() {
    discs.replaceChildren(); discMap.clear();
    for (const mv of st.moves) discs.append(discEl(mv));
    rendered = st.moves.length;
  }
  async function animateDrop(mv) {
    const el = discEl(mv);
    discs.append(el);
    const dist = pad + mv.row * cell + cell;
    const dur = 300 + mv.row * 55;
    setTimeout(() => { if (!dead) { Sound.clack(); vibrate(8); } }, dur * 0.72);
    await settle(el.animate([
      { transform: `translateY(${-dist}px)`, easing: 'cubic-bezier(.55,0,1,.6)' },
      { transform: 'translateY(0)', offset: 0.72, easing: 'cubic-bezier(0,.5,.5,1)' },
      { transform: `translateY(${-cell * 0.18}px)`, offset: 0.86, easing: 'cubic-bezier(.5,0,1,1)' },
      { transform: 'translateY(0)' },
    ], { duration: dur }));
  }
  async function queue() {
    if (animating || dead) return;
    st = c4State(m);
    if (st.moves.length < rendered) renderStatic();
    while (!dead && rendered < (st = c4State(m)).moves.length) {
      animating = true;
      paintChrome();
      const mv = st.moves[rendered];
      rendered++;
      await animateDrop(mv);
    }
    animating = false;
    if (dead) return;
    if (pending && st.moves.length > pendingN) pending = false;
    paintChrome();
    if (st.winner || st.draw) finish();
  }
  function paintChrome() {
    if (!st || !st.starter) return;
    miniMe.className = 'mini ' + colorOf(seat);
    miniThem.className = 'mini ' + colorOf(opp);
    const t = animating ? null : st.turn;
    chipMe.classList.toggle('active', t === seat);
    chipThem.classList.toggle('active', t === opp);
    if (st.winner || st.draw) { status.textContent = ''; hideGhost(); pGhost.hidden = true; return; }
    if (t === seat) status.textContent = 'Your turn — slide to aim, let go to drop';
    else if (t === opp) {
      status.textContent = Live.partnerHover() != null ? `${P} is lining up a move…` : `Waiting for ${P}…`;
    } else status.textContent = '';
    paintPartnerGhost();
  }
  function paintPartnerGhost() {
    const hov = Live.partnerHover();
    if (st && st.turn === opp && !animating && hov != null && hov >= 0 && hov < C4C) {
      pGhost.className = 'disc ghost partner ' + colorOf(opp);
      pGhost.style.left = pad + hov * cell + (cell - cell * 0.82) / 2 + 'px';
      pGhost.hidden = false;
    } else pGhost.hidden = true;
  }
  // quiet: the game was already over when this screen opened, so no end card
  function finish(quiet) {
    if (endShown) return;
    endShown = true;
    if (st.line) for (const [r, c] of st.line) { const el = discMap.get(r + ',' + c); el && el.classList.add('win'); }
    recordResult(m, st.winner || 'draw');
    endArea.replaceChildren(endBar(m));
    if (quiet) return;
    const title = st.winner === seat ? 'Four in a row. You win!' : st.winner ? `${P} got four in a row` : 'Board’s full. It’s a draw';
    endSheetSoon(m, () => dead, 1100, { title, body: `${st.moves.length} discs dropped.`, good: st.winner === seat });
  }
  // ---- touch aiming ----
  const colAt = (x) => { const r = board.getBoundingClientRect(); return Math.max(0, Math.min(C4C - 1, Math.floor((x - r.left - pad) / cell))); };
  const canMove = () => st && st.turn === seat && !pending;
  function showGhost(col) {
    ghost.className = 'disc ghost ' + colorOf(seat);
    ghost.style.left = pad + col * cell + (cell - cell * 0.82) / 2 + 'px';
    ghost.hidden = false;
  }
  function hideGhost() { ghost.hidden = true; }
  wrap.addEventListener('pointerdown', (e) => {
    if (!canMove()) {
      if (st && st.turn === opp && !st.winner) shake(status, 6, 260, 'transform');
      return;
    }
    aiming = true;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    aimCol = colAt(e.clientX);
    showGhost(aimCol);
    ghost.animate([{ transform: 'translateY(-8px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 0.9 }], { duration: 160 });
    Sound.tap();
    Live.set({ hover: aimCol });
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!aiming) return;
    const c = colAt(e.clientX);
    if (c !== aimCol) { aimCol = c; showGhost(c); vibrate(4); Live.set({ hover: c }); }
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!aiming) return;
    aiming = false;
    drop(colAt(e.clientX));
  });
  wrap.addEventListener('pointercancel', () => { aiming = false; hideGhost(); Live.set({ hover: null }); });
  function drop(c) {
    if (!canMove()) { hideGhost(); return; }
    if (st.grid[0][c]) {
      shake(ghost);
      toast('That column is full');
      setTimeout(hideGhost, 260);
      Live.set({ hover: null });
      return;
    }
    pending = true; pendingN = st.moves.length;
    hideGhost();
    Live.set({ hover: null });
    write(matchPath(m.id), { moves: { ['m' + pad3(pendingN)]: c } }).then((ok) => { if (!ok) { pending = false; paintChrome(); } });
  }

  return {
    update(nm) {
      m = nm; st = c4State(m);
      // our own disc is in the log: we may aim again as soon as it's our turn, even mid-animation
      if (pending && st.moves.length > pendingN) pending = false;
      if (cell == null) layout();
      if (rendered < 0) {
        renderStatic();
        if (st.winner || st.draw) finish(true);
      }
      queue();
    },
    onPeers() { if (st) paintChrome(); },
    isOver() { return !!(st && (st.winner || st.draw)); },
    destroy() { dead = true; Live.set({ hover: null }); },
  };
}

// ---------------- Otto (bot.js) ----------------
// Hard looks six discs ahead (alpha-beta over a count of open lines); Easy takes a win it sees most
// of the time, blocks yours some of the time, and otherwise plays loosely towards the middle.
const C4_ORDER = [3, 2, 4, 1, 5, 0, 6];
function c4BotMove(m, seat, level = 'hard', rng = Math.random, depth = 6) {
  const st = c4State(m);
  if (st.turn !== seat) return null;
  const me = seat, opp = other(seat), g = st.grid.map((r) => r.slice());
  const free = (c) => !g[0][c];
  const drop = (c, who) => { for (let r = C4R - 1; r >= 0; r--) if (!g[r][c]) { g[r][c] = who; return r; } return -1; };
  const winsAt = (c, who) => { const r = drop(c, who); const w = !!c4Line(g, r, c, who); g[r][c] = null; return w; };
  const cols = C4_ORDER.filter(free);
  const win = cols.find((c) => winsAt(c, me)), block = cols.find((c) => winsAt(c, opp));
  if (level === 'easy') {
    if (win != null && rng() < 0.85) return win;
    if (block != null && rng() < 0.6) return block;
    // mostly avoid a disc that lets you win straight on top of it
    const safe = cols.filter((c) => { const r = drop(c, me); const ok = r === 0 || !winsAt(c, opp); g[r][c] = null; return ok; });
    const pool = safe.length && rng() < 0.75 ? safe : cols;
    let total = 0; const w = pool.map((c) => (total += 4 - Math.abs(c - 3)));
    const x = rng() * total;
    return pool[w.findIndex((v) => x < v)];
  }
  if (win != null) return win;
  if (block != null) return block;
  const evalBoard = () => {
    let s = 0;
    for (let r = 0; r < C4R; r++) { if (g[r][3] === me) s += 3; else if (g[r][3] === opp) s -= 3; }
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      for (let r = 0; r < C4R; r++) for (let c = 0; c < C4C; c++) {
        const er = r + 3 * dr, ec = c + 3 * dc;
        if (er < 0 || er >= C4R || ec < 0 || ec >= C4C) continue;
        let a = 0, b = 0;
        for (let i = 0; i < 4; i++) { const v = g[r + i * dr][c + i * dc]; if (v === me) a++; else if (v === opp) b++; }
        if (a && b) continue;
        if (a === 3) s += 5; else if (a === 2) s += 2;
        if (b === 3) s -= 6; else if (b === 2) s -= 2;
      }
    }
    return s;
  };
  const search = (d, alpha, beta, mine) => {
    const order = C4_ORDER.filter(free);
    if (!order.length) return 0;
    if (d === 0) return evalBoard();
    let best = mine ? -Infinity : Infinity;
    for (const c of order) {
      const who = mine ? me : opp, r = drop(c, who);
      const v = c4Line(g, r, c, who) ? (mine ? 1e5 + d : -1e5 - d) : search(d - 1, alpha, beta, !mine);
      g[r][c] = null;
      if (mine) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (alpha >= beta) break;
    }
    return best;
  };
  let best = -Infinity, picks = [];
  for (const c of cols) {
    const r = drop(c, me);
    const v = search(depth - 1, -Infinity, Infinity, false);
    g[r][c] = null;
    if (v > best) { best = v; picks = [c]; } else if (v === best) picks.push(c);
  }
  return picks[Math.floor(rng() * picks.length)];
}
function c4Bot(ctx) {
  return {
    update(m) {
      const st = c4State(m);
      if (st.turn !== ctx.seat) return;
      const n = st.moves.length;
      ctx.plan('m' + n, botBetween(ctx.rng, ctx.hard ? 900 : 1100, ctx.hard ? 1800 : 2600), () => {
        const now = ctx.m(); if (!now) return;
        const s = c4State(now);
        if (s.turn !== ctx.seat || s.moves.length !== n) return;
        const col = c4BotMove(now, ctx.seat, ctx.level, ctx.rng);
        // his "finger" hovers over the column for a moment, like a partner's would
        ctx.show({ hover: col });
        ctx.later(500, () => { ctx.show({ hover: null }); ctx.write({ moves: { ['m' + pad3(n)]: col } }); });
      });
    },
    stop() {},
  };
}
