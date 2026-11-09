'use strict';
// ================= Otto, the bot =================
// "Play Otto" on the landing page sets up a solo table: you in the host seat, Otto in the guest seat
// ({dev:'bot', name:'Otto', bot:true}). Otto runs on this phone. Its moves are ordinary writes into
// the same append-only logs, under its own seat, so every replay function and screen works unchanged
// (and the other games' rules, stats and saving need nothing new). A solo table is its own table, so
// its score sheet and stats never mix with the one you share with your partner.
//
// Each game has a bot in its own file: `c4Bot(ctx)`, `bsBot(ctx)`, … returns { update(m), stop() }.
// The pure "what would Otto do" functions next to them are what the unit tests check.
// Easy or Hard is chosen when a game is opened and kept on the match (`match.bot`).
const BOT = { dev: 'bot', name: 'Otto', bot: true };
const BOT_LEVELS = { easy: 'Easy', hard: 'Hard' };
const botSeatOf = (t) => (t && t.guest && t.guest.bot ? 'guest' : t && t.host && t.host.bot ? 'host' : null);
const isBotTable = (t = G.table) => !!botSeatOf(t);
const botLevel = (m) => (m && m.bot === 'hard' ? 'hard' : 'easy');
const botBetween = (rng, lo, hi) => lo + (hi - lo) * rng();
const botChoice = (rng, list) => list[Math.floor(rng() * list.length)];

// Otto's game for each kind (the functions live in the game files).
const BOT_GAMES = { c4: 'c4Bot', bs: 'bsBot', hu: 'huBot', qf: 'qfBot', ww: 'wwBot', sl: 'slBot', sw: 'swBot' };

const Bot = {
  ctl: null,     // { id, game, seat, impl, timers, plans, dead }
  pres: {},      // what Otto's "finger" is on, like a partner's presence: {hover} (Connect Four, Hues), {aim} (Battleships)
  // Live.partner() at Otto's table: he's always here, on the same screen as you.
  peer() { return { id: 'bot', at: Date.now(), pres: { seat: botSeatOf(G.table), screen: (cur.name || '').split(':')[0], ...this.pres } }; },
  show(patch) {
    let changed = false;
    for (const k in patch) { if (JSON.stringify(this.pres[k]) !== JSON.stringify(patch[k])) changed = true; if (patch[k] == null) delete this.pres[k]; else this.pres[k] = patch[k]; }
    if (changed) Live.fire();
  },
  // Called after every route(): starts Otto for the current match, stops him when it's put away.
  sync() {
    const t = G.table, m = G.match, seat = botSeatOf(t);
    const want = seat && m && t.current === m.id && GAMES[m.game] ? m.id : null;
    if (this.ctl && this.ctl.id !== want) this.stop();
    if (!want) return;
    if (!this.ctl) this.ctl = this.start(m, seat);
    this.poke();
  },
  stop() {
    const c = this.ctl; if (!c) return;
    c.dead = true;
    clearInterval(c.beat);
    for (const t of c.timers) clearTimeout(t);
    c.timers.clear();
    try { c.impl && c.impl.stop && c.impl.stop(); } catch (e) { console.error(e); }
    this.ctl = null;
    this.show({ hover: null, aim: null });
  },
  // Something changed (a snapshot, the screen, the page coming back): let Otto look again.
  poke() {
    const c = this.ctl, m = G.match;
    if (!c || c.dead || !m || m.id !== c.id) return;
    try {
      if (!rpsState(m).starter) { botRPS(c.ctx, m); return; }
      if (!c.impl) c.impl = globalThis[BOT_GAMES[m.game]](c.ctx);
      c.impl.update(m);
    } catch (e) { console.error('bot', e); }
  },
  start(m, seat) {
    const c = { id: m.id, game: m.game, seat, impl: null, timers: new Set(), plans: new Map(), dead: false };
    // A heartbeat: Otto looks again every couple of seconds even when nothing new arrives, so a move
    // whose write failed (or whose timer found the match briefly out of step) is planned again.
    c.beat = setInterval(() => { if (Bot.ctl === c) Bot.poke(); }, 2000);
    const live = () => !c.dead && Bot.ctl === c && G.match && G.match.id === c.id && G.table && G.table.current === c.id;
    const later = (ms, fn) => {
      const t = setTimeout(() => { c.timers.delete(t); if (live()) fn(); }, Math.max(0, ms));
      c.timers.add(t);
      return t;
    };
    c.ctx = {
      seat, opp: other(seat), id: m.id, level: botLevel(m), hard: botLevel(m) === 'hard', rng: Math.random,
      live,
      m: () => (live() ? G.match : null),
      // You're looking at the game itself (not the how-to card or the RPS reveal) and the page is showing.
      // Otto only moves then, so he never plays while you can't see it.
      ready: () => live() && document.visibilityState === 'visible' && cur.name === 'match:' + c.id && !!G.phase && !['howto', 'rps'].includes(G.phase),
      phase: () => G.phase,
      later,
      show: (patch) => { if (live()) Bot.show(patch); },
      clear: (t) => { clearTimeout(t); c.timers.delete(t); },
      // One planned move per key: planning the same key again keeps the first timer, so a snapshot
      // that changes nothing doesn't push Otto's move back. If you're not looking when it's due,
      // it waits until you are.
      plan(key, ms, fn, { needReady = true } = {}) {
        if (c.plans.has(key)) return;
        const go = () => {
          if (needReady && !c.ctx.ready()) { c.plans.set(key, later(400, go)); return; }
          c.plans.delete(key);
          fn(G.match);
        };
        c.plans.set(key, later(ms, go));
      },
      planned: (key) => c.plans.has(key),
      unplan(key) { const t = c.plans.get(key); if (t != null) { clearTimeout(t); c.timers.delete(t); c.plans.delete(key); } },
      unplanAll() { for (const k of [...c.plans.keys()]) c.ctx.unplan(k); },
      write: (patch) => (live() ? write(matchPath(c.id), patch) : Promise.resolve(false)),
      // fn(latest match) returns the patch to write, or throws to give up
      async tx(fn) {
        if (!live()) return false;
        try {
          await Net.timed(FB.fs.runTransaction(async (tx) => {
            const ref = FB.fs.doc(matchPath(c.id)), snap = await tx.get(ref);
            if (!snap.exists) throw Error('gone');
            const patch = fn(snap.data());
            if (!patch) throw Error('nothing to do');
            tx.update(ref, patch);
          }));
          return true;
        } catch (e) { return false; }
      },
      // the RPS winner's one choice for the match (Hues rules, Quickfire setup, the wheel, the Sharp Wits game)
      choose: (field, value) => c.ctx.tx((latest) => (rpsState(latest).starter === seat && !latest[field] ? { [field]: value } : null)),
    };
    return c;
  },
};
document.addEventListener('visibilitychange', () => Bot.poke());

// Rock, paper, scissors: Otto throws at random a moment after each round opens (Easy and Hard alike:
// it's luck either way).
function botRPS(ctx, m) {
  const st = rpsState(m);
  if (!st.k || st.cur[ctx.seat]) return;
  const k = st.k;
  ctx.plan('rps' + k, botBetween(ctx.rng, 700, 1900), () => {
    const now = ctx.m(); if (!now) return;
    const s = rpsState(now);
    if (s.k !== k || s.cur[ctx.seat]) return;
    ctx.write({ rps: { ['r' + k]: { [ctx.seat]: botChoice(ctx.rng, ['rock', 'paper', 'scissors']) } } });
  }, { needReady: false });
}
