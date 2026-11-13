// Bot test: 30 fake phones (15 per team) connect over real sockets and tap randomly through every game,
// with chaos (dropped connections, double taps, a late joiner, a handover). The server runs in this
// process at SABHA_SPEED× (default 10) so a full evening takes a few minutes.
// Checks: no game errors, every phone ends on the final screen, and every score adds up from the events.
//
//   node tests/bots.mjs            (SPEED=20 node tests/bots.mjs for a quicker run)
import { createRequire } from 'module';
import { io as connect } from 'socket.io-client';
const require = createRequire(import.meta.url);

process.env.SABHA_SPEED = process.env.SPEED || process.env.SABHA_SPEED || '10';
process.env.NO_SAVE = '1';
const SPEED = Number(process.env.SABHA_SPEED);
const { start, rooms } = require('../server/index.js');
const { rng } = require('../server/rng.js');
const { GAMES } = require('../server/room.js');
const scoring = require('../server/scoring.js');

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();

const { server } = await start(0);
const URL = `http://localhost:${server.address().port}`;
const call = (s, ev, d) => new Promise(res => s.emit(ev, d, res));
const until = async (fn, ms = 60000, what = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error('timed out waiting for ' + what);
};

// ---------- host ----------
const host = connect(URL, { transports: ['websocket'] });
let hs = null;
host.on('state', s => { hs = s; });
const created = await call(host, 'host:create', null);
const CODE = created.room;
await call(host, 'host:hello', { room: CODE, hostToken: created.hostToken });
const cmd = async c => { const r = await call(host, 'host:cmd', c); if (r && r.error) throw new Error(`host ${c.cmd}: ${r.error}`); return r; };
log('room', CODE);

// ---------- bots ----------
class Bot {
  constructor(i, team) {
    this.i = i; this.team = team; this.name = `Bot${i}`; this.state = null; this.r = rng('bot', String(i));
    this.acts = 0; this.dup = 0; this.paused = false;
  }
  async connect() {
    this.s = connect(URL, { transports: ['websocket'], forceNew: true });
    this.s.on('state', st => { this.state = st; });
    this.s.on('joined', c => { this.creds = c; this.hello(); });
    await new Promise(r => this.s.once('connect', r));
  }
  async join(team) {
    const r = await call(this.s, 'p:join', { room: CODE, name: this.name });
    if (r.pending) return 'pending';
    this.creds = r;
    await this.hello();
    if (team) await call(this.s, 'p:team', { team });
  }
  hello() { return call(this.s, 'p:hello', this.creds); }
  async drop(ms) { // phone loses signal, then comes back with its saved token
    this.paused = true; this.s.disconnect();
    await sleep(ms);
    await this.connect(); await this.hello(); this.paused = false;
  }
  step() {
    if (this.paused || !this.s.connected) return;
    if (this.r.chance(0.12)) this.s.emit('hb');
    const st = this.state;
    if (!st || st.phase !== 'live' || !st.playing || !st.view) return;
    const mod = GAMES[st.game.id];
    if (!mod.bot || !this.r.chance(0.5)) return;
    let a = null;
    try { a = this.listen(st) || (this.r.chance(EARS ? 0.25 : 1) ? mod.bot(st.view, this.r) : null); } catch (e) { errors.push(`bot ${st.game.id}: ${e.stack}`); }
    if (!a) return;
    const msg = { actionId: Math.random().toString(36).slice(2), ...a };
    this.s.emit('act', msg); this.acts++;
    if (this.r.chance(0.05)) { this.s.emit('act', msg); this.dup++; } // double tap
  }
  // "Ears": what a real player would hear across the room. Bots share it through a board per team, so
  // pairs really find each other, shouted instructions get pressed and shouted numbers carry the chain.
  // (Set EARS=0 for purely random tapping.)
  listen(st) {
    if (!EARS) return null;
    const v = st.view, team = st.me.team, me = st.me.id, b = board(team);
    if (st.game.id === 'pairhunt' && v.status === 'hunt' && v.symbol) {
      const key = v.symbol.name;
      b.ph.set(me, { key, code: v.code, gid: v.gid });
      if (v.typed) return null;
      for (const [id, x] of b.ph) if (id !== me && x.key === key && x.gid === v.gid && this.r.chance(0.35)) return { type: 'code', code: String(x.code) };
    }
    if (st.game.id === 'shout' && v.buttons) {
      if (v.instr) b.shout.set(me, v.instr.text.toLowerCase()); else b.shout.delete(me);
      const asked = new Set([...b.shout].filter(([id]) => id !== me).map(([, t]) => t));
      const mine = v.buttons.find(x => asked.has(x.label.toLowerCase()));
      if (mine && this.r.chance(0.6)) return { type: 'press', button: mine.id };
    }
    if (st.game.id === 'maths') {
      if (v.status === 'done' && v.answer != null) b.maths = v.answer;
      if (v.status === 'turn') {
        let x = v.start != null ? v.start : v.incoming != null ? v.incoming : b.maths;
        if (x == null) return null;
        for (const s of v.steps || []) x = applyText(x, s.text);
        return { type: 'answer', value: this.r.chance(0.85) ? x : x + 1 };
      }
    }
    return null;
  }
}
const EARS = process.env.EARS !== '0';
const boards = {};
const board = t => (boards[t] = boards[t] || { ph: new Map(), shout: new Map(), maths: null });
function applyText(v, text) {
  const m = String(text).trim().match(/^([+−×÷]) (\d+)$/);
  if (m) { const n = Number(m[2]); return { '+': v + n, '−': v - n, '×': v * n, '÷': v / n }[m[1]]; }
  return { 'Double it': v * 2, 'Half it': v / 2, 'Add the digits': String(v).split('').reduce((a, d) => a + Number(d), 0), 'Square it': v * v }[String(text).trim()];
}
const bots = [];
for (let i = 1; i <= 30; i++) bots.push(new Bot(i, i <= 15 ? 'red' : 'blue'));
await Promise.all(bots.map(b => b.connect()));
for (const b of bots) await b.join(b.team);
const hbTimer = setInterval(() => bots.forEach(b => !b.paused && b.s.connected && b.s.emit('hb')), 3000);
const stepTimer = setInterval(() => bots.forEach(b => b.step()), 200);
await until(() => hs && hs.counts.red === 15 && hs.counts.blue === 15, 10000, '30 players in the lobby');
log('30 bots joined');
await cmd({ cmd: 'lock' });

