'use strict';
// ================= stats: what the saved logs say about the two of you =================
// Nothing here is stored. Every finished game is in table.results, and its match document still
// holds the whole log, so tableStats() replays them with the games' own replay functions, the same
// way the boards are drawn. Games finished before there were stats count too.

const STATS_LOG = 30; // games in the log, newest first
const STATS_HANDS = ['rock', 'paper', 'scissors'];

const seatsOf = (f) => ({ host: f(), guest: f() });
const lowest = (a, b) => (a == null || b < a ? b : a);
const highest = (a, b) => (a == null || b > a ? b : a);

// table: the table document; matches: every match document at the table (finished or not).
// Games go in the order they finished (results[id].at); results from before that was kept use created.
function tableStats(table, matches) {
  const byId = {};
  for (const m of matches) if (m && m.id && GAMES[m.game]) byId[m.id] = m;
  const results = (table && table.results) || {};
  const done = Object.keys(results)
    .filter((id) => results[id] && GAMES[results[id].g])
    .map((id) => ({ id, g: results[id].g, w: results[id].w, m: byId[id] || null, at: results[id].at || (byId[id] && byId[id].created) || 0 }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

  const s = {
    games: done.length, wins: seatsOf(() => 0), draws: 0, streak: { seat: null, n: 0 }, best: seatsOf(() => 0),
    played: { c4: 0, bs: 0, hu: 0, qf: 0, ww: 0 }, split: {}, log: [],
    rps: seatsOf(() => ({ rock: 0, paper: 0, scissors: 0, throws: 0, opener: { rock: 0, paper: 0, scissors: 0 }, tosses: 0 })),
    c4: seatsOf(() => ({ wins: 0, fewest: null, discs: 0, first: 0 })),
    bs: seatsOf(() => ({ wins: 0, shots: 0, hits: 0, best: null, fewest: null, run: 0 })),
    hu: seatsOf(() => ({ wins: 0, fewest: null, pickup: 0, callouts: 0, hues: 0 })),
    qf: seatsOf(() => ({ wins: 0, rounds: 0, word: null, sum: null, answers: 0, ms: 0, gaveUp: 0 })),
    ww: seatsOf(() => ({ wins: 0, words: 0, longest: null, nines: 0 })),
  };

  // wins and streaks: a draw ends the run
  for (const d of done) {
    s.played[d.g]++;
    const split = (s.split[d.g] ||= { host: 0, guest: 0, draw: 0 });
    split[d.w === 'host' || d.w === 'guest' ? d.w : 'draw']++;
    if (d.w === 'host' || d.w === 'guest') {
      s.wins[d.w]++;
      s.streak = s.streak.seat === d.w ? { seat: d.w, n: s.streak.n + 1 } : { seat: d.w, n: 1 };
      s.best[d.w] = Math.max(s.best[d.w], s.streak.n);
    } else { s.draws++; s.streak = { seat: null, n: 0 }; }
  }

  // rock, paper, scissors: every game played here, finished or not
  for (const m of Object.values(byId)) {
    const st = rpsState(m);
    st.rounds.forEach((r, i) => {
      for (const seat of ['host', 'guest']) {
        const p = s.rps[seat];
        if (!STATS_HANDS.includes(r[seat])) continue;
        p[r[seat]]++; p.throws++;
        if (i === 0) p.opener[r[seat]]++;
      }
    });
    if (st.starter) s.rps[st.starter].tosses++;
  }

  // each game's own records, from its replay
  for (const d of done) {
    if (!d.m) continue;
    const note = STATS_GAME[d.g](d.m, s[d.g]);
    s.log.push({ id: d.id, g: d.g, w: d.w, at: d.at, note });
  }
  s.log = s.log.reverse().slice(0, STATS_LOG);
  return s;
}

// Each adds one finished game to its records and returns a few words about it for the log.
const STATS_GAME = {
  c4(m, rec) {
    const st = c4State(m);
    if (!st.winner) return st.draw ? 'board full, a draw' : '';
    const discs = st.moves.filter((x) => x.who === st.winner).length, r = rec[st.winner];
    r.wins++; r.discs += discs; r.fewest = lowest(r.fewest, discs);
    if (st.winner === st.starter) r.first++;
    return `four in a row with ${discs} discs`;
  },
  bs(m, rec) {
    const st = bsState(m);
    for (const seat of ['host', 'guest']) {
      const r = rec[seat], fired = st.fired[seat];
      r.shots += fired; r.hits += st.hits[seat];
      if (fired) r.best = highest(r.best, st.hits[seat] / fired);
      let run = 0;
      for (const x of st.shots) if (x.shooter === seat) { run = x.hit ? run + 1 : 0; r.run = Math.max(r.run, run); }
    }
    if (!st.winner) return '';
    const r = rec[st.winner];
    r.wins++; r.fewest = lowest(r.fewest, st.fired[st.winner]);
    return `${st.hits[st.winner]} hits from ${st.fired[st.winner]} shots`;
  },
  hu(m, rec) {
    const st = huState(m);
    for (const e of st.log) {
      if (!rec[e.by]) continue;
      if (e.k === 'draw' && e.pen) rec[e.by].pickup = Math.max(rec[e.by].pickup, e.ids.length);
      else if (e.k === 'callout') rec[e.by].callouts++;
      else if (e.k === 'hues') rec[e.by].hues++;
    }
    if (!st.winner) return '';
    const cards = st.log.reduce((n, e) => n + (e.k === 'play' && e.by === st.winner ? e.ids.length : 0), 0), r = rec[st.winner];
    r.wins++; r.fewest = lowest(r.fewest, cards);
    return `out of cards after playing ${cards}`;
  },
  qf(m, rec) {
    const st = qfState(m);
    for (const round of st.rounds) {
      if (round.phase !== 'done') continue;
      if (round.w) rec[round.w].rounds++;
      for (const seat of ['host', 'guest']) {
        const a = round.ans[seat], r = rec[seat];
        if (a && a.pass) r.gaveUp++;
        if (!a || !a.ok) continue;
        r.answers++; r.ms += a.ms;
        if (round.type === 'w' && (!r.word || a.ms < r.word.ms)) r.word = { ms: a.ms, w: a.w };
        if (round.type === 's' && (!r.sum || a.ms < r.sum.ms)) r.sum = { ms: a.ms, x: round.x, y: round.y, op: round.op };
      }
    }
    if (!st.winner) return '';
    rec[st.winner].wins++;
    const lose = st.score[other(st.winner)];
    return `${st.score[st.winner]}–${lose} in ${QF_MODES[st.setup.mode].name}`;
  },
  ww(m, rec) {
    const st = wwState(m);
    for (const f of st.finds) {
      const r = rec[f.by];
      r.words++;
      if (f.w.length === 9) r.nines++;
      if (!r.longest || f.w.length > r.longest.w.length) r.longest = { w: f.w };
    }
    if (!st.winner) return '';
    rec[st.winner].wins++;
    return `${st.score[st.winner]}–${st.score[other(st.winner)]}, the wheel’s nine-letter word was ${st.wheel.nine[0]}`;
  },
};

// ---------- the sheet ----------
// The rules let a phone read a match it knows the id of, not list them all, so this fetches the
// finished games (table.results) and the saved and current ones (for rock, paper, scissors).
async function loadTableStats() {
  const t = G.table;
  const ids = new Set([...Object.keys(t.results || {}), ...Object.values(t.saved || {}), t.current].filter(Boolean));
  const snaps = await Promise.all([...ids].map((id) => Net.doc(matchPath(id)).get()));
  return tableStats(t, snaps.filter((s) => s.exists).map((s) => s.data()));
}
function showStats() {
  Sound.tap();
  const body = h('div', { class: 'stats' }, h('p', { class: 'stats-foot' }, 'Adding it all up…'));
  openSheet({ title: 'All the stats', sub: 'From every game you’ve finished at this table', body, actions: [{ label: 'Back to the shelf', kind: 'ghost' }] });
  loadTableStats().then((s) => body.replaceChildren(...statsView(s)), (e) => {
    console.warn('stats', e);
    body.replaceChildren(h('p', { class: 'stats-foot' }, 'Couldn’t reach the table. Try again when you’re connected.'));
  });
}

const statsDash = '–';
const statsPct = (x) => (x == null ? statsDash : Math.round(x * 100) + '%');
const statsSecs = (ms) => (ms == null ? statsDash : (ms / 1000).toFixed(2) + ' s');
const statsNum = (n) => (n == null ? statsDash : String(n));
function statsFavourite(counts) {
  const top = Math.max(...STATS_HANDS.map((k) => counts[k]));
  if (!top) return statsDash;
  const best = STATS_HANDS.filter((k) => counts[k] === top);
  return best.length > 1 ? 'no favourite' : cap(best[0]);
}

// ---------- the pictures ----------
// Painted on the sheet's paper: you are always blue, your partner red (--chart-me, --chart-them), draws
// grey. Every bar and slice carries its number, so nothing depends on telling colours apart.
const STATS_ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="none" stroke="#c4482f" stroke-width="10" opacity=".85"/><circle cx="20" cy="20" r="14" fill="none" stroke="#2f68ad" stroke-width="10" stroke-dasharray="52 88" transform="rotate(-90 20 20)" opacity=".85"/></svg>';
const statsWho = (x) => (x === G.seat ? 'You' : firstName(partnerName()));

// Head to head: one bar split into your wins, draws and theirs, with the numbers on it.
function statsSplit(a, b, draws = 0) {
  const total = a + b + draws;
  const seg = (n, cls, label) => (n ? h('span', { class: 'st-seg ' + cls, style: `flex-grow:${n}`, title: label }, String(n)) : null);
  return h('div', { class: 'st-split', role: 'img', 'aria-label': `${statsWho(G.seat)} ${a}, ${statsWho(other(G.seat))} ${b}${draws ? `, ${draws} drawn` : ''}` },
    total ? [seg(a, 'me', `${statsWho(G.seat)}: ${a}`), seg(draws, 'draw', `Drawn: ${draws}`), seg(b, 'them', `${statsWho(other(G.seat))}: ${b}`)] : h('span', { class: 'st-seg none' }, 'none yet'));
}
// One record for both of you: your bar grows left from the middle, theirs right, longest for the
// bigger number; `better` ('hi' or 'lo') marks the leader.
function statsDuel(label, a, b, show = statsNum, better = null) {
  const top = Math.max(a || 0, b || 0) || 1;
  const lead = better && a != null && b != null && a !== b ? ((better === 'hi') === (a > b) ? 'me' : 'them') : null;
  const side = (v, who) => h('div', { class: `st-half ${who}` + (lead === who ? ' lead' : '') },
    h('span', { class: 'st-bar', style: `width:${v ? Math.max(4, (v / top) * 100) : 0}%` }), h('b', null, show(v)));
  return h('div', { class: 'st-duel', role: 'img', 'aria-label': `${label}: ${statsWho(G.seat)} ${show(a)}, ${statsWho(other(G.seat))} ${show(b)}` },
    h('span', { class: 'st-label' }, label), side(a, 'me'), side(b, 'them'));
}
// A pie (a ring) of one player's rock, paper and scissors, with the painted hands as its key.
function statsDonut(p, who) {
  const r = 38, C = 2 * Math.PI * r, gap = p.throws > 1 ? 1.6 : 0;
  let at = 0, arcs = '';
  for (const k of STATS_HANDS) {
    const len = p.throws ? (p[k] / p.throws) * C : 0;
    if (len > gap) arcs += `<circle class="st-arc hand-${k}" cx="50" cy="50" r="${r}" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-at}"><title>${cap(k)}: ${p[k]}</title></circle>`;
    at += len;
  }
  const ring = svgEl(`<svg class="st-donut" viewBox="0 0 100 100" aria-hidden="true"><circle class="st-arc empty" cx="50" cy="50" r="${r}"/><g transform="rotate(-90 50 50)">${arcs}</g></svg>`);
  return h('figure', { class: 'st-pie', role: 'img', 'aria-label': `${who}: ` + STATS_HANDS.map((k) => `${k} ${statsShare(p, k)}`).join(', ') },
    h('div', { class: 'st-ring' }, ring, h('div', { class: 'st-mid' }, h('b', null, who), h('small', null, `${p.throws} ${p.throws === 1 ? 'throw' : 'throws'}`))),
    h('figcaption', null, ...STATS_HANDS.map((k) => h('span', { class: 'st-key hand-' + k }, h('i'), h('img', { class: 'wc', src: `art/rps-${k}.png`, alt: '' }), cap(k), h('b', null, statsShare(p, k))))));
}
const statsShare = (p, k) => (p.throws ? Math.round((p[k] / p.throws) * 100) + '%' : statsDash);
// The last few games as a row of dots, oldest on the left.
function statsForm(log) {
  const games = log.slice(0, 12).reverse();
  return h('div', { class: 'st-form', role: 'img', 'aria-label': 'Last games, oldest first: ' + games.map((g) => (g.w === G.seat ? 'you' : g.w === other(G.seat) ? firstName(partnerName()) : 'draw')).join(', ') },
    ...games.map((g) => h('i', { class: g.w === G.seat ? 'me' : g.w === other(G.seat) ? 'them' : 'draw', title: GAMES[g.g].name })));
}

function statsView(s) {
  const me = G.seat, them = other(G.seat), P = firstName(partnerName());
  if (!s.games) return [h('p', { class: 'stats-foot' }, 'No finished games yet. Play one and the numbers start here.')];
  const section = (title, ...kids) => h('section', { class: 'stats-sec' }, h('h3', null, title), ...kids);
  const duels = (rows) => h('div', { class: 'st-duels' }, ...rows.map(([label, get, show, better]) => statsDuel(label, get(me), get(them), show, better)));
  const key = h('div', { class: 'st-legend' }, h('span', { class: 'me' }, h('i'), 'You'), h('span', { class: 'them' }, h('i'), P));
  const out = [key];

  // overall: the head-to-head, the run of recent results, and the games one by one
  const run = s.streak.seat && s.streak.n > 1 ? `${s.streak.seat === me ? 'You’re' : `${P}’s`} on a roll: ${s.streak.n} wins in a row.` : '';
  const perGame = Object.keys(GAMES).filter((g) => s.split[g]).map((g) =>
    h('div', { class: 'st-game' }, h('span', null, GAMES[g].name), statsSplit(s.split[g][me], s.split[g][them], s.split[g].draw)));
  out.push(section('Overall',
    h('div', { class: 'st-hero' }, h('div', { class: 'me' }, h('b', null, s.wins[me]), h('small', null, 'your wins')), h('div', { class: 'them' }, h('b', null, s.wins[them]), h('small', null, `${P}’s wins`))),
    statsSplit(s.wins[me], s.wins[them], s.draws),
    h('p', { class: 'stats-foot' }, `${s.games} ${s.games === 1 ? 'game' : 'games'} finished${s.draws ? `, ${s.draws} drawn` : ''}. ${run}`.trim()),
    h('h4', null, 'Lately'), statsForm(s.log),
    h('h4', null, 'Game by game'), ...perGame,
    duels([['Longest winning run', (x) => s.best[x], statsNum, 'hi']])));

  out.push(section('Rock, paper, scissors',
    h('div', { class: 'st-pies' }, statsDonut(s.rps[me], 'You'), statsDonut(s.rps[them], P)),
    h('p', { class: 'stats-foot' }, `Opens with: you, ${statsFavourite(s.rps[me].opener).toLowerCase()}; ${P}, ${statsFavourite(s.rps[them].opener).toLowerCase()}.`),
    duels([['Won the toss', (x) => s.rps[x].tosses, statsNum, 'hi']])));

  if (s.played.c4) out.push(section('Connect Four', duels([
    ['Wins', (x) => s.c4[x].wins, statsNum, 'hi'],
    ['Fewest discs to win', (x) => s.c4[x].fewest, statsNum, 'lo'],
    ['Discs per win', (x) => (s.c4[x].wins ? Math.round((s.c4[x].discs / s.c4[x].wins) * 10) / 10 : null), statsNum, 'lo'],
    ['Wins going first', (x) => s.c4[x].first, statsNum],
  ])));
  if (s.played.bs) out.push(section('Battleships', duels([
    ['Wins', (x) => s.bs[x].wins, statsNum, 'hi'],
    ['Accuracy', (x) => (s.bs[x].shots ? s.bs[x].hits / s.bs[x].shots : null), statsPct, 'hi'],
    ['Best game', (x) => s.bs[x].best, statsPct, 'hi'],
    ['Fewest shots to win', (x) => s.bs[x].fewest, statsNum, 'lo'],
    ['Most hits in a row', (x) => s.bs[x].run, statsNum, 'hi'],
  ])));
  if (s.played.hu) out.push(section('Hues', duels([
    ['Wins', (x) => s.hu[x].wins, statsNum, 'hi'],
    ['Fewest cards to win', (x) => s.hu[x].fewest, statsNum, 'lo'],
    ['Biggest pickup', (x) => s.hu[x].pickup, statsNum],
    ['Call-outs', (x) => s.hu[x].callouts, statsNum, 'hi'],
  ])));
  if (s.played.qf) out.push(section('Quickfire', duels([
    ['Wins', (x) => s.qf[x].wins, statsNum, 'hi'],
    ['Rounds won', (x) => s.qf[x].rounds, statsNum, 'hi'],
    ['Fastest word', (x) => s.qf[x].word && s.qf[x].word.ms, statsSecs, 'lo'],
    ['Fastest sum', (x) => s.qf[x].sum && s.qf[x].sum.ms, statsSecs, 'lo'],
    ['Average answer', (x) => (s.qf[x].answers ? s.qf[x].ms / s.qf[x].answers : null), statsSecs, 'lo'],
    ['Gave up', (x) => s.qf[x].gaveUp, statsNum],
  ]), ...['word', 'sum'].map((k) => {
    // the quickest of the two, with what it was
    const f = [me, them].filter((x) => s.qf[x][k]).map((x) => ({ who: x === me ? 'you' : P, ...s.qf[x][k] })).sort((a, b) => a.ms - b.ms)[0];
    if (!f) return '';
    const what = k === 'word' ? f.w : `${f.x} ${QF_OPS[f.op].sym} ${f.y}`;
    return h('p', { class: 'stats-foot' }, `Quickest ${k}: ${what}, by ${f.who} in ${statsSecs(f.ms)}.`);
  })));
  if (s.played.ww) {
    const best = [me, them].filter((x) => s.ww[x].longest).sort((x, y) => s.ww[y].longest.w.length - s.ww[x].longest.w.length)[0];
    out.push(section('Word Wheel', duels([
      ['Wins', (x) => s.ww[x].wins, statsNum, 'hi'],
      ['Words found', (x) => s.ww[x].words, statsNum, 'hi'],
      ['Longest word', (x) => s.ww[x].longest && s.ww[x].longest.w.length, statsNum, 'hi'],
      ['Nine-letter words', (x) => s.ww[x].nines, statsNum, 'hi'],
    ]), best ? h('p', { class: 'stats-foot' }, `Longest word: ${s.ww[best].longest.w}, by ${best === me ? 'you' : P}.`) : ''));
  }

  const day = (at) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  out.push(section('The log', h('ol', { class: 'stats-log' }, ...s.log.map((g) => h('li', { class: g.w === me ? 'me' : g.w === them ? 'them' : 'draw' },
    h('small', null, [day(g.at), GAMES[g.g].name].filter(Boolean).join(' · ')),
    h('b', null, g.w === me ? 'You won' : g.w === them ? `${P} won` : 'A draw'),
    g.note ? h('span', null, g.note) : '')))));
  return out;
}
