'use strict';
// Game 3: Maths Chain. Both teams race through the same chain of maths steps, one step per player in
// seat order. Each player hears the number from the player before them, applies their step, types the
// answer and shouts it on. A wrong answer can't break the chain; it only costs time.
//
// State per team: `owner[i]` is the player doing step i (normally chain order; a step passes on when
// its owner is offline for 15 s or the host taps Skip seat). A "turn" is the run of consecutive steps
// from `pos` with the same owner (two when someone does a passed-on step plus their own), answered with
// one number: the value after the last of them.

const TEAM_NAME = { red: 'Red', blue: 'Blue' };
const CAP_MS = 240000;
const LOCK_MS = 3000;
const HINT_AFTER = 3;
const HINT_PENALTY_MS = 10000;
const OFFLINE_PASS_MS = 15000;
const MAX_L = 12;
const START_OFFSET = [0, 3, 7]; // round 1 starts at seat 1, round 2 at seat 4, round 3 at seat 8

// ---------- the step generator ----------
const LEVELS = {
  1: { start: [2, 10], max: 100, add: 12, mul: [2, 6], div: [2, 5], words: false, r3: false },
  2: { start: [10, 30], max: 200, add: 25, mul: [2, 9], div: [2, 3, 4, 5, 6, 7, 8, 9, 10], words: true, r3: false },
  3: { start: [20, 50], max: 200, add: 25, mul: [2, 9], div: [2, 3, 4, 5, 6, 7, 8, 9, 10], words: true, r3: true },
};

function applyStep(v, s) {
  switch (s.op) {
    case '+': return v + s.n;
    case '-': return v - s.n;
    case '*': return v * s.n;
    case '/': return v / s.n;
    case 'double': return v * 2;
    case 'half': return v / 2;
    case 'digits': return String(v).split('').reduce((a, d) => a + Number(d), 0);
    case 'square': return v * v;
  }
  return NaN;
}

function stepText(s) {
  switch (s.op) {
    case '+': return `+ ${s.n}`;
    case '-': return `− ${s.n}`;
    case '*': return `× ${s.n}`;
    case '/': return `÷ ${s.n}`;
    case 'double': return 'Double it';
    case 'half': return 'Half it';
    case 'digits': return 'Add the digits';
    case 'square': return 'Square it';
  }
  return '?';
}

// One candidate step for value v, drawn from the round's allowed steps (may not fit; caller re-picks).
function candidate(r, lv, v) {
  const kinds = ['add', 'add', 'sub', 'sub', 'mul', 'div'];
  if (lv.words) kinds.push('double', 'half');
  if (lv.r3) kinds.push('digits', 'square');
  const k = r.pick(kinds);
  switch (k) {
    case 'add': return { op: '+', n: r.int(1, lv.add) };
    case 'sub': return { op: '-', n: r.int(1, lv.add) };
    case 'mul': return { op: '*', n: r.int(lv.mul[0], lv.mul[1]) };
    case 'div': return { op: '/', n: r.pick(lv.div) };
    default: return { op: k };
  }
}

// A step fits if the result is a whole number from 1 to the cap and actually changes the number.
function fits(v, s, lv) {
  const x = applyStep(v, s);
  if (!Number.isInteger(x) || x < 1 || x > lv.max || x === v) return false;
  if (s.op === 'square' && x > 200) return false;
  if (s.op === 'digits' && v < 10) return false;
  return true;
}

