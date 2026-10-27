'use strict';
// ================= Hues =================
// Our own shedding card game: play a card that matches the active colour, the number or the symbol
// on the pile; first to empty their hand wins. Both phones shuffle the same deck from the match's
// seed and replay the append-only log `plays`:
//   {by, k:'play', ids:[…], col?} · {by, k:'draw'} · {by, k:'keep'} · {by, k:'pass'}   (the player to move)
//   {by, k:'hues'} · {by, k:'callout'}                                               (either player, any time)
const HUE_COLOURS = ['lavender', 'orange', 'navy', 'sage'];
const HUE_NAMES = ['Lavender', 'Orange', 'Navy', 'Sage'];
const HUE_HAND = 7;
const HUE_OPEN_SPECIALS = 2; // no opening hand gets more action cards than this
const HUE_CALLOUT = 2;       // cards for being caught on one card without calling Hues
// again: another turn · p2 Splash: +2 · p4 Flood: +4 and pick the colour · blend: pick the colour · trade: swap hands and pick
const HUE_KIND = {
  n: { name: '' },
  again: { name: 'Again' },
  p2: { name: 'Splash', pen: 2 },
  p4: { name: 'Flood', pen: 4, wild: true },
  blend: { name: 'Blend', wild: true },
  trade: { name: 'Trade', wild: true },
};
// 95 cards: per colour 1–9 twice, two Again and two Splash; then four Blend, two Flood and one Trade
const HUE_DECK = (() => {
  const d = [];
  for (let c = 0; c < 4; c++) {
    for (let v = 1; v <= 9; v++) d.push({ c, k: 'n', v }, { c, k: 'n', v });
    for (let i = 0; i < 2; i++) d.push({ c, k: 'again' }, { c, k: 'p2' });
  }
  for (let i = 0; i < 4; i++) d.push({ c: -1, k: 'blend' });
  for (let i = 0; i < 2; i++) d.push({ c: -1, k: 'p4' });
  d.push({ c: -1, k: 'trade' });
  return d.map((x, id) => ({ ...x, id }));
})();
const hueName = (c) => [c.c >= 0 ? HUE_NAMES[c.c] : '', c.k === 'n' ? c.v : HUE_KIND[c.k].name, HUE_KIND[c.k].pen ? '+' + HUE_KIND[c.k].pen : ''].filter(Boolean).join(' ');