// late joiner after lock, assigned by the host
const late = new Bot(31, 'blue'); late.name = 'Latecomer';
await late.connect(); await late.join(null);
await until(() => hs.players.some(p => p.name === 'Latecomer' && p.waiting), 5000, 'late joiner in the queue');
await cmd({ cmd: 'assign', pid: late.creds.playerId, team: 'blue' });
bots.push(late);

// handover: Bot3 "loses their phone" and joins again by name on a new one
const newPhone = new Bot(3, 'red');
await newPhone.connect();
const ho = await newPhone.join(null);
if (ho !== 'pending') throw new Error('expected a handover prompt');
await until(() => hs.handovers.length === 1, 5000, 'handover prompt');
await cmd({ cmd: 'handover', id: hs.handovers[0].id, yes: true });
await until(() => newPhone.state && newPhone.state.me && newPhone.state.me.name === 'Bot3', 5000, 'handover to finish');
bots[2].s.disconnect(); bots[2] = newPhone;
log('late joiner and handover ok');

async function playRound(label) {
  for (const k in boards) delete boards[k];
  await cmd({ cmd: 'start' });
  await until(() => hs.phase === 'live', 10000, 'live');
  const segId = hs.seg.segId;
  // chaos: three phones drop for 15 s of real time (they go offline and come back)
  const victims = [bots[4], bots[20], bots[9]];
  const chaos = Promise.all(victims.map((b, k) => sleep(300 + k * 500).then(() => b.drop(12000 + k * 1500))));
  // one pause in the middle of the first round of each game
  if (label.endsWith('#1')) { await sleep(1000); await cmd({ cmd: 'pause' }); await sleep(1500); await cmd({ cmd: 'resume' }); }
  await until(() => ['time', 'results', 'gameover'].includes(hs.phase), 400000 / SPEED + 60000, `end of ${label}`);
  await chaos;
  await until(() => ['results', 'gameover'].includes(hs.phase), 20000, 'results');
  const seg = hs.results[hs.results.length - 1];
  log(`${label} ${segId}: raw R${seg.raw.red ?? '-'} B${seg.raw.blue ?? '-'} → score R${seg.score.red ?? '-'} B${seg.score.blue ?? '-'} | ${Object.values(seg.lines).join(' / ')}`);
}

