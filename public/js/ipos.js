'use strict';
// ================= IPOs =================
// Our own game of hype and timing (design: docs/ipos-design.md). Four quarters, each:
//   newsflow (3 news cards each) → roadshow (sealed bids on 4 listings) → trading (take turns) → earnings.
// Both phones shuffle the same company and news decks from the match's seed, then replay:
//   bids  {q1: {host: [b,b,b,b], guest: […]}, …}   one sealed array per player per quarter
//   plays {p0000h: {by, k:'news', id, s?, s2?, c?} · {by, k:'cash', c} · {by, k:'pass'}, …}   (the player to move)
const IPO_START_CASH = 15;
const IPO_QUARTERS = 4;
const IPO_LISTINGS = 4;
const IPO_DRAW = 3;
const IPO_HAND = 5;   // more than this and the oldest news expires
const IPO_TOP = 12;
// start price, bubble line (null: never pops), dividend, price cap
const IPO_SECTORS = [
  { key: 'brown', name: 'Scrappy ventures', short: 'Scrappy', col: 'Brown', start: 1, line: 5, div: 0, cos: ['WeWobble', 'Groupoff'] },
  { key: 'lblue', name: 'On-demand', short: 'On-demand', col: 'Light blue', start: 2, line: 7, div: 1, cos: ['Ooober', 'DoorDawdle', 'AirBeanB'] },
  { key: 'pink', name: 'Fintech', short: 'Fintech', col: 'Pink', start: 3, line: 8, div: 1, cos: ['PayFoe', 'Stryype', 'Blockish'] },
  { key: 'orange', name: 'Entertainment', short: 'Entertain.', col: 'Orange', start: 3, line: 8, div: 1, cos: ['Netflicks', 'Spotifry', 'YouToob'] },
  { key: 'red', name: 'Social media', short: 'Social', col: 'Red', start: 4, line: 9, div: 1, cos: ['Metah', 'TikTak', 'SnapChatter'] },
  { key: 'yellow', name: 'Devices and chips', short: 'Chips', col: 'Yellow', start: 4, line: 10, div: 1, cos: ['Appull', 'Samsong', 'Nvidiot'] },
  { key: 'green', name: 'Platform giants', short: 'Platforms', col: 'Green', start: 5, line: 10, div: 2, cos: ['Joogle', 'Zamazon', 'Macrosoft'] },
  { key: 'dblue', name: 'AI labs', short: 'AI labs', col: 'Dark blue', start: 5, line: 12, div: 0, cos: ['Twothropic', 'BatGPT'] },
  { key: 'black', name: 'Logistics', short: 'Logistics', col: 'Black', start: 3, line: 7, div: 2, cos: ['FedUps', 'OopsPS', 'DHeLivery', 'Maersk My Words'] },
  { key: 'grey', name: 'Utilities', short: 'Utilities', col: 'Grey', start: 2, line: null, div: 2, cap: 6, cos: ['Shwell Energy', 'BeePee Power'] },
];
const IPO_COS = IPO_SECTORS.flatMap((sec, s) => sec.cos.map((name) => ({ name, s }))).map((c, id) => ({ ...c, id }));
// t: what it needs. 'sector' one sector · 'two' two different sectors · 'theirs' one of your partner's companies · 'none'
const IPO_NEWS_KIND = {
  hype: { name: 'Hype Train', n: 6, t: 'sector', text: 'Raise one sector by 2.', note: 'Everyone is talking about it. Nobody has used it.' },
  viral: { name: 'Viral Moment', n: 4, t: 'two', text: 'Raise two different sectors by 1 each.', note: 'A dance, somehow.' },
  scandal: { name: 'Scandal', n: 5, t: 'sector', text: 'Lower one sector by 2.', note: 'Leaked group chat.' },
  reg: { name: 'Regulator Calling', n: 3, t: 'sector', text: 'Lower one sector by 3.', note: 'Please hold.' },
  short: { name: 'Short Seller', n: 2, t: 'sector', text: 'Pick a sector. At earnings, gain 2M per step it is below today’s price; pay 1M per step above.', note: 'Thoughts and prayers.' },
  acq: { name: 'Acqui-hire', n: 2, t: 'theirs', text: 'Buy one of your partner’s companies at its price + 2M. They must sell.', note: 'We’re excited to welcome the team.' },
  lockup: { name: 'Lockup Expiry', n: 2, t: 'none', text: 'Lower by 1 every sector where your partner holds more companies than you.', note: 'Early staff, heading for the exit.' },
};
const IPO_NEWS = Object.entries(IPO_NEWS_KIND).flatMap(([k, v]) => Array.from({ length: v.n }, () => k)).map((k, id) => ({ k, id }));

