'use strict';
// Championship maths. Everything here is worked out from the room's event log and finished segments;
// nothing is stored separately, so the scoreboard and the audit can never disagree.

const TEAMS = ['red', 'blue'];
const games = () => require('./room'); // lazy: room.js requires this file

// MVP shout-outs, per team. Games record these with ctx.track / ctx.best under these keys.
const MVPS = [
  { game: 'pairhunt', key: 'pairs', dir: 'max', label: 'Most pairs found', fmt: n => `${n} pair${n === 1 ? '' : 's'}` },
  { game: 'shout', key: 'pressed', dir: 'max', label: 'Most buttons pressed', fmt: n => `${n} press${n === 1 ? '' : 'es'}` },
  { game: 'maths', key: 'fastestStep', dir: 'min', label: 'Fastest Maths Chain step', fmt: ms => `${(ms / 1000).toFixed(1)} s` },
];

// A game's total per team: the sum of its round scores (practice rounds don't count).
function gameTotals(room, gameId) {
  const t = { red: 0, blue: 0 };
  for (const s of room.segments) if (s.game === gameId && !s.practice) for (const team of s.teams) t[team] += s.score[team] || 0;
  return t;
}

// Higher total gets 100; the other gets 100 × theirs ÷ winner's, rounded. Never below 0.
function toChampionship(totals) {
  const r = Math.max(0, totals.red), b = Math.max(0, totals.blue);
  if (r === b) return r > 0 ? { red: 100, blue: 100 } : { red: 0, blue: 0 };
  const win = r > b ? 'red' : 'blue', lose = win === 'red' ? 'blue' : 'red';
  const w = Math.max(r, b), l = Math.min(r, b);
  return { [win]: 100, [lose]: Math.round(100 * l / w) };
}

function championship(room) {
  const { GAMES, GAME_ORDER } = games();
  const out = { games: [], adjust: { red: 0, blue: 0 }, total: { red: 0, blue: 0 }, leader: null, tiebreak: null };
  for (const id of GAME_ORDER) {
    const played = room.segments.some(s => s.game === id && !s.practice);
    if (!played || !GAMES[id] || GAMES[id].championship === false) continue;
    const totals = gameTotals(room, id);
    const points = toChampionship(totals);
    const winner = points.red === points.blue ? null : (points.red > points.blue ? 'red' : 'blue');
    const status = room.games[id] ? room.games[id].status : 'done';
    out.games.push({ id, name: GAMES[id].name, totals, points, winner, status });
    for (const t of TEAMS) out.total[t] += points[t];
  }
  for (const e of room.events) if (e.type === 'manual') out.adjust[e.team] += e.points;
  for (const t of TEAMS) out.total[t] += out.adjust[t];
  // tie-break: the faster combined Maths Chain time
  const mt = { red: 0, blue: 0 }; let any = false;
  for (const s of room.segments) if (s.game === 'maths' && !s.practice && s.tiebreak) { any = true; for (const t of TEAMS) mt[t] += s.tiebreak[t] || 0; }
  if (any) out.tiebreak = mt;
  if (out.total.red !== out.total.blue) out.leader = out.total.red > out.total.blue ? 'red' : 'blue';
  else if (any && mt.red !== mt.blue) { out.leader = mt.red < mt.blue ? 'red' : 'blue'; out.byTiebreak = true; }
  return out;
}

// Per player: how many events they were part of and the points of those events.
function contributions(room) {
  const c = {};
  for (const e of room.events) {
    if (!e.points && !String(e.type).startsWith('host')) continue;
    for (const pid of e.playerIds || []) {
      const r = (c[pid] = c[pid] || { events: 0, points: 0, byGame: {} });
      if (e.practice) continue;
      r.events++; r.points += e.points;
      r.byGame[e.game] = (r.byGame[e.game] || 0) + e.points;
    }
  }
  return c;
}

function mvps(room) {
  const out = [];
  for (const m of MVPS) {
    for (const team of TEAMS) {
      let best = null;
      for (const p of Object.values(room.players)) {
        if (p.team !== team || p.removed) continue;
        const v = room.stats[p.id] && room.stats[p.id][m.game] && room.stats[p.id][m.game][m.key];
        if (v == null || (m.dir === 'max' && v <= 0)) continue;
        if (!best || (m.dir === 'min' ? v < best.v : v > best.v)) best = { pid: p.id, name: p.name, v };
      }
      if (best) out.push({ game: m.game, team, label: m.label, name: best.name, value: m.fmt(best.v) });
    }
  }
  return out;
}

function finalResults(room) {
  const ch = championship(room);
  const dsi = { red: 0, blue: 0 }; let dsiPlayed = false;
  for (const e of room.events) if (e.game === 'dsi') { dsi[e.team] += e.points; dsiPlayed = true; }
  return {
    champion: ch.leader, byTiebreak: !!ch.byTiebreak, total: ch.total, adjust: ch.adjust,
    games: ch.games.map(g => ({ id: g.id, name: g.name, winner: g.winner, points: g.points })),
    dsi: dsiPlayed ? { points: dsi, winner: dsi.red === dsi.blue ? null : (dsi.red > dsi.blue ? 'red' : 'blue') } : null,
    mvps: mvps(room),
  };
}

module.exports = { MVPS, gameTotals, toChampionship, championship, contributions, mvps, finalResults };