// generateChain(rng, round, L) → {start, steps: [{op, n?, text}], values: [start, v1, …, vL]}
function generateChain(r, round, L) {
  const lv = LEVELS[Math.min(3, Math.max(1, round))] || LEVELS[1];
  const start = r.int(lv.start[0], lv.start[1]);
  const steps = [], values = [start];
  let v = start, prevOp = null;
  for (let i = 0; i < L; i++) {
    let s = null;
    for (let tries = 0; tries < 500 && !s; tries++) {
      const c = candidate(r, lv, v);
      if (!fits(v, c, lv)) continue;
      // keep it varied: no two "word" steps or two divisions in a row
      if (prevOp && c.op === prevOp && ['/', 'double', 'half', 'digits', 'square', '*'].includes(c.op)) continue;
      s = c;
    }
    if (!s) s = v > 1 ? { op: '-', n: 1 } : { op: '+', n: 1 }; // never reached in practice; always valid
    s.text = stepText(s);
    v = applyStep(v, s);
    steps.push(s); values.push(v);
    prevOp = s.op;
  }
  return { start, steps, values };
}

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = {
  id: 'maths',
  name: 'Maths Chain',
  rule: 'Do your step, type your answer, shout it to the next person.',
  hostSays: '"When your phone buzzes, listen for the number from the person before you, do your step, type it, shout it to the next person. First team to the end wins."',
  championship: true,
  normalise: false,
  minPlayers: 2,
  rounds: () => [1, 2, 3].map(n => ({ n, label: `Round ${n}`, ms: CAP_MS })),
  generateChain, applyStep, stepText,

  create(ctx) {
    const round = ctx.n || 1;
    const onlineCount = t => ctx.onlineIds(t).length;
    const counts = { red: onlineCount('red'), blue: onlineCount('blue') };
    const nonzero = ['red', 'blue'].map(t => counts[t]).filter(c => c > 0);
    const L = Math.max(1, Math.min(MAX_L, nonzero.length ? Math.min(...nonzero) : 1));
    const chain = generateChain(ctx.rng('chain'), round, L);
    const offlineSince = {};
    const T = {};
    let finishCount = 0;

    for (const team of ['red', 'blue']) {
      const online = ctx.teams[team].filter(p => ctx.online(p.id)); // sorted by seat
      const off = online.length ? START_OFFSET[(round - 1) % 3] % online.length : 0;
      const order = online.slice(off).concat(online.slice(0, off));
      const players = order.slice(0, L).map(p => p.id);
      T[team] = {
        team, players, checkers: order.slice(L).map(p => p.id),
        owner: players.slice(), // owner[i] = pid doing step i
        pos: 0, turnStart: ctx.startsAt, wrong: 0, lockUntil: 0, hintUsed: false, hints: 0, wrongTotal: 0,
        penalty: 0, doneAt: null, finishOrder: null, answers: {}, // pid → {value, end (last step index)}
        passedFrom: {}, // step index → name of the player who had it
        log: [], // per step done: {i, pid, ms}
      };
    }

    const name = pid => { const p = ctx.player(pid); return p ? p.name : '?'; };
    const seat = pid => { const p = ctx.player(pid); return p ? p.seat : null; };
    const who = pid => (pid ? { name: name(pid), seat: seat(pid) } : null);
    const teamOfPid = pid => ctx.teamOf(pid);
    const turnEnd = t => { let e = t.pos; while (e + 1 < L && t.owner[e + 1] === t.owner[t.pos]) e++; return e; };
    const teamTime = t => (t.doneAt != null ? t.doneAt - ctx.startsAt + t.penalty : null);

    function newTurn(t, now) { t.turnStart = now; t.wrong = 0; t.lockUntil = 0; t.hintUsed = false; }

    // Hand the current step to the next online player in chain order (then checkers).
    function passOn(t, now, reason) {
      if (t.doneAt != null || !t.players.length) return false;
      const cur = t.owner[t.pos];
      const cands = [];
      for (let j = t.pos + 1; j < L; j++) if (!cands.includes(t.owner[j])) cands.push(t.owner[j]);
      for (const p of t.players) if (!cands.includes(p)) cands.push(p);
      for (const p of t.checkers) if (!cands.includes(p)) cands.push(p);
      const next = cands.find(p => p !== cur && ctx.online(p));
      if (!next) return false;
      const end = turnEnd(t);
      for (let j = t.pos; j <= end; j++) { t.passedFrom[j] = t.passedFrom[j] || name(t.owner[j]); t.owner[j] = next; }
      ctx.award(t.team, [cur, next], 'step_passed', 0, `${name(cur)}'s step passed to ${name(next)} (${reason})`);
      newTurn(t, now);
      ctx.pushTeam(t.team);
      ctx.fx(next, { game: 'maths', kind: 'turn' });
      return true;
    }

    function finishTeam(t, now) {
      t.doneAt = now;
      t.finishOrder = ++finishCount;
      ctx.pushAll();
      ctx.fxTeam(t.team, { game: 'maths', kind: 'finished' });
      if (['red', 'blue'].every(x => T[x].doneAt != null || !T[x].players.length)) ctx.end('done');
    }

    function answer(pid, t, value, now) {
      if (t.doneAt != null || t.owner[t.pos] !== pid) return;
      if (now < t.lockUntil) return;
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      const end = turnEnd(t);
      const expected = chain.values[end + 1];
      if (v === expected) {
        const ms = now - t.turnStart;
        if (end === t.pos && !t.passedFrom[t.pos]) ctx.best(pid, 'fastestStep', ms, 'min');
        t.answers[pid] = { value: expected, end };
        for (let i = t.pos; i <= end; i++) t.log.push({ i, pid, ms });
        const stepsDone = chain.steps.slice(t.pos, end + 1).map(s => s.text).join(', then ');
        ctx.award(t.team, [pid], 'step_done', 0, `step ${end + 1}/${L}: ${chain.values[t.pos]} ${stepsDone} = ${expected} in ${(ms / 1000).toFixed(1)} s`);
        ctx.fx(pid, { kind: 'good' });
        t.pos = end + 1;
        newTurn(t, now);
        if (t.pos >= L) finishTeam(t, now);
        else { ctx.fx(t.owner[t.pos], { game: 'maths', kind: 'turn' }); ctx.pushTeam(t.team); }
      } else {
        t.wrong++; t.wrongTotal++;
        t.lockUntil = now + LOCK_MS;
        ctx.track(pid, 'wrong');
        ctx.fx(pid, { kind: 'bad' });
        ctx.push(pid);
        ctx.pushTeam(t.team); // checkers see the attempt count
      }
    }

    function hint(pid, t, now) {
      if (t.doneAt != null || t.owner[t.pos] !== pid || t.hintUsed || t.wrong < HINT_AFTER || t.pos === 0) return;
      t.hintUsed = true; t.hints++;
      t.penalty += HINT_PENALTY_MS;
      ctx.track(pid, 'hints');
      ctx.award(t.team, [pid], 'hint_used', 0, `${name(pid)} was shown the number ${chain.values[t.pos]} (+10 s to ${TEAM_NAME[t.team]}'s time)`);
      ctx.push(pid);
      ctx.pushTeam(t.team);
    }

    function viewFor(pid) {
      const team = teamOfPid(pid);
      const t = T[team];
      if (!t) return null;
      const now = ctx.now();
      const other = T[team === 'red' ? 'blue' : 'red'];
      const base = {
        L, pos: t.pos, team, round,
        me: who(pid),
        solving: t.doneAt == null && t.players.length ? who(t.owner[t.pos]) : null,
        otherDone: other.doneAt != null ? { team: other.team } : null,
        teamDone: t.doneAt != null ? { time: teamTime(t), penalty: t.penalty } : null,
      };
      if (t.doneAt != null) return { ...base, status: 'teamDone' };
      const curOwner = t.owner[t.pos];
      if (curOwner === pid) {
        const end = turnEnd(t);
        const steps = [];
        for (let i = t.pos; i <= end; i++) steps.push({ text: chain.steps[i].text, from: t.passedFrom[i] || null });
        // a passed-on step merged with the player's own is shown "theirs first, then yours"
        return {
          ...base, status: 'turn', turnKey: `${t.pos}:${pid}:${t.turnStart}`, steps,
          start: t.pos === 0 ? chain.start : null,
          incoming: t.hintUsed ? chain.values[t.pos] : null,
          listen: t.pos > 0 ? who(t.answers && lastAnswerer(t, t.pos - 1)) : null,
          wrong: t.wrong, lockUntil: t.lockUntil > now ? t.lockUntil : 0,
          hintAvailable: t.pos > 0 && t.wrong >= HINT_AFTER && !t.hintUsed,
          next: end + 1 < L ? who(t.owner[end + 1]) : null,
        };
      }
      const future = t.owner.findIndex((o, i) => i > t.pos && o === pid);
      if (future >= 0) {
        return { ...base, status: 'waiting', myStep: future, listen: who(t.owner[future - 1]), stepsBefore: future - t.pos };
      }
      const a = t.answers[pid];
      if (a) return { ...base, status: 'done', answer: a.value, next: a.end + 1 < L ? who(t.owner[a.end + 1]) : null, last: a.end + 1 >= L };
      // checkers (and anyone not in the chain this round) watch the whole chain as it happens
      const sofar = [];
      for (let i = 0; i < t.pos; i++) sofar.push({ text: chain.steps[i].text, value: chain.values[i + 1] });
      return { ...base, status: 'checker', start: chain.start, sofar, attempts: t.wrong };
    }

    // who answered the step at index i (the player who shouted that number)
    function lastAnswerer(t, i) {
      for (let k = t.log.length - 1; k >= 0; k--) if (t.log[k].i === i) return t.log[k].pid;
      return null;
    }

    return {
      start() { ctx.pushAll(); for (const team of ['red', 'blue']) if (T[team].players.length) ctx.fx(T[team].owner[0], { game: 'maths', kind: 'turn' }); },
      onAction(pid, a) {
        const t = T[teamOfPid(pid)];
        if (!t) return;
        const now = ctx.now();
        if (a.type === 'answer') answer(pid, t, a.value, now);
        else if (a.type === 'hint') hint(pid, t, now);
      },
      onTick(now) {
        for (const team of ['red', 'blue']) {
          const t = T[team];
          if (t.doneAt != null || !t.players.length) continue;
          const cur = t.owner[t.pos];
          if (!ctx.online(cur) && offlineSince[cur] != null && now - Math.max(offlineSince[cur], t.turnStart) >= OFFLINE_PASS_MS) {
            passOn(t, now, 'offline 15 s');
          }
        }
      },
      onPlayerOffline(pid) { offlineSince[pid] = ctx.now(); const team = teamOfPid(pid); if (team) ctx.pushTeam(team); },
      onPlayerOnline(pid) { delete offlineSince[pid]; ctx.push(pid); },
      onHostCommand(d) {
        if (d && d.skip && T[d.skip]) passOn(T[d.skip], ctx.now(), 'host skipped the seat');
      },
      view: viewFor,
      hostView() {
        const lines = [`Chain of ${L} steps · start ${chain.start} · answer ${chain.values[L]}`];
        const buttons = [];
        for (const team of ['red', 'blue']) {
          const t = T[team];
          if (!t.players.length) { lines.push(`${TEAM_NAME[team]}: nobody online`); continue; }
          if (t.doneAt != null) {
            lines.push(`${TEAM_NAME[team]}: finished in ${fmt(teamTime(t))}${t.penalty ? ` (incl. ${t.penalty / 1000} s hints)` : ''}`);
            continue;
          }
          const cur = t.owner[t.pos];
          lines.push(`${TEAM_NAME[team]}: step ${t.pos + 1} of ${L} · ${name(cur)} (#${seat(cur)}) solving${ctx.online(cur) ? '' : ' · OFFLINE'}${t.wrong ? ` · ${t.wrong} wrong` : ''}${t.hints ? ` · ${t.hints} hint${t.hints > 1 ? 's' : ''}` : ''}`);
          if (t.checkers.length) lines.push(`${TEAM_NAME[team]} checkers: ${t.checkers.map(p => `${name(p)} (#${seat(p)})`).join(', ')}`);
          buttons.push({ label: `Skip ${name(cur)} (${TEAM_NAME[team]})`, cmd: { skip: team }, confirm: `Pass ${name(cur)}'s step to the next seat?` });
        }
        return { lines, buttons };
      },
      end() {
        const done = ['red', 'blue'].map(x => T[x]).filter(t => t.doneAt != null)
          .sort((a, b) => teamTime(a) - teamTime(b) || a.finishOrder - b.finishOrder);
        const lines = {}, stats = {}, tiebreak = {};
        for (const team of ['red', 'blue']) {
          const t = T[team];
          const time = teamTime(t);
          const rank = done.indexOf(t);
          let pts, line;
          const pen = t.penalty ? ` (incl. ${t.penalty / 1000} s of hints)` : '';
          if (rank === 0) {
            pts = 100; line = `${TEAM_NAME[team]} finished first in ${fmt(time)}${pen}`;
            ctx.award(team, [], 'chain_first', pts, `finished first in ${fmt(time)}${pen}`);
          } else if (rank === 1) {
            pts = Math.min(99, Math.max(40, Math.round(100 * Math.max(1, teamTime(done[0])) / Math.max(1, time))));
            line = `${TEAM_NAME[team]} finished in ${fmt(time)}${pen}`;
            ctx.award(team, [], 'chain_second', pts, `finished second in ${fmt(time)}${pen}: 100 × ${fmt(teamTime(done[0]))} ÷ ${fmt(time)}`);
          } else {
            pts = Math.round(30 * t.pos / L);
            line = `${TEAM_NAME[team]} reached step ${t.pos} of ${L}`;
            if (t.players.length || pts) ctx.award(team, [], 'chain_unfinished', pts, `${t.pos} of ${L} steps by the cap: 30 × ${t.pos} ÷ ${L}`);
          }
          lines[team] = line;
          stats[team] = { seconds: time != null ? Math.round(time / 100) / 10 : null, steps: t.pos, chainLength: L, wrongAnswers: t.wrongTotal, hints: t.hints };
          tiebreak[team] = time != null ? time : CAP_MS + t.penalty;
        }
        return { lines, stats, tiebreak };
      },
      // for tests
      _debug: { chain, T, L },
    };
  },

  // A bot phone: answers right when it knows the incoming number, otherwise guesses, and takes the hint.
  bot(view, r) {
    if (!view || view.status !== 'turn') return null;
    const known = view.start != null ? view.start : view.incoming;
    if (known != null) {
      // re-apply the shown steps (the bot can parse its own step texts back)
      let v = known;
      for (const s of view.steps) v = applyStep(v, parseStep(s.text));
      return { type: 'answer', value: r.chance(0.85) ? v : r.int(1, 200) };
    }
    if (view.hintAvailable) return { type: 'hint' };
    return { type: 'answer', value: r.int(1, 200) };
  },
};

function parseStep(text) {
  const m = text.match(/^([+−×÷]) (\d+)$/);
  if (m) return { op: { '+': '+', '−': '-', '×': '*', '÷': '/' }[m[1]], n: Number(m[2]) };
  return { op: { 'Double it': 'double', 'Half it': 'half', 'Add the digits': 'digits', 'Square it': 'square' }[text] };
}
module.exports.parseStep = parseStep;
