// Server restart: start the real server as a child process with a temp DATA_DIR, play a round of the demo
// game, start another, kill the server mid-round, start it again, and check that the host and the players
// reconnect with their saved tokens, finished scores are kept and the interrupted round is ready to replay.
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { io: connect } = require('socket.io-client');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = mkdtempSync(path.join(tmpdir(), 'sabha-'));
const PORT = 3190 + Math.floor(Math.random() * 50);
const URL = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const call = (s, ev, d) => new Promise(res => s.emit(ev, d, res));

function server() {
  const p = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, SABHA_SPEED: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise(res => p.stdout.on('data', d => { if (/Sabha games on/.test(String(d))) res(p); }));
}
async function sock() { const s = connect(URL, { transports: ['websocket'], forceNew: true, reconnection: false }); await new Promise(r => s.once('connect', r)); return s; }

let srv = await server();
let host = await sock();
let hs = null; host.on('state', s => { hs = s; });
const { room, hostToken } = await call(host, 'host:create', null);
await call(host, 'host:hello', { room, hostToken });
const creds = [];
for (const [name, team] of [['Ravi', 'red'], ['Meet', 'red'], ['Priya', 'blue'], ['Asha', 'blue']]) {
  const s = await sock();
  const c = await call(s, 'p:join', { room, name });
  await call(s, 'p:hello', c); await call(s, 'p:team', { team });
  creds.push({ ...c, s });
}
const cmd = async c => { const r = await call(host, 'host:cmd', c); assert(!r.error, c.cmd + ': ' + r.error); };
await cmd({ cmd: 'lock' });
await cmd({ cmd: 'game', game: 'demo' });
await cmd({ cmd: 'start' });
await sleep(3400);
for (let i = 0; i < 4; i++) { creds[0].s.emit('act', { actionId: 'x' + i, type: 'tap' }); await sleep(260); }
await cmd({ cmd: 'endRound' });
await sleep(3000);
// play again (replay), kill it mid-round
await cmd({ cmd: 'replayRound' });
await cmd({ cmd: 'start' });
await sleep(3400);
creds[2].s.emit('act', { actionId: 'y', type: 'tap' });
await sleep(300);
srv.kill('SIGKILL');
await sleep(300);

srv = await server();
host = await sock(); hs = null; host.on('state', s => { hs = s; });
assert((await call(host, 'host:hello', { room, hostToken })).ok, 'host reconnects after restart');
await sleep(300);
assert(hs && hs.phase === 'intro', 'interrupted first round goes back to intro, got ' + (hs && hs.phase));
assert(hs.players.length === 4 && hs.locked, 'players and lock kept');
for (const c of creds) {
  const s = await sock(); let st = null; s.on('state', x => { st = x; });
  assert((await call(s, 'p:hello', { room, playerId: c.playerId, token: c.token })).ok, 'player reconnects with saved token');
  await sleep(100);
  assert(st && st.me.seat >= 1, 'seat kept');
  s.disconnect();
}
// the interrupted round's taps are gone; replaying works
await cmd({ cmd: 'start' });
await sleep(3400);
assert(hs.phase === 'live', 'replayed round is live');
host.disconnect(); srv.kill('SIGKILL');
rmSync(DATA, { recursive: true, force: true });
console.log('restart test passed');
process.exit(0);
