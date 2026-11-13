'use strict';
// HTTP + Socket.IO front door. All game logic lives in room.js and games/*.js; this file only maps
// sockets to rooms/players, serves the pages and the join QR, ticks rooms and saves them to disk.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Room, registerGame, GAMES, makeCode } = require('./room');

for (const f of fs.readdirSync(path.join(__dirname, 'games')).sort()) {
  if (f.endsWith('.js')) registerGame(require(path.join(__dirname, 'games', f)));
}

const PORT = Number(process.env.PORT) || 3100;
const PUBLIC = path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const KEEP_MS = 24 * 3600 * 1000;
const SAVE = process.env.NO_SAVE ? null : true;
// SABHA_SPEED=10 runs every round ten times faster (bot test only); heartbeats stay on real time
const SPEED = Number(process.env.SABHA_SPEED) || 1;
const T0 = Date.now();
const gameClock = SPEED === 1 ? Date.now : () => T0 + (Date.now() - T0) * SPEED;

const rooms = new Map();
let io;

function transport(code) {
  const P = pid => `p:${code}:${pid}`;
  return {
    player: (pid, ev, data) => io.to(P(pid)).emit(ev, data),
    team: (team, ev, data) => {
      const room = rooms.get(code); if (!room) return;
      // during a round, a team is the round's roster (someone moved mid-round still plays for their old team)
      const seg = room.current && room.current.seg;
      const ids = (seg && ['countdown', 'live'].includes(room.phase) && seg.teams.includes(team)
        ? seg.roster[team].map(p => P(p.id))
        : Object.values(room.players).filter(p => p.team === team && !p.removed).map(p => P(p.id)));
      if (ids.length) io.to(ids).emit(ev, data);
    },
    all: (ev, data) => io.to(`r:${code}`).emit(ev, data),
    host: (ev, data) => io.to(`h:${code}`).emit(ev, data),
    req: (reqId, ev, data) => io.to(`q:${code}:${reqId}`).emit(ev, data),
    kick: async (pid) => {
      const socks = await io.in(P(pid)).fetchSockets();
      for (const s of socks) { s.emit('replaced'); s.leave(P(pid)); s.data.pid = null; }
    },
  };
}

function saveRoom(room) {
  if (!SAVE) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, room.code + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(room.toJSON()));
  fs.renameSync(file + '.tmp', file);
}

function loadRooms() {
  if (!SAVE || !fs.existsSync(DATA_DIR)) return;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!/^[A-Z]{4}\.json$/.test(f)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      if (Date.now() - (d.touched || 0) > KEEP_MS) continue;
      const room = Room.fromJSON(d, { transport: transport(d.code), save: saveRoom, clock: gameClock, wall: Date.now });
      rooms.set(room.code, room);
      console.log(`reloaded room ${room.code} (${Object.keys(room.players).length} players, phase ${room.phase})`);
    } catch (e) { console.error('could not reload', f, e.message); }
  }
}

