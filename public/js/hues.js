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

// Legality is shared by the UI and the replay. Official-style uses the painted Hues
// deck, including Trade; it is a single-hand adaptation, not the full UNO game.
const HUE_CALLOUT_MS = 2000;
const HUE_SHUFFLES = 2;
function hueFits(st, card) {
  if (!card) return false;
  const top = HUE_DECK[st.discard.at(-1)];
  if (st.penalty) {
    if (st.rules === 'official') return false;
    if (card.k === 'p4') return true;
    return card.k === 'p2' && (top.k === 'p2' || card.c === st.colour);
  }
  if (st.drawn != null && card.id !== st.drawn) return false;
  if (st.rules === 'official') {
    // Flood is legal only without a card in the active colour. Enforced directly;
    // this version does not offer bluffing, challenges or 500-point match scoring.
    if (card.k === 'p4' && st.hands?.[st.turn]?.some(id => HUE_DECK[id].c === st.colour)) return false;
  }
  if (HUE_KIND[card.k].wild) return true;
  return card.c === st.colour || (card.k === 'n' ? top.k === 'n' && top.v === card.v : top.k === card.k);
}
function hueFitsAll(st, ids) {
  if (!Array.isArray(ids)) return false;
  const cards = ids.map(id => HUE_DECK[id]);
  if (!cards.length || cards.some(c => !c) || new Set(ids).size !== ids.length || !hueFits(st, cards[0])) return false;
  return cards.length === 1 || (st.rules !== 'official' && !st.penalty && st.drawn == null && cards.every(c => c.k === 'n' && c.v === cards[0].v));
}
const hueSpecial = (id) => HUE_DECK[id].k !== 'n';

// Seven cards each, one at a time, starting with the player who doesn't go first. A hand that
// already holds HUE_OPEN_SPECIALS action cards gets the next number card instead; the pile starts on a number.
function hueDeal(st) {
  for (let i = 0; i < HUE_HAND; i++) {
    for (const s of [other(st.starter), st.starter]) {
      let j = st.pile.length - 1;
      if (st.hands[s].filter(hueSpecial).length >= HUE_OPEN_SPECIALS) while (hueSpecial(st.pile[j])) j--;
      st.hands[s].push(st.pile.splice(j, 1)[0]);
    }
  }
  const first = st.pile.findLastIndex((id) => !hueSpecial(id));
  st.discard.push(st.pile.splice(first, 1)[0]);
  st.colour = HUE_DECK[st.discard[0]].c;
}

