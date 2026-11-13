'use strict';
// Game 1: Pair Hunt. Everyone hunts for the one teammate whose phone shows the same symbol, proves it by
// typing their code, and gets a new symbol. Both teams play at once, each inside its own team.
//
// Codes: every player in a group has their OWN 2-digit code (not one code per pair). You show yours, your
// partner types it. With a shared pair code a player could tap "Show my code" and type it themselves
// without ever finding their partner; per-player codes close that (see DECISIONS.md).

const SHAPES = ['circle', 'triangle', 'square', 'star', 'heart', 'moon', 'diamond', 'cross'];
const COLOURS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
// Round 2 look-alike families: symbols inside a family are easy to mix up at a glance.
const COLOUR_FAMILIES = [['red', 'orange'], ['blue', 'purple'], ['green', 'yellow']];
const SHAPE_FAMILIES = [['circle', 'moon'], ['square', 'diamond'], ['star', 'cross'], ['triangle', 'heart']];

const ROUND_MS = 180000;
const MATCHED_MS = 1500;       // "Matched! New symbol coming…" before a new symbol
const LOCK_MS = 3000;
const LOCK_LONG_MS = 10000;    // after three wrong codes in a row
const BONUS_FAST_MS = 15000;
const BONUS_OK_MS = 30000;
const TEAMS = ['red', 'blue'];
const TEAM_NAME = { red: 'Red', blue: 'Blue' };

const symKey = s => s.colour + ' ' + s.shape;
const symName = s => `${s.colour} ${s.shape}`.toUpperCase();

// Symbols a round may use. Round 1: all 48. Round 2: look-alikes only, enough for the bigger team's
// groups plus spare, chosen from the seed so both teams get the same set.
function symbolSet(lookalike, maxPlayers, r) {
  if (!lookalike) return COLOURS.flatMap(colour => SHAPES.map(shape => ({ colour, shape })));
  const need = Math.floor(maxPlayers / 2) + 2;
  const cf = r.shuffle(COLOUR_FAMILIES), sf = r.shuffle(SHAPE_FAMILIES);
  let nc = 1, ns = 1;
  const size = () => cf.slice(0, nc).flat().length * sf.slice(0, ns).flat().length;
  while (size() < need && (ns < sf.length || nc < cf.length)) { if (ns < sf.length) ns++; else nc++; }
  const cols = cf.slice(0, nc).flat(), shs = sf.slice(0, ns).flat();
  return cols.flatMap(colour => shs.map(shape => ({ colour, shape })));
}

