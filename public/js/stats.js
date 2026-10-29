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
    played: { c4: 0, bs: 0, hu: 0, qf: 0 }, log: [],
    rps: seatsOf(() => ({ rock: 0, paper: 0, scissors: 0, throws: 0, opener: { rock: 0, paper: 0, scissors: 0 }, tosses: 0 })),
    c4: seatsOf(() => ({ wins: 0, fewest: null, discs: 0, first: 0 })),
    bs: seatsOf(() => ({ wins: 0, shots: 0, hits: 0, best: null, fewest: null, run: 0 })),
    hu: seatsOf(() => ({ wins: 0, fewest: null, pickup: 0, callouts: 0, hues: 0 })),
    qf: seatsOf(() => ({ wins: 0, rounds: 0, word: null, sum: null, answers: 0, ms: 0, gaveUp: 0 })),
  };

  // wins and streaks: a draw ends the run
  for (const d of done) {
    s.played[d.g]++;
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
const statsShare = (p, k) => (p.throws ? Math.round((p[k] / p.throws) * 100) + '%' : statsDash);
function statsFavourite(counts) {
  const top = Math.max(...STATS_HANDS.map((k) => counts[k]));
  if (!top) return statsDash;
  const best = STATS_HANDS.filter((k) => counts[k] === top);
  return best.length > 1 ? 'no favourite' : cap(best[0]);
}

function statsView(s) {
  const me = G.seat, them = other(G.seat);
  if (!s.games) return [h('p', { class: 'stats-foot' }, 'No finished games yet. Play one and the numbers start here.')];
  // one ruled grid per section: label, you, them; `better` marks the leader ('hi' or 'lo'), when both have one
  const grid = (rows) => {
    const cells = [h('span', { class: 'hd' }), h('span', { class: 'hd n' }, firstName(myName())), h('span', { class: 'hd n' }, firstName(partnerName()))];
    for (const [label, get, show = statsNum, better = null] of rows) {
      const a = get(me), b = get(them);
      const lead = better && a != null && b != null && a !== b ? ((better === 'hi') === (a > b) ? 'me' : 'them') : null;
      cells.push(h('span', null, label),
        h('span', { class: 'n' + (lead === 'me' ? ' lead' : '') }, show(a)),
        h('span', { class: 'n' + (lead === 'them' ? ' lead' : '') }, show(b)));
    }
    return h('div', { class: 'score-grid stats-grid' }, ...cells);
  };
  const section = (title, ...kids) => h('section', { class: 'stats-sec' }, h('h3', null, title), ...kids);
  const out = [];

  const run = s.streak.seat && s.streak.n > 1 ? `${s.streak.seat === me ? 'You’re' : `${firstName(partnerName())}’s`} on a roll: ${s.streak.n} wins in a row.` : null;
  out.push(section('Overall',
    grid([['Games won', (x) => s.wins[x], statsNum, 'hi'], ['Longest winning run', (x) => s.best[x], statsNum, 'hi']]),
    h('p', { class: 'stats-foot' }, `${s.games} ${s.games === 1 ? 'game' : 'games'} finished${s.draws ? `, ${s.draws} drawn` : ''}. ${run || ''}`.trim())));

  out.push(section('Rock, paper, scissors', grid([
    ['Rock', (x) => s.rps[x], (p) => statsShare(p, 'rock')],
    ['Paper', (x) => s.rps[x], (p) => statsShare(p, 'paper')],
    ['Scissors', (x) => s.rps[x], (p) => statsShare(p, 'scissors')],
    ['Opens with', (x) => s.rps[x].opener, statsFavourite],
    ['Won the toss', (x) => s.rps[x].tosses, statsNum, 'hi'],
  ])));

  if (s.played.c4) out.push(section('Connect Four', grid([
    ['Wins', (x) => s.c4[x].wins, statsNum, 'hi'],
    ['Fewest discs to win', (x) => s.c4[x].fewest, statsNum, 'lo'],
    ['Discs per win', (x) => (s.c4[x].wins ? Math.round((s.c4[x].discs / s.c4[x].wins) * 10) / 10 : null), statsNum, 'lo'],
    ['Wins going first', (x) => s.c4[x].first, statsNum],
  ])));
  if (s.played.bs) out.push(section('Battleships', grid([
    ['Wins', (x) => s.bs[x].wins, statsNum, 'hi'],
    ['Accuracy', (x) => (s.bs[x].shots ? s.bs[x].hits / s.bs[x].shots : null), statsPct, 'hi'],
    ['Best game', (x) => s.bs[x].best, statsPct, 'hi'],
    ['Fewest shots to win', (x) => s.bs[x].fewest, statsNum, 'lo'],
    ['Most hits in a row', (x) => s.bs[x].run, statsNum, 'hi'],
  ])));
  if (s.played.hu) out.push(section('Hues', grid([
    ['Wins', (x) => s.hu[x].wins, statsNum, 'hi'],
    ['Fewest cards to win', (x) => s.hu[x].fewest, statsNum, 'lo'],
    ['Biggest pickup', (x) => s.hu[x].pickup, statsNum],
    ['Call-outs', (x) => s.hu[x].callouts, statsNum, 'hi'],
  ])));
  if (s.played.qf) out.push(section('Quickfire', grid([
    ['Wins', (x) => s.qf[x].wins, statsNum, 'hi'],
    ['Rounds won', (x) => s.qf[x].rounds, statsNum, 'hi'],
    ['Fastest word', (x) => s.qf[x].word && s.qf[x].word.ms, statsSecs, 'lo'],
    ['Fastest sum', (x) => s.qf[x].sum && s.qf[x].sum.ms, statsSecs, 'lo'],
    ['Average answer', (x) => (s.qf[x].answers ? s.qf[x].ms / s.qf[x].answers : null), statsSecs, 'lo'],
    ['Gave up', (x) => s.qf[x].gaveUp, statsNum],
  ]), ...['word', 'sum'].map((k) => {
    // the quickest of the two, with what it was
    const f = [me, them].filter((x) => s.qf[x][k]).map((x) => ({ who: x === me ? 'you' : firstName(partnerName()), ...s.qf[x][k] })).sort((a, b) => a.ms - b.ms)[0];
    if (!f) return '';
    const what = k === 'word' ? f.w : `${f.x} ${QF_OPS[f.op].sym} ${f.y}`;
    return h('p', { class: 'stats-foot' }, `Quickest ${k}: ${what}, by ${f.who} in ${statsSecs(f.ms)}.`);
  })));

  const day = (at) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  out.push(section('The log', h('ol', { class: 'stats-log' }, ...s.log.map((g) => h('li', null,
    h('small', null, [day(g.at), GAMES[g.g].name].filter(Boolean).join(' · ')),
    h('b', null, g.w === me ? 'You won' : g.w === them ? `${firstName(partnerName())} won` : 'A draw'),
    g.note ? h('span', null, g.note) : '')))));
  return out;
}