const ipoCap = (s) => IPO_SECTORS[s].cap || IPO_TOP;
const ipoFrothy = (st, s) => IPO_SECTORS[s].line != null && st.price[s] > IPO_SECTORS[s].line;
const ipoLead = (st, q = st.q) => (q % 2 ? st.starter : other(st.starter));
const ipoWorth = (st, seat) => st.cash[seat] + st.own[seat].reduce((t, c) => t + st.price[IPO_COS[c].s], 0);
const ipoCount = (st, seat, s) => st.own[seat].filter((c) => IPO_COS[c].s === s).length;
// the sectors Lockup Expiry would lower if `seat` played it now
const ipoLockup = (st, seat) => IPO_SECTORS.map((_, s) => s).filter((s) => ipoCount(st, other(seat), s) > ipoCount(st, seat, s));
// sealed bids as the replay reads them: anything that breaks the rules counts as no bids at all
function ipoCleanBids(st, seat, raw) {
  if (!Array.isArray(raw) || raw.length !== st.listings.length) return st.listings.map(() => 0);
  const b = raw.map((x, i) => (Number.isInteger(x) && x >= st.price[IPO_COS[st.listings[i]].s] ? x : 0));
  return b.reduce((t, x) => t + x, 0) > st.cash[seat] ? b.map(() => 0) : b;
}
// Can this news card be played like this right now? (the same check the replay uses)
function ipoNewsOk(st, by, mv) {
  const card = IPO_NEWS[mv.id];
  if (!card || !st.hands[by].includes(mv.id)) return false;
  const t = IPO_NEWS_KIND[card.k].t, okS = (s) => Number.isInteger(s) && s >= 0 && s < IPO_SECTORS.length;
  if (t === 'sector') return okS(mv.s);
  if (t === 'two') return okS(mv.s) && okS(mv.s2) && mv.s !== mv.s2;
  if (t === 'theirs') return st.own[other(by)].includes(mv.c) && st.cash[by] >= st.price[IPO_COS[mv.c].s] + 2;
  return true;
}