function create(ctx) {
  const lookalike = ctx.n === 2;
  const maxPlayers = Math.max(ctx.teams.red.length, ctx.teams.blue.length);
  const allowed = symbolSet(lookalike, maxPlayers, ctx.rng('lookalike'));
  const T = {};
  for (const team of TEAMS) {
    T[team] = {
      team, ids: ctx.teams[team].map(p => p.id),
      symRng: ctx.rng('symbols'), codeRng: ctx.rng('codes'), shuffleRng: ctx.rng('shuffle'),
      groups: new Map(), nextGid: 1, pairs: 0, trios: 0, wrong: 0, finds: [],
    };
  }
  const P = {}; // pid → per-player state
  for (const team of TEAMS) for (const p of ctx.teams[team]) {
    P[p.id] = {
      id: p.id, team, gid: null, code: null, status: 'waiting', poolSince: 0, readyAt: 0,
      last: new Set(), met: new Set(), prevSym: null, prevCode: null,
      streak: 0, lockUntil: 0, pairs: 0, typed: false,
    };
  }
  const teamOf = pid => (P[pid] ? P[pid].team : null);

  function pickSymbol(t, members) {
    const held = new Set([...t.groups.values()].map(g => symKey(g.symbol)));
    const prev = new Set(members.map(id => P[id].prevSym).filter(Boolean));
    const free = allowed.filter(s => !held.has(symKey(s)));
    const fresh = free.filter(s => !prev.has(symKey(s)));
    const from = fresh.length ? fresh : free.length ? free : allowed;
    // draw from the full list so both teams' generators move in step while their held sets agree
    for (let i = 0; i < 40; i++) { const s = t.symRng.pick(allowed); if (from.some(f => symKey(f) === symKey(s))) return s; }
    return t.symRng.pick(from);
  }
  function pickCode(t, pid) {
    const used = new Set();
    for (const g of t.groups.values()) for (const id of g.members) if (P[id].code) used.add(P[id].code);
    for (let i = 0; i < 200; i++) {
      const c = String(t.codeRng.int(10, 99));
      if (!used.has(c) && c !== P[pid].prevCode) return c;
    }
    return String(t.codeRng.int(10, 99));
  }

  function formGroup(t, members) {
    const now = ctx.now();
    const g = { id: t.nextGid++, members: members.slice(), symbol: null, since: now, typed: new Set() };
    g.symbol = pickSymbol(t, members);
    t.groups.set(g.id, g);
    for (const id of members) {
      const p = P[id];
      p.gid = g.id; p.status = 'hunt'; p.typed = false;
      p.code = pickCode(t, id);
      for (const o of members) if (o !== id) p.met.add(o);
      ctx.fx(id, { game: 'pairhunt', kind: 'newsym' });
      ctx.push(id);
    }
    return g;
  }

  function toPool(pid, status, delay) {
    const p = P[pid];
    p.gid = null; p.code = null; p.typed = false;
    p.status = status;
    p.poolSince = ctx.now();
    p.readyAt = ctx.now() + delay;
    ctx.push(pid);
  }

  function breakGroup(t, g, status, delay) {
    t.groups.delete(g.id);
    for (const id of g.members) {
      const p = P[id];
      p.prevSym = symKey(g.symbol); p.prevCode = p.code;
      if (ctx.online(id)) toPool(id, status, delay);
      else { p.gid = null; p.code = null; p.status = 'offline'; }
    }
  }

  // Pair people in the free pool, in the spec's order of rules.
  function pairPool(t) {
    const now = ctx.now();
    const online = t.ids.filter(id => ctx.online(id));
    const pool = online.filter(id => P[id].gid == null && P[id].status !== 'offline');
    const ready = pool.filter(id => P[id].readyAt <= now).sort((a, b) => P[a].poolSince - P[b].poolSince);
    if (ready.length >= 2) pairReady(t, online, pool, ready);
    // still free once "Matched!" has shown: tell them they're waiting
    for (const id of ready) if (P[id].gid == null && P[id].status !== 'waiting') { P[id].status = 'waiting'; ctx.push(id); }
  }

  function pairReady(t, online, pool, ready) {
    // nobody is hunting and everyone free is ready: the spec's "wait for someone else" can't be met
    const stuck = pool.length === online.length && ready.length === pool.length;
    if (stuck && ready.length === 3) { formGroup(t, ready); return; } // the last three become a trio
    const used = new Set();
    for (const a of ready) {
      if (used.has(a)) continue;
      const cands = ready.filter(b => b !== a && !used.has(b) && !P[a].last.has(b) && !P[b].last.has(a));
      if (!cands.length) continue; // only their previous partner is free: wait
      const neverMet = cands.filter(b => !P[a].met.has(b));
      const b = (neverMet.length ? neverMet : cands)[0];
      used.add(a); used.add(b);
      formGroup(t, [a, b]);
    }
    if (stuck) {
      // never pair two people who were just paired — unless there is nobody else at all (a tiny team)
      const left = ready.filter(x => !used.has(x));
      while (left.length >= 2) formGroup(t, left.splice(0, left.length === 3 ? 3 : 2));
    }
  }

  function confirm(t, g, typer) {
    const now = ctx.now();
    const ms = now - g.since;
    const trio = g.members.length >= 3;
    const base = trio ? 15 : 10;
    const bonus = ms <= BONUS_FAST_MS ? 5 : ms <= BONUS_OK_MS ? 2 : 0;
    const secs = Math.round(ms / 100) / 10;
    ctx.award(t.team, g.members, trio ? 'trio_confirmed' : 'pair_confirmed', base + bonus,
      `${symName(g.symbol).toLowerCase()}, found in ${secs}s${bonus ? ` (+${bonus} speed bonus)` : ''}`);
    t.pairs++; if (trio) t.trios++;
    t.finds.push(ms);
    for (const id of g.members) {
      const p = P[id];
      p.pairs++;
      p.last = new Set(g.members.filter(o => o !== id));
      ctx.track(id, 'pairs');
      ctx.track(id, 'findMs', ms);
      ctx.best(id, 'fastestFind', ms, 'min');
      ctx.fx(id, { kind: 'good' });
    }
    breakGroup(t, g, 'matched', MATCHED_MS);
    ctx.pushTeam(t.team);
  }

  function onCode(pid, raw) {
    const p = P[pid];
    if (!p || p.gid == null) return;
    const t = T[p.team];
    const g = t.groups.get(p.gid);
    if (!g) return;
    const now = ctx.now();
    if (now < p.lockUntil) return;
    const code = String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 2);
    if (code.length !== 2) return;
    if (code === p.code) { ctx.fx(pid, { game: 'pairhunt', kind: 'own' }); return; } // their own code: a slip, not a guess
    const hit = g.members.some(o => o !== pid && P[o].code === code);
    if (!hit) {
      p.streak++; t.wrong++;
      ctx.track(pid, 'wrongCodes');
      if (p.streak >= 3) { p.lockUntil = now + LOCK_LONG_MS; p.streak = 0; } else p.lockUntil = now + LOCK_MS;
      ctx.fx(pid, { kind: 'bad' });
      ctx.push(pid);
      return;
    }
    p.streak = 0;
    if (g.members.length >= 3) {
      if (!g.typed.has(pid)) { g.typed.add(pid); p.typed = true; }
      if (g.typed.size >= 2) confirm(t, g, pid);
      else { ctx.fx(pid, { game: 'pairhunt', kind: 'typed' }); g.members.forEach(id => ctx.push(id)); }
      return;
    }
    confirm(t, g, pid);
  }

  return {
    start() {
      for (const team of TEAMS) {
        const t = T[team];
        const online = t.shuffleRng.shuffle(t.ids.filter(id => ctx.online(id)));
        for (const id of t.ids) if (!ctx.online(id)) P[id].status = 'offline';
        let i = 0;
        while (online.length - i >= 2) {
          const size = online.length - i === 3 ? 3 : 2;
          formGroup(t, online.slice(i, i + size));
          i += size;
        }
        if (i < online.length) toPool(online[i], 'waiting', 0); // a team of one
      }
      ctx.pushAll();
    },
    onAction(pid, a) {
      if (a.type === 'code') onCode(pid, a.code);
    },
    onTick() { for (const team of TEAMS) pairPool(T[team]); },
    onPlayerOffline(pid) {
      const p = P[pid]; if (!p) return;
      const t = T[p.team];
      const g = p.gid != null ? t.groups.get(p.gid) : null;
      p.status = 'offline';
      if (g) {
        const rest = g.members.filter(id => id !== pid && ctx.online(id));
        if (rest.length >= 2) { // a trio carries on as a pair, same symbol
          g.members = rest; g.typed.delete(pid);
          p.gid = null; p.code = null;
          rest.forEach(id => ctx.push(id));
        } else {
          breakGroup(t, g, 'dropped', 0);
          p.status = 'offline';
        }
      } else { p.gid = null; p.code = null; }
    },
    onPlayerOnline(pid) {
      const p = P[pid]; if (!p || p.gid != null) return;
      toPool(pid, 'waiting', 0);
    },
    view(pid) {
      const p = P[pid];
      if (!p) return null;
      const t = T[p.team];
      const g = p.gid != null ? t.groups.get(p.gid) : null;
      const v = {
        teamPairs: t.pairs, mine: p.pairs, status: g ? 'hunt' : (p.status === 'hunt' ? 'waiting' : p.status),
        lockUntil: p.lockUntil, lookalike,
      };
      if (g) {
        Object.assign(v, {
          gid: g.id, symbol: { shape: g.symbol.shape, colour: g.symbol.colour, name: symName(g.symbol) },
          code: p.code, size: g.members.length, typed: p.typed, typedCount: g.typed.size, since: g.since,
        });
      }
      return v;
    },
    hostView() {
      return {
        lines: TEAMS.map(team => {
          const t = T[team];
          const hunting = [...t.groups.values()].length;
          const waiting = t.ids.filter(id => ctx.online(id) && P[id].gid == null && P[id].status !== 'offline').length;
          const off = t.ids.filter(id => !ctx.online(id)).length;
          const fast = t.finds.length ? ` · fastest ${Math.round(Math.min(...t.finds) / 1000)}s` : '';
          return `${TEAM_NAME[team]}: ${t.pairs} found · ${hunting} hunting · ${waiting} waiting${off ? ` · ${off} offline` : ''}${fast}`;
        }).concat(lookalike ? ['Look-alike symbols this round.'] : []),
      };
    },
    end() {
      const lines = {}, stats = {}, fun = {};
      for (const team of TEAMS) {
        const t = T[team];
        const fastest = t.finds.length ? Math.min(...t.finds) : null;
        const avg = t.finds.length ? t.finds.reduce((s, x) => s + x, 0) / t.finds.length : null;
        const fs = fastest != null ? Math.max(1, Math.round(fastest / 1000)) : null;
        lines[team] = `${TEAM_NAME[team]} found ${t.pairs} pair${t.pairs === 1 ? '' : 's'}` + (fs != null ? `, fastest in ${fs} second${fs === 1 ? '' : 's'}` : '');
        stats[team] = {
          pairs: t.pairs, trios: t.trios, wrongCodes: t.wrong,
          fastestSec: fastest != null ? Math.round(fastest / 100) / 10 : null,
          avgFindSec: avg != null ? Math.round(avg / 100) / 10 : null,
        };
        if (fs != null) fun[team] = `fastest in ${fs}s`;
      }
      return { lines, stats, fun };
    },
    // for tests
    _state: { T, P, allowed },
  };
}

// A bot phone: guess a code now and then (the crash test taps randomly).
function bot(view, rng) {
  if (!view || view.status !== 'hunt') return null;
  if (rng.next() < 0.5) return null;
  return { type: 'code', code: String(rng.int(10, 99)) };
}

module.exports = {
  id: 'pairhunt',
  name: 'Pair Hunt',
  rule: 'Your phone shows a symbol. One person in your team has the same one. Find them.',
  hostSays: '"Your phone shows a symbol. One person in your team has the same one. Find them, type their code, and you get a new one. Go!"',
  championship: true,
  normalise: true,
  minPlayers: 2,
  rounds: () => [
    { n: 1, label: 'Round 1', ms: ROUND_MS },
    { n: 2, label: 'Round 2', ms: ROUND_MS, note: 'Look-alike symbols' },
  ],
  create,
  bot,
  SHAPES, COLOURS, COLOUR_FAMILIES, SHAPE_FAMILIES, symbolSet,
};
