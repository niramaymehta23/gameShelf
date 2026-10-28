'use strict';
// ================= Battleships =================
const BS_N = 10;
const FLEET = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'battleship', name: 'Battleship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
];
const FLEET_BY = Object.fromEntries(FLEET.map((f) => [f.id, f]));
const ROW_L = 'ABCDEFGHIJ';
const coord = (r, c) => ROW_L[r] + (c + 1);
const HIT_AGAIN = true; // house rule: a hit earns another shot; a miss passes the turn
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function shipCells(s) {
  const out = []; const len = FLEET_BY[s.id].len;
  for (let i = 0; i < len; i++) out.push(s.v ? [s.r + i, s.c] : [s.r, s.c + i]);
  return out;
}
const fitsGrid = (s) => shipCells(s).every(([r, c]) => r >= 0 && r < BS_N && c >= 0 && c < BS_N);
function overlaps(s, ships) {
  const taken = new Set();
  for (const o of ships) if (o && o.id !== s.id) for (const [r, c] of shipCells(o)) taken.add(r * 10 + c);
  return shipCells(s).some(([r, c]) => taken.has(r * 10 + c));
}
function clampShip(s) {
  const len = FLEET_BY[s.id].len;
  return { ...s, r: clamp(s.r, 0, BS_N - (s.v ? len : 1)), c: clamp(s.c, 0, BS_N - (s.v ? 1 : len)) };
}
function randomFleet() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ships = [];
    for (const f of FLEET) {
      for (let t = 0; t < 400; t++) {
        const v = Math.random() < 0.5;
        const s = { id: f.id, v, r: Math.floor(Math.random() * (BS_N - (v ? f.len : 1) + 1)), c: Math.floor(Math.random() * (BS_N - (v ? 1 : f.len) + 1)) };
        if (fitsGrid(s) && !overlaps(s, ships)) { ships.push(s); break; }
      }
    }
    if (ships.length === FLEET.length) return ships;
  }
  return [];
}

function bsState(m) {
  const starter = rpsState(m).starter;
  const fl = (m && m.fleets) || {};
  const fleets = { host: Array.isArray(fl.host) ? fl.host : null, guest: Array.isArray(fl.guest) ? fl.guest : null };
  const res = { starter, fleets, ready: { host: !!fleets.host, guest: !!fleets.guest }, shots: [], winner: null, turn: null, hits: { host: 0, guest: 0 }, fired: { host: 0, guest: 0 }, sunk: { host: [], guest: [] } };
  if (!fleets.host || !fleets.guest) return res;
  const owner = { host: new Map(), guest: new Map() };
  for (const s of ['host', 'guest']) for (const ship of fleets[s]) for (const [r, c] of shipCells(ship)) owner[s].set(r * 10 + c, ship.id);
  const shotBy = { host: new Set(), guest: new Set() };
  const hitsOn = { host: {}, guest: {} };
  let turn = starter;
  for (const k of sortedKeys(m.shots)) {
    if (res.winner) break;
    const s = m.shots[k];
    if (!s || typeof s.r !== 'number' || typeof s.c !== 'number') continue;
    if (s.r < 0 || s.r >= BS_N || s.c < 0 || s.c >= BS_N) continue;
    const shooter = turn, target = other(turn), key = s.r * 10 + s.c;
    if (shotBy[shooter].has(key)) continue;
    shotBy[shooter].add(key);
    const shipId = owner[target].get(key) || null;
    let sunk = null;
    res.fired[shooter]++;
    if (shipId) {
      hitsOn[target][shipId] = (hitsOn[target][shipId] || 0) + 1;
      res.hits[shooter]++;
      if (hitsOn[target][shipId] === FLEET_BY[shipId].len) { sunk = shipId; res.sunk[target].push(shipId); }
    }
    res.shots.push({ i: res.shots.length, shooter, target, r: s.r, c: s.c, hit: !!shipId, sunk });
    if (res.sunk[target].length === FLEET.length) { res.winner = shooter; break; }
    turn = (HIT_AGAIN && shipId) ? shooter : target;
  }
  res.turn = res.winner ? null : turn;
  res.shotBy = shotBy;
  return res;
}

function posShip(el, s, cell, ins = Math.round(cell * 0.12)) {
  const len = FLEET_BY[s.id].len;
  el.style.left = s.c * cell + ins + 'px';
  el.style.top = s.r * cell + ins + 'px';
  el.style.width = (s.v ? 1 : len) * cell - 2 * ins + 'px';
  el.style.height = (s.v ? len : 1) * cell - 2 * ins + 'px';
  el.classList.toggle('v', !!s.v);
}