// Replays the log (the first `limit` events). Nothing here is ever stored.
//   phase  'bid' (roadshow: waiting for sealed bids) · 'trade' · 'over'
//   log    events for the screens: deal, bids, news, cash, pass, earn
function ipoState(m, limit = Infinity) {
  const starter = rpsState(m).starter;
  const rnd = hueRng('ipo' + (m.seed || m.id));
  const st = {
    starter, q: 0, phase: 'bid', turn: null, passes: 0,
    price: IPO_SECTORS.map((s) => s.start), cash: { host: IPO_START_CASH, guest: IPO_START_CASH },
    own: { host: [], guest: [] }, hands: { host: [], guest: [] }, shorts: [],
    coDeck: hueShuffle(IPO_COS.map((c) => c.id), rnd), newsDeck: hueShuffle(IPO_NEWS.map((c) => c.id), rnd),
    listings: [], bidsIn: { host: false, guest: false }, winner: null, score: null, log: [],
  };
  if (!starter) return st;
  const move = (s, d) => { const was = st.price[s]; st.price[s] = Math.max(1, Math.min(ipoCap(s), was + d)); return [s, was, st.price[s]]; };
  const push = (ev) => { st.log.push(ev); return st.log.length >= limit; };

  function newQuarter() {
    st.q++;
    st.phase = 'bid'; st.turn = null; st.passes = 0;
    const lead = ipoLead(st), drew = { host: [], guest: [] }, expired = { host: [], guest: [] };
    for (const seat of [lead, other(lead)]) {
      for (let i = 0; i < IPO_DRAW && st.newsDeck.length; i++) drew[seat].push(st.newsDeck.pop());
      st.hands[seat].push(...drew[seat]);
      while (st.hands[seat].length > IPO_HAND) expired[seat].push(st.hands[seat].shift());
    }
    st.listings = st.coDeck.splice(-IPO_LISTINGS).reverse();
    st.bidsIn = { host: false, guest: false };
    return push({ k: 'deal', q: st.q, drew, expired, listings: st.listings.slice() });
  }
  function roadshow(raw) {
    const before = { ...st.cash };
    const bids = { host: ipoCleanBids(st, 'host', raw.host), guest: ipoCleanBids(st, 'guest', raw.guest) };
    const res = st.listings.map((c, i) => {
      const hb = bids.host[i], gb = bids.guest[i];
      let w = hb > gb ? 'host' : gb > hb ? 'guest' : null;
      if (!w && hb > 0) w = before.host < before.guest ? 'host' : before.guest < before.host ? 'guest' : null; // tie: less money wins
      if (w) { st.cash[w] -= bids[w][i]; st.own[w].push(c); move(IPO_COS[c].s, 1); }
      return { c, host: hb, guest: gb, w };
    });
    st.listings = [];
    st.phase = 'trade'; st.turn = ipoLead(st); st.passes = 0;
    return push({ k: 'bids', q: st.q, res });
  }
  function earnings() {
    const shorts = st.shorts.map((x) => {
      const d = x.at - st.price[x.s];
      const amt = d > 0 ? 2 * d : -Math.min(st.cash[x.by], -d);
      st.cash[x.by] += amt;
      return { ...x, now: st.price[x.s], amt };
    });
    st.shorts = [];
    const pops = [];
    IPO_SECTORS.forEach((sec, s) => {
      if (!ipoFrothy(st, s)) return;
      const lost = { host: st.own.host.filter((c) => IPO_COS[c].s === s), guest: st.own.guest.filter((c) => IPO_COS[c].s === s) };
      for (const seat of ['host', 'guest']) st.own[seat] = st.own[seat].filter((c) => IPO_COS[c].s !== s);
      pops.push({ s, was: st.price[s], lost });
      st.price[s] = sec.start;
    });
    const divs = {};
    for (const seat of ['host', 'guest']) {
      divs[seat] = st.own[seat].reduce((t, c) => t + IPO_SECTORS[IPO_COS[c].s].div, 0);
      st.cash[seat] += divs[seat];
    }
    const ev = { k: 'earn', q: st.q, shorts, pops, divs };
    if (st.q >= IPO_QUARTERS) {
      st.phase = 'over'; st.turn = null;
      st.score = { host: ipoWorth(st, 'host'), guest: ipoWorth(st, 'guest') };
      // tie: more companies, then more cash, then whoever went second
      const key = (seat) => [st.score[seat], st.own[seat].length, st.cash[seat], seat === st.starter ? 0 : 1];
      const a = key('host'), b = key('guest');
      const i = a.findIndex((x, j) => x !== b[j]);
      st.winner = a[i] > b[i] ? 'host' : 'guest';
      ev.score = st.score; ev.winner = st.winner;
      return push(ev);
    }
    return push(ev) || newQuarter();
  }

  if (newQuarter()) return st;
  const bids = m.bids || {}, plays = sortedKeys(m.plays);
  let pi = 0;
  while (st.phase !== 'over') {
    if (st.phase === 'bid') {
      const b = bids['q' + st.q] || {};
      st.bidsIn = { host: !!b.host, guest: !!b.guest };
      if (!b.host || !b.guest) break;
      if (roadshow(b)) return st;
      continue;
    }
    // trading
    if (pi >= plays.length) break;
    const mv = m.plays[plays[pi++]];
    const by = mv && mv.by;
    if (by !== st.turn) continue;
    const opp = other(by);
    let ev;
    if (mv.k === 'pass') {
      st.passes++;
      ev = { k: 'pass', by };
    } else if (mv.k === 'cash') {
      if (!st.own[by].includes(mv.c)) continue;
      const s = IPO_COS[mv.c].s, got = st.price[s];
      st.own[by].splice(st.own[by].indexOf(mv.c), 1);
      st.cash[by] += got;
      ev = { k: 'cash', by, c: mv.c, got, moves: [move(s, -1)] };
    } else if (mv.k === 'news') {
      if (!ipoNewsOk(st, by, mv)) continue;
      const kind = IPO_NEWS[mv.id].k;
      st.hands[by].splice(st.hands[by].indexOf(mv.id), 1);
      ev = { k: 'news', by, id: mv.id, kind, moves: [] };
      if (kind === 'hype') ev.moves.push(move(mv.s, 2));
      else if (kind === 'viral') ev.moves.push(move(mv.s, 1), move(mv.s2, 1));
      else if (kind === 'scandal') ev.moves.push(move(mv.s, -2));
      else if (kind === 'reg') ev.moves.push(move(mv.s, -3));
      else if (kind === 'short') { st.shorts.push({ by, s: mv.s, at: st.price[mv.s] }); ev.s = mv.s; ev.at = st.price[mv.s]; }
      else if (kind === 'lockup') ev.moves.push(...ipoLockup(st, by).map((s) => move(s, -1)));
      else if (kind === 'acq') {
        const cost = st.price[IPO_COS[mv.c].s] + 2;
        st.own[opp].splice(st.own[opp].indexOf(mv.c), 1);
        st.own[by].push(mv.c);
        st.cash[by] -= cost; st.cash[opp] += cost;
        ev.c = mv.c; ev.cost = cost;
      }
    } else continue;
    if (mv.k !== 'pass') st.passes = 0;
    st.turn = opp;
    if (push(ev)) return st;
    if (st.passes >= 2 && earnings()) return st;
  }
  return st;
}