// a small seeded generator (mulberry32 over an FNV hash of the seed), the same on every phone
function hueRng(seed) {
  let a = 2166136261;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hueShuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// Can this card go on the pile right now?
function hueFits(st, card) {
  const top = HUE_DECK[st.discard[st.discard.length - 1]];
  if (st.penalty) {
    // a chain is on: a Flood goes on anything; a +2 on a +2, or on a Flood only in the colour it named
    if (card.k === 'p4') return true;
    if (card.k === 'p2') return top.k === 'p2' || card.c === st.colour;
    return false;
  }
  if (st.drawn != null && card.id !== st.drawn) return false; // after drawing, only the drawn card
  if (HUE_KIND[card.k].wild) return true;
  return card.c === st.colour || (card.k === 'n' ? top.k === 'n' && top.v === card.v : top.k === card.k);
}
// Several cards at once: the first has to fit, and the rest are number cards with the same number.
function hueFitsAll(st, ids) {
  const cards = ids.map((id) => HUE_DECK[id]);
  if (!cards.length || cards.some((c) => !c) || new Set(ids).size !== ids.length || !hueFits(st, cards[0])) return false;
  return cards.length === 1 || (!st.penalty && st.drawn == null && cards.every((c) => c.k === 'n' && c.v === cards[0].v));
}
const hueSpecial = (id) => HUE_DECK[id].k !== 'n';

// Replays the log (the first `limit` moves that counted). Nothing here is ever stored.
//   paid   the player to move has just picked up a chain, so may pass without drawing
//   said   called Hues · owes: down to one card without calling it, so can be called out until their next turn
function huState(m, limit = Infinity) {
  const starter = rpsState(m).starter;
  const rnd = hueRng(m.seed || m.id);
  const st = {
    starter, hands: { host: [], guest: [] }, pile: hueShuffle(HUE_DECK.map((c) => c.id), rnd), discard: [],
    colour: 0, turn: starter, penalty: 0, drawn: null, paid: false, said: { host: false, guest: false }, owes: { host: false, guest: false },
    grace: null, firstOut: null, winner: null, log: [],
  };
  if (!starter) return st;
  for (let i = 0; i < HUE_HAND; i++) {
    for (const s of [other(starter), starter]) {
      let j = st.pile.length - 1;
      if (st.hands[s].filter(hueSpecial).length >= HUE_OPEN_SPECIALS) while (hueSpecial(st.pile[j])) j--;
      st.hands[s].push(st.pile.splice(j, 1)[0]);
    }
  }
  const first = st.pile.findLastIndex((id) => !hueSpecial(id)); // the pile starts on a number card
  st.discard.push(st.pile.splice(first, 1)[0]);
  st.colour = HUE_DECK[st.discard[0]].c;
  const draw = (n) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      if (!st.pile.length && st.discard.length > 1) st.pile = hueShuffle(st.discard.splice(0, st.discard.length - 1), rnd);
      if (!st.pile.length) break;
      ids.push(st.pile.pop());
    }
    return ids;
  };
  for (const key of sortedKeys(m.plays)) {
    if (st.winner || st.log.length >= limit) break;
    const mv = m.plays[key];
    const by = mv && mv.by;
    if (by !== 'host' && by !== 'guest') continue;
    const before = st.turn;
    if (mv.k === 'hues') {
      const n = st.hands[by].length;
      if (st.said[by] || !((st.owes[by] && n === 1) || (st.turn === by && n <= 2))) continue;
      st.said[by] = true; st.owes[by] = false;
      st.log.push({ by, k: 'hues' });
      continue;
    }
    if (mv.k === 'callout') {
      const x = other(by);
      if (!(st.owes[x] && st.hands[x].length === 1 && st.turn !== x)) continue;
      const ids = draw(HUE_CALLOUT);
      st.hands[x].push(...ids);
      st.log.push({ by, k: 'callout', who: x, ids });
    } else {
      if (by !== st.turn) continue;
      const me = by, opp = other(me), hand = st.hands[me];
      if (mv.k === 'play') {
        const ids = Array.isArray(mv.ids) ? mv.ids : [mv.id];
        if (!ids.every((id) => hand.includes(id)) || !hueFitsAll(st, ids)) continue;
        const last = HUE_DECK[ids[ids.length - 1]], kind = HUE_KIND[last.k];
        if (kind.wild && !(mv.col >= 0 && mv.col < 4)) continue;
        for (const id of ids) { hand.splice(hand.indexOf(id), 1); st.discard.push(id); }
        st.colour = kind.wild ? mv.col : last.c;
        st.drawn = null; st.paid = false;
        st.penalty += kind.pen || 0;
        if (last.k === 'trade') {
          [st.hands.host, st.hands.guest] = [st.hands.guest, st.hands.host];
          st.said = { host: false, guest: false };
        } else if (hand.length === 1 && !st.said[me]) st.owes[me] = true;
        if (last.k !== 'again') st.turn = opp;
        st.log.push({ by: me, k: 'play', ids, col: st.colour });
      } else if (mv.k === 'draw') {
        if (st.drawn != null) continue;
        if (st.penalty) {
          // take the whole chain, then carry on with a normal turn (or pass)
          const ids = draw(st.penalty);
          hand.push(...ids);
          if (!st.hands[opp].length) st.grace = me; // they're out, but you still get your turn
          st.log.push({ by: me, k: 'draw', ids, pen: st.penalty });
          st.penalty = 0; st.paid = true;
        } else {
          const ids = draw(1);
          hand.push(...ids);
          st.paid = false;
          if (ids.length && hueFits({ ...st, drawn: ids[0] }, HUE_DECK[ids[0]])) st.drawn = ids[0];
          else st.turn = opp;
          st.log.push({ by: me, k: 'draw', ids });
        }
      } else if (mv.k === 'keep' || mv.k === 'pass') {
        if (mv.k === 'keep' ? st.drawn == null : (!st.paid || st.drawn != null)) continue;
        st.drawn = null; st.paid = false; st.turn = opp;
        st.log.push({ by: me, k: mv.k });
      } else continue;
    }
    // Hues calls only count while they're down to one card; a missed call can be caught until their next turn
    for (const s of ['host', 'guest']) {
      const n = st.hands[s].length;
      if (n !== 1) st.owes[s] = false;
      if (n > 2 || (n === 2 && st.turn !== s)) st.said[s] = false;
      if (st.turn === s && before !== s) st.owes[s] = false;
    }
    // who emptied their hand first, and is it settled? Not while a chain is on, or during the turn owed after one.
    if (st.firstOut && st.hands[st.firstOut].length) st.firstOut = null;
    if (!st.firstOut) st.firstOut = [before, other(before)].find((s) => s && !st.hands[s].length) || null;
    if (st.grace && st.turn !== st.grace) st.grace = null;
    if (st.firstOut && !st.penalty && !st.grace) { st.winner = st.firstOut; st.turn = null; }
  }
  return st;
}

