'use strict';
// The core: one Room per sabha session. It owns players, teams, seats, the round flow, the event log
// and every timer. Games are plug-ins (server/games/*.js) that the room drives through a fixed shape;
// they never touch the room directly, only the ctx handed to them (see makeCtx and docs in README.md).
//
// The room knows nothing about sockets: it talks through `transport` (see index.js) and reads time
// from `clock`, so tests can drive it with a fake clock and a recording transport.

const crypto = require('crypto');
const { rng, newSeed } = require('./rng');
const scoring = require('./scoring');

const GAMES = {};
function registerGame(mod) { GAMES[mod.id] = mod; }
const GAME_ORDER = ['pairhunt', 'shout', 'maths'];

const TEAMS = ['red', 'blue'];
const TEAM_NAME = { red: 'Red', blue: 'Blue' };
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O: nothing to mix up with 1 or 0
const HB_OFFLINE_MS = 10000;
const GRACE_MS = 300;
const COUNTDOWN_MS = 3000;
const TIME_SCREEN_MS = 2500;
const MAX_ACTIONS_PER_SEC = 5;
const NAME_MAX = 12;

const uuid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(16).toString('hex');

function makeCode(taken) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!taken || !taken(c)) return c;
  }
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.hostToken = opts.hostToken || token();
    this.clock = opts.clock || Date.now;  // game time source (tests and the bot run speed it up)
    this.wall = opts.wall || this.clock;  // real time: heartbeats, spam guard, host push throttle
    this.out = opts.transport || nullTransport();
    this.saveFn = opts.save || null;
    this.created = this.clock();
    this.touched = this.created;
    this.players = {};          // id → {id, name, team, seat, token, joinedAt, online, lastSeen, waiting, removed}
    this.locked = false;
    this.events = [];           // every point change (and a few zero-point notes), in order
    this.segments = [];         // finished live segments (one per round, two per turn-based round)
    this.games = {};            // gameId → {opts, status: 'playing'|'done', seeds: {roundId: seed}}
    this.options = { shoutMode: 'simultaneous' };
    this.phase = 'lobby';       // lobby | ready | intro | countdown | live | time | results | gameover | dsi | final
    this.current = null;        // {game, opts, rounds, idx} plus, while a segment runs: seg
    this.pause = { total: 0, at: null };
    this.handovers = [];        // pending "Is this Ravi (Red #4)?" prompts
    this.stats = {};            // pid → gameId → key → number (merged from a segment when it ends)
    this.dsi = { turn: null, turns: { red: 0, blue: 0 }, next: 'red' };
    this.adjustments = [];
    this.final = null;
    this.warnings = [];
    this._rate = {};
    this._seen = {};
    this._dirty = new Set();
    this._hostDirty = false;
    this._saveTimer = null;
    this._nextEvent = 1;
  }

  // ---------- time ----------
  // Game time stops while the host has paused; every timer in a round runs on it.
  now() { return (this.pause.at != null ? this.pause.at : this.clock()) - this.pause.total; }
  clockInfo() { return { total: this.pause.total, at: this.pause.at }; }
  paused() { return this.pause.at != null; }

  // ---------- players ----------
  activePlayers(team) {
    return Object.values(this.players)
      .filter(p => !p.removed && !p.waiting && p.team && (!team || p.team === team))
      .sort((a, b) => (a.seat || 999) - (b.seat || 999) || a.joinedAt - b.joinedAt);
  }
  teamCounts() {
    const c = { red: 0, blue: 0 };
    for (const p of this.activePlayers()) c[p.team]++;
    return c;
  }
  uniqueName(base) {
    const names = new Set(Object.values(this.players).filter(p => !p.removed).map(p => p.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) {
      const suffix = ' ' + i;
      const n = base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
      if (!names.has(n.toLowerCase())) return n;
    }
  }
  findByName(name) {
    const n = name.toLowerCase();
    return Object.values(this.players).find(p => !p.removed && p.name.toLowerCase() === n) || null;
  }
  newPlayer(name, extra = {}) {
    const p = {
      id: uuid(), name: this.uniqueName(name), team: null, seat: null, token: token(),
      joinedAt: this.clock(), online: true, lastSeen: this.wall(), waiting: false, removed: false, ...extra,
    };
    this.players[p.id] = p;
    return p;
  }
  nextSeat(team) {
    return 1 + Math.max(0, ...Object.values(this.players).filter(p => p.team === team && p.seat).map(p => p.seat));
  }
  label(p) { return p.team ? `${TEAM_NAME[p.team]}${p.seat ? ' #' + p.seat : ''}` : 'no team'; }

  // A phone asks to join with a name. Returns {player} or {pending: reqId} (after lock, a name that
  // matches someone already playing asks the host whether it's the same person on a new phone).
  join(name, reqId) {
    name = cleanName(name);
    if (!name) return { error: 'Type your name first.' };
    this.touch();
    if (this.locked) {
      const same = this.findByName(name);
      if (same && reqId) {
        this.handovers = this.handovers.filter(h => h.targetId !== same.id);
        this.handovers.push({ id: reqId, name, targetId: same.id, at: this.clock() });
        this.markHost(); this.flush();
        return { pending: reqId };
      }
      const p = this.newPlayer(name, { waiting: true });
      this.markAll(); this.saveSoon(); this.flush();
      return { player: p };
    }
    const p = this.newPlayer(name);
    this.markHost(); this.saveSoon(); this.flush();
    return { player: p };
  }

  pickTeam(pid, team) {
    const p = this.players[pid];
    if (!p || p.removed || !TEAMS.includes(team)) return { error: 'No such player or team.' };
    if (this.locked) return { error: 'Teams are locked. Ask the host to move you.' };
    p.team = team;
    this.markPlayer(pid); this.markHost(); this.saveSoon(); this.flush();
    return { ok: true };
  }

  hello(pid, tok) {
    const p = this.players[pid];
    if (!p || p.token !== tok) return null;
    if (p.removed) return p;
    this.heartbeat(pid);
    this.markPlayer(pid); this.flush();
    return p;
  }

  heartbeat(pid) {
    const p = this.players[pid];
    if (!p || p.removed) return;
    p.lastSeen = this.wall();
    this.touch();
    if (!p.online) {
      p.online = true;
      this.markHost();
      const seg = this.current && this.current.seg;
      if (seg && seg.inst && this.phase === 'live' && seg.ids.has(pid)) this.safe(() => seg.inst.onPlayerOnline && seg.inst.onPlayerOnline(pid));
      this.markPlayer(pid);
      this.flush();
    }
  }

  setOffline(p) {
    if (!p.online) return;
    p.online = false;
    this.markHost();
    const seg = this.current && this.current.seg;
    if (seg && seg.inst && this.phase === 'live' && seg.ids.has(p.id)) this.safe(() => seg.inst.onPlayerOffline && seg.inst.onPlayerOffline(p.id));
  }

  // ---------- game actions from phones ----------
  action(pid, a) {
    const p = this.players[pid];
    if (!p || p.removed || !a || typeof a !== 'object') return;
    this.heartbeat(pid);
    // spam guard: at most 5 game actions a second
    const t = this.wall();
    const rate = (this._rate[pid] = (this._rate[pid] || []).filter(x => t - x < 1000));
    if (rate.length >= MAX_ACTIONS_PER_SEC) return;
    rate.push(t);
    // a double tap or resend carries the same actionId and counts once
    if (a.actionId) {
      const seen = (this._seen[pid] = this._seen[pid] || []);
      if (seen.includes(a.actionId)) return;
      seen.push(a.actionId); if (seen.length > 100) seen.shift();
    }
    const seg = this.current && this.current.seg;
    if (this.phase !== 'live' || !seg || !seg.inst || this.paused()) return;
    if (!seg.ids.has(pid)) return;
    if (seg.endsAt != null && this.now() > seg.endsAt + GRACE_MS) return;
    this.safe(() => seg.inst.onAction(pid, a));
    this.flush();
  }

  // ---------- the event log ----------
  // Scores are always the sum of events, never a separate counter.
  award(team, playerIds, type, points, detail, extra = {}) {
    const seg = this.current && this.current.seg;
    const e = {
      id: this._nextEvent++, t: this.clock(), segId: seg ? seg.segId : (extra.segId || null),
      roundId: seg ? seg.roundId : (extra.roundId || null), game: seg ? seg.game : (extra.game || null),
      team, playerIds: (playerIds || []).filter(Boolean), names: (playerIds || []).map(id => this.players[id] ? this.players[id].name : '?'),
      type, points: Math.round(points || 0), detail: detail || '', practice: seg ? !!seg.practice : false,
    };
    if (extra.segId) e.segId = extra.segId;
    if (extra.game) e.game = extra.game;
    this.events.push(e);
    this.markHost();
    return e;
  }

  // ---------- host commands ----------
  hostCmd(c) {
    if (!c || typeof c !== 'object') return { error: 'Bad command' };
    this.touch();
    const fn = HOST_CMDS[c.cmd];
    if (!fn) return { error: 'Unknown command ' + c.cmd };
    let r;
    try { r = fn.call(this, c) || { ok: true }; } catch (e) { if (e.constructor !== Error) console.error(e); r = { error: String(e.message || e) }; }
    this.markHost();
    this._lastHost = 0; // host taps get an answer at once
    this.flush();
    return r;
  }

  startGame(gameId, opts = {}) {
    const mod = GAMES[gameId];
    if (!mod) throw new Error('No such game');
    if (!this.locked) throw new Error('Lock the teams first.');
    if (!['ready', 'gameover', 'dsi', 'final'].includes(this.phase)) throw new Error('Finish the current game first.');
    if (gameId === 'shout') opts = { mode: this.options.shoutMode, ...opts };
    const rounds = mod.rounds(opts);
    this.games[gameId] = { opts, status: 'playing', seeds: {} };
    // starting a game again replays it from scratch
    this.events = this.events.filter(e => e.game !== gameId || e.segId === 'manual');
    this.segments = this.segments.filter(s => s.game !== gameId);
    for (const pid in this.stats) delete this.stats[pid][gameId];
    this.current = { game: gameId, opts, rounds, idx: 0, seg: null };
    this.final = null;
    this.phase = 'intro';
    this.markAll(); this.save();
  }

  startSegment() {
    const cur = this.current;
    if (!cur) throw new Error('Pick a game first.');
    if (!['intro', 'results'].includes(this.phase)) throw new Error('A round is already running.');
    if (cur.idx >= cur.rounds.length) throw new Error('That was the last round.');
    const desc = cur.rounds[cur.idx];
    const mod = GAMES[cur.game];
    const gs = this.games[cur.game];
    const roundId = `${cur.game}-${desc.practice ? 'practice' : desc.n}`;
    const seed = gs.seeds[roundId] || (gs.seeds[roundId] = newSeed());
    const teams = desc.teams || TEAMS;
    const roster = {};
    for (const t of TEAMS) roster[t] = teams.includes(t) ? this.activePlayers(t).map(p => ({ id: p.id, name: p.name, seat: p.seat })) : [];
    const segId = roundId + (teams.length === 1 ? '-' + teams[0] : '');
    const startsAt = this.now() + COUNTDOWN_MS;
    cur.seg = {
      segId, roundId, game: cur.game, n: desc.n, label: desc.label, practice: !!desc.practice, teams, seed, roster,
      ids: new Set(TEAMS.flatMap(t => roster[t].map(p => p.id))),
      teamSize: { red: roster.red.length, blue: roster.blue.length },
      startsAt, endsAt: desc.ms ? startsAt + desc.ms : null, ms: desc.ms || null,
      inst: null, stats: {}, endReq: null, idx: cur.idx,
    };
    for (const t of teams) {
      const online = roster[t].filter(p => this.players[p.id].online).length;
      if (mod.minPlayers && online < mod.minPlayers) this.warn(`${TEAM_NAME[t]} has only ${online} online for ${mod.name}. The game still runs.`);
    }
    this.phase = 'countdown';
    this.markAll();
    this.save(); // (the running round is left out of the file, so a restart offers it again)
  }

  goLive() {
    const seg = this.current.seg;
    const mod = GAMES[seg.game];
    seg.ctx = this.makeCtx(seg, mod);
    this.phase = 'live';
    seg.inst = mod.create(seg.ctx);
    this.safe(() => seg.inst.start && seg.inst.start());
    this.markAll();
  }

  endSegment(reason) {
    const cur = this.current, seg = cur && cur.seg;
    if (!seg || !['live', 'countdown'].includes(this.phase)) return;
    if (this.paused()) { this.pause.total += this.clock() - this.pause.at; this.pause.at = null; }
    if (this.phase === 'countdown') { // ended before it began: nothing happened
      cur.seg = null;
      this.phase = cur.idx === 0 ? 'intro' : 'results';
      this.markAll();
      return;
    }
    let res = {};
    this.safe(() => { res = (seg.inst.end && seg.inst.end(reason)) || {}; });
    // merge per-player stats tracked during the segment
    if (!seg.practice) {
      for (const pid in seg.stats) {
        const g = ((this.stats[pid] = this.stats[pid] || {})[seg.game] = this.stats[pid][seg.game] || {});
        for (const k in seg.stats[pid]) {
          const s = seg.stats[pid][k];
          if (s.dir === 'add') g[k] = (g[k] || 0) + s.v;
          else if (g[k] == null || (s.dir === 'min' ? s.v < g[k] : s.v > g[k])) g[k] = s.v;
        }
      }
    }
    const mod = GAMES[seg.game];
    const result = {
      segId: seg.segId, roundId: seg.roundId, game: seg.game, n: seg.n, label: seg.label, practice: seg.practice,
      teams: seg.teams, teamSize: seg.teamSize, seed: seg.seed, endedBy: reason || 'time',
      startedAt: seg.startsAt, endedAt: this.now(),
      lines: res.lines || {}, stats: res.stats || {}, tiebreak: res.tiebreak || null, fun: res.fun || {},
      raw: {}, score: {},
    };
    for (const t of seg.teams) {
      const raw = this.events.filter(e => e.segId === seg.segId && e.team === t).reduce((s, e) => s + e.points, 0);
      result.raw[t] = raw;
      result.score[t] = seg.practice ? 0 : (mod.normalise ? Math.round(raw * 10 / Math.max(1, seg.teamSize[t])) : raw);
    }
    this.segments.push(result);
    cur.seg = null;
    cur.idx++;
    this.phase = 'time';
    this._timeUntil = this.now() + TIME_SCREEN_MS;
    if (cur.idx >= cur.rounds.length) this.games[cur.game].status = 'done';
    this.markAll();
    this.save();
  }

  // Pushes the room forward on its own: countdown → live, the buzzer, offline players, "Time!" → results.
  tick() {
    const now = this.now();
    for (const p of Object.values(this.players)) {
      if (p.online && !p.removed && this.wall() - p.lastSeen > HB_OFFLINE_MS) this.setOffline(p);
    }
    const seg = this.current && this.current.seg;
    if (!this.paused()) {
      if (this.phase === 'countdown' && now >= seg.startsAt) this.goLive();
      else if (this.phase === 'live') {
        this.safe(() => seg.inst.onTick && seg.inst.onTick(now));
        if (seg.endReq) this.endSegment(seg.endReq);
        else if (seg.endsAt != null && now >= seg.endsAt + GRACE_MS) this.endSegment('time');
      } else if (this.phase === 'time' && now >= this._timeUntil) {
        this.phase = this.current.idx >= this.current.rounds.length ? 'gameover' : 'results';
        if (this.phase === 'gameover') this.save();
        this.markAll();
      }
    }
    if (this.dsi.turn && !this.dsi.turn.over && now >= this.dsi.turn.endsAt) { this.dsi.turn.over = true; this.markAll(); }
    this.flush();
  }

  // ---------- what a game sees ----------
  makeCtx(seg, mod) {
    const room = this;
    const teamOf = {};
    for (const t of TEAMS) for (const p of seg.roster[t]) teamOf[p.id] = t;
    const stat = (pid, key, v, dir) => {
      if (seg.practice) return;
      const s = (seg.stats[pid] = seg.stats[pid] || {});
      const cur = s[key];
      if (!cur) s[key] = { v, dir };
      else if (dir === 'add') cur.v += v;
      else if (dir === 'min' ? v < cur.v : v > cur.v) cur.v = v;
    };
    return {
      code: room.code, game: seg.game, roundId: seg.roundId, segId: seg.segId, n: seg.n, label: seg.label,
      practice: seg.practice, opts: room.current.opts, seed: seg.seed, teamsPlaying: seg.teams.slice(),
      roundIndex: seg.idx,
      // teams: {red: [{id, name, seat}], blue: [...]}, sorted by seat; empty for a team not playing this segment
      teams: { red: seg.roster.red.slice(), blue: seg.roster.blue.slice() },
      teamOf: pid => teamOf[pid] || null,
      player: pid => { const p = room.players[pid]; return p ? { id: p.id, name: p.name, seat: p.seat, team: teamOf[pid] || p.team } : null; },
      rng: (label = '') => rng(seg.seed, label),
      now: () => room.now(),
      startsAt: seg.startsAt,
      endsAt: seg.endsAt,
      online: pid => { const p = room.players[pid]; return !!(p && p.online && !p.removed); },
      onlineIds: team => seg.roster[team].map(p => p.id).filter(id => room.players[id] && room.players[id].online && !room.players[id].removed),
      award: (team, pids, type, points, detail) => room.award(team, pids, type, points, detail),
      track: (pid, key, delta = 1) => stat(pid, key, delta, 'add'),
      best: (pid, key, value, dir = 'min') => stat(pid, key, value, dir),
      raw: team => room.events.filter(e => e.segId === seg.segId && e.team === team).reduce((s, e) => s + e.points, 0),
      push: pid => room.markPlayer(pid),
      pushTeam: team => seg.roster[team].forEach(p => room.markPlayer(p.id)),
      pushAll: () => room.markAll(),
      fx: (pid, data) => room.out.player(pid, 'fx', data),
      fxTeam: (team, data) => room.out.team(team, 'fx', data),
      fxAll: data => room.out.all('fx', data),
      end: reason => { seg.endReq = reason || 'done'; },
      warnHost: text => room.warn(text),
    };
  }

  // ---------- what phones see ----------
  // Every push sends a player their whole screen state; phones never keep game state of their own.
  playerState(pid) {
    const p = this.players[pid];
    if (!p) return { phase: 'gone' };
    const base = {
      room: this.code, phase: this.phase, clock: this.clockInfo(), serverNow: this.clock(),
      me: { id: p.id, name: p.name, team: p.team, seat: p.seat, waiting: p.waiting, removed: p.removed },
      locked: this.locked,
    };
    if (p.removed) return { ...base, phase: 'removed' };
    if (this.phase === 'lobby' || this.phase === 'ready' || !p.team) return base;
    const cur = this.current;
    const mod = cur && GAMES[cur.game];
    if (mod) base.game = { id: mod.id, name: mod.name, rule: mod.rule, rounds: cur.rounds.filter(r => !r.practice).length };
    if (['intro', 'countdown', 'live', 'time', 'results'].includes(this.phase) && cur) {
      const seg = cur.seg;
      const desc = seg ? cur.rounds[seg.idx] : cur.rounds[Math.min(cur.idx, cur.rounds.length - 1)];
      const nextDesc = cur.rounds[cur.idx];
      if (seg) {
        base.round = { n: seg.n, label: seg.label, practice: seg.practice, startsAt: seg.startsAt, endsAt: seg.endsAt, teams: seg.teams, segId: seg.segId };
        base.playing = seg.ids.has(pid);
        if (!base.playing) base.watching = seg.teams.includes(p.team) ? 'late' : seg.teams[0];
        if (this.phase === 'live' && base.playing) {
          try { base.view = seg.inst.view(pid); } catch (e) { console.error(e); base.view = null; }
        }
      } else if (nextDesc) {
        base.next = { n: nextDesc.n, label: nextDesc.label, practice: !!nextDesc.practice, teams: nextDesc.teams || TEAMS };
      }
      if (desc) base.roundOf = desc;
      if (this.phase === 'results' || this.phase === 'time') {
        const last = this.segments[this.segments.length - 1];
        if (last && last.game === cur.game) {
          base.last = { label: last.label, practice: last.practice, played: last.teams.includes(p.team), line: last.lines[p.team] || '', score: last.score[p.team] };
        }
        base.teamTotal = scoring.gameTotals(this, cur.game)[p.team];
      }
    }
    if (this.phase === 'gameover') {
      const ch = scoring.championship(this);
      base.gameover = { game: cur && cur.game, result: ch.games.find(g => g.id === (cur && cur.game)) || null, total: ch.total };
    }
    if (this.phase === 'dsi') base.dsi = this.dsiState();
    if (this.phase === 'final') base.final = this.final;
    return base;
  }

  dsiState() {
    const pts = { red: 0, blue: 0 };
    for (const e of this.events) if (e.game === 'dsi') pts[e.team] += e.points;
    const t = this.dsi.turn;
    return { points: pts, turn: t ? { team: t.team, endsAt: t.endsAt, over: !!t.over, n: t.n } : null, turns: this.dsi.turns, next: this.dsi.next };
  }

  hostState() {
    const cur = this.current, seg = cur && cur.seg;
    const players = Object.values(this.players).map(p => ({
      id: p.id, name: p.name, team: p.team, seat: p.seat, online: p.online, waiting: p.waiting, removed: p.removed, joinedAt: p.joinedAt,
    }));
    const st = {
      room: this.code, phase: this.phase, locked: this.locked, clock: this.clockInfo(), serverNow: this.clock(), paused: this.paused(),
      players, counts: this.teamCounts(),
      handovers: this.handovers.map(h => { const t = this.players[h.targetId]; return { id: h.id, name: h.name, target: t ? `${t.name} (${this.label(t)})` : '?' }; }),
      options: this.options,
      catalogue: GAME_ORDER.filter(id => GAMES[id]).map(id => ({
        id, name: GAMES[id].name, status: this.games[id] ? this.games[id].status : 'new',
        rounds: GAMES[id].rounds(id === 'shout' ? { mode: this.options.shoutMode } : {}).filter(r => !r.practice).length,
      })),
      championship: scoring.championship(this),
      warnings: this.warnings.slice(-5),
      eventCount: this.events.length,
      eventsTail: this.events.slice(-12).reverse(),
      dsi: this.dsiState(),
      final: this.final,
    };
    if (cur) {
      const mod = GAMES[cur.game];
      st.game = { id: cur.game, name: mod.name, rule: mod.rule, hostSays: mod.hostSays, idx: cur.idx, rounds: cur.rounds, opts: cur.opts };
      st.next = cur.rounds[cur.idx] || null;
      if (seg) {
        st.seg = { segId: seg.segId, label: seg.label, practice: seg.practice, teams: seg.teams, startsAt: seg.startsAt, endsAt: seg.endsAt, teamSize: seg.teamSize };
        st.seg.raw = { red: 0, blue: 0 };
        for (const e of this.events) if (e.segId === seg.segId) st.seg.raw[e.team] += e.points;
        if (seg.inst && seg.inst.hostView) { try { st.seg.view = seg.inst.hostView(); } catch (e) { console.error(e); } }
      }
      st.results = this.segments.filter(s => s.game === cur.game);
      st.totals = scoring.gameTotals(this, cur.game);
    }
    return st;
  }

  audit() {
    return {
      events: this.events,
      contributions: scoring.contributions(this),
      players: Object.values(this.players).map(p => ({ id: p.id, name: p.name, team: p.team, seat: p.seat, removed: p.removed })),
      segments: this.segments,
      adjustments: this.adjustments,
    };
  }

  // ---------- pushing ----------
  markPlayer(pid) { this._dirty.add(pid); this._hostDirty = true; }
  markAll() { for (const id in this.players) this._dirty.add(id); this._hostDirty = true; }
  markHost() { this._hostDirty = true; }
  flush() {
    if (this._dirty.size) {
      const ids = [...this._dirty]; this._dirty.clear();
      for (const id of ids) if (this.players[id]) this.out.player(id, 'state', this.playerState(id));
    }
    // the host page rebuilds on every push, so at most ~4 a second (tick flushes what's left)
    if (this._hostDirty && this.wall() - (this._lastHost || 0) >= 250) {
      this._hostDirty = false;
      this._lastHost = this.wall();
      this.out.host('state', this.hostState());
    }
  }

  warn(text) { this.warnings.push({ t: this.clock(), text }); if (this.warnings.length > 20) this.warnings.shift(); this.markHost(); }
  touch() { this.touched = this.clock(); }
  safe(fn) { try { fn(); } catch (e) { console.error(`[${this.code}] game error:`, e); this.warn('Game error: ' + (e.message || e)); } }

  // ---------- persistence ----------
  // Saved at the end of every round (and debounced on lobby changes). A round that is still running is
  // left out, so a restart replays it from its start.
  toJSON() {
    const cur = this.current, seg = cur && cur.seg;
    let phase = this.phase, events = this.events;
    if (seg) {
      phase = seg.idx === 0 ? 'intro' : 'results';
      events = events.filter(e => e.segId !== seg.segId);
    }
    if (phase === 'time') phase = cur && cur.idx >= cur.rounds.length ? 'gameover' : 'results';
    return {
      v: 1, code: this.code, hostToken: this.hostToken, created: this.created, touched: this.touched,
      players: Object.fromEntries(Object.entries(this.players).map(([id, p]) => [id, { ...p, online: false }])),
      locked: this.locked, events, segments: this.segments, games: this.games, options: this.options,
      phase, current: cur ? { game: cur.game, opts: cur.opts, idx: cur.idx } : null,
      stats: this.stats, dsi: { ...this.dsi, turn: null }, adjustments: this.adjustments, final: this.final, nextEvent: this._nextEvent,
    };
  }
  static fromJSON(d, opts) {
    const r = new Room(d.code, { ...opts, hostToken: d.hostToken });
    Object.assign(r, {
      created: d.created, touched: d.touched, players: d.players, locked: d.locked, events: d.events, segments: d.segments,
      games: d.games, options: d.options, phase: d.phase, stats: d.stats, dsi: d.dsi, adjustments: d.adjustments || [], final: d.final,
      _nextEvent: d.nextEvent || (d.events.length + 1),
    });
    // a restart is not anyone's fault: give everyone a fresh 10 s before they count as offline
    for (const p of Object.values(r.players)) { p.online = false; p.lastSeen = r.wall(); }
    if (d.current && GAMES[d.current.game]) {
      r.current = { game: d.current.game, opts: d.current.opts, idx: d.current.idx, rounds: GAMES[d.current.game].rounds(d.current.opts), seg: null };
    }
    if (r.phase === 'final' && !r.final) r.phase = 'ready';
    return r;
  }
  save() {
    clearTimeout(this._saveTimer); this._saveTimer = null;
    if (this.saveFn) { try { this.saveFn(this); } catch (e) { console.error('save failed', e); } }
  }
  saveSoon() {
    if (!this.saveFn || this._saveTimer) return;
    this._saveTimer = setTimeout(() => this.save(), 1000);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }
}

