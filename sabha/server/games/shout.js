'use strict';
// Game 2: Shout It Out. Every phone has 4 buttons and one instruction; the instruction always names a
// button on a teammate's phone, so the team shouts across the room and the holder presses it in time.
//
// Per team: buttons are dealt by position in seat order from one shuffled list of the 144 names, made
// from the round seed, so both teams get the same names, the same timers and the same twist moment.
// Which instruction lands on which phone depends on who is free (a per-team generator from the seed).

const COLOURS = [
  { key: 'golden', name: 'GOLDEN', bg: '#f2b631', fg: '#2a1d00' },
  { key: 'green', name: 'GREEN', bg: '#1f8f4a', fg: '#ffffff' },
  { key: 'purple', name: 'PURPLE', bg: '#6f3fb0', fg: '#ffffff' },
  { key: 'pink', name: 'PINK', bg: '#f06bb0', fg: '#2b0a1c' },
  { key: 'orange', name: 'ORANGE', bg: '#f07a1a', fg: '#2a1200' },
  { key: 'silver', name: 'SILVER', bg: '#c3c9d2', fg: '#1d2433' },
  { key: 'black', name: 'BLACK', bg: '#222222', fg: '#ffffff' },
  { key: 'white', name: 'WHITE', bg: '#ffffff', fg: '#1d2433' },
  { key: 'brown', name: 'BROWN', bg: '#7a4a26', fg: '#ffffff' },
  { key: 'sky', name: 'SKY', bg: '#4fc3f7', fg: '#05283a' },
  { key: 'maroon', name: 'MAROON', bg: '#7d1a2c', fg: '#ffffff' },
  { key: 'teal', name: 'TEAL', bg: '#138a8a', fg: '#ffffff' },
];
const OBJECTS = ['DRUM', 'MANGO', 'DIYA', 'KITE', 'ROCKET', 'TIGER', 'BELL', 'LOTUS', 'LADOO', 'BUS', 'STAR', 'BAT'];
const ALL_NAMES = [];
for (let c = 0; c < COLOURS.length; c++) for (let o = 0; o < OBJECTS.length; o++) ALL_NAMES.push({ c, o });

const PER_PHONE = 4;
const HALF = 72;                 // first set of names from [0, 72), renamed set from [72, 144): up to 18 players
const GRACE_MS = 300;
const WRONG_LOCK_MS = 3000;      // a wrong press greys that phone's buttons for 3 s, so mashing loses points
const NEXT_AFTER_HIT = 1000;     // instructor gets a new instruction 1 s after a success
const NEXT_AFTER_TIMEOUT = 700;  // long enough for the red flash to be seen
const TWIST_AT = 120000;         // 2:00: "Controls changed!"
const TEAM_NAME = { red: 'Red', blue: 'Blue' };

function timerFor(elapsed) {
  if (elapsed < 60000) return 12000;
  if (elapsed < 120000) return 9000;
  return 7000;
}

function label(n) { return `${COLOURS[n.c].name} ${OBJECTS[n.o]}`; }