// White flag on a pole. The cloth waves by morphing between two outlines (SMIL, so it works on iOS too).
const FLAG_A = 'M6.5 4C10 2.6 14 5.8 22 4.2C21.2 7.5 21.6 10.4 22.2 13.6C14.5 15.2 10.5 12 6.5 13.4Z';
const FLAG_B = 'M6.5 4C10.5 5.6 15 2.4 21.6 5.2C21.4 8.2 21 11 21.4 14.4C15 12.2 10 15.4 6.5 13.4Z';
const FOLD_A = 'M11 3.9C11.6 7 10.8 10 11.4 13.2', FOLD_B = 'M11.4 4.6C10.8 7.6 11.8 10.6 11 13.6';
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
function flagSVG(phase) {
  const wave = (a, b) => STILL ? '' : `<animate attributeName="d" dur="1.8s" begin="-${(phase * 1.8).toFixed(2)}s" repeatCount="indefinite" values="${a};${b};${a}" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
  return `<svg viewBox="0 0 24 28" width="100%" height="100%" aria-hidden="true">`
    + `<ellipse cx="6" cy="26.2" rx="4.6" ry="1.5" fill="rgba(24,44,72,.22)"/>`
    + `<path d="${FLAG_A}" fill="#fbf8f0" stroke="rgba(24,44,72,.6)" stroke-width=".7" stroke-linejoin="round">${wave(FLAG_A, FLAG_B)}</path>`
    + `<path d="${FOLD_A}" fill="none" stroke="rgba(24,44,72,.18)" stroke-width=".9" stroke-linecap="round">${wave(FOLD_A, FOLD_B)}</path>`
    + `<line x1="6" y1="2.6" x2="6" y2="26" stroke="#5b4633" stroke-width="1.5" stroke-linecap="round"/>`
    + `<circle cx="6" cy="2.4" r="1.3" fill="#c99a4a"/></svg>`;
}

function makeSeaGrid(cell) {
  const lab = Math.round(cell * 0.62);
  const size = cell * BS_N;
  const grid = h('div', { class: 'bs-grid' });
  grid.style.cssText = `--cell:${cell}px;width:${size}px;height:${size}px;grid-template-columns:repeat(${BS_N},${cell}px);grid-template-rows:repeat(${BS_N},${cell}px)`;
  const cells = [];
  for (let r = 0; r < BS_N; r++) for (let c = 0; c < BS_N; c++) { const el = h('div', { class: 'cell' }); cells.push(el); grid.append(el); }
  const top = h('div', { class: 'axis', 'aria-hidden': 'true' }, ...Array.from({ length: BS_N }, (_, i) => h('span', null, i + 1)));
  top.style.cssText = `left:${lab}px;top:0;width:${size}px;height:${lab}px;grid-template-columns:repeat(${BS_N},1fr)`;
  const side = h('div', { class: 'axis', 'aria-hidden': 'true' }, ...ROW_L.split('').map((l) => h('span', null, l)));
  side.style.cssText = `left:0;top:${lab}px;width:${lab}px;height:${size}px;grid-template-rows:repeat(${BS_N},1fr)`;
  const wrap = h('div', { class: 'grid-wrap' }, top, side, grid);
  const mat = Math.round(cell * 0.3);
  wrap.style.cssText = `width:${size + lab + mat}px;height:${size + lab + mat}px;padding:${lab}px ${mat}px ${mat}px ${lab}px;flex:none`;
  return {
    wrap, grid, cells, cell, size, lab, outer: size + lab + mat,
    at(x, y) {
      const r = grid.getBoundingClientRect();
      const c = Math.floor((x - r.left) / cell), rr = Math.floor((y - r.top) / cell);
      return (rr >= 0 && rr < BS_N && c >= 0 && c < BS_N) ? { r: rr, c } : null;
    },
    cellAt(r, c) { return cells[r * BS_N + c]; },
    // a hit is a red peg that keeps burning; a miss is a white flag planted in the water
    peg(r, c, hit, pop) {
      const phase = ((r * 7 + c * 3) % 10) / 10; // so neighbouring fires and flags don't move in step
      let el;
      if (hit) {
        const d = Math.round(cell * 0.42);
        el = h('div', { class: 'peg hit' }, h('i', { class: 'flame', style: `animation-delay:-${phase}s` }),
          ...[0, 1, 2].map((i) => h('i', { class: 'smoke', style: `animation-delay:-${(phase + i) * 0.9}s;--drift:${(i - 1) * 4 + (phase - 0.5) * 6}px` })));
        el.style.cssText = `width:${d}px;height:${d}px;left:${c * cell + (cell - d) / 2}px;top:${r * cell + (cell - d) / 2}px`;
      } else {
        const w = Math.round(cell * 0.8), ht = Math.round(cell * 0.9);
        el = h('div', { class: 'peg flag' });
        el.innerHTML = flagSVG(phase);
        el.style.cssText = `width:${w}px;height:${ht}px;left:${c * cell + cell / 2 - w * 0.25}px;top:${r * cell + cell * 0.86 - ht * 0.93}px`;
      }
      grid.append(el);
      if (pop) {
        if (hit) el.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
        else el.animate([{ transform: 'translateY(-40%) scale(.4)', opacity: 0 }, { transform: 'translateY(6%) scale(1.05)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
      }
      return el;
    },
    reticle(cls) {
      const el = h('div', { class: 'reticle ' + (cls || ''), hidden: true });
      el.style.width = el.style.height = cell - 4 + 'px';
      grid.append(el);
      return {
        el,
        at(r, c) { el.style.left = c * cell + 2 + 'px'; el.style.top = r * cell + 2 + 'px'; el.hidden = false; },
        hide() { el.hidden = true; },
      };
    },
  };
}

function makeBS(box, ctx) {
  let sub = null, subName = null;
  return {
    update(m) {
      const st = bsState(m);
      const want = (st.ready.host && st.ready.guest) ? 'battle' : 'place';
      if (want !== subName) {
        sub && sub.destroy();
        box.replaceChildren();
        const inner = h('div', { class: 'phase-box' });
        box.append(inner);
        subName = want;
        sub = want === 'place' ? makePlacement(inner) : makeBattle(inner);
        if (want === 'battle') { Sound.ding(); toast('Both fleets are hidden. Battle stations!'); }
      }
      sub.update(m);
    },
    onPeers() { sub && sub.onPeers && sub.onPeers(); },
    isOver() { return !!(sub && sub.isOver && sub.isOver()); },
    destroy() { sub && sub.destroy(); },
  };
}

// ---------------- placing the fleet ----------------
function makePlacement(box) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  const draftKey = 'draft:' + G.matchId;
  let m = null, st = null, dead = false, locked = false, saving = false, selected = null, drag = null;
  let ships = {};
  const lastV = {};
  try { const d = JSON.parse(Pref.get(draftKey) || 'null'); if (Array.isArray(d)) d.forEach((s) => { if (FLEET_BY[s.id] && fitsGrid(s)) ships[s.id] = s; }); } catch (e) {}

  const bw = box.clientWidth || 360, bh = box.clientHeight || 600;
  const availH = bh - 30 - 136 - 46 - 56 - 48;
  const cell = Math.floor(Math.max(22, Math.min((bw - 6) / 10.95, availH / 10.95, 44)));
  const dcell = Math.max(18, Math.round(cell * 0.72));
  const ins = Math.round(cell * 0.12); // a ship's inset from its squares, as posShip draws it
  const S = makeSeaGrid(cell);
  const status = h('div', { class: 'bs-status status-line', 'aria-live': 'polite' });
  const dock = h('div', { class: 'dock paper', 'aria-label': 'Ships waiting to be placed' });
  const mkTool = (icon, label, fn) => { const b = h('button', { class: 'tool', html: icon }); b.append(label); b.addEventListener('click', fn); return b; };
  const rotateBtn = mkTool(ICON.rotate, 'Turn', () => { if (selected && ships[selected]) rotate(selected); });
  const shuffleBtn = mkTool(ICON.shuffle, 'Shuffle', () => {
    const f = randomFleet(); ships = {}; f.forEach((s) => { ships[s.id] = s; }); selected = null;
    Sound.whoosh(); vibrate(10); draw();
  });
  const clearBtn = mkTool(ICON.clear, 'Clear', () => { ships = {}; selected = null; Sound.tap(); draw(); });
  const tools = h('div', { class: 'place-tools' }, rotateBtn, shuffleBtn, clearBtn);
  const mainBtn = h('button', { class: 'btn btn-primary' });
  mainBtn.addEventListener('click', onMain);
  const root = h('div', { class: 'bs' }, status, S.wrap, h('div', { class: 'bs-bottom' }, dock, tools, mainBtn));
  box.append(root);
  const els = {};
  const list = () => FLEET.map((f) => ships[f.id]).filter(Boolean);

  function save() { try { Pref.set(draftKey, JSON.stringify(list())); } catch (e) {} }
  function draw() {
    for (const f of FLEET) {
      const s = ships[f.id];
      let el = els[f.id];
      if (s) {
        if (!el) { el = h('div', { class: 'ship', 'aria-label': f.name }); el.dataset.id = f.id; S.grid.append(el); els[f.id] = el; posShip(el, s, cell); el.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
        else posShip(el, s, cell);
        el.classList.toggle('sel', selected === f.id && !locked);
      } else if (el) { el.remove(); delete els[f.id]; }
    }
    dock.replaceChildren();
    const docked = FLEET.filter((f) => !ships[f.id]);
    dock.hidden = locked;
    tools.hidden = locked;
    for (const f of docked) {
      const el = h('div', { class: 'ship' + (selected === f.id ? ' sel' : ''), 'aria-label': f.name + ', ' + f.len + ' squares' });
      el.dataset.id = f.id; el.dataset.dock = '1';
      el.style.cssText = `width:${f.len * dcell - 6}px;height:${dcell - 6}px`;
      dock.append(h('div', { class: 'slip' }, el, h('span', null, `${f.name} · ${f.len}`)));
    }
    if (!docked.length) dock.append(h('div', { class: 'dock-empty' }, 'All five ships are on the chart'));
    rotateBtn.disabled = !(selected && ships[selected]);
    clearBtn.disabled = !list().length;
    const n = list().length;
    if (locked) {
      mainBtn.className = 'btn btn-ghost';
      mainBtn.textContent = 'Change my fleet';
      mainBtn.disabled = saving;
      status.replaceChildren(h('b', null, 'Fleet locked. '), `Waiting for ${P} to hide theirs…`);
    } else {
      mainBtn.className = 'btn btn-primary';
      mainBtn.textContent = n < FLEET.length ? `Place ${FLEET.length - n} more ship${FLEET.length - n === 1 ? '' : 's'}` : 'Lock in my fleet';
      mainBtn.disabled = n < FLEET.length || saving;
      if (selected && !ships[selected]) status.textContent = `Tap a square to drop your ${FLEET_BY[selected].name}, or drag it on.`;
      else if (n < FLEET.length) status.textContent = 'Drag ships onto the grid. Tap a placed ship to turn it.';
      else status.textContent = st && st.ready[opp] ? `${P} is ready. Lock in when you’re happy.` : 'Happy with it? Lock in your fleet.';
    }
    if (!locked) save();
  }
  async function onMain() {
    if (saving) return;
    Sound.pick();
    saving = true; draw();
    if (locked) await write(matchPath(m.id), { fleets: { [seat]: null } });
    else if (list().length === FLEET.length) { vibrate([10, 30, 10]); await write(matchPath(m.id), { fleets: { [seat]: list() } }); }
    saving = false; if (!dead) draw();
  }
  // a ship that can't go there shakes (the CSS .shake animation)
  function refuse(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); Sound.lose(); vibrate(30); }
  function rotate(id) {
    const s = ships[id]; const len = FLEET_BY[id].len;
    const nv = !s.v;
    for (let k = 0; k < len; k++) {
      const cand = clampShip({ ...s, v: nv, r: nv ? s.r - k : s.r, c: nv ? s.c : s.c - k });
      if (fitsGrid(cand) && !overlaps(cand, list())) {
        ships[id] = cand; lastV[id] = nv; selected = id; Sound.tap(); vibrate(6); draw(); return;
      }
    }
    selected = id; draw(); refuse(els[id]); toast('No room to turn it there');
  }
  function placeAt(id, r, c) {
    const v = !!lastV[id];
    for (const vv of [v, !v]) {
      const cand = clampShip({ id, r, c, v: vv });
      if (!overlaps(cand, list())) { ships[id] = cand; lastV[id] = vv; selected = null; Sound.clack(); vibrate(10); draw(); return; }
    }
    toast('That spot is taken');
  }
  // ---- drag & tap ----
  let fl = null;
  function liftFor(d) { return d.touch ? Math.round(cell * 1.15) : 0; }
  root.addEventListener('pointerdown', (e) => {
    if (locked || dead || saving) return;
    const shipEl = e.target.closest('.ship');
    if (shipEl && shipEl.dataset.id) {
      const id = shipEl.dataset.id, f = FLEET_BY[id];
      const fromDock = !!shipEl.dataset.dock; const s = ships[id];
      let grab = 0; const v = s ? !!s.v : !!lastV[id];
      if (!fromDock && s) { const p = S.at(e.clientX, e.clientY); if (p) grab = s.v ? p.r - s.r : p.c - s.c; }
      else { const r = shipEl.getBoundingClientRect(); grab = clamp(Math.floor((e.clientX - r.left) / dcell), 0, f.len - 1); if (v) grab = Math.floor(f.len / 2); }
      drag = { id, fromDock, grab: clamp(grab, 0, f.len - 1), v, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId, target: null, valid: false, touch: e.pointerType !== 'mouse' };
      try { root.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    const p = S.at(e.clientX, e.clientY);
    if (p && selected && !ships[selected]) placeAt(selected, p.r, p.c);
    else if (selected && p) { selected = null; draw(); }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
    if (!drag.moved) startFloat();
    moveFloat(e.clientX, e.clientY);
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    if (!d.moved) return tapShip(d);
    endFloat(d);
  });
  root.addEventListener('pointercancel', () => { if (drag && drag.moved) { fl && fl.remove(); fl = null; if (els[drag.id]) els[drag.id].style.opacity = ''; } drag = null; draw(); });
  function tapShip(d) {
    if (d.fromDock) { selected = selected === d.id ? null : d.id; Sound.tap(); draw(); return; }
    rotate(d.id);
  }
  function startFloat() {
    drag.moved = true; selected = drag.id;
    const f = FLEET_BY[drag.id];
    fl = h('div', { class: 'ship dragging' + (drag.v ? ' v' : '') });
    fl.style.position = 'fixed';
    fl.style.width = (drag.v ? cell : f.len * cell) - 2 * ins + 'px';
    fl.style.height = (drag.v ? f.len * cell : cell) - 2 * ins + 'px';
    document.body.append(fl);
    if (els[drag.id]) els[drag.id].style.opacity = '.25';
    Sound.tap(); vibrate(6);
  }
  function moveFloat(x, y) {
    const d = drag;
    const ly = y - liftFor(d);
    const gr = S.grid.getBoundingClientRect();
    const cr = Math.floor((ly - gr.top) / cell), cc = Math.floor((x - gr.left) / cell);
    const over = cr >= 0 && cr < BS_N && cc >= 0 && cc < BS_N;
    if (over) {
      const cand = clampShip({ id: d.id, v: d.v, r: d.v ? cr - d.grab : cr, c: d.v ? cc : cc - d.grab });
      const valid = !overlaps(cand, list());
      if (!d.target || d.target.r !== cand.r || d.target.c !== cand.c) vibrate(3);
      d.target = cand; d.valid = valid;
      fl.style.left = gr.left + cand.c * cell + ins + 'px';
      fl.style.top = gr.top + cand.r * cell + ins + 'px';
      fl.classList.toggle('bad', !valid);
    } else {
      d.target = null;
      fl.classList.remove('bad');
      fl.style.left = x - (d.v ? cell / 2 : d.grab * cell + cell / 2) + 'px';
      fl.style.top = ly - (d.v ? d.grab * cell + cell / 2 : cell / 2) + 'px';
    }
  }
  function endFloat(d) {
    if (fl) { fl.remove(); fl = null; }
    if (els[d.id]) els[d.id].style.opacity = '';
    if (d.target && d.valid) { ships[d.id] = d.target; lastV[d.id] = d.v; selected = null; Sound.clack(); vibrate(10); draw(); return; }
    if (d.target && !d.valid) { draw(); refuse(els[d.id]); toast('Ships can’t overlap'); return; }
    if (!d.fromDock) { delete ships[d.id]; selected = null; Sound.tap(); }
    draw();
  }

  return {
    update(nm) {
      m = nm; st = bsState(m);
      const wasLocked = locked;
      locked = st.ready[seat];
      if (locked) { ships = {}; st.fleets[seat].forEach((s) => { ships[s.id] = s; }); selected = null; }
      else if (wasLocked) { /* unlocked again: keep the same layout to edit */ }
      draw();
    },
    onPeers() {},
    destroy() { dead = true; if (fl) fl.remove(); },
  };
}

// ---------------- the battle ----------------
function makeBattle(box) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, st = null, dead = false, rendered = -1, animating = false, pending = false, pendingN = -1, endShown = false;
  let view = null, manual = false, aim = null, viewTimer = null;
  const bw = box.clientWidth || 360, bh = box.clientHeight || 600;
  const availH = bh - 50 - 32 - 30 - 56 - 50;
  const cell = Math.floor(Math.max(22, Math.min((bw - 6) / 10.95, availH / 10.95, 46)));
  const T = makeSeaGrid(cell), Hm = makeSeaGrid(cell);
  T.grid.classList.add('target');
  const W = T.outer;
  const track = h('div', { style: `display:flex;width:${W * 2}px;transition:transform .45s var(--ease-out)` }, T.wrap, Hm.wrap);
  const seas = h('div', { style: `width:${W}px;max-width:100%;overflow-x:clip;position:relative;flex:none` }, track);
  const myRet = T.reticle(); const theirRet = Hm.reticle('partner');
  const btnT = h('button', null, `${firstName(P)}’s waters`, h('i', { class: 'badge' }));
  const btnH = h('button', null, 'Your fleet', h('i', { class: 'badge' }));
  btnT.addEventListener('click', () => { manual = true; setView('target'); Sound.tap(); });
  btnH.addEventListener('click', () => { manual = true; setView('home'); Sound.tap(); });
  const seg = h('div', { class: 'seg', role: 'tablist' }, btnT, btnH);
  const status = h('div', { class: 'bs-status status-line', 'aria-live': 'polite' });
  const trackEl = h('div', { class: 'fleet-track' });
  const fireBtn = h('button', { class: 'btn btn-primary' });
  fireBtn.addEventListener('click', fire);
  const bottom = h('div', { class: 'bs-bottom' }, fireBtn);
  box.append(h('div', { class: 'bs' }, status, h('div', { style: `width:${W}px;max-width:100%;display:flex;flex-direction:column` }, seg, seas), trackEl, bottom));
  const myShipEls = {};
  const enemyShipEls = {};

  function setView(v) {
    if (view === v) return;
    view = v;
    track.style.transform = v === 'home' ? `translateX(-${W}px)` : 'none';
    btnT.classList.toggle('on', v === 'target'); btnH.classList.toggle('on', v === 'home');
    (v === 'target' ? btnT : btnH).classList.remove('alert');
    paintTrack();
  }
  function shownShots() { return st.shots.slice(0, Math.max(0, rendered)); }
  function paintTrack() {
    if (!st) return;
    const owner = view === 'target' ? opp : seat;
    const sunk = new Set(shownShots().filter((s) => s.sunk && s.target === owner).map((s) => s.sunk));
    // a small label, then the five ships as 3 + 2, each with its length as little hull squares
    trackEl.replaceChildren(
      h('div', { class: 'who' }, owner === seat ? 'Your fleet' : `${firstName(P)}’s fleet`),
      h('div', { class: 'ships' }, ...FLEET.map((f) => h('div', { class: 'ship-tag' + (sunk.has(f.id) ? ' sunk' : ''), 'aria-label': `${f.name}, ${f.len} squares${sunk.has(f.id) ? ', sunk' : ''}` },
        h('b', null, f.name), h('span', { class: 'len' }, ...Array.from({ length: f.len }, () => h('i')))))));
  }
  function drawMyFleet() {
    for (const s of st.fleets[seat]) {
      const el = h('div', { class: 'ship', 'aria-label': FLEET_BY[s.id].name });
      posShip(el, s, cell); Hm.grid.append(el); myShipEls[s.id] = el;
    }
  }
  function drawEnemyShip(id, cls) {
    if (enemyShipEls[id]) { enemyShipEls[id].className = 'ship enemy ' + cls; posShip(enemyShipEls[id], st.fleets[opp].find((s) => s.id === id), cell); return enemyShipEls[id]; }
    const s = st.fleets[opp].find((x) => x.id === id); if (!s) return null;
    const el = h('div', { class: 'ship enemy ' + cls, 'aria-label': `${P}’s ${FLEET_BY[id].name}` });
    posShip(el, s, cell); T.grid.append(el); enemyShipEls[id] = el;
    return el;
  }
  function renderStatic() {
    for (const s of st.shots) {
      (s.shooter === seat ? T : Hm).peg(s.r, s.c, s.hit, false);
      if (s.sunk) {
        if (s.shooter === seat) drawEnemyShip(s.sunk, '');
        else myShipEls[s.sunk] && myShipEls[s.sunk].classList.add('sunk');
      }
    }
    rendered = st.shots.length;
  }
  const canFire = () => st && st.turn === seat && !pending && !animating && !endShown;
  function paint() {
    if (!st) return;
    if (st.winner && rendered >= st.shots.length) return;
    const myTurn = !animating && st.turn === seat;
    const last = st.shots[st.shots.length - 1];
    const again = !!(last && last.hit && last.shooter === st.turn); // the last shot hit, so the same player goes again
    if (myTurn) {
      if (aim) { fireBtn.disabled = pending; fireBtn.textContent = 'Fire'; }
      else { fireBtn.disabled = true; fireBtn.textContent = 'Pick a square to fire at'; }
      if (!animating && !aim) status.replaceChildren(h('b', null, again ? 'Hit! Fire again. ' : 'Your turn. '), 'Tap a square in their waters to aim.');
      theirRet.hide();
    } else if (!animating) {
      fireBtn.disabled = true; fireBtn.textContent = `${P}’s turn`;
      const p = Live.partner(); const a = p && p.pres && Array.isArray(p.pres.aim) ? p.pres.aim : null;
      if (st.turn === opp && a) { theirRet.at(a[0], a[1]); status.replaceChildren(`${P} is aiming at `, h('b', null, coord(a[0], a[1])), '…'); }
      else { theirRet.hide(); if (st.turn === opp) status.textContent = again ? `${P} hit, so they fire again…` : `${P} is choosing where to fire…`; }
    }
  }
  function setAim(p) {
    aim = p; myRet.at(p.r, p.c);
    Sound.tap(); vibrate(5);
    Live.set({ aim: [p.r, p.c] });
    status.replaceChildren('Tap ', h('b', null, coord(p.r, p.c)), ' again, or press Fire.');
    paint();
  }
  function clearAim() { aim = null; myRet.hide(); Live.set({ aim: null }); }
  T.grid.addEventListener('click', (e) => {
    const p = T.at(e.clientX, e.clientY); if (!p) return;
    if (!canFire()) {
      if (st && st.turn === opp) shake(status, 6, 260, 'transform');
      return;
    }
    if (st.shotBy[seat].has(p.r * 10 + p.c)) { toast(`You’ve already fired at ${coord(p.r, p.c)}`); return; }
    if (aim && aim.r === p.r && aim.c === p.c) fire(); else setAim(p);
  });
  function fire() {
    if (!aim || !canFire()) return;
    const a = aim;
    pending = true; pendingN = st.shots.length;
    clearAim();
    fireBtn.disabled = true;
    vibrate(12);
    write(matchPath(m.id), { shots: { ['s' + pad3(pendingN)]: { r: a.r, c: a.c } } }).then((ok) => { if (!ok) { pending = false; paint(); } });
  }
  async function animateShot(s) {
    const mine = s.shooter === seat;
    const B = mine ? T : Hm;
    const v = mine ? 'target' : 'home';
    if (view !== v) { setView(v); await sleep(480); }
    if (dead) return;
    status.replaceChildren(mine ? 'Firing at ' : `${P} fires at `, h('b', null, coord(s.r, s.c)), '…');
    const cx = s.c * cell + cell / 2, cy = s.r * cell + cell / 2;
    const d = Math.round(cell * 0.46);
    const ball = h('div', { class: 'fx' });
    ball.style.cssText = `width:${d}px;height:${d}px;left:${B.lab + cx - d / 2}px;top:${B.lab + cy - d / 2}px;background:radial-gradient(circle at 35% 30%,#8b8b8b,#1d1d1d 70%);box-shadow:0 6px 10px rgba(0,0,0,.45)`;
    B.wrap.append(ball);
    const fromY = mine ? (B.size - cy) + cell * 2.5 : -(cy + cell * 2.5);
    const fromX = B.size / 2 - cx;
    Sound.whoosh();
    await settle(ball.animate([
      { transform: `translate(${fromX}px,${fromY}px) scale(1.15)` },
      { transform: `translate(${fromX * 0.45}px,${fromY * 0.45 - cell * 1.8}px) scale(1.9)`, offset: 0.5 },
      { transform: 'translate(0,0) scale(.7)' },
    ], { duration: 640, easing: 'cubic-bezier(.35,.15,.6,1)' }));
    ball.remove();
    if (dead) return;
    if (s.hit) {
      Sound.boom(); vibrate([25, 40, 25]);
      const b = h('div', { class: 'fx' }); const bd = cell * 1.7;
      b.style.cssText = `width:${bd}px;height:${bd}px;left:${cx - bd / 2}px;top:${cy - bd / 2}px;background:radial-gradient(circle,#fff6b8 0%,#ffb347 30%,rgba(239,91,43,.85) 50%,rgba(239,91,43,0) 70%)`;
      B.grid.append(b);
      b.animate([{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 560, easing: 'ease-out' }).finished.then(() => b.remove()).catch(() => b.remove());
      B.grid.animate([{ translate: '0 0' }, { translate: '-3px 2px' }, { translate: '3px -2px' }, { translate: '-2px 1px' }, { translate: '0 0' }], { duration: 320 });
    } else {
      Sound.splash();
      for (const delay of [0, 140]) {
        const ring = h('div', { class: 'fx' }); const rd = cell * 1.2;
        ring.style.cssText = `width:${rd}px;height:${rd}px;left:${cx - rd / 2}px;top:${cy - rd / 2}px;border:2px solid var(--miss);box-sizing:border-box`;
        B.grid.append(ring);
        ring.animate([{ transform: 'scale(.25)', opacity: 0.95 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 650, delay, easing: 'ease-out', fill: 'backwards' }).finished.then(() => ring.remove()).catch(() => ring.remove());
      }
    }
    B.peg(s.r, s.c, s.hit, true);
    const where = h('b', null, coord(s.r, s.c));
    if (s.sunk) {
      const name = FLEET_BY[s.sunk].name;
      if (mine) {
        const el = drawEnemyShip(s.sunk, '');
        el && el.animate([{ opacity: 0, transform: 'scale(1.15)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
        toast(`You sank ${P}’s ${name}!`);
        status.replaceChildren(where, ` — you sank their ${name}!`);
      } else {
        myShipEls[s.sunk] && myShipEls[s.sunk].classList.add('sunk');
        toast(`${P} sank your ${name}`);
        status.replaceChildren(where, ` — ${P} sank your ${name}.`);
      }
    } else if (mine) status.replaceChildren(where, s.hit ? ' — hit!' : ' — miss.');
    else status.replaceChildren(`${P} fired at `, where, s.hit ? ' — hit.' : ' — miss.');
    await sleep(s.hit ? 900 : 700);
  }
  async function queue() {
    if (animating || dead) return;
    while (!dead && rendered < (st = bsState(m)).shots.length) {
      animating = true; paint();
      clearTimeout(viewTimer);
      const s = st.shots[rendered];
      await animateShot(s);
      rendered++;
      paintTrack();
      manual = false;
    }
    animating = false;
    if (dead) return;
    if (pending && st.shots.length > pendingN) pending = false;
    if (st.winner) return finish();
    paint();
    clearTimeout(viewTimer);
    if (!manual) {
      if (st.turn === seat && view !== 'target') viewTimer = setTimeout(() => { if (!dead && !manual) setView('target'); }, 700);
      if (st.turn === opp && view !== 'home') viewTimer = setTimeout(() => { if (!dead && !manual && st.turn === opp) setView('home'); }, 1300);
    }
  }
  function finish(quiet) {
    if (endShown) return;
    endShown = true;
    clearAim(); theirRet.hide();
    for (const s of st.fleets[opp]) if (!st.sunk[seat].includes(s.id) && !st.sunk[opp].includes(s.id)) drawEnemyShip(s.id, 'ghosted');
    recordResult(m, st.winner);
    const won = st.winner === seat;
    const pct = st.fired[seat] ? Math.round((100 * st.hits[seat]) / st.fired[seat]) : 0;
    const body = `You fired ${st.fired[seat]} shots and hit ${st.hits[seat]} (${pct}%). ${P} fired ${st.fired[opp]}.`;
    status.replaceChildren(h('b', null, won ? 'Victory. ' : 'Fleet lost. '), body);
    bottom.replaceChildren(endBar(m));
    if (!won) setView('home'); else setView('target');
    if (!quiet) endSheetSoon(m, () => dead, 900, { title: won ? `You sank ${P}’s whole fleet!` : `${P} sank your whole fleet`, body, good: won });
  }

  return {
    update(nm) {
      m = nm; st = bsState(m);
      if (rendered < 0) {
        drawMyFleet();
        renderStatic();
        setView(st.turn === opp ? 'home' : 'target');
        if (st.winner) { finish(true); return; }
        paint();
      }
      queue();
    },
    onPeers() { if (!animating) paint(); },
    isOver() { return !!(st && st.winner); },
    destroy() { dead = true; clearTimeout(viewTimer); Live.set({ aim: null }); },
  };
}