// Replays the log (the first `limit` moves that counted). Nothing here is ever stored.
//   paid   the player to move has just picked up a chain, so may pass without drawing
//   said   called Hues · owes: down to one card without calling it, so can be called out until their next turn
function huLegacyState(m, limit = Infinity) {
  const starter = rpsState(m).starter;
  const rnd = hueRng(m.seed || m.id);
  const st = {
    starter, hands: { host: [], guest: [] }, pile: hueShuffle(HUE_DECK.map((c) => c.id), rnd), discard: [],
    colour: 0, turn: starter, penalty: 0, drawn: null, paid: false, said: { host: false, guest: false }, owes: { host: false, guest: false },
    grace: null, firstOut: null, winner: null, log: [],
  };
  if (!starter) return st;
  hueDeal(st);
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

// Version 2: pure command application. Only commands/options are stored in Firebase.
// plays keys: version 1 (saved games) four digits plus the seat, p0042h; version 2 five digits, p00042
const hueKeyV1 = (n, seat) => 'p' + String(n).padStart(4, '0') + seat[0];
const hueKeyV2 = (n) => 'p' + String(n).padStart(5, '0');
function hueInitial(m) {
  const starter = rpsState(m).starter, rules = m.hueRules || 'custom', rnd = hueRng(m.seed || m.id);
  const ids = HUE_DECK.map((c) => c.id);
  const s = {
    version: 2, rules, starter, hands: { host: [], guest: [] }, pile: hueShuffle(ids, rnd), discard: [], colour: 0, turn: starter,
    penalty: 0, drawn: null, paid: false, said: { host: false, guest: false }, owes: { host: false, guest: false }, oneKey: { host: null, guest: null },
    callWindow: null, shuffles: { host: 0, guest: 0 }, firstOut: null, grace: null, winner: null, log: [], seed: m.seed || m.id, reshuffles: 0,
  };
  if (s.starter) hueDeal(s);
  return s;
}
function hueCanSay(s, seat) { return !!(s && !s.winner && s.hands[seat].length === 1 && !s.said[seat]); }
// the other player is on one card without calling Hues, and this phone hasn't opened the call-out window for it yet
function hueNeedsNotice(s, seat) {
  const victim = other(seat);
  return !!(s && !s.winner && s.turn === seat && s.owes[victim] && !s.said[victim] && s.hands[victim].length === 1 && s.callWindow?.one !== s.oneKey[victim]);
}
function hueCanCall(s, seat, now = Infinity) {
  const victim = other(seat), window = s?.callWindow;
  return !!(s && !s.winner && s.turn === seat && s.owes[victim] && !s.said[victim] && s.hands[victim].length === 1
    && window?.by === seat && window.one === s.oneKey[victim] && now >= window.until);
}
function hueApply(state, mv, key) {
  const s = clone(state), by = mv?.by;
  const fail = (text) => { throw Error(text); };
  if (!['host', 'guest'].includes(by) || s.winner) fail('This move is not available.');
  const opp = other(by), hand = s.hands[by];
  // a hand that changes loses its Hues call, and any call-out window against it
  const invalidate = (seat) => {
    s.said[seat] = false; s.owes[seat] = false; s.oneKey[seat] = null;
    if (s.callWindow?.who === seat) s.callWindow = null;
  };
  const draw = (seat, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!s.pile.length && s.discard.length > 1) s.pile = hueShuffle(s.discard.splice(0, s.discard.length - 1), hueRng(s.seed + ':recycle:' + s.reshuffles++));
      if (!s.pile.length) break;
      out.push(s.pile.pop());
    }
    s.hands[seat].push(...out);
    invalidate(seat);
    return out;
  };
  // down to one card without calling Hues: it can be called out, and this move's key marks the moment
  const one = (seat) => {
    if (s.hands[seat].length === 1 && !s.said[seat]) { s.owes[seat] = true; s.oneKey[seat] = key; }
    else if (s.hands[seat].length !== 1) invalidate(seat);
  };
  // The next player's ordinary play/draw closes any unchallenged declaration.
  const closeMissed = () => { if (s.owes[opp]) { s.owes[opp] = false; s.oneKey[opp] = null; s.callWindow = null; } };
  const time = () => {
    const at = typeof mv.at === 'number' ? mv.at : mv.at && Number(mv.at.seconds) * 1000 + (Number(mv.at.nanoseconds) || 0) / 1e6;
    if (!Number.isFinite(at)) fail('A response needs a timestamp.');
    return at;
  };
  let ev;
  if (mv.k === 'hues') {
    if (!hueCanSay(s, by)) fail('Call Hues only when you have exactly one card.');
    s.said[by] = true; s.owes[by] = false;
    if (s.callWindow?.who === by) s.callWindow = null;
    ev = { by, k: 'hues' };
  } else if (mv.k === 'notice') {
    if (!hueNeedsNotice(s, by) || mv.one !== s.oneKey[opp]) fail('There is no new one-card turn to notice.');
    s.callWindow = { by, who: opp, one: mv.one, until: time() + HUE_CALLOUT_MS };
    ev = { by, k: 'notice', who: opp, until: s.callWindow.until };
  } else if (mv.k === 'callout') {
    if (!hueCanCall(s, by, time()) || mv.one !== s.oneKey[opp]) fail('Call out unlocks two seconds after your screen shows the new turn.');
    const ids = draw(opp, HUE_CALLOUT);
    ev = { by, k: 'callout', who: opp, ids };
  } else if (mv.k === 'shuffle') {
    if (s.rules !== 'custom' || s.shuffles[by] >= HUE_SHUFFLES || s.drawn != null || s.pile.length < 2) fail('No shuffle is available.');
    s.shuffles[by]++;
    s.pile = hueShuffle(s.pile, hueRng(s.seed + ':shuffle:' + by + ':' + s.shuffles[by]));
    ev = { by, k: 'shuffle' };
  } else {
    if (by !== s.turn) fail('It is not your turn.');
    if (mv.k === 'play') {
      const ids = mv.ids;
      if (!Array.isArray(ids) || !ids.every((id) => hand.includes(id)) || !hueFitsAll(s, ids)) fail('Those cards cannot be played now.');
      const last = HUE_DECK[ids.at(-1)], kind = HUE_KIND[last.k];
      if (kind.wild && (!Number.isInteger(mv.col) || mv.col < 0 || mv.col > 3)) fail('Choose the next colour.');
      invalidate(by);
      for (const id of ids) { hand.splice(hand.indexOf(id), 1); s.discard.push(id); }
      s.colour = kind.wild ? mv.col : last.c;
      s.drawn = null; s.paid = false;
      s.penalty += kind.pen || 0;
      if (last.k === 'trade') {
        [s.hands.host, s.hands.guest] = [s.hands.guest, s.hands.host];
        invalidate('host'); invalidate('guest'); one('host'); one('guest');
      } else one(by);
      s.turn = last.k === 'again' ? by : opp;
      closeMissed();
      ev = { by, k: 'play', ids, col: s.colour };
    } else if (mv.k === 'draw') {
      if (s.drawn != null) fail('Play the drawn card, or keep it.');
      if (s.paid) fail('Play a card or pass after paying a draw penalty.');
      closeMissed();
      if (s.penalty) {
        const pen = s.penalty, ids = draw(by, pen);
        s.penalty = 0; s.drawn = null;
        // Empty-handed opponent wins as soon as the chain is paid. Cards just
        // drawn can never resurrect a finished game or start another stack.
        if (!s.hands[opp].length) { s.winner = opp; s.turn = null; }
        else if (s.rules === 'official') { s.turn = opp; s.paid = false; }
        else s.paid = true;
        ev = { by, k: 'draw', ids, pen };
      } else {
        const ids = draw(by, 1);
        s.paid = false;
        if (ids.length && hueFits({ ...s, drawn: ids[0] }, HUE_DECK[ids[0]])) s.drawn = ids[0];
        else s.turn = opp;
        ev = { by, k: 'draw', ids };
      }
    } else if (mv.k === 'keep' || mv.k === 'pass') {
      if (mv.k === 'keep' ? s.drawn == null : (!s.paid || s.drawn != null)) fail('You need to draw or play first.');
      s.drawn = null; s.paid = false; s.turn = opp;
      ev = { by, k: mv.k };
    } else fail('Unknown move.');
  }
  // who emptied their hand first; it wins once no chain is on
  if (s.firstOut && s.hands[s.firstOut].length) s.firstOut = null;
  if (!s.firstOut) s.firstOut = [by, opp].find((seat) => !s.hands[seat].length) || null;
  if (!s.winner && s.firstOut && !s.penalty) { s.winner = s.firstOut; s.turn = null; }
  s.log.push(ev);
  return s;
}
function huState(m, limit = Infinity) {
  if (m.hueVersion !== 2) return huLegacyState(m, limit);
  let s = hueInitial(m);
  if (!s.starter) return s;
  for (const key of sortedKeys(m.plays)) {
    if (s.winner || s.log.length >= limit) break;
    try { s = hueApply(s, m.plays[key], key); } catch (_) { /* Ignore invalid/stale commands in imported logs. */ }
  }
  return s;
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
function hueRuleSteps(m) {
  if (m?.game === 'hu' && m.hueVersion !== 2) return GAMES.hu.howTo;
  const mode = m?.hueVersion === 2 ? m.hueRules : null;
  const rules = mode === 'official' ? 'Official-style: one card at a time, no stacking. Splash +2 and Flood +4 make the other player draw and skip their turn. Manual shuffles are left out. Flood needs a hand with no card in the active colour.'
    : mode === 'custom' ? 'Custom: play matching number cards together. Stack Splash +2 and Flood +4; after paying, the player may play or pass. Each player gets two draw-pile shuffles.'
    : 'Custom allows matching-number pairs, draw stacking, a turn after picking up, Trade and two shuffles each. Official-style uses one card at a time, no stacking, and draw penalties skip the turn.';
  return [
    { t: 'Who goes first', d: 'Rock, paper, scissors, best of three. The winner chooses Custom or Official-style before seven cards are dealt.', art: 'art/rps-rock.png' },
    { t: 'Match the pile', d: 'Match its colour, number or symbol. Tap once to select, then again or tap the pile to play; you can also drag a card onto the pile.', art: 'art/hue-orange.png' },
    { t: 'Choose your rules', d: rules },
    { t: 'Pick a colour', d: 'Blend and Flood let you choose a colour above your visible hand. Trade swaps hands and chooses a colour too.', art: 'art/hue-wild.png' },
    { t: 'Hues!', d: 'Tap Hues! only at exactly one card. Drawing resets it. When the other player’s turn appears, Call out stays locked for two seconds on their screen. After it unlocks they can catch you for two cards, unless you tap Hues! first. You can still declare after the countdown until you are caught.' },
    { t: 'Empty your hand to win', d: 'A last Splash or Flood can only be answered by a stacking card already in hand in Custom. Once the other player picks up the penalty, the game ends immediately. A last Blend ends the game after the colour is chosen.' },
    { t: 'About Official-style', d: 'A first-out adaptation using the painted Hues deck. It does not reproduce UNO’s exact deck, bluff/challenge system or 500-point match scoring.' },
  ];
}
function makeHueRules(box) {
  let m, busy = false;
  const root = h('div', { class: 'hu-rules-wrap' });
  box.append(root);
  async function choose(rules) {
    if (busy || rpsState(m).starter !== G.seat) return;
    busy = true; draw();
    await chooseOnce(m, 'hueRules', rules, 'The rules have already been chosen.', 'Couldn’t choose the rules. Try again.');
    busy = false; if (root.isConnected) draw();
  }
  const rows = [
    ['Cards per play', 'Same-number cards together', 'One card'],
    ['Draw stacking', 'Splash / Flood chains', 'No stacking'],
    ['After a penalty', 'Play or pass', 'Turn skipped'],
    ['Manual shuffle', 'Twice each', 'Not available'],
    ['Flood', 'Wild colour choice', 'Only without the active colour'],
  ];
  function draw() {
    if (!m) return;
    const mine = rpsState(m).starter === G.seat;
    root.replaceChildren(h('div', { class: 'paper hu-rules-card' }, h('div', { class: 'tape sage' }),
      h('span', { class: 'eyebrow' }, 'Before the first card'),
      h('h1', { class: 'display h2' }, 'Choose your Hues'),
      h('p', { class: 'hand-note' }, mine ? 'You won rock, paper, scissors. You pick the rules.' : partnerName() + ' won rock, paper, scissors and is choosing the rules.'),
      h('table', { class: 'hu-rules-table' },
        h('thead', null, h('tr', null, h('th', null, 'Rule'), h('th', null, 'Custom'), h('th', null, 'Official-style'))),
        h('tbody', null, ...rows.map((row) => h('tr', null, ...row.map((text, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null, text)))))),
      h('p', { class: 'muted' }, 'Both keep all 95 painted Hues cards, including Trade, one-card declarations, fair callouts and first-out scoring. Official-style is an adaptation; no bluff/challenge or 500-point matches.'),
      h('div', { class: 'stack' }, ...['custom', 'official'].map((r) => h('button', {
        class: 'btn ' + (r === 'custom' ? 'btn-primary' : 'btn-ink'), disabled: !mine || busy, 'data-rules': r, onclick: () => choose(r),
      }, r === 'custom' ? 'Play Custom' : 'Play Official-style')))));
  }
  return { update(nm) { m = nm; draw(); }, destroy() { root.remove(); } };
}

function makeHU(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, st = null, rendered = -1, animating = false, pending = false, pendingN = -1, endShown = false, dead = false;
  let sel = [], drag = null, cw = 66, chh = 94, choosing = false, colourResolve = null, timerBusy = false;
  let timer = null, localWindow = null;

  const countMe = h('b'), countThem = h('b');
  const chipMe = h('div', { class: 'turn-chip' }, h('span', null, 'You'), countMe);
  const chipThem = h('div', { class: 'turn-chip' }, h('span', null, P), countThem);
  const theirHand = h('div', { class: 'hu-their' });
  const deck = h('button', { class: 'hu-deck', 'aria-label': 'Draw a card' }, hueCard(null), hueCard(null), h('span', { class: 'hu-left' }));
  const pileEl = h('div', { class: 'hu-pile', 'aria-label': 'The pile' });
  const swatch = h('div', { class: 'hu-swatch' }, h('i'), h('span'));
  const penEl = h('div', { class: 'hu-pen', hidden: true });
  const shuffleBtn = h('button', { class: 'hu-shuffle chip', 'aria-label': 'Shuffle draw pile' }, 'Shuffle · 2');
  const tableEl = h('div', { class: 'hu-table' }, deck, pileEl, h('div', { class: 'hu-side' }, swatch, penEl, shuffleBtn));
  const status = h('div', { class: 'hu-status status-line', 'aria-live': 'polite' });
  const huesBtn = h('button', { class: 'btn btn-primary hu-call' }, 'Hues!');
  const calloutBtn = h('button', { class: 'btn btn-ghost hu-call', title: 'Catch a missed Hues declaration before you play or draw' }, 'Call out');
  const actBtn = h('button', { class: 'btn hu-act' });
  const btnRow = h('div', { class: 'hu-btns' }, huesBtn, actBtn, calloutBtn);
  const calloutCountdown = h('output', { class: 'hu-catch-countdown script', hidden: true, 'aria-live': 'off' });
  const colourPicker = h('div', { class: 'hu-colour-picker paper', hidden: true, role: 'group', 'aria-label': 'Choose the next colour' });
  const ruleBadge = h('div', { class: 'hu-rule-badge script' });
  const handEl = h('div', { class: 'hu-hand', role: 'group', 'aria-label': 'Your hand' });
  const endArea = h('div', { class: 'end-area', hidden: true });
  const root = h('div', { class: 'hu' }, h('div', { class: 'turnbar' }, chipMe, chipThem), ruleBadge, theirHand, tableEl, status, calloutCountdown, btnRow, colourPicker, handEl, endArea);
  box.append(root);

  const canAct = () => !!(st && st.turn === seat && !st.winner && !pending && !animating && !choosing);
  const canSayHues = s => hueCanSay(s, seat);
  const canCallOut = s => s?.version === 2 ? hueCanCall(s, seat, Net.now()) : !!(s && s.owes[opp] && s.hands[opp].length === 1 && s.turn !== opp);
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
    ruleBadge.textContent = s.version === 2 ? (s.rules === 'official' ? 'Official-style' : 'Custom') : 'Custom · saved rules';
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
    huesBtn.disabled = pending || !canSayHues(full);
    paintCalloutWindow(full);
    shuffleBtn.hidden = s.version !== 2 || s.rules !== 'custom';
    shuffleBtn.disabled = pending || animating || choosing || !!s.winner || s.shuffles?.[seat] >= HUE_SHUFFLES || s.drawn != null || s.pile.length < 2;
    shuffleBtn.replaceChildren(h('span', null, 'Shuffle pile'), h('small', null, Math.max(0, HUE_SHUFFLES - (s.shuffles?.[seat] || 0)) + ' left'));
    shuffleBtn.title = s.drawn != null ? 'Finish the drawn-card choice first' : 'Reshuffle the remaining draw pile · twice each · either turn';
    if (s.winner) { status.textContent = ''; return; }
    const top = HUE_DECK[s.discard[s.discard.length - 1]];
    status.replaceChildren();
    const say = (...parts) => status.append(...parts.map((p) => (Array.isArray(p) ? h('b', null, p[0]) : p)));
    if (choosing) { say('Pick the next colour. Your hand stays below.'); return; }
    if (s.turn === seat) {
      const stackable = s.hands[seat].some((id) => hueFits(s, HUE_DECK[id]));
      if (s.penalty && s.rules === 'official') say(`Pick up ${s.penalty}. Your turn is skipped.`);
      else if (s.penalty) say(`+${s.penalty} for you. `, stackable ? (top.k === 'p4' ? ['Flood it, or +2 in ' + HUE_NAMES[s.colour]] : ['Stack a +2 or a Flood']) : 'Pick them up', stackable ? ' or pick up' : '');
      else if (sel.length > 1) say('Tap the pile to play ', [`all ${sel.length}`], ' together');
      else if (s.drawn != null) say('It fits! ', ['Play it'], ', or keep it');
      else if (s.paid) say('Play a card, or ', ['pass']);
      else if (s.grace) say(`${P} is out of cards. `, ['Last turn'], ' to stop them');
      else say('Your turn. Play on ', [HUE_NAMES[s.colour]], top.k === 'n' ? ` or a ${top.v}` : '');
    } else if (s.turn === opp) {
      if (s.penalty) say(s.rules === 'official' ? `${P} picks up ${s.penalty} and skips their turn` : `${P} has to stack or pick up ${s.penalty}`);
      else say(Live.partnerHover() != null ? `${P} is choosing a card…` : `Waiting for ${P}…`);
    }
  }

  function paintCalloutWindow(full = st) {
    if (!full) return;
    calloutBtn.disabled = pending || choosing || !canCallOut(full);
    const window = full.callWindow?.by === seat ? full.callWindow : (hueNeedsNotice(full, seat) && localWindow?.one === full.oneKey[opp] ? localWindow : null);
    const remaining = window ? Math.max(0, window.until - Net.now()) : 0;
    calloutCountdown.hidden = !window || remaining <= 0;
    if (window && remaining > 0) calloutCountdown.textContent = 'Call out unlocks in ' + (remaining / 1000).toFixed(1) + 's';
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
    } else if (ev.k === 'shuffle') {
      paint(after);
      Sound.whoosh();
      toast(ev.by === seat ? 'Draw pile shuffled · ' + (HUE_SHUFFLES - after.shuffles[seat]) + ' left' : P + ' shuffled the draw pile');
      await settle(deck.animate([{ rotate: '0deg' }, { rotate: '-9deg' }, { rotate: '8deg' }, { rotate: '0deg' }], { duration: 380 }));
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
    if (m.hueVersion !== 2 && pending && Object.keys(m.plays || {}).length > pendingN) pending = false;
    paint(st);
    if (st.winner) finish();
  }
  // quiet: the game was already over when this screen opened, so no end card
  function finish(quiet) {
    if (endShown) return;
    endShown = true;
    recordResult(m, st.winner);
    endArea.hidden = false;
    endArea.replaceChildren(endBar(m));
    if (quiet) return;
    const n = st.log.reduce((t, e) => t + (e.k === 'play' ? e.ids.length : 0), 0);
    const title = st.winner === seat ? 'Out of cards. You win!' : `${P} played their last card`;
    endSheetSoon(m, () => dead, 900, { title, body: `${n} cards played, ${st.hands[st.winner === seat ? opp : seat].length} left in the losing hand.`, good: st.winner === seat });
  }

  // ---- moves ----
  // Version 2 appends transactionally; declarations rebase safely over ordinary moves.
  // Legacy saved games retain their original seat-suffixed append keys.
  async function send(mv) {
    if (pending || dead) return;
    pendingN = Object.keys(m.plays || {}).length; pending = true; paintChrome();
    const id = m.id, path = matchPath(id), expected = pendingN, command = { by: seat, ...mv, at: Net.now() };
    if (!['hues', 'notice', 'callout'].includes(mv.k)) Live.set({ hover: null });
    try {
      if (m.hueVersion !== 2) {
        await Net.doc(path).update({ plays: { [hueKeyV1(pendingN, seat)]: command } });
      } else await Net.timed(FB.fs.runTransaction(async (tx) => {
        const ref = FB.fs.doc(path), snap = await tx.get(ref), latest = snap.data();
        if (!snap.exists) throw Error('This game is no longer available.');
        const count = Object.keys(latest.plays || {}).length;
        if (!['hues', 'notice', 'callout', 'shuffle'].includes(mv.k) && count !== expected) throw Error('The table changed. Please tap again.');
        if (G.table?.[seat]?.dev !== G.dev) throw Error('Your seat changed. Rejoin the table.');
        const key = hueKeyV2(count);
        hueApply(huState(latest), command, key);
        tx.update(ref, { ['plays.' + key]: { ...command, at: ['hues', 'notice'].includes(mv.k) ? command.at : firebase.firestore.FieldValue.serverTimestamp() } });
      }));
    } catch (e) { if (mv.k !== 'notice' && !dead) toast(writeError(e, 'Couldn’t save that move. Try again.')); }
    finally { if (!dead && m?.id === id) { pending = false; paintChrome(); } }
  }
  function tick() {
    if (dead || !st) return;
    if (st.version === 2) {
      paintCalloutWindow();
      // Start the lockout only after this phone has rendered its own new turn.
      // No countdown or automatic penalty is sent to the one-card player.
      if (hueNeedsNotice(st, seat) && Net.online && !animating && !pending && !timerBusy && document.visibilityState !== 'hidden') {
        timerBusy = true;
        localWindow = { one: st.oneKey[opp], until: Net.now() + HUE_CALLOUT_MS };
        paintChrome();
        send({ k: 'notice', one: st.oneKey[opp] }).finally(() => { timerBusy = false; });
      }
    }
  }
  // The colour pots open above the hand; resolves with the colour, or null for "Not this card".
  // A pot only counts if the press started on it (or it was a keyboard click), so the tap that
  // played the card can't land on a pot as well.
  function chooseColour(title) {
    choosing = true; drag = null; colourPicker.hidden = false; root.classList.add('choosing-colour');
    paintChrome();
    return new Promise((resolve) => {
      colourResolve = resolve;
      const finish = (col) => {
        if (!colourResolve) return;
        const done = colourResolve;
        colourResolve = null; choosing = false; colourPicker.hidden = true; root.classList.remove('choosing-colour');
        done(col);
      };
      colourPicker.replaceChildren(
        h('div', { class: 'script' }, title),
        h('div', { class: 'hue-pots' }, ...HUE_NAMES.map((name, i) => h('button', {
          class: 'hue-pot ' + HUE_COLOURS[i], 'aria-label': name,
          onpointerdown: (e) => { e.currentTarget.dataset.armed = '1'; },
          onclick: (e) => { if (e.detail === 0 || e.currentTarget.dataset.armed === '1') finish(i); },
        }, h('i'), h('span', null, name)))),
        h('button', { class: 'hu-colour-cancel', onclick: () => finish(null) }, 'Not this card'));
    });
  }
  async function play(ids) {
    if (!canAct()) { if (st && st.turn === opp) shake(status); return; }
    if (!hueFitsAll(st, ids)) {
      for (const id of ids) { const el = handEl.querySelector(`[data-id="${id}"]`); el && shake(el); }
      const top = HUE_DECK[st.discard[st.discard.length - 1]];
      toast(st.rules === 'official' && st.penalty ? 'Official-style: pick up the penalty; stacking is off'
        : st.rules === 'official' && ids.length > 1 ? 'Official-style plays one card at a time'
        : st.rules === 'official' && HUE_DECK[ids[0]]?.k === 'p4' ? `Flood needs a hand with no ${HUE_NAMES[st.colour]} cards in Official-style`
        : ids.length > 1 && hueFits(st, HUE_DECK[ids[0]]) ? 'Only cards with the same number go down together'
        : st.penalty ? (top.k === 'p4' ? `Only a Flood, or a +2 in ${HUE_NAMES[st.colour]}, can stop this` : 'Only a +2 or a Flood can go on a Splash')
        : st.drawn != null ? 'You drew: only that card can go now' : `That doesn’t match ${HUE_NAMES[st.colour]} or the top card`);
      return;
    }
    const last = HUE_DECK[ids[ids.length - 1]];
    let col;
    if (HUE_KIND[last.k].wild) {
      col = await chooseColour(last.k === 'trade' ? 'Swap hands, then pick the colour' : 'Pick the next colour');
      if (dead) return;
      if (col == null || !canAct()) { sel = []; paintHand(st); paintChrome(); Live.set({ hover: null }); return; }
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
    if (st.paid) { toast('Play a card, or pass after picking up the penalty'); return; }
    Sound.tap();
    send({ k: 'draw' });
  });
  pileEl.addEventListener('click', () => { if (sel.length) play(sel.slice()); });
  huesBtn.addEventListener('click', () => {
    if (pending) return;
    if (!canSayHues(st)) { toast(st && st.said[seat] ? 'You’ve called it' : 'Call Hues when you’re down to one card'); return; }
    send({ k: 'hues' });
  });
  shuffleBtn.addEventListener('click', () => {
    if (!shuffleBtn.disabled && st.version === 2 && st.rules === 'custom' && st.shuffles[seat] < HUE_SHUFFLES) send({ k: 'shuffle' });
  });
  calloutBtn.addEventListener('click', () => {
    if (pending) return;
    if (!canCallOut(st)) { toast(`Nothing to call out. ${P} has to be on one card without calling Hues`); return; }
    send({ k: 'callout', ...(st.version === 2 ? {one:st.oneKey[opp]} : {}) });
  });

  // tap a card to lift it (tap another with the same number to add it), tap it again or the pile to play;
  // or drag it up onto the pile
  handEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.hcard');
    if (!el || !st || choosing || pending) return;
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
    if (st.rules !== 'official' && first && first.k === 'n' && c.k === 'n' && c.v === first.v) sel.push(d.id); // same number: goes down with it
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
        if (!timer) timer = setInterval(tick, 100);
        st = huState(m);
        rendered = st.log.length;
        requestAnimationFrame(() => { if (!dead) paint(huState(m, rendered)); });
        paint(st);
        if (st.winner) finish(true);
      }
      st = huState(m);
      if (m.hueVersion !== 2 && pending && Object.keys(m.plays || {}).length > pendingN) pending = false;
      queue();
    },
    onPeers() { if (st && !animating) paintChrome(); },
    isOver() { return !!(st && st.winner); },
    destroy() { dead = true; clearInterval(timer); if (colourResolve) { const done = colourResolve; colourResolve = null; done(null); } Live.set({ hover: null }); },
  };
}