// Host commands. `this` is the room. Throw an Error with a readable message to refuse.
const HOST_CMDS = {
  move({ pid, team }) {
    const p = this.players[pid];
    if (!p || p.removed || !TEAMS.includes(team)) throw new Error('No such player.');
    if (p.team === team && !p.waiting) return;
    const from = p.team;
    p.team = team; p.waiting = false;
    if (this.locked) {
      p.seat = this.nextSeat(team);
      this.award(team, [pid], 'host_move', 0, `Host moved ${p.name} ${from ? 'from ' + TEAM_NAME[from] + ' ' : ''}to ${TEAM_NAME[team]} #${p.seat}`, { segId: 'lobby' });
    }
    this.markPlayer(pid); this.saveSoon();
  },
  assign({ pid, team }) { return HOST_CMDS.move.call(this, { pid, team }); },
  remove({ pid }) {
    const p = this.players[pid];
    if (!p) throw new Error('No such player.');
    this.setOffline(p);
    p.removed = true;
    if (this.locked) this.award(p.team, [pid], 'host_remove', 0, `Host removed ${p.name}`, { segId: 'lobby' });
    this.out.player(pid, 'state', this.playerState(pid));
    this.saveSoon();
  },
  lock() {
    if (this.locked) return;
    const unteamed = Object.values(this.players).filter(p => !p.removed && !p.team);
    for (const p of unteamed) p.waiting = true; // joined but never picked: the host can place them
    this.locked = true;
    for (const t of TEAMS) this.activePlayers(t).forEach((p, i) => { p.seat = i + 1; });
    this.phase = 'ready';
    this.markAll(); this.save();
  },
  handover({ id, yes }) {
    const h = this.handovers.find(x => x.id === id);
    if (!h) return;
    this.handovers = this.handovers.filter(x => x !== h);
    const target = this.players[h.targetId];
    if (yes && target && !target.removed) {
      target.token = token();
      this.out.kick(target.id);
      this.award(target.team, [target.id], 'host_handover', 0, `${target.name} moved to a new phone`, { segId: 'lobby' });
      this.out.req(h.id, 'joined', { room: this.code, playerId: target.id, token: target.token });
    } else {
      const p = this.newPlayer(h.name, { waiting: true });
      this.out.req(h.id, 'joined', { room: this.code, playerId: p.id, token: p.token });
      this.markAll();
    }
    this.saveSoon();
  },
  option({ shoutMode }) {
    if (shoutMode && ['simultaneous', 'turn'].includes(shoutMode)) this.options.shoutMode = shoutMode;
  },
  game({ game, opts }) { this.startGame(game, opts || {}); },
  start() { this.startSegment(); },
  pause() {
    if (!['countdown', 'live'].includes(this.phase) || this.paused()) return;
    this.pause.at = this.clock();
    this.markAll();
  },
  resume() {
    if (!this.paused()) return;
    this.pause.total += this.clock() - this.pause.at;
    this.pause.at = null;
    this.markAll();
  },
  endRound() { this.endSegment('host'); },
  endGame() {
    // stop this game after the rounds played so far
    const cur = this.current;
    if (!cur) return;
    if (['countdown', 'live'].includes(this.phase)) this.endSegment('host');
    cur.idx = cur.rounds.length;
    this.games[cur.game].status = 'done';
    this.phase = this.phase === 'time' ? 'time' : 'gameover';
    this.markAll(); this.save();
  },
  replayRound() {
    // the server restarted or something went wrong: run the last finished round again
    const cur = this.current;
    if (!cur || !['results', 'gameover'].includes(this.phase)) throw new Error('Nothing to replay.');
    const last = this.segments[this.segments.length - 1];
    if (!last || last.game !== cur.game) throw new Error('Nothing to replay.');
    this.segments.pop();
    this.events = this.events.filter(e => e.segId !== last.segId);
    cur.idx = cur.rounds.findIndex((r, i) => i >= 0 && `${cur.game}-${r.practice ? 'practice' : r.n}` === last.roundId && (r.teams || TEAMS).join() === last.teams.join());
    if (cur.idx < 0) cur.idx = 0;
    this.games[cur.game].status = 'playing';
    this.phase = cur.idx === 0 ? 'intro' : 'results';
    this.markAll(); this.save();
  },
  gameCmd(c) {
    const seg = this.current && this.current.seg;
    if (!seg || !seg.inst || !seg.inst.onHostCommand) throw new Error('No round running.');
    seg.inst.onHostCommand(c.data || {});
  },
  adjust({ team, points, reason }) {
    points = Math.round(Number(points));
    if (!TEAMS.includes(team) || !points) throw new Error('Pick a team and a number of points.');
    if (!reason || !String(reason).trim()) throw new Error('A manual adjustment needs a reason.');
    const e = this.award(team, [], 'manual', points, String(reason).trim().slice(0, 140), { segId: 'manual', game: 'manual' });
    this.adjustments.push(e.id);
    this.save();
  },
  toReady() {
    if (['countdown', 'live'].includes(this.phase)) throw new Error('A round is running.');
    this.phase = 'ready';
    this.markAll();
  },
  dsi() {
    if (['countdown', 'live'].includes(this.phase)) throw new Error('A round is running.');
    this.phase = 'dsi';
    this.markAll();
  },
  dsiStart({ team }) {
    if (this.phase !== 'dsi') throw new Error('Open Don\'t Say It first.');
    team = TEAMS.includes(team) ? team : this.dsi.next;
    this.dsi.turns[team]++;
    this.dsi.turn = { team, endsAt: this.now() + 60000, n: this.dsi.turns[team] };
    this.dsi.next = team === 'red' ? 'blue' : 'red';
    this.markAll();
  },
  dsiStop() { if (this.dsi.turn) { this.dsi.turn.over = true; this.markAll(); } },
  dsiPoint({ team, delta }) {
    if (!TEAMS.includes(team) || ![1, -1].includes(delta)) throw new Error('Bad point.');
    const t = this.dsi.turn;
    this.award(team, [], delta > 0 ? 'dsi_correct' : 'dsi_slip', delta,
      delta > 0 ? 'Correct guess' : 'Slip: said the word, a banned word or gestured', { segId: 'dsi', game: 'dsi' });
    if (t && t.team !== team && delta > 0) { /* points can go to either team; nothing else to do */ }
    this.markAll(); this.saveSoon();
  },
  dsiUndo() {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].game === 'dsi') {
      const e = this.events[i];
      this.award(e.team, [], 'dsi_undo', -e.points, `Undo: ${e.detail}`, { segId: 'dsi', game: 'dsi' });
      break;
    }
    this.markAll();
  },
  final() {
    if (['countdown', 'live'].includes(this.phase)) throw new Error('A round is running.');
    this.final = scoring.finalResults(this);
    this.phase = 'final';
    this.markAll(); this.save();
  },
};

function nullTransport() {
  const noop = () => {};
  return { player: noop, team: noop, all: noop, host: noop, kick: noop, req: noop };
}

module.exports = { Room, registerGame, GAMES, GAME_ORDER, TEAMS, TEAM_NAME, makeCode, cleanName, HB_OFFLINE_MS, GRACE_MS, COUNTDOWN_MS, TIME_SCREEN_MS };