async function playGame(id, n) {
  await cmd({ cmd: 'game', game: id });
  let k = 0;
  while (hs.phase !== 'gameover') {
    await until(() => ['intro', 'results', 'gameover'].includes(hs.phase), 20000, 'between rounds');
    if (hs.phase === 'gameover') break;
    await playRound(`${id}#${++k}`);
  }
  log(`${id} done; championship R${hs.championship.total.red} B${hs.championship.total.blue}`);
}

const plan = (process.env.GAMES || 'pairhunt,shout,maths').split(',');
for (const id of plan) await playGame(id);
if (plan.includes('shout') && !process.env.QUICK) { await cmd({ cmd: 'option', shoutMode: 'turn' }); await playGame('shout'); }

// Don't Say It and the final
await cmd({ cmd: 'dsi' });
await cmd({ cmd: 'dsiStart', team: 'red' });
for (const [team, d] of [['red', 1], ['red', 1], ['blue', -1], ['blue', 1]]) await cmd({ cmd: 'dsiPoint', team, delta: d });
await cmd({ cmd: 'adjust', team: 'blue', points: 3, reason: 'bot test adjustment' });
await cmd({ cmd: 'final' });
await until(() => bots.every(b => b.state && b.state.phase === 'final'), 10000, 'every phone on the final screen');

// ---------- checks ----------
const room = rooms.get(CODE);
const problems = [];
for (const s of room.segments) {
  for (const t of s.teams) {
    const sum = room.events.filter(e => e.segId === s.segId && e.team === t).reduce((a, e) => a + e.points, 0);
    if (sum !== s.raw[t]) problems.push(`${s.segId} ${t}: raw ${s.raw[t]} ≠ events ${sum}`);
    const mod = GAMES[s.game];
    const want = s.practice ? 0 : mod.normalise ? Math.round(sum * 10 / Math.max(1, s.teamSize[t])) : sum;
    if (want !== s.score[t]) problems.push(`${s.segId} ${t}: score ${s.score[t]} ≠ ${want}`);
  }
}
const ch = scoring.championship(room);
for (const t of ['red', 'blue']) {
  const sum = ch.games.reduce((a, g) => a + g.points[t], 0) + ch.adjust[t];
  if (sum !== ch.total[t]) problems.push(`championship ${t}: ${ch.total[t]} ≠ ${sum}`);
  if (room.final.total[t] !== ch.total[t]) problems.push(`final ${t} ≠ championship`);
}
for (const g of ch.games) if (Math.max(g.points.red, g.points.blue) !== 100 && (g.totals.red > 0 || g.totals.blue > 0)) problems.push(`${g.id}: nobody got 100`);
if (room.events.some(e => e.points !== Math.round(e.points))) problems.push('fractional points');
const gameErrors = room.warnings.filter(w => /error/i.test(w.text)).map(w => w.text);
const totalActs = bots.reduce((a, b) => a + b.acts, 0);
log(`final: champion ${room.final.champion}, Red ${room.final.total.red} · Blue ${room.final.total.blue}; ${room.events.length} events; ${totalActs} bot actions (${bots.reduce((a, b) => a + b.dup, 0)} double taps)`);
log('MVPs:', room.final.mvps.map(m => `${m.team} ${m.label}: ${m.name} ${m.value}`).join('; '));

clearInterval(hbTimer); clearInterval(stepTimer);
host.disconnect(); bots.forEach(b => b.s.disconnect());
const fail = [...problems, ...gameErrors, ...errors];
if (fail.length) { origError('BOT TEST FAILED:\n' + fail.slice(0, 30).join('\n')); process.exit(1); }
console.log('bot test passed');
process.exit(0);