module.exports = {
  id: 'shout',
  name: 'Shout It Out',
  rule: 'Your phone tells you what to press, but the button is on someone else\'s phone. Shout!',
  hostSays: '"Your phone tells you what to press, but the button is on someone else\'s phone. Shout it! Don\'t press random buttons, that loses points."',
  championship: true,
  normalise: true,
  minPlayers: 4,
  COLOURS, OBJECTS, timerFor,

  rounds(opts = {}) {
    const practice = { practice: true, n: 0, label: 'Practice', ms: 30000 };
    if (opts.mode === 'turn') {
      const out = [practice];
      for (const n of [1, 2]) for (const t of ['red', 'blue']) out.push({ n, label: `Round ${n}`, ms: 180000, teams: [t] });
      return out;
    }
    return [practice, { n: 1, label: 'Round 1', ms: 180000 }, { n: 2, label: 'Round 2', ms: 180000 }];
  },

  create(ctx) {
    const order = ctx.rng('names').shuffle(ALL_NAMES);
    const T = {};       // team → state
    const where = {};   // pid → team
    let renamedAt = null;

    for (const team of ctx.teamsPlaying) {
      const roster = ctx.teams[team];
      const st = {
        team, rng: ctx.rng('targets'), // same seed for both teams: same choices while the teams look alike
        ids: roster.map(p => p.id),
        buttons: {},      // pid → [{id, n}]
        owner: {},        // buttonId → pid
        instr: {},        // instructor pid → {id, button, holder, issuedAt, deadline, timer}
        nextAt: {},       // instructor pid → game time they may get the next one
        last: {},         // instructor pid → last button asked for (avoid asking twice running)
        lockUntil: {},    // holder pid → game time their buttons work again after a wrong press
        hits: 0, timeouts: 0, wrong: 0, seq: 0,
      };
      roster.forEach((p, i) => {
        where[p.id] = team;
        st.buttons[p.id] = [];
        for (let k = 0; k < PER_PHONE; k++) {
          const id = `b${i * PER_PHONE + k}`;
          st.buttons[p.id].push({ id, n: order[(i * PER_PHONE + k) % HALF] });
          st.owner[id] = p.id;
          // more than 18 players (never at a sabha) wraps the list; names stay unique per team up to 18
        }
      });
      T[team] = st;
    }

    const elapsed = () => ctx.now() - ctx.startsAt;
    const btn = (st, id) => { const pid = st.owner[id]; return pid ? st.buttons[pid].find(b => b.id === id) : null; };

    function targeted(st) { const s = new Set(); for (const pid in st.instr) s.add(st.instr[pid].button); return s; }

    // give an instructor a new instruction, naming a free button on an online teammate's phone
    function issue(st, pid, now) {
      if (!ctx.online(pid)) return false;
      const taken = targeted(st);
      let cands = [];
      for (const other of st.ids) {
        if (other === pid || !ctx.online(other)) continue;
        for (const b of st.buttons[other]) if (!taken.has(b.id)) cands.push(b.id);
      }
      if (!cands.length) return false;
      if (cands.length > 1 && st.last[pid]) cands = cands.filter(id => id !== st.last[pid]);
      const button = st.rng.pick(cands);
      const timer = ctx.practice ? 12000 : timerFor(now - ctx.startsAt);
      st.instr[pid] = { id: ++st.seq, button, holder: st.owner[button], issuedAt: now, deadline: now + timer, timer };
      st.last[pid] = button;
      delete st.nextAt[pid];
      ctx.push(pid);
      return true;
    }

    function fill(st, now) {
      for (const pid of st.ids) {
        if (st.instr[pid] || !ctx.online(pid)) continue;
        if (st.nextAt[pid] != null && now < st.nextAt[pid]) continue;
        issue(st, pid, now);
      }
    }

    // drop instructions that can no longer be done and re-issue (no penalty)
    function reroute(st, now, predicate) {
      for (const pid of Object.keys(st.instr)) {
        if (predicate(st.instr[pid], pid)) { delete st.instr[pid]; delete st.nextAt[pid]; ctx.push(pid); }
      }
      fill(st, now);
    }

    function rename(now) {
      renamedAt = now;
      for (const team in T) {
        const st = T[team];
        st.ids.forEach((pid, i) => {
          st.buttons[pid].forEach((b, k) => { b.n = order[HALF + ((i * PER_PHONE + k) % HALF)]; });
        });
        // every active instruction is re-issued for the new names, on the new (shortest) timer
        for (const pid of Object.keys(st.instr)) { delete st.instr[pid]; delete st.nextAt[pid]; }
        st.last = {};
        fill(st, now);
        ctx.pushTeam(team);
        ctx.fxTeam(team, { game: 'shout', type: 'controls' });
      }
    }

    function view(pid) {
      const team = where[pid];
      const st = T[team];
      if (!st) return null;
      const i = st.instr[pid];
      return {
        hits: st.hits,
        buttons: st.buttons[pid].map(b => ({ id: b.id, label: label(b.n), colour: COLOURS[b.n.c].key, bg: COLOURS[b.n.c].bg, fg: COLOURS[b.n.c].fg, word1: COLOURS[b.n.c].name, word2: OBJECTS[b.n.o] })),
        instr: i ? { id: i.id, text: label(btn(st, i.button).n), deadline: i.deadline, timer: i.timer, issuedAt: i.issuedAt } : null,
        waiting: !i && (st.nextAt[pid] == null || ctx.now() >= st.nextAt[pid]),
        renamedAt,
        lockUntil: st.lockUntil[pid] || 0,
        practice: !!ctx.practice,
      };
    }

    return {
      start() {
        const now = ctx.now();
        for (const team in T) fill(T[team], now);
        ctx.pushAll();
      },

      onAction(pid, a) {
        if (!a || a.type !== 'press') return;
        const team = where[pid], st = T[team];
        if (!st) return;
        const mine = st.buttons[pid].find(b => b.id === a.button);
        if (!mine) return; // not one of this phone's buttons: ignore (stale tap or forged)
        const now = ctx.now();
        if (st.lockUntil[pid] && now < st.lockUntil[pid]) return; // locked after a wrong press
        let hitBy = null;
        for (const ip in st.instr) {
          const ins = st.instr[ip];
          if (ins.button === mine.id && now <= ins.deadline + GRACE_MS) { hitBy = ip; break; }
        }
        if (!hitBy) {
          st.wrong++;
          ctx.award(team, [pid], 'wrong_press', -2, `pressed ${label(mine.n)}: nobody asked for it`);
          ctx.track(pid, 'wrongPresses');
          st.lockUntil[pid] = now + WRONG_LOCK_MS;
          ctx.push(pid);
          ctx.fx(pid, { kind: 'bad' });
          ctx.fx(pid, { game: 'shout', type: 'tileBad', button: mine.id });
          return;
        }
        const ins = st.instr[hitBy];
        const left = Math.max(0, ins.deadline - now);
        const bonus = Math.min(5, Math.max(1, Math.ceil(5 * left / ins.timer)));
        delete st.instr[hitBy];
        st.nextAt[hitBy] = now + NEXT_AFTER_HIT;
        st.hits++;
        const secs = ((now - ins.issuedAt) / 1000).toFixed(1);
        ctx.award(team, [hitBy, pid], 'instruction_done', 10 + bonus, `${label(mine.n)} in ${secs}s (+${bonus} speed)`);
        ctx.track(pid, 'pressed');
        ctx.track(hitBy, 'shouted');
        ctx.fx(hitBy, { kind: 'good' });
        ctx.fx(pid, { game: 'shout', type: 'tileGood', button: mine.id });
        ctx.pushTeam(team);
      },

      onTick(now) {
        if (!ctx.practice && renamedAt == null && now - ctx.startsAt >= TWIST_AT && (ctx.endsAt == null || ctx.endsAt - ctx.startsAt > TWIST_AT)) rename(now);
        for (const team in T) {
          const st = T[team];
          for (const pid of Object.keys(st.instr)) {
            const ins = st.instr[pid];
            if (now > ins.deadline + GRACE_MS) {
              delete st.instr[pid];
              st.timeouts++;
              st.nextAt[pid] = now + NEXT_AFTER_TIMEOUT;
              ctx.track(pid, 'timeouts');
              ctx.fx(pid, { game: 'shout', type: 'timeout' });
              ctx.push(pid);
            }
          }
          fill(st, now); // issue() pushes each phone that gets a new instruction
        }
      },

      onPlayerOffline(pid) {
        const team = where[pid], st = T[team];
        if (!st) return;
        const now = ctx.now();
        // their own instruction is cancelled; any instruction naming their buttons is swapped
        delete st.instr[pid]; delete st.nextAt[pid];
        reroute(st, now, ins => ins.holder === pid);
        ctx.pushTeam(team);
      },

      onPlayerOnline(pid) {
        const team = where[pid], st = T[team];
        if (!st) return;
        const now = ctx.now();
        delete st.nextAt[pid];
        fill(st, now); // they get a new instruction, and teammates who were waiting can now name their buttons
        ctx.pushTeam(team);
      },

      view,

      hostView() {
        const el = elapsed();
        const lines = [];
        for (const team in T) {
          const st = T[team];
          const online = st.ids.filter(id => ctx.online(id)).length;
          lines.push(`${TEAM_NAME[team]}: ${st.hits} hits · ${st.timeouts} timed out · ${st.wrong} wrong presses · ${online}/${st.ids.length} online`);
        }
        lines.push(ctx.practice ? 'Practice: 12 s per instruction, no points.' : `Instruction timer now ${timerFor(el) / 1000} s${renamedAt != null ? ' · controls changed at 2:00' : ' · controls change at 2:00'}`);
        return { lines };
      },

      end() {
        const lines = {}, stats = {};
        for (const team in T) {
          const st = T[team];
          lines[team] = `${TEAM_NAME[team]} hit ${st.hits} instruction${st.hits === 1 ? '' : 's'}`;
          stats[team] = { hits: st.hits, timeouts: st.timeouts, wrong: st.wrong };
        }
        return { lines, stats };
      },

      // for tests
      _state: T,
    };
  },

  // Bot phones for the crash test: press one of their own buttons now and then, at random.
  bot(view, rng) {
    if (!view || !view.buttons || !view.buttons.length) return null;
    if (!rng.chance(0.35)) return null;
    return { type: 'press', button: rng.pick(view.buttons).id };
  },
};