const HUE_ICON = {
  again: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M30 14a11 11 0 1 0 2 11"/><path d="M31 6v8h-8"/></svg>',
  blend: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6c8 0 14 6 14 14"/><path d="M34 20c0 8-6 14-14 14"/><path d="M20 34c-8 0-14-6-14-14"/><path d="M6 20c0-8 6-14 14-14"/><circle cx="20" cy="20" r="4" fill="currentColor"/></svg>',
  trade: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14h22M24 8l6 6-6 6"/><path d="M32 26H10M16 20l-6 6 6 6"/></svg>',
};
function hueCard(id) {
  if (id == null) return h('div', { class: 'hcard back', 'aria-hidden': 'true' });
  const c = HUE_DECK[id], kind = HUE_KIND[c.k];
  const big = c.k === 'n' ? String(c.v) : kind.pen ? '+' + kind.pen : null;
  const corner = big || kind.name[0];
  return h('div', { class: `hcard ${c.c >= 0 ? HUE_COLOURS[c.c] : 'wild'} k-${c.k}`, 'data-id': id, role: 'img', 'aria-label': hueName(c) },
    h('span', { class: 'ix' }, corner),
    big ? h('b', { class: 'v' }, big) : h('i', { class: 'sym', html: HUE_ICON[c.k] }),
    kind.name ? h('span', { class: 'nm' }, kind.name) : null,
    h('span', { class: 'ix end' }, corner));
}
// the four paint pots to pick the next colour from
function hueAskColour(title) {
  return new Promise((resolve) => {
    const pots = h('div', { class: 'hue-pots' }, ...HUE_NAMES.map((n, i) => h('button', {
      class: 'hue-pot ' + HUE_COLOURS[i],
      onclick: () => { Sound.pick(); closeSheet(); resolve(i); },
    }, h('i'), h('span', null, n))));
    openSheet({ title, body: h('div', { class: 'sheet-body' }, pots), actions: [{ label: 'Not this card', kind: 'ghost', onClick: () => resolve(null) }] });
  });
}