// ---------------- the screen ----------------
const ipoM = (n) => n + 'M';
const ipoMove = ([s, a, b]) => `${IPO_SECTORS[s].name} ${a}→${b}`;
// a company as a small paper card with its sector's painted band
function ipoCoCard(c, ...extra) {
  const co = IPO_COS[c], sec = IPO_SECTORS[co.s];
  return h('div', { class: `ip-co s-${sec.key}`, 'data-c': c },
    h('i', { class: 'band' }),
    h('b', { class: 'nm' }, co.name),
    h('span', { class: 'sec' }, `${sec.name} · ${sec.col}`),
    ...extra);
}
function ipoNewsCard(id, tag = 'div') {
  const kind = IPO_NEWS_KIND[IPO_NEWS[id].k];
  return h(tag, { class: `ip-news k-${IPO_NEWS[id].k}`, 'data-id': id },
    h('b', { class: 'nm' }, kind.name),
    h('span', { class: 'tx' }, kind.text));
}

function makeIP(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName(), Pshort = P.split(' ')[0];
  let m = null, st = null, rendered = -1, animating = false, pending = false, pendingN = -1, endShown = false, dead = false;
  let sel = null, first = null, bid = [], bidQ = 0;

  const cashMe = h('b'), cashThem = h('b');
  const chipMe = h('div', { class: 'turn-chip' }, h('span', null, 'You'), cashMe);
  const chipThem = h('div', { class: 'turn-chip' }, h('span', null, P), cashThem);
  const qLine = h('div', { class: 'ip-q' });
  const rows = IPO_SECTORS.map((sec, s) => h('button', { class: `ip-row s-${sec.key}`, 'data-s': s, 'aria-label': sec.name },
    h('i', { class: 'band' }),
    h('span', { class: 'nm' }, sec.short),
    h('span', { class: 'track' }, ...Array.from({ length: IPO_TOP }, (_, k) => h('i', {
      class: 'cell' + (k + 1 > ipoCap(s) ? ' void' : '') + (sec.line != null && k + 1 > sec.line ? ' over' : '') + (sec.line === k + 1 ? ' line' : ''),
    }))),
    h('b', { class: 'px' }),
    h('span', { class: 'n me' }),
    h('span', { class: 'n them' })));
  const board = h('div', { class: 'ip-board paper' },
    h('div', { class: 'tape', style: 'top:-11px;left:44%;width:70px;transform:rotate(-3deg)' }),
    h('div', { class: 'ip-head' }, h('span', null, 'The market'), h('span', { class: 'px' }, 'Price'), h('span', { class: 'n' }, 'You'), h('span', { class: 'n them' }, Pshort)),
    ...rows);
  const status = h('div', { class: 'ip-status status-line', 'aria-live': 'polite' });
  const panel = h('div', { class: 'ip-panel' });
  const endArea = h('div', { class: 'end-area', hidden: true });
  const root = h('div', { class: 'ip' }, h('div', { class: 'turnbar' }, chipMe, chipThem), qLine, board, status, panel, endArea);
  box.append(root);

  const canTrade = () => !!(st && st.phase === 'trade' && st.turn === seat && !pending && !animating);
  const canBid = () => !!(st && st.phase === 'bid' && !st.bidsIn[seat] && !pending && !animating);
  const shake = (el) => el.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 260 });
  const kindOf = (id) => IPO_NEWS_KIND[IPO_NEWS[id].k];

  // ---- painting ----
  function paint(s) {
    cashMe.textContent = ipoM(s.cash[seat]); cashThem.textContent = ipoM(s.cash[opp]);
    chipMe.classList.toggle('active', s.phase === 'trade' ? s.turn === seat : s.phase === 'bid' && !s.bidsIn[seat]);
    chipThem.classList.toggle('active', s.phase === 'trade' ? s.turn === opp : s.phase === 'bid' && !s.bidsIn[opp]);
    qLine.textContent = s.phase === 'over' ? 'Market closed' : `Quarter ${s.q} of ${IPO_QUARTERS} · ${s.phase === 'bid' ? 'roadshow' : 'trading'}`;
    rows.forEach((row, i) => {
      const p = s.price[i];
      row.querySelectorAll('.cell').forEach((c, k) => c.classList.toggle('on', k < p));
      row.querySelector('.px').textContent = p;
      row.querySelector('.n.me').textContent = ipoCount(s, seat, i) || '';
      row.querySelector('.n.them').textContent = ipoCount(s, opp, i) || '';
      row.classList.toggle('frothy', ipoFrothy(s, i));
      row.classList.toggle('shorted', s.shorts.some((x) => x.s === i && x.by === seat));
      row.classList.toggle('pick', first === i);
      row.setAttribute('aria-label', `${IPO_SECTORS[i].name}, price ${p}${ipoFrothy(s, i) ? ', above its bubble line' : ''}`);
    });
    paintPanel(s);
    paintChrome(s);
  }
  function paintPanel(s) {
    panel.dataset.phase = s.phase;
    if (s.phase === 'bid') {
      if (bidQ !== s.q) { bidQ = s.q; bid = s.listings.map(() => 0); }
      const sent = s.bidsIn[seat];
      const mine = sent && m.bids && m.bids['q' + s.q] ? m.bids['q' + s.q][seat] || [] : bid;
      const total = mine.reduce((t, x) => t + x, 0);
      const cards = s.listings.map((c, i) => {
        const min = s.price[IPO_COS[c].s], sec = IPO_SECTORS[IPO_COS[c].s];
        const out = h('output', null, mine[i] ? ipoM(mine[i]) : 'Pass');
        const step = sent ? h('div', { class: 'ip-step sent' }, out) : h('div', { class: 'ip-step' },
          h('button', { class: 'minus', 'aria-label': 'Bid less', onclick: () => nudge(i, -1) }, '−'), out,
          h('button', { class: 'plus', 'aria-label': 'Bid more', onclick: () => nudge(i, 1) }, '+'));
        return ipoCoCard(c, h('span', { class: 'meta' }, `from ${ipoM(min)} · pays ${ipoM(sec.div)}`), step);
      });
      panel.replaceChildren(
        h('div', { class: 'ip-listings' }, ...cards),
        h('div', { class: 'ip-total hand-note' }, sent ? `Sealed: ${ipoM(total)} bid` : `Bidding ${ipoM(total)} of ${ipoM(s.cash[seat])}`),
        sent ? h('div', { class: 'chair' }, h('span', { class: 'pulse-dots' }, h('i'), h('i'), h('i')), s.bidsIn[opp] ? 'Opening the envelopes' : `Waiting for ${Pshort}’s bids`)
          : h('button', { class: 'btn btn-primary ip-seal', disabled: pending || null, onclick: seal }, total ? 'Seal my bids' : 'Pass on all four'));
    } else if (s.phase === 'trade') {
      const hand = s.hands[seat];
      if (sel != null && !hand.includes(sel)) { sel = null; first = null; }
      const cards = hand.map((id) => {
        const b = ipoNewsCard(id, 'button');
        if (id === sel) b.classList.add('sel');
        b.addEventListener('click', () => pickCard(id));
        return b;
      });
      const playIt = sel != null && kindOf(sel).t === 'none';
      panel.replaceChildren(
        h('div', { class: 'ip-hand', role: 'group', 'aria-label': 'Your news cards' }, ...(cards.length ? cards : [h('p', { class: 'hand-note' }, 'No news cards. Cash out or pass.')])),
        h('div', { class: 'btn-row ip-btns' },
          playIt ? h('button', { class: 'btn btn-primary', onclick: () => sendNews({ id: sel }) }, `Play ${kindOf(sel).name}`) : null,
          h('button', { class: 'btn btn-ink ip-pass', onclick: pass }, sel != null ? 'Put it back' : 'Pass')));
    } else panel.replaceChildren();
  }
  function paintChrome(s = st) {
    if (!s || !s.starter) return;
    root.dataset.ready = canTrade() || canBid() ? '1' : '';
    panel.querySelectorAll('button').forEach((b) => { if (!b.closest('.ip-step')) b.disabled = !(canTrade() || canBid()); });
    status.replaceChildren();
    const say = (...parts) => status.append(...parts.map((p) => (Array.isArray(p) ? h('b', null, p[0]) : p)));
    if (s.phase === 'over') return;
    if (s.phase === 'bid') {
      if (!s.bidsIn[seat]) say('Bid on what you want. Bids are ', ['sealed']);
      else say(s.bidsIn[opp] ? 'Opening the envelopes…' : `Waiting for ${Pshort} to seal their bids…`);
    } else if (s.turn === seat) {
      if (sel != null) {
        const k = kindOf(sel);
        if (k.t === 'sector') say('Tap a sector for ', [k.name]);
        else if (k.t === 'two') say(first == null ? 'Tap the first sector to raise' : 'Now a second sector');
        else if (k.t === 'theirs') say('Tap a sector where ', [Pshort], ' holds a company');
        else { const l = ipoLockup(s, seat); say(l.length ? `Drops ${l.map((x) => IPO_SECTORS[x].short).join(', ')}` : 'Nothing would drop right now'); }
      } else say('Your move: ', ['play news'], ', tap a sector to ', ['cash out'], ', or pass');
    } else say(`${Pshort} is trading…`);
  }

  // ---- what happened, as words ----
  function describe(ev) {
    const who = ev.by === seat ? 'You' : Pshort;
    if (ev.k === 'pass') return `${who} passed`;
    if (ev.k === 'cash') return `${who} cashed out ${IPO_COS[ev.c].name} for ${ipoM(ev.got)}`;
    if (ev.k === 'news') {
      const k = IPO_NEWS_KIND[ev.kind];
      if (ev.kind === 'short') return `${who}: ${k.name} on ${IPO_SECTORS[ev.s].name} at ${ev.at}`;
      if (ev.kind === 'acq') return `${who}: ${k.name}, ${IPO_COS[ev.c].name} for ${ipoM(ev.cost)}`;
      return `${who}: ${k.name}${ev.moves.length ? '. ' + ev.moves.map(ipoMove).join(', ') : ', nothing moved'}`;
    }
    return '';
  }
  function flash(moves) {
    return Promise.all(moves.map(([s, a, b]) => settle(rows[s].animate(
      [{ backgroundColor: b > a ? 'rgba(226,168,60,.55)' : b < a ? 'rgba(196,72,47,.35)' : 'transparent' }, { backgroundColor: 'transparent' }], { duration: 900 }))));
  }
  function bidsSheet(ev) {
    const lines = ev.res.map((r) => h('li', { class: 'ip-res' },
      ipoCoCard(r.c),
      h('span', { class: 'bids' }, `You ${r[seat] ? ipoM(r[seat]) : '–'} · ${Pshort} ${r[opp] ? ipoM(r[opp]) : '–'}`),
      h('b', { class: 'who ' + (r.w === seat ? 'mine' : r.w ? 'theirs' : '') }, r.w ? (r.w === seat ? 'Yours' : `${Pshort}’s`) : 'Pulled')));
    const won = ev.res.filter((r) => r.w === seat).length;
    openSheet({ title: `Quarter ${ev.q} roadshow`, sub: won ? `You won ${won} listing${won === 1 ? '' : 's'}` : 'You won nothing this time', body: h('ul', { class: 'ip-results' }, ...lines), actions: [{ label: 'On to trading', kind: 'primary' }] });
  }
  function earnBody(ev) {
    const out = [];
    for (const x of ev.shorts) out.push(h('li', null, `${x.by === seat ? 'Your' : `${Pshort}’s`} short on ${IPO_SECTORS[x.s].name} (${x.at}→${x.now}): ${x.amt >= 0 ? '+' : '−'}${ipoM(Math.abs(x.amt))}`));
    for (const p of ev.pops) {
      const lost = (s) => p.lost[s].map((c) => IPO_COS[c].name).join(', ');
      out.push(h('li', { class: 'pop' }, h('b', null, `${IPO_SECTORS[p.s].name} popped at ${p.was}! `),
        [lost(seat) && `You lost ${lost(seat)}.`, lost(opp) && `${Pshort} lost ${lost(opp)}.`].filter(Boolean).join(' ') || 'Nobody held it.'));
    }
    out.push(h('li', null, `Dividends: you +${ipoM(ev.divs[seat])}, ${Pshort} +${ipoM(ev.divs[opp])}`));
    return h('ul', { class: 'ip-earn' }, ...out);
  }

  // ---- animation queue: one logged event at a time ----
  async function animate(ev, after) {
    paint(after);
    if (ev.k === 'deal') {
      if (ev.q > 1) toast(`Quarter ${ev.q}: three news cards each`);
      if (ev.expired[seat].length) toast(`Old news: ${ev.expired[seat].map((id) => kindOf(id).name).join(', ')} expired`, 3000);
      await sleep(200);
    } else if (ev.k === 'bids') {
      Sound.whoosh();
      bidsSheet(ev);
      await sleep(300);
    } else if (ev.k === 'earn') {
      if (ev.pops.length) { Sound.boom(); vibrate([20, 60, 20]); } else Sound.ding();
      await Promise.all(ev.pops.map((p) => settle(rows[p.s].animate([{ scale: 1 }, { scale: 1.06, backgroundColor: 'rgba(196,72,47,.45)' }, { scale: 1 }], { duration: 700 }))));
      if (!ev.score) openSheet({ title: `Quarter ${ev.q} earnings`, body: earnBody(ev), actions: [{ label: 'Next quarter', kind: 'primary' }] });
    } else {
      if (ev.k === 'news') Sound.clack(); else if (ev.k === 'cash') Sound.pop(); else Sound.tap();
      if (ev.by === opp) toast(describe(ev), 3000);
      const chip = ev.by === seat ? chipMe : chipThem;
      await Promise.all([flash(ev.moves || []), settle(chip.animate([{ scale: 1 }, { scale: 1.05, offset: 0.4 }, { scale: 1 }], { duration: 360 }))]);
    }
  }
  async function queue() {
    if (animating || dead) return;
    let full = ipoState(m);
    if (full.log.length < rendered) { rendered = full.log.length; paint(full); }
    while (!dead && rendered < (full = ipoState(m)).log.length) {
      animating = true;
      paintChrome(st);
      const ev = full.log[rendered];
      rendered++;
      await animate(ev, ipoState(m, rendered));
    }
    animating = false;
    if (dead) return;
    st = ipoState(m);
    syncPending();
    paint(st);
    if (st.winner) finish();
  }
  function finish(quiet) {
    if (endShown) return;
    endShown = true;
    recordResult(m, st.winner);
    endArea.hidden = false;
    endArea.replaceChildren(endBar(m));
    if (quiet) return;
    const last = st.log[st.log.length - 1];
    const line = (s) => `${s === seat ? 'You' : Pshort}: ${ipoM(st.score[s])} (${ipoM(st.cash[s])} cash + ${st.own[s].length} compan${st.own[s].length === 1 ? 'y' : 'ies'})`;
    const body = h('div', null, earnBody(last), h('p', { class: 'ip-final' }, line(seat), h('br'), line(opp)));
    setTimeout(() => { if (!dead && G.matchId === m.id) endSheet(m, { title: st.winner === seat ? 'Richest at the bell. You win!' : `${Pshort} closes richer`, body, good: st.winner === seat }); }, 700);
  }

  // ---- moves ----
  function syncPending() {
    if (!pending) return;
    if (pendingN < 0 ? st.bidsIn[seat] : Object.keys(m.plays || {}).length > pendingN) pending = false;
  }
  function send(mv) {
    pendingN = Object.keys(m.plays || {}).length;
    pending = true;
    sel = null; first = null;
    paintChrome();
    write(`tables/${G.code}/matches/${m.id}`, { plays: { ['p' + String(pendingN).padStart(4, '0') + seat[0]]: { by: seat, ...mv } } })
      .then((ok) => { if (!ok) { pending = false; paintChrome(); } });
  }
  function sendNews(mv) {
    if (!canTrade()) return;
    if (!ipoNewsOk(st, seat, mv)) { toast('That card can’t go there'); return; }
    send({ k: 'news', ...mv });
  }
  function seal() {
    if (!canBid()) return;
    Sound.pick();
    pending = true; pendingN = -1;
    paintChrome();
    write(`tables/${G.code}/matches/${m.id}`, { bids: { ['q' + st.q]: { [seat]: bid.slice() } } })
      .then((ok) => { if (!ok) { pending = false; paintChrome(); } });
  }
  function nudge(i, d) {
    if (!canBid()) return;
    const min = st.price[IPO_COS[st.listings[i]].s];
    const others = bid.reduce((t, x, j) => t + (j === i ? 0 : x), 0);
    let v = bid[i];
    v = d > 0 ? (v ? v + 1 : min) : (v > min ? v - 1 : 0);
    if (others + v > st.cash[seat]) { toast(`You only have ${ipoM(st.cash[seat])}`); shake(panel.querySelectorAll('.ip-co')[i]); return; }
    Sound.tap();
    bid[i] = v;
    paintPanel(st); paintChrome();
  }
  function pass() {
    if (!canTrade()) return;
    Sound.tap();
    if (sel != null) { sel = null; first = null; paint(st); return; }
    send({ k: 'pass' });
  }
  function pickCard(id) {
    if (!canTrade()) { shake(status); return; }
    Sound.tap();
    if (sel === id) { if (kindOf(id).t === 'none') sendNews({ id }); else { sel = null; first = null; paint(st); } return; }
    sel = id; first = null;
    paint(st);
  }
  function sectorSheet(s) {
    const sec = IPO_SECTORS[s];
    const owner = (c) => (st.own[seat].includes(c) ? 'You' : st.own[opp].includes(c) ? Pshort : '');
    const list = IPO_COS.filter((c) => c.s === s).map((c) => {
      const mine = st.own[seat].includes(c.id);
      return h('li', { class: 'ip-sec-co' }, ipoCoCard(c.id), h('span', { class: 'who' }, owner(c.id)),
        mine && canTrade() ? h('button', { class: 'btn btn-felt ip-cash', onclick: () => { closeSheet(); Sound.pick(); send({ k: 'cash', c: c.id }); } }, `Cash out ${ipoM(st.price[s])}`) : null);
    });
    openSheet({
      title: sec.name, sub: `${sec.col} · price ${st.price[s]} · ${sec.line == null ? 'never pops' : `pops above ${sec.line} at earnings`} · pays ${ipoM(sec.div)} a company`,
      body: h('div', { class: 'sheet-body' }, h('ul', { class: 'ip-sec' }, ...list),
        canTrade() && ipoCount(st, seat, s) ? h('p', { class: 'ip-small' }, `Cashing out drops ${sec.short} by 1.`) : null),
      actions: [{ label: 'Close', kind: 'ghost' }],
    });
  }
  function buySheet(s) {
    const id = sel;
    const theirs = st.own[opp].filter((c) => IPO_COS[c].s === s), cost = st.price[s] + 2;
    if (!theirs.length) { toast(`${Pshort} has nothing in ${IPO_SECTORS[s].name}`); return; }
    openSheet({
      title: 'Acqui-hire', sub: `${ipoM(cost)} each, paid to ${Pshort}`,
      body: h('ul', { class: 'ip-sec' }, ...theirs.map((c) => h('li', { class: 'ip-sec-co' }, ipoCoCard(c),
        h('button', { class: 'btn btn-primary ip-cash', disabled: st.cash[seat] < cost || null, onclick: () => { closeSheet(); sendNews({ id, c }); } }, `Buy ${ipoM(cost)}`)))),
      actions: [{ label: 'Not now', kind: 'ghost' }],
    });
  }
  board.addEventListener('click', (e) => {
    const row = e.target.closest('.ip-row');
    if (!row || !st) return;
    const s = +row.dataset.s;
    Sound.tap();
    if (sel == null || !canTrade()) { if (sel != null) shake(status); sectorSheet(s); return; }
    const k = kindOf(sel);
    if (k.t === 'sector') sendNews({ id: sel, s });
    else if (k.t === 'two') {
      if (first == null) { first = s; paint(st); }
      else if (first === s) { first = null; paint(st); }
      else sendNews({ id: sel, s: first, s2: s });
    } else if (k.t === 'theirs') buySheet(s);
    else sectorSheet(s);
  });

  return {
    update(nm) {
      m = nm;
      if (rendered < 0) {
        st = ipoState(m);
        rendered = st.log.length;
        paint(st);
        if (st.winner) finish(true);
      }
      st = ipoState(m);
      syncPending();
      queue();
    },
    onPeers() { if (st && !animating) paintChrome(); },
    isOver() { return !!(st && st.winner); },
    destroy() { dead = true; },
  };
}
