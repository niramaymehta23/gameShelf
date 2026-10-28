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
    setTimeout(() => { Sound.clack(); vibrate(8); }, dur * 0.72);
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