function makeHU(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, st = null, rendered = -1, animating = false, pending = false, pendingN = -1, endShown = false, dead = false;
  let sel = [], drag = null, cw = 66, chh = 94;

  const countMe = h('b'), countThem = h('b');
  const chipMe = h('div', { class: 'turn-chip' }, h('span', null, 'You'), countMe);
  const chipThem = h('div', { class: 'turn-chip' }, h('span', null, P), countThem);
  const theirHand = h('div', { class: 'hu-their' });
  const deck = h('button', { class: 'hu-deck', 'aria-label': 'Draw a card' }, hueCard(null), hueCard(null), h('span', { class: 'hu-left' }));
  const pileEl = h('div', { class: 'hu-pile', 'aria-label': 'The pile' });
  const swatch = h('div', { class: 'hu-swatch' }, h('i'), h('span'));
  const penEl = h('div', { class: 'hu-pen', hidden: true });
  const tableEl = h('div', { class: 'hu-table' }, deck, pileEl, h('div', { class: 'hu-side' }, swatch, penEl));
  const status = h('div', { class: 'hu-status status-line', 'aria-live': 'polite' });
  const huesBtn = h('button', { class: 'btn btn-primary hu-call' }, 'Hues!');
  const calloutBtn = h('button', { class: 'btn btn-ghost hu-call' }, 'Call out');
  const actBtn = h('button', { class: 'btn hu-act' });
  const btnRow = h('div', { class: 'hu-btns' }, huesBtn, actBtn, calloutBtn);
  const handEl = h('div', { class: 'hu-hand', role: 'group', 'aria-label': 'Your hand' });
  const endArea = h('div', { class: 'end-area', hidden: true });
  const root = h('div', { class: 'hu' }, h('div', { class: 'turnbar' }, chipMe, chipThem), theirHand, tableEl, status, btnRow, handEl, endArea);
  box.append(root);

  const canAct = () => !!(st && st.turn === seat && !st.winner && !pending && !animating);
  const canSayHues = (s) => !!(s && !s.winner && !s.said[seat] && ((s.owes[seat] && s.hands[seat].length === 1) || (s.turn === seat && s.hands[seat].length <= 2)));
  const canCallOut = (s) => !!(s && !s.winner && s.owes[opp] && s.hands[opp].length === 1 && s.turn !== opp);
  const shake = (el) => el.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 260 });
  const sortKey = (id) => { const c = HUE_DECK[id]; return (c.c < 0 ? 4 : c.c) * 1000 + ['n', 'again', 'p2', 'blend', 'p4', 'trade'].indexOf(c.k) * 20 + (c.v || 0); };
  const tilt = (id) => ((id * 37) % 11) - 5;

  function layout() {
    const W = box.clientWidth || 358;
    cw = Math.max(54, Math.min(80, Math.floor(W / 4.8)));
    chh = Math.round(cw * 1.42);
    root.style.setProperty('--cw', cw + 'px');
    root.style.setProperty('--ch', chh + 'px');
  }

  // ---- painting ----
  function paint(s) {
    const mine = s.hands[seat], theirs = s.hands[opp];
    countMe.textContent = mine.length; countThem.textContent = theirs.length;
    chipMe.classList.toggle('active', s.turn === seat);
    chipThem.classList.toggle('active', s.turn === opp);
    // their hand: backs only
    const tw = Math.round(cw * 0.62), step = theirs.length > 1 ? Math.min(tw * 0.55, ((box.clientWidth || 358) - tw - 20) / (theirs.length - 1)) : 0;
    theirHand.replaceChildren(...theirs.map((_, i) => { const b = hueCard(null); b.style.cssText = `left:${i * step}px;rotate:${(i - (theirs.length - 1) / 2) * 1.2}deg`; return b; }));
    theirHand.style.width = (theirs.length ? tw + step * (theirs.length - 1) : 0) + 'px';
    theirHand.setAttribute('aria-label', `${P} has ${theirs.length} card${theirs.length === 1 ? '' : 's'}`);
    deck.querySelector('.hu-left').textContent = s.pile.length;
    deck.classList.toggle('empty', !s.pile.length);
    pileEl.replaceChildren(...s.discard.slice(-3).map((id) => { const c = hueCard(id); c.style.rotate = tilt(id) + 'deg'; return c; }));
    swatch.className = 'hu-swatch ' + HUE_COLOURS[s.colour];
    swatch.querySelector('span').textContent = HUE_NAMES[s.colour];
    penEl.hidden = !s.penalty;
    penEl.textContent = s.penalty ? `+${s.penalty}` : '';
    paintHand(s);
    paintChrome(s);
  }
  function paintHand(s) {
    const ids = s.hands[seat].slice().sort((a, b) => sortKey(a) - sortKey(b) || a - b);
    sel = sel.filter((id) => ids.includes(id));
    const W = handEl.clientWidth || box.clientWidth || 358;
    const perRow = Math.max(2, Math.floor((W - cw) / 44) + 1);
    const rows = Math.max(1, Math.ceil(ids.length / perRow));
    const inRow = Math.ceil(ids.length / rows);
    const rowStep = Math.max(48, Math.round(chh * 0.6));
    const kids = ids.map((id, i) => {
      const r = Math.floor(i / inRow), k = i % inRow, n = Math.min(inRow, ids.length - r * inRow);
      const step = n > 1 ? Math.min(cw + 6, (W - cw) / (n - 1)) : 0;
      const x = (W - (cw + step * (n - 1))) / 2 + k * step;
      const el = hueCard(id);
      el.style.cssText = `left:${x}px;top:${18 + r * rowStep}px;z-index:${i + 1};rotate:${(k - (n - 1) / 2) * 0.8}deg`;
      const at = sel.indexOf(id);
      if (at >= 0) { el.classList.add('sel'); if (sel.length > 1) el.append(h('span', { class: 'hu-order' }, at + 1)); }
      return el;
    });
    handEl.replaceChildren(...kids);
    handEl.style.height = 18 + (rows - 1) * rowStep + chh + 8 + 'px';
  }
  function paintChrome(s = st) {
    if (!s || !s.starter) return;
    const full = st || s;
    root.dataset.ready = canAct() ? '1' : '';
    btnRow.hidden = !!s.winner;
    actBtn.disabled = !canAct();
    actBtn.style.visibility = s.turn === seat ? 'visible' : 'hidden';
    actBtn.className = 'btn hu-act ' + (s.drawn != null || (s.paid && !s.penalty) ? 'btn-felt' : 'btn-ink');
    actBtn.textContent = s.penalty ? `Pick up ${s.penalty}` : s.drawn != null ? 'Keep it' : s.paid ? 'Pass' : 'Draw a card';
    huesBtn.disabled = pending || !!full.said[seat];
    calloutBtn.disabled = pending;
    if (s.winner) { status.textContent = ''; return; }
    const top = HUE_DECK[s.discard[s.discard.length - 1]];
    status.replaceChildren();
    const say = (...parts) => status.append(...parts.map((p) => (Array.isArray(p) ? h('b', null, p[0]) : p)));
    if (s.turn === seat) {
      const stackable = s.hands[seat].some((id) => hueFits(s, HUE_DECK[id]));
      if (s.penalty) say(`+${s.penalty} for you. `, stackable ? (top.k === 'p4' ? ['Flood it, or +2 in ' + HUE_NAMES[s.colour]] : ['Stack a +2 or a Flood']) : 'Pick them up', stackable ? ' or pick up' : '');
      else if (sel.length > 1) say('Tap the pile to play ', [`all ${sel.length}`], ' together');
      else if (s.drawn != null) say('It fits! ', ['Play it'], ', or keep it');
      else if (s.paid) say('Play a card, or ', ['pass']);
      else if (s.grace) say(`${P} is out of cards. `, ['Last turn'], ' to stop them');
      else say('Your turn. Play on ', [HUE_NAMES[s.colour]], top.k === 'n' ? ` or a ${top.v}` : '');
    } else if (s.turn === opp) {
      const p = Live.partner();
      if (s.penalty) say(`${P} has to stack or pick up `, [`${s.penalty}`]);
      else say(p && p.pres && typeof p.pres.hover === 'number' ? `${P} is choosing a card…` : `Waiting for ${P}…`);
    }
  }

  // ---- animation queue: one logged move at a time ----
  const rectOf = (el) => el.getBoundingClientRect();
  function flyFrom(el, from, dur = 380, delay = 0) {
    const to = rectOf(el);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return settle(el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`, opacity: 0.9 }, { transform: 'none', opacity: 1 }],
      { duration: dur, delay, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' }));
  }
  async function flyDrawn(who, ids) {
    const from = rectOf(deck);
    const els = who === seat ? ids.map((id) => handEl.querySelector(`[data-id="${id}"]`)).filter(Boolean) : [...theirHand.children].slice(-ids.length);
    await Promise.all(els.slice(-8).map((el, i) => flyFrom(el, from, 340, i * 70)));
  }
  async function animate(ev, after) {
    if (ev.k === 'play') {
      const froms = ev.ids.map((id, i) => {
        const src = ev.by === seat ? handEl.querySelector(`[data-id="${id}"]`) : theirHand.children[theirHand.children.length - 1 - i];
        return rectOf(src || (ev.by === seat ? handEl : theirHand));
      });
      const card = HUE_DECK[ev.ids[ev.ids.length - 1]];
      paint(after);
      Sound.clack(); vibrate(8);
      const tops = [...pileEl.children].slice(-ev.ids.length);
      const go = tops.map((el, i) => flyFrom(el, froms[froms.length - tops.length + i], 380, i * 160));
      if (HUE_KIND[card.k].wild) go.push(settle(swatch.animate([{ scale: 0.4, opacity: 0 }, { scale: 1.15, opacity: 1, offset: 0.7 }, { scale: 1 }], { duration: 520, delay: 200 })));
      if (HUE_KIND[card.k].pen) go.push(settle(penEl.animate([{ scale: 0.3 }, { scale: 1.3, offset: 0.6 }, { scale: 1 }], { duration: 480, delay: 220 })));
      if (card.k === 'trade') {
        Sound.whoosh();
        go.push(settle(handEl.animate([{ transform: 'translateY(-60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, delay: 250, fill: 'backwards' })));
        go.push(settle(theirHand.animate([{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, delay: 250, fill: 'backwards' })));
      }
      await Promise.all(go);
    } else if (ev.k === 'draw') {
      paint(after);
      if (ev.pen) Sound.lose(); else Sound.pop();
      await flyDrawn(ev.by, ev.ids);
    } else if (ev.k === 'hues') {
      paint(after);
      Sound.ding(); vibrate(12);
      toast(ev.by === seat ? 'Hues! You’re safe on one card' : `${P} called Hues!`);
      const chip = ev.by === seat ? chipMe : chipThem;
      await settle(chip.animate([{ scale: 1 }, { scale: 1.08, offset: 0.4 }, { scale: 1 }], { duration: 420 }));
    } else if (ev.k === 'callout') {
      paint(after);
      Sound.lose(); vibrate([10, 60, 10]);
      toast(ev.by === seat ? `Caught! ${P} picks up ${HUE_CALLOUT}` : `${P} called you out: pick up ${HUE_CALLOUT}`, 3000);
      await flyDrawn(ev.who, ev.ids);
    } else paint(after);
  }
  async function queue() {
    if (animating || dead) return;
    let full = huState(m);
    if (full.log.length < rendered) { rendered = full.log.length; paint(full); }
    while (!dead && rendered < (full = huState(m)).log.length) {
      animating = true;
      paintChrome(st);
      const ev = full.log[rendered];
      rendered++;
      await animate(ev, huState(m, rendered));
    }
    animating = false;
    if (dead) return;
    st = huState(m);
    if (pending && Object.keys(m.plays || {}).length > pendingN) pending = false;
    paint(st);
    if (st.winner) finish();
  }
  function finish() {
    if (endShown) return;
    endShown = true;
    recordResult(m, st.winner);
    endArea.hidden = false;
    endArea.replaceChildren(endBar(m));
    const n = st.log.reduce((t, e) => t + (e.k === 'play' ? e.ids.length : 0), 0);
    const title = st.winner === seat ? 'Out of cards. You win!' : `${P} played their last card`;
    setTimeout(() => { if (!dead && G.matchId === m.id) endSheet(m, { title, body: `${n} cards played, ${st.hands[st.winner === seat ? opp : seat].length} left in the losing hand.`, good: st.winner === seat }); }, 900);
  }

  // ---- moves ----
  // Keys carry the seat, so a Hues or Call out sent at the same moment as the other phone's move can't collide.
  function send(mv) {
    pendingN = Object.keys(m.plays || {}).length;
    pending = true;
    paintChrome();
    if (mv.k !== 'hues' && mv.k !== 'callout') Live.set({ hover: null });
    write(`tables/${G.code}/matches/${m.id}`, { plays: { ['p' + String(pendingN).padStart(4, '0') + seat[0]]: { by: seat, ...mv } } })
      .then((ok) => { if (!ok) { pending = false; paintChrome(); } });
  }
  async function play(ids) {
    if (!canAct()) { if (st && st.turn === opp) shake(status); return; }
    if (!hueFitsAll(st, ids)) {
      for (const id of ids) { const el = handEl.querySelector(`[data-id="${id}"]`); el && shake(el); }
      const top = HUE_DECK[st.discard[st.discard.length - 1]];
      toast(ids.length > 1 && hueFits(st, HUE_DECK[ids[0]]) ? 'Only cards with the same number go down together'
        : st.penalty ? (top.k === 'p4' ? `Only a Flood, or a +2 in ${HUE_NAMES[st.colour]}, can stop this` : 'Only a +2 or a Flood can go on a Splash')
        : st.drawn != null ? 'You drew: only that card can go now' : `That doesn’t match ${HUE_NAMES[st.colour]} or the top card`);
      return;
    }
    const last = HUE_DECK[ids[ids.length - 1]];
    let col;
    if (HUE_KIND[last.k].wild) {
      col = await hueAskColour(last.k === 'trade' ? 'Swap hands, then pick the colour' : 'Pick the next colour');
      if (col == null || !canAct()) { sel = []; paintHand(st); Live.set({ hover: null }); return; }
    }
    sel = [];
    send({ k: 'play', ids, ...(col != null ? { col } : {}) });
  }
  function act() {
    if (!canAct()) return;
    Sound.tap();
    send({ k: st.drawn != null ? 'keep' : st.paid && !st.penalty ? 'pass' : 'draw' });
  }
  actBtn.addEventListener('click', act);
  deck.addEventListener('click', () => {
    if (!canAct()) return;
    if (st.drawn != null) { toast('Play the card you drew, or keep it'); return; }
    Sound.tap();
    send({ k: 'draw' });
  });
  pileEl.addEventListener('click', () => { if (sel.length) play(sel.slice()); });
  huesBtn.addEventListener('click', () => {
    if (pending) return;
    if (!canSayHues(st)) { toast(st && st.said[seat] ? 'You’ve called it' : 'Call Hues when you’re down to one card'); return; }
    send({ k: 'hues' });
  });
  calloutBtn.addEventListener('click', () => {
    if (pending) return;
    if (!canCallOut(st)) { toast(`Nothing to call out. ${P} has to be on one card without calling Hues`); return; }
    send({ k: 'callout' });
  });

  // tap a card to lift it (tap another with the same number to add it), tap it again or the pile to play;
  // or drag it up onto the pile
  handEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.hcard');
    if (!el || !st) return;
    drag = { el, id: +el.dataset.id, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId };
    try { handEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  handEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 10 && canAct()) {
      drag.moved = true;
      drag.el.classList.add('dragging');
      Live.set({ hover: 1 });
    }
    if (drag.moved) drag.el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 30}deg)`;
  });
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    if (d.moved) {
      d.el.classList.remove('dragging');
      const over = !cancel && e.clientY < rectOf(handEl).top + 4;
      if (over) {
        d.el.style.visibility = 'hidden';
        play(sel.includes(d.id) ? sel.slice() : [d.id]).then(() => { if (d.el.isConnected) { d.el.style.visibility = ''; d.el.style.transform = ''; } });
      } else { d.el.style.transform = ''; Live.set({ hover: null }); }
      return;
    }
    if (cancel) return;
    Sound.tap();
    const c = HUE_DECK[d.id], first = sel.length && HUE_DECK[sel[0]];
    if (sel.includes(d.id)) { play(sel.slice()); return; }
    if (first && first.k === 'n' && c.k === 'n' && c.v === first.v) sel.push(d.id); // same number: goes down with it
    else sel = [d.id];
    if (st.turn === seat) Live.set({ hover: 1 });
    paintHand(st);
    paintChrome();
  };
  handEl.addEventListener('pointerup', (e) => endDrag(e, false));
  handEl.addEventListener('pointercancel', (e) => endDrag(e, true));

  return {
    update(nm) {
      m = nm;
      if (rendered < 0) {
        layout();
        st = huState(m);
        rendered = st.log.length;
        requestAnimationFrame(() => { if (!dead) paint(huState(m, rendered)); });
        paint(st);
        if (st.winner) { endShown = true; recordResult(m, st.winner); endArea.hidden = false; endArea.replaceChildren(endBar(m)); }
      }
      st = huState(m);
      if (pending && Object.keys(m.plays || {}).length > pendingN) pending = false;
      queue();
    },
    onPeers() { if (st && !animating) paintChrome(); },
    isOver() { return !!(st && st.winner); },
    destroy() { dead = true; Live.set({ hover: null }); },
  };
}