function createRoom() {
  const code = makeCode(c => rooms.has(c));
  const room = new Room(code, { transport: transport(code), save: saveRoom, clock: gameClock, wall: Date.now });
  rooms.set(code, room);
  room.save();
  return room;
}

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const qr = p.match(/^\/qr\/([A-Z]{4})\.svg$/);
  if (qr) {
    const svg = await QRCode.toString(`${origin(req)}/?r=${qr[1]}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d2433', light: '#ffffff' } });
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' });
    return res.end(svg);
  }
  if (p === '/' || p === '/join') p = '/index.html';
  if (p === '/host') p = '/host.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- sockets ----------
function wire(socket) {
  const ack = fn => (typeof fn === 'function' ? fn : () => {});
  const roomOf = code => rooms.get(String(code || '').toUpperCase());

  socket.on('ping', (t0, cb) => ack(cb)(gameClock()));

  socket.on('room:exists', (code, cb) => { const r = roomOf(code); ack(cb)(r ? { ok: true, locked: r.locked } : { ok: false }); });

  // ----- host -----
  socket.on('host:create', (_, cb) => {
    const room = createRoom();
    ack(cb)({ room: room.code, hostToken: room.hostToken });
  });
  socket.on('host:hello', ({ room: code, hostToken } = {}, cb) => {
    const room = roomOf(code);
    if (!room || room.hostToken !== hostToken) return ack(cb)({ error: 'unknown' });
    socket.data.host = room.code;
    socket.join(`h:${room.code}`);
    ack(cb)({ ok: true });
    socket.emit('state', room.hostState());
  });
  socket.on('host:cmd', (c, cb) => {
    const room = socket.data.host && rooms.get(socket.data.host);
    if (!room) return ack(cb)({ error: 'Not the host.' });
    ack(cb)(room.hostCmd(c));
  });
  socket.on('host:audit', (_, cb) => {
    const room = socket.data.host && rooms.get(socket.data.host);
    ack(cb)(room ? room.audit() : { error: 'Not the host.' });
  });

  // ----- players -----
  const bind = (room, p) => {
    if (socket.data.pid && socket.data.pid !== p.id) socket.leave(`p:${room.code}:${socket.data.pid}`);
    socket.data.room = room.code; socket.data.pid = p.id;
    socket.join(`p:${room.code}:${p.id}`);
    socket.join(`r:${room.code}`);
  };
  socket.on('p:hello', ({ room: code, playerId, token } = {}, cb) => {
    const room = roomOf(code);
    if (!room) return ack(cb)({ error: 'noroom' });
    const p = room.hello(playerId, token);
    if (!p) return ack(cb)({ error: 'unknown' });
    bind(room, p);
    ack(cb)({ ok: true });
    socket.emit('state', room.playerState(p.id));
  });
  socket.on('p:join', ({ room: code, name } = {}, cb) => {
    const room = roomOf(code);
    if (!room) return ack(cb)({ error: 'No game with that code.' });
    const reqId = Math.random().toString(36).slice(2, 10);
    socket.join(`q:${room.code}:${reqId}`);
    const r = room.join(name, reqId);
    if (r.error) return ack(cb)({ error: r.error });
    if (r.pending) return ack(cb)({ pending: true, reqId });
    ack(cb)({ room: room.code, playerId: r.player.id, token: r.player.token });
  });
  // a phone waiting for the host's "Is this you?" answer reconnects, or gives up
  socket.on('p:pending', ({ room: code, reqId } = {}, cb) => {
    const room = roomOf(code);
    if (!room || !reqId) return ack(cb)({ error: 'gone' });
    socket.join(`q:${room.code}:${reqId}`);
    ack(cb)(room.pendingStatus(String(reqId)));
  });
  socket.on('p:cancel', ({ room: code, reqId } = {}, cb) => {
    const room = roomOf(code);
    if (room && reqId) room.cancelHandover(String(reqId));
    ack(cb)({ ok: true });
  });
  const mine = () => { const room = socket.data.room && rooms.get(socket.data.room); return room && socket.data.pid ? room : null; };
  socket.on('p:team', ({ team } = {}, cb) => { const room = mine(); ack(cb)(room ? room.pickTeam(socket.data.pid, team) : { error: 'Not joined.' }); });
  socket.on('hb', () => { const room = mine(); if (room) { room.heartbeat(socket.data.pid); } });
  socket.on('act', (a) => { const room = mine(); if (room) room.action(socket.data.pid, a); });
}

function start(port = PORT) {
  if (SPEED === 1) loadRooms();
  const server = http.createServer((req, res) => handle(req, res).catch(e => { console.error(e); res.writeHead(500); res.end(); }));
  io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, cors: { origin: true } });
  io.on('connection', wire);
  const t = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      try { room.tick(); } catch (e) { console.error(`[${code}] tick`, e); }
      if (gameClock() - room.touched > KEEP_MS * SPEED) rooms.delete(code);
    }
  }, 250);
  server.on('close', () => clearInterval(t));
  return new Promise(resolve => server.listen(port, () => {
    console.log(`Sabha games on http://localhost:${server.address().port}  (host: /host)  games: ${Object.keys(GAMES).join(', ')}`);
    resolve({ server, io, rooms });
  }));
}

if (require.main === module) start();
module.exports = { start, rooms };
